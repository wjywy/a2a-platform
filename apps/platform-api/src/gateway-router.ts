import crypto from "node:crypto";
import { Router, type Response } from "express";
import {
  CancelTaskRequest,
  GetTaskRequest,
  SendMessageRequest,
  SendMessageResponse,
  StreamResponse,
  SubscribeToTaskRequest,
  Task,
  AgentCard,
  ListTasksRequest,
  ListTasksResponse,
  TaskPushNotificationConfig,
  GetTaskPushNotificationConfigRequest,
  DeleteTaskPushNotificationConfigRequest,
  ListTaskPushNotificationConfigsRequest,
  ListTaskPushNotificationConfigsResponse,
  SSE_HEADERS,
  formatSSEErrorEvent,
  formatSSEEvent,
} from "@a2a-js/sdk";
import {
  authenticateApiKey,
  apiKeyAuditIdentity,
  requireApiKeyScope,
  type AuthenticatedApiKey,
} from "./api-key-service.js";
import {
  acquireQuota,
  acquireAgentConcurrency,
  recordUsage,
  searchUsage,
  usageSummary,
  usageCsv,
  usageByteLength,
  type QuotaLease,
  type ConcurrencyLease,
} from "./quota-service.js";
import { AppError, ForbiddenError, NotFoundError } from "./domain.js";
import { asyncHandler, pathParam } from "./http.js";
import type { AuthenticatedRequest } from "./auth.js";
import { getAgentBySlug, listAgents } from "./repositories.js";
import {
  getRemoteClient,
  platformCard,
  streamEventSummary,
} from "./agent-service.js";
import type { PlatformAgent } from "./types.js";
import {
  appendTaskEvent,
  assertKnownRemoteTaskTenant,
  assertRemoteTaskTenant,
  markTaskCancelled,
  taskInstanceBinding,
  listObservedTasks,
} from "./task-service.js";
import { getRedis } from "./redis.js";
import { config } from "./config.js";
import {
  acquireAgentInstance,
  credentialForInstance,
  type InstanceLease,
} from "./agent-instance-service.js";

const router = Router();
type GatewayContext = {
  agent: PlatformAgent;
  key: AuthenticatedApiKey;
  lease: QuotaLease;
  agentLease: ConcurrencyLease;
  instanceLease: InstanceLease;
  startedAt: number;
  inputBytes: number;
};

async function assertMessageTaskReferences(
  agentId: string,
  tenantId: string,
  request: SendMessageRequest,
): Promise<void> {
  const references = new Set(
    [
      request.message?.taskId,
      ...(request.message?.referenceTaskIds ?? []),
    ].filter((value): value is string => Boolean(value)),
  );
  for (const taskId of references)
    await assertRemoteTaskTenant(agentId, taskId, tenantId);
}

function apiSecret(req: AuthenticatedRequest): string | undefined {
  return (
    req.header("x-api-key") ??
    req.header("authorization")?.replace(/^Bearer\s+/i, "")
  );
}
async function activeAgent(slug: string): Promise<PlatformAgent> {
  const agent = await getAgentBySlug(slug);
  if (!agent) throw new NotFoundError("Agent", slug);
  if (!["online", "degraded"].includes(agent.status))
    throw new AppError(503, "AGENT_OFFLINE", "Agent 当前未上线。");
  return agent;
}
async function catalogKey(
  req: AuthenticatedRequest,
): Promise<AuthenticatedApiKey> {
  const secret = apiSecret(req);
  if (!secret)
    throw new AppError(
      401,
      "API_KEY_REQUIRED",
      "请通过 X-API-Key 提供调用密钥。",
    );
  const key = await authenticateApiKey(secret);
  if (key.tenantStatus !== "active")
    throw new ForbiddenError("TENANT_SUSPENDED", "API Key 所属租户已停用。");
  requireApiKeyScope(key, "agent:invoke");
  return key;
}
async function scopedKey(
  req: AuthenticatedRequest,
  scope: "agent:invoke" | "task:read" | "task:cancel" | "usage:read",
): Promise<AuthenticatedApiKey> {
  const secret = apiSecret(req);
  if (!secret)
    throw new AppError(
      401,
      "API_KEY_REQUIRED",
      "请通过 X-API-Key 提供调用密钥。",
    );
  const key = await authenticateApiKey(secret);
  if (key.tenantStatus !== "active")
    throw new ForbiddenError("TENANT_SUSPENDED", "API Key 所属租户已停用。");
  requireApiKeyScope(key, scope);
  return key;
}
function assertAgentAccess(
  agent: PlatformAgent,
  key: AuthenticatedApiKey,
): void {
  if (key.allowedAgentIds.length && !key.allowedAgentIds.includes(agent.id))
    throw new ForbiddenError(
      "API_KEY_AGENT_DENIED",
      "此 API Key 未获授权调用该 Agent。",
    );
  if (agent.visibility === "public") return;
  if (!agent.tenantId)
    throw new ForbiddenError(
      "AGENT_NOT_ASSIGNED",
      "Agent 尚未分配租户，不能由外部 API Key 调用。",
    );
  if (agent.tenantId === key.tenantId) return;
  if (
    agent.visibility === "tenant" &&
    agent.allowedTenantIds.includes(key.tenantId)
  )
    return;
  throw new ForbiddenError(
    "AGENT_ACCESS_DENIED",
    "当前 API Key 所属租户无权调用该 Agent。",
  );
}
async function gatewayContext(
  req: AuthenticatedRequest,
  scope: "agent:invoke" | "task:read" | "task:cancel",
  explicitTaskId?: string,
): Promise<GatewayContext> {
  const agent = await activeAgent(pathParam(req, "slug"));
  const secret = apiSecret(req);
  if (!secret)
    throw new AppError(
      401,
      "API_KEY_REQUIRED",
      "请通过 X-API-Key 提供调用密钥。",
    );
  let key: AuthenticatedApiKey;
  try {
    key = await authenticateApiKey(secret);
  } catch (error) {
    const known = await apiKeyAuditIdentity(secret);
    if (known)
      await recordUsage({
        tenantId: known.tenantId,
        apiKeyId: known.id,
        agentId: agent.id,
        callerId: known.prefix,
        requestId: req.requestId ?? crypto.randomUUID(),
        operation: scope,
        statusCode: error instanceof AppError ? error.status : 401,
        inputBytes: usageByteLength(req.body ?? {}),
        errorCode:
          error instanceof AppError ? error.code : "API_KEY_AUTH_FAILED",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    throw error;
  }
  try {
    if (key.tenantStatus !== "active")
      throw new ForbiddenError("TENANT_SUSPENDED", "API Key 所属租户已停用。");
    requireApiKeyScope(key, scope);
    assertAgentAccess(agent, key);
    const message =
      req.body && typeof req.body === "object" && "message" in req.body
        ? (req.body.message as Record<string, unknown> | undefined)
        : undefined;
    const remoteTaskId =
      explicitTaskId ??
      (typeof req.params.taskId === "string" ? req.params.taskId : undefined) ??
      (typeof message?.taskId === "string" && message.taskId
        ? message.taskId
        : undefined);
    if (remoteTaskId)
      await assertKnownRemoteTaskTenant(agent.id, remoteTaskId, key.tenantId);
  } catch (error) {
    await recordUsage({
      tenantId: key.tenantId,
      apiKeyId: key.id,
      agentId: agent.id,
      callerId: key.prefix,
      requestId: req.requestId ?? crypto.randomUUID(),
      operation: scope,
      statusCode: error instanceof AppError ? error.status : 403,
      inputBytes: usageByteLength(req.body ?? {}),
      errorCode: error instanceof AppError ? error.code : "ACCESS_DENIED",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  let lease: QuotaLease;
  try {
    lease = await acquireQuota(key);
  } catch (error) {
    await recordUsage({
      tenantId: key.tenantId,
      apiKeyId: key.id,
      agentId: agent.id,
      callerId: key.prefix,
      requestId: req.requestId ?? crypto.randomUUID(),
      operation: scope,
      statusCode: error instanceof AppError ? error.status : 500,
      inputBytes: usageByteLength(req.body ?? {}),
      errorCode: error instanceof AppError ? error.code : "QUOTA_CHECK_FAILED",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  let agentLease: ConcurrencyLease;
  try {
    agentLease = await acquireAgentConcurrency(
      agent.id,
      agent.invocationPolicy.maxConcurrent,
    );
  } catch (error) {
    await Promise.allSettled([lease.release()]);
    await recordUsage({
      tenantId: key.tenantId,
      apiKeyId: key.id,
      agentId: agent.id,
      callerId: key.prefix,
      requestId: req.requestId ?? crypto.randomUUID(),
      operation: scope,
      statusCode: error instanceof AppError ? error.status : 500,
      inputBytes: usageByteLength(req.body ?? {}),
      errorCode:
        error instanceof AppError ? error.code : "CONCURRENCY_CHECK_FAILED",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  let instanceLease: InstanceLease;
  try {
    const message =
      req.body && typeof req.body === "object" && "message" in req.body
        ? (req.body.message as Record<string, unknown> | undefined)
        : undefined;
    const remoteTaskId =
      explicitTaskId ??
      (typeof req.params.taskId === "string" ? req.params.taskId : undefined) ??
      (typeof message?.taskId === "string" && message.taskId
        ? message.taskId
        : undefined);
    const preferredInstanceId = remoteTaskId
      ? await taskInstanceBinding(agent.id, remoteTaskId, key.tenantId)
      : undefined;
    instanceLease = await acquireAgentInstance(agent, preferredInstanceId);
  } catch (error) {
    await Promise.allSettled([lease.release(), agentLease.release()]);
    await recordUsage({
      tenantId: key.tenantId,
      apiKeyId: key.id,
      agentId: agent.id,
      callerId: key.prefix,
      requestId: req.requestId ?? crypto.randomUUID(),
      operation: scope,
      statusCode: error instanceof AppError ? error.status : 503,
      inputBytes: usageByteLength(req.body ?? {}),
      errorCode:
        error instanceof AppError ? error.code : "INSTANCE_SELECTION_FAILED",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  return {
    agent,
    key,
    lease,
    agentLease,
    instanceLease,
    startedAt: performance.now(),
    inputBytes: usageByteLength(req.body ?? {}),
  };
}
function quotaHeaders(res: Response, lease: QuotaLease): void {
  for (const quota of lease.snapshots) {
    const subject = quota.subject === "tenant" ? "Tenant" : "Key";
    const suffix = quota.window[0].toUpperCase() + quota.window.slice(1);
    res.setHeader(
      `X-RateLimit-${subject}-${suffix}-Limit`,
      String(quota.limit),
    );
    res.setHeader(
      `X-RateLimit-${subject}-${suffix}-Remaining`,
      String(quota.remaining),
    );
    if (quota.resetsAt)
      res.setHeader(`X-RateLimit-${subject}-${suffix}-Reset`, quota.resetsAt);
  }
  for (const window of ["minute", "day", "month", "concurrent"] as const) {
    const entries = lease.snapshots.filter((item) => item.window === window);
    const limit = Math.min(...entries.map((item) => item.limit));
    const remaining = Math.min(...entries.map((item) => item.remaining));
    const suffix = window[0].toUpperCase() + window.slice(1);
    res.setHeader(`X-RateLimit-${suffix}-Limit`, String(limit));
    res.setHeader(`X-RateLimit-${suffix}-Remaining`, String(remaining));
  }
}
async function finish(
  context: GatewayContext,
  req: AuthenticatedRequest,
  input: {
    operation: string;
    statusCode: number;
    outputBytes?: number;
    eventCount?: number;
    errorCode?: string;
    errorMessage?: string;
    remoteTaskId?: string;
  },
): Promise<void> {
  const outcomes = await Promise.allSettled([
    context.lease.release(),
    context.agentLease.release(),
    context.instanceLease.release(),
    recordUsage({
      tenantId: context.key.tenantId,
      apiKeyId: context.key.id,
      agentId: context.agent.id,
      agentInstanceId: context.instanceLease.instance.id,
      callerId: context.key.prefix,
      requestId: req.requestId ?? crypto.randomUUID(),
      operation: input.operation,
      statusCode: input.statusCode,
      latencyMs: Math.round(performance.now() - context.startedAt),
      inputBytes: context.inputBytes,
      outputBytes: input.outputBytes ?? 0,
      eventCount: input.eventCount ?? 0,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      remoteTaskId: input.remoteTaskId,
    }),
  ]);
  for (const outcome of outcomes)
    if (outcome.status === "rejected")
      console.error("Gateway finalization failed:", outcome.reason);
}
async function remoteClient(context: GatewayContext) {
  return getRemoteClient(context.agent, {
    selectedInterface: context.instanceLease.instance.selectedInterface,
    credential: await credentialForInstance(context.instanceLease.instance.id),
  });
}
async function publishRealtime(agentId: string, event: unknown): Promise<void> {
  const redis = await getRedis();
  if (redis)
    await redis.publish(`agent:${agentId}:events`, JSON.stringify(event));
}
type TaskWebhookEventType =
  "task.created" | "task.working" | "task.completed" | "task.failed";
function webhookTypes(
  state: string | undefined,
  includeCreated: boolean,
): TaskWebhookEventType[] {
  const result: TaskWebhookEventType[] = includeCreated ? ["task.created"] : [];
  const value = (state ?? "").toLowerCase();
  if (value.includes("working") || value.includes("submitted"))
    result.push("task.working");
  if (value.includes("completed")) result.push("task.completed");
  if (value.includes("failed") || value.includes("cancel"))
    result.push("task.failed");
  return [...new Set(result)];
}
function normalizeRemoteError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  return new AppError(
    502,
    "REMOTE_AGENT_ERROR",
    error instanceof Error ? error.message : "远端 Agent 调用失败。",
  );
}
function callTimeout(agent: PlatformAgent): number {
  return Math.min(
    agent.invocationPolicy.timeoutMs,
    config.maxA2ACallDurationMs,
  );
}
function assertStreamBudget(eventBytes: number, eventCount: number): void {
  if (
    eventBytes > config.maxA2AEventBytes ||
    eventCount > config.maxA2AStreamEvents
  )
    throw new AppError(
      502,
      "REMOTE_STREAM_LIMIT_EXCEEDED",
      "远端 Agent 流式输出超过平台事件大小或数量上限。",
      {
        eventBytes,
        eventCount,
        maxEventBytes: config.maxA2AEventBytes,
        maxEvents: config.maxA2AStreamEvents,
      },
    );
}
async function retry<T>(
  agent: PlatformAgent,
  operation: (signal: AbortSignal) => Promise<T>,
  maxRetries = agent.invocationPolicy.maxRetries,
): Promise<{ value: T; retries: number }> {
  let attempt = 0;
  let last: unknown;
  while (attempt <= maxRetries) {
    try {
      const signal = AbortSignal.timeout(callTimeout(agent));
      const value = await operation(signal);
      return { value, retries: attempt };
    } catch (error) {
      last = error;
      if (attempt >= maxRetries) break;
      attempt++;
    }
  }
  throw last;
}

router.get(
  "/agents/:slug/.well-known/agent-card.json",
  asyncHandler(async (req, res) => {
    const agent = await activeAgent(pathParam(req, "slug"));
    res.json(platformCard(agent, config.platformOrigin));
  }),
);

router.get(
  "/v1/agents",
  asyncHandler(async (req, res) => {
    if (!config.publicCatalogEnabled)
      throw new AppError(404, "CATALOG_DISABLED", "Agent 目录未启用。");
    const key = await catalogKey(req);
    const agents = (await listAgents())
      .filter((agent) => ["online", "degraded"].includes(agent.status))
      .filter((agent) => {
        try {
          assertAgentAccess(agent, key);
          return true;
        } catch {
          return false;
        }
      })
      .map((agent) => ({
        slug: agent.slug,
        displayName: agent.displayName,
        description: agent.description,
        labels: agent.labels,
        status: agent.status,
        healthStatus: agent.healthStatus,
        cardUrl: `${config.platformOrigin}/agents/${agent.slug}/.well-known/agent-card.json`,
      }));
    res.json({ agents });
  }),
);

router.get(
  "/v1/agents/:slug",
  asyncHandler(async (req, res) => {
    const key = await catalogKey(req);
    const agent = await activeAgent(pathParam(req, "slug"));
    assertAgentAccess(agent, key);
    res.json({
      agent: {
        slug: agent.slug,
        displayName: agent.displayName,
        description: agent.description,
        labels: agent.labels,
        status: agent.status,
        healthStatus: agent.healthStatus,
        card: AgentCard.toJSON(platformCard(agent, config.platformOrigin)),
      },
    });
  }),
);

router.get(
  "/v1/usage",
  asyncHandler(async (req, res) => {
    const key = await scopedKey(req, "usage:read");
    res.json(
      await searchUsage({
        ...req.query,
        tenantId: key.tenantId,
        apiKeyId: key.id,
      }),
    );
  }),
);

router.get(
  "/v1/usage/summary",
  asyncHandler(async (req, res) => {
    const key = await scopedKey(req, "usage:read");
    res.json({
      summary: await usageSummary({
        ...req.query,
        tenantId: key.tenantId,
        apiKeyId: key.id,
      }),
    });
  }),
);

router.get(
  "/v1/usage/export.csv",
  asyncHandler(async (req, res) => {
    const key = await scopedKey(req, "usage:read");
    res
      .type("text/csv; charset=utf-8")
      .attachment(`usage-${new Date().toISOString().slice(0, 10)}.csv`)
      .send(
        await usageCsv({
          ...req.query,
          tenantId: key.tenantId,
          apiKeyId: key.id,
        }),
      );
  }),
);

router.get(
  "/agents/:slug/a2a/rest/extendedAgentCard",
  asyncHandler(async (req, res) => {
    const context = await gatewayContext(req, "agent:invoke");
    quotaHeaders(res, context.lease);
    try {
      const card = await (
        await remoteClient(context)
      ).getAgentCard({
        signal: AbortSignal.timeout(callTimeout(context.agent)),
      });
      const json = AgentCard.toJSON(card);
      res.json(json);
      await finish(context, req, {
        operation: "agent.extended_card",
        statusCode: 200,
        outputBytes: usageByteLength(json),
      });
    } catch (error) {
      await finish(context, req, {
        operation: "agent.extended_card",
        statusCode: error instanceof AppError ? error.status : 502,
        errorCode:
          error instanceof AppError ? error.code : "REMOTE_AGENT_ERROR",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw normalizeRemoteError(error);
    }
  }),
);

router.post(
  "/agents/:slug/a2a/rest/message\\:send",
  asyncHandler(async (req, res) => {
    const context = await gatewayContext(req, "agent:invoke");
    quotaHeaders(res, context.lease);
    try {
      const request = SendMessageRequest.fromJSON(req.body ?? {});
      request.tenant = context.key.tenantId;
      await assertMessageTaskReferences(
        context.agent.id,
        context.key.tenantId,
        request,
      );
      // Message creation is not guaranteed idempotent by every remote Agent.
      // Keep the configured retry policy for read-only calls, but never replay
      // a write after an ambiguous timeout/connection loss.
      const call = await retry(
        context.agent,
        async (signal) =>
          (await remoteClient(context)).sendMessage(request, {
            signal,
          }),
        0,
      );
      const result = call.value;
      const payload =
        "messageId" in result
          ? { payload: { $case: "message" as const, value: result } }
          : { payload: { $case: "task" as const, value: result } };
      const response = SendMessageResponse.toJSON(payload);
      let taskId: string | undefined;
      if ("id" in result) {
        taskId = result.id;
        const event = response as Record<string, unknown>;
        const state = result.status?.state?.toString();
        await appendTaskEvent({
          agentId: context.agent.id,
          agentInstanceId: context.instanceLease.instance.id,
          tenantId: context.key.tenantId,
          apiKeyId: context.key.id,
          requestId: req.requestId,
          remoteTaskId: result.id,
          contextId: result.contextId,
          operation: "message.send",
          state,
          eventType: "task",
          event,
          requestPayload: SendMessageRequest.toJSON(request) as Record<
            string,
            unknown
          >,
          retryCount: call.retries,
          platformEvents: webhookTypes(state, true).map((type) => ({
            type,
            data: { state, requestId: req.requestId },
          })),
        });
      }
      res.json(response);
      await finish(context, req, {
        operation: "message.send",
        statusCode: 200,
        outputBytes: usageByteLength(response),
        eventCount: 1,
        remoteTaskId: taskId,
      });
    } catch (error) {
      await finish(context, req, {
        operation: "message.send",
        statusCode: error instanceof AppError ? error.status : 502,
        errorCode:
          error instanceof AppError ? error.code : "REMOTE_AGENT_ERROR",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw normalizeRemoteError(error);
    }
  }),
);

router.post(
  "/agents/:slug/a2a/rest/message\\:stream",
  asyncHandler(async (req, res) => {
    const context = await gatewayContext(req, "agent:invoke");
    quotaHeaders(res, context.lease);
    let outputBytes = 0,
      eventCount = 0,
      remoteTaskId: string | undefined,
      firstTaskEvent = true,
      streamError: unknown;
    let abortUpstream: (() => void) | undefined;
    try {
      const request = SendMessageRequest.fromJSON(req.body ?? {});
      request.tenant = context.key.tenantId;
      await assertMessageTaskReferences(
        context.agent.id,
        context.key.tenantId,
        request,
      );
      const client = await remoteClient(context);
      const streamController = new AbortController();
      abortUpstream = () => streamController.abort();
      res.once("close", abortUpstream);
      const stream = client.sendMessageStream(request, {
        signal: AbortSignal.any([
          streamController.signal,
          AbortSignal.timeout(callTimeout(context.agent)),
        ]),
      });
      Object.entries(SSE_HEADERS).forEach(([key, value]) =>
        res.setHeader(key, value),
      );
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();
      for await (const event of stream) {
        const json = StreamResponse.toJSON(event) as Record<string, unknown>;
        const summary = streamEventSummary(event);
        remoteTaskId = summary.remoteTaskId ?? remoteTaskId;
        const eventType = event.payload?.$case ?? "unknown";
        const bytes = usageByteLength(json);
        outputBytes += bytes;
        eventCount++;
        assertStreamBudget(bytes, eventCount);
        res.write(formatSSEEvent(json));
        if (summary.remoteTaskId) {
          await appendTaskEvent({
            agentId: context.agent.id,
            agentInstanceId: context.instanceLease.instance.id,
            tenantId: context.key.tenantId,
            apiKeyId: context.key.id,
            requestId: req.requestId,
            remoteTaskId: summary.remoteTaskId,
            contextId: summary.contextId,
            operation: "message.stream",
            state: summary.state,
            eventType,
            event: json,
            requestPayload: firstTaskEvent
              ? (SendMessageRequest.toJSON(request) as Record<string, unknown>)
              : undefined,
            platformEvents: webhookTypes(summary.state, firstTaskEvent).map(
              (type) => ({
                type,
                data: {
                  state: summary.state,
                  eventType,
                  requestId: req.requestId,
                },
              }),
            ),
          });
          firstTaskEvent = false;
        }
        await publishRealtime(context.agent.id, {
          ...json,
          requestId: req.requestId,
          tenantId: context.key.tenantId,
        });
      }
    } catch (error) {
      streamError = error;
      const message =
        error instanceof Error ? error.message : "远端流式调用失败。";
      if (res.headersSent)
        res.write(
          formatSSEErrorEvent({
            error: message,
            code:
              error instanceof AppError ? error.code : "REMOTE_STREAM_ERROR",
          }),
        );
      else throw normalizeRemoteError(error);
    } finally {
      if (abortUpstream) res.off("close", abortUpstream);
      if (!res.writableEnded) res.end();
      await finish(context, req, {
        operation: "message.stream",
        statusCode: streamError ? 502 : 200,
        outputBytes,
        eventCount,
        errorCode:
          streamError instanceof AppError
            ? streamError.code
            : streamError
              ? "REMOTE_STREAM_ERROR"
              : undefined,
        errorMessage:
          streamError instanceof Error ? streamError.message : undefined,
        remoteTaskId,
      });
    }
  }),
);

router.get(
  "/agents/:slug/a2a/rest/tasks/:taskId",
  asyncHandler(async (req, res) => {
    const context = await gatewayContext(req, "task:read");
    quotaHeaders(res, context.lease);
    try {
      await assertRemoteTaskTenant(
        context.agent.id,
        pathParam(req, "taskId"),
        context.key.tenantId,
      );
      const call = await retry(context.agent, async (signal) =>
        (await remoteClient(context)).getTask(
          GetTaskRequest.fromJSON({
            id: pathParam(req, "taskId"),
            tenant: context.key.tenantId,
            historyLength: req.query.historyLength,
          }),
          { signal },
        ),
      );
      const task = call.value;
      const json = Task.toJSON(task);
      res.json(json);
      await finish(context, req, {
        operation: "task.get",
        statusCode: 200,
        outputBytes: usageByteLength(json),
        remoteTaskId: task.id,
      });
    } catch (error) {
      await finish(context, req, {
        operation: "task.get",
        statusCode: error instanceof AppError ? error.status : 502,
        errorCode:
          error instanceof AppError ? error.code : "REMOTE_AGENT_ERROR",
        errorMessage: error instanceof Error ? error.message : String(error),
        remoteTaskId: pathParam(req, "taskId"),
      });
      throw normalizeRemoteError(error);
    }
  }),
);

router.get(
  "/agents/:slug/a2a/rest/tasks",
  asyncHandler(async (req, res) => {
    const context = await gatewayContext(req, "task:read");
    quotaHeaders(res, context.lease);
    try {
      const request = ListTasksRequest.fromJSON({
        ...req.query,
        tenant: context.key.tenantId,
      });
      const result = ListTasksResponse.fromJSON(
        await listObservedTasks({
          agentId: context.agent.id,
          tenantId: context.key.tenantId,
          contextId: request.contextId || undefined,
          state: request.status ? request.status.toString() : undefined,
          statusTimestampAfter: request.statusTimestampAfter,
          pageSize: request.pageSize,
          pageToken: request.pageToken,
          includeArtifacts: request.includeArtifacts,
        }),
      );
      const json = ListTasksResponse.toJSON(result);
      res.json(json);
      await finish(context, req, {
        operation: "task.list",
        statusCode: 200,
        outputBytes: usageByteLength(json),
      });
    } catch (error) {
      await finish(context, req, {
        operation: "task.list",
        statusCode: error instanceof AppError ? error.status : 502,
        errorCode:
          error instanceof AppError ? error.code : "REMOTE_AGENT_ERROR",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw normalizeRemoteError(error);
    }
  }),
);

router.post(
  "/agents/:slug/a2a/rest/tasks/:taskId/pushNotificationConfigs",
  asyncHandler(async (req, res) => {
    const context = await gatewayContext(req, "agent:invoke");
    quotaHeaders(res, context.lease);
    try {
      await assertRemoteTaskTenant(
        context.agent.id,
        pathParam(req, "taskId"),
        context.key.tenantId,
      );
      const input = TaskPushNotificationConfig.fromJSON({
        ...req.body,
        taskId: pathParam(req, "taskId"),
        tenant: context.key.tenantId,
      });
      const result = await (
        await remoteClient(context)
      ).createTaskPushNotificationConfig(input, {
        signal: AbortSignal.timeout(callTimeout(context.agent)),
      });
      const json = TaskPushNotificationConfig.toJSON(result);
      res.status(201).json(json);
      await finish(context, req, {
        operation: "push_config.create",
        statusCode: 201,
        outputBytes: usageByteLength(json),
        remoteTaskId: input.taskId,
      });
    } catch (error) {
      await finish(context, req, {
        operation: "push_config.create",
        statusCode: error instanceof AppError ? error.status : 502,
        errorCode:
          error instanceof AppError ? error.code : "REMOTE_AGENT_ERROR",
        errorMessage: error instanceof Error ? error.message : String(error),
        remoteTaskId: pathParam(req, "taskId"),
      });
      throw normalizeRemoteError(error);
    }
  }),
);

router.get(
  "/agents/:slug/a2a/rest/tasks/:taskId/pushNotificationConfigs",
  asyncHandler(async (req, res) => {
    const context = await gatewayContext(req, "task:read");
    quotaHeaders(res, context.lease);
    try {
      await assertRemoteTaskTenant(
        context.agent.id,
        pathParam(req, "taskId"),
        context.key.tenantId,
      );
      const input = ListTaskPushNotificationConfigsRequest.fromJSON({
        ...req.query,
        taskId: pathParam(req, "taskId"),
        tenant: context.key.tenantId,
      });
      const result = await (
        await remoteClient(context)
      ).listTaskPushNotificationConfig(input, {
        signal: AbortSignal.timeout(callTimeout(context.agent)),
      });
      const json = ListTaskPushNotificationConfigsResponse.toJSON(result);
      res.json(json);
      await finish(context, req, {
        operation: "push_config.list",
        statusCode: 200,
        outputBytes: usageByteLength(json),
        remoteTaskId: input.taskId,
      });
    } catch (error) {
      await finish(context, req, {
        operation: "push_config.list",
        statusCode: error instanceof AppError ? error.status : 502,
        errorCode:
          error instanceof AppError ? error.code : "REMOTE_AGENT_ERROR",
        errorMessage: error instanceof Error ? error.message : String(error),
        remoteTaskId: pathParam(req, "taskId"),
      });
      throw normalizeRemoteError(error);
    }
  }),
);

router.get(
  "/agents/:slug/a2a/rest/tasks/:taskId/pushNotificationConfigs/:configId",
  asyncHandler(async (req, res) => {
    const context = await gatewayContext(req, "task:read");
    quotaHeaders(res, context.lease);
    try {
      await assertRemoteTaskTenant(
        context.agent.id,
        pathParam(req, "taskId"),
        context.key.tenantId,
      );
      const input = GetTaskPushNotificationConfigRequest.fromJSON({
        taskId: pathParam(req, "taskId"),
        id: pathParam(req, "configId"),
        tenant: context.key.tenantId,
      });
      const result = await (
        await remoteClient(context)
      ).getTaskPushNotificationConfig(input, {
        signal: AbortSignal.timeout(callTimeout(context.agent)),
      });
      const json = TaskPushNotificationConfig.toJSON(result);
      res.json(json);
      await finish(context, req, {
        operation: "push_config.get",
        statusCode: 200,
        outputBytes: usageByteLength(json),
        remoteTaskId: input.taskId,
      });
    } catch (error) {
      await finish(context, req, {
        operation: "push_config.get",
        statusCode: error instanceof AppError ? error.status : 502,
        errorCode:
          error instanceof AppError ? error.code : "REMOTE_AGENT_ERROR",
        errorMessage: error instanceof Error ? error.message : String(error),
        remoteTaskId: pathParam(req, "taskId"),
      });
      throw normalizeRemoteError(error);
    }
  }),
);

router.delete(
  "/agents/:slug/a2a/rest/tasks/:taskId/pushNotificationConfigs/:configId",
  asyncHandler(async (req, res) => {
    const context = await gatewayContext(req, "agent:invoke");
    quotaHeaders(res, context.lease);
    try {
      await assertRemoteTaskTenant(
        context.agent.id,
        pathParam(req, "taskId"),
        context.key.tenantId,
      );
      const input = DeleteTaskPushNotificationConfigRequest.fromJSON({
        taskId: pathParam(req, "taskId"),
        id: pathParam(req, "configId"),
        tenant: context.key.tenantId,
      });
      await (
        await remoteClient(context)
      ).deleteTaskPushNotificationConfig(input, {
        signal: AbortSignal.timeout(callTimeout(context.agent)),
      });
      res.status(204).end();
      await finish(context, req, {
        operation: "push_config.delete",
        statusCode: 204,
        remoteTaskId: input.taskId,
      });
    } catch (error) {
      await finish(context, req, {
        operation: "push_config.delete",
        statusCode: error instanceof AppError ? error.status : 502,
        errorCode:
          error instanceof AppError ? error.code : "REMOTE_AGENT_ERROR",
        errorMessage: error instanceof Error ? error.message : String(error),
        remoteTaskId: pathParam(req, "taskId"),
      });
      throw normalizeRemoteError(error);
    }
  }),
);

router.post(
  "/agents/:slug/a2a/rest/tasks/:taskId\\:cancel",
  asyncHandler(async (req, res) => {
    const context = await gatewayContext(req, "task:cancel");
    quotaHeaders(res, context.lease);
    try {
      await assertRemoteTaskTenant(
        context.agent.id,
        pathParam(req, "taskId"),
        context.key.tenantId,
      );
      const task = await (
        await remoteClient(context)
      ).cancelTask(
        CancelTaskRequest.fromJSON({
          id: pathParam(req, "taskId"),
          tenant: context.key.tenantId,
          metadata: req.body?.metadata,
        }),
        {
          signal: AbortSignal.timeout(callTimeout(context.agent)),
        },
      );
      const json = Task.toJSON(task) as Record<string, unknown>;
      await markTaskCancelled(context.agent.id, task.id, json, {
        tenantId: context.key.tenantId,
        apiKeyId: context.key.id,
        requestId: req.requestId,
        agentInstanceId: context.instanceLease.instance.id,
      });
      res.json(json);
      await finish(context, req, {
        operation: "task.cancel",
        statusCode: 200,
        outputBytes: usageByteLength(json),
        eventCount: 1,
        remoteTaskId: task.id,
      });
    } catch (error) {
      await finish(context, req, {
        operation: "task.cancel",
        statusCode: error instanceof AppError ? error.status : 502,
        errorCode:
          error instanceof AppError ? error.code : "REMOTE_AGENT_ERROR",
        errorMessage: error instanceof Error ? error.message : String(error),
        remoteTaskId: pathParam(req, "taskId"),
      });
      throw normalizeRemoteError(error);
    }
  }),
);

const subscribe = asyncHandler(async (req, res) => {
  const context = await gatewayContext(req, "task:read");
  quotaHeaders(res, context.lease);
  let outputBytes = 0,
    eventCount = 0;
  let streamError: unknown;
  let abortUpstream: (() => void) | undefined;
  try {
    await assertRemoteTaskTenant(
      context.agent.id,
      pathParam(req, "taskId"),
      context.key.tenantId,
    );
    const streamController = new AbortController();
    abortUpstream = () => streamController.abort();
    res.once("close", abortUpstream);
    const stream = (await remoteClient(context)).resubscribeTask(
      SubscribeToTaskRequest.fromJSON({
        id: pathParam(req, "taskId"),
        tenant: context.key.tenantId,
      }),
      {
        signal: AbortSignal.any([
          streamController.signal,
          AbortSignal.timeout(callTimeout(context.agent)),
        ]),
      },
    );
    Object.entries(SSE_HEADERS).forEach(([key, value]) =>
      res.setHeader(key, value),
    );
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    for await (const event of stream) {
      const json = StreamResponse.toJSON(event) as Record<string, unknown>;
      const summary = streamEventSummary(event);
      const bytes = usageByteLength(json);
      outputBytes += bytes;
      eventCount++;
      assertStreamBudget(bytes, eventCount);
      res.write(formatSSEEvent(json));
      await appendTaskEvent({
        agentId: context.agent.id,
        agentInstanceId: context.instanceLease.instance.id,
        tenantId: context.key.tenantId,
        apiKeyId: context.key.id,
        requestId: req.requestId,
        remoteTaskId: summary.remoteTaskId ?? pathParam(req, "taskId"),
        contextId: summary.contextId,
        operation: "task.subscribe",
        state: summary.state,
        eventType: event.payload?.$case ?? "unknown",
        event: json,
        platformEvents: webhookTypes(summary.state, false).map((type) => ({
          type,
          data: { state: summary.state, requestId: req.requestId },
        })),
      });
      await publishRealtime(context.agent.id, {
        ...json,
        requestId: req.requestId,
        tenantId: context.key.tenantId,
      });
    }
  } catch (error) {
    streamError = error;
    if (res.headersSent)
      res.write(
        formatSSEErrorEvent({
          error: error instanceof Error ? error.message : "重新订阅失败。",
        }),
      );
    else throw normalizeRemoteError(error);
  } finally {
    if (abortUpstream) res.off("close", abortUpstream);
    if (!res.writableEnded) res.end();
    await finish(context, req, {
      operation: "task.subscribe",
      statusCode: streamError ? 502 : 200,
      outputBytes,
      eventCount,
      errorCode: streamError ? "REMOTE_STREAM_ERROR" : undefined,
      errorMessage:
        streamError instanceof Error ? streamError.message : undefined,
      remoteTaskId: pathParam(req, "taskId"),
    });
  }
});
router.get("/agents/:slug/a2a/rest/tasks/:taskId\\:subscribe", subscribe);
router.post("/agents/:slug/a2a/rest/tasks/:taskId\\:subscribe", subscribe);

type JsonRpcId = string | number | null;
type JsonRpcRequestBody = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
};
function jsonRpcBody(raw: unknown): JsonRpcRequestBody {
  if (!raw || typeof raw !== "object")
    throw new AppError(
      400,
      "JSONRPC_INVALID_REQUEST",
      "JSON-RPC 请求必须是对象。",
    );
  const value = raw as Partial<JsonRpcRequestBody>;
  if (
    value.jsonrpc !== "2.0" ||
    typeof value.method !== "string" ||
    value.id === undefined
  )
    throw new AppError(
      400,
      "JSONRPC_INVALID_REQUEST",
      "JSON-RPC 版本、方法或 id 无效。",
    );
  return {
    jsonrpc: "2.0",
    id: value.id,
    method: value.method,
    params:
      value.params && typeof value.params === "object" ? value.params : {},
  };
}
function jsonRpcError(id: JsonRpcId, error: unknown) {
  const appError =
    error instanceof AppError ? error : normalizeRemoteError(error);
  return {
    jsonrpc: "2.0" as const,
    id,
    error: {
      code:
        appError.code === "JSONRPC_METHOD_NOT_FOUND"
          ? -32601
          : appError.code === "JSONRPC_INVALID_REQUEST"
            ? -32600
            : appError.status === 401
              ? -32001
              : appError.status === 403
                ? -32003
                : -32000,
      message: appError.message,
      data: {
        code: appError.code,
        status: appError.status,
        ...appError.details,
      },
    },
  };
}
function rpcScope(
  method: string,
): "agent:invoke" | "task:read" | "task:cancel" {
  if (
    [
      "GetTask",
      "ListTasks",
      "SubscribeToTask",
      "GetTaskPushNotificationConfig",
      "ListTaskPushNotificationConfigs",
    ].includes(method)
  )
    return "task:read";
  if (method === "CancelTask") return "task:cancel";
  return "agent:invoke";
}
function taskIdFromParams(params: Record<string, unknown>): string | undefined {
  const message =
    params.message && typeof params.message === "object"
      ? (params.message as Record<string, unknown>)
      : undefined;
  const id = params.id ?? params.taskId ?? message?.taskId;
  return typeof id === "string" && id ? id : undefined;
}

router.post(
  "/agents/:slug/a2a/jsonrpc",
  asyncHandler(async (req, res) => {
    let rpc: JsonRpcRequestBody;
    try {
      rpc = jsonRpcBody(req.body);
    } catch (error) {
      res.status(400).json(jsonRpcError(null, error));
      return;
    }
    if (["SendStreamingMessage", "SubscribeToTask"].includes(rpc.method)) {
      let context: GatewayContext | undefined;
      let outputBytes = 0;
      let eventCount = 0;
      let remoteTaskId = taskIdFromParams(rpc.params ?? {});
      let streamError: unknown;
      try {
        context = await gatewayContext(req, rpcScope(rpc.method), remoteTaskId);
        quotaHeaders(res, context.lease);
        if (rpc.method === "SubscribeToTask") {
          if (!remoteTaskId)
            throw new AppError(
              400,
              "JSONRPC_INVALID_REQUEST",
              "SubscribeToTask 缺少任务 id。",
            );
          await assertRemoteTaskTenant(
            context.agent.id,
            remoteTaskId,
            context.key.tenantId,
          );
        }
        const controller = new AbortController();
        res.once("close", () => controller.abort());
        const client = await remoteClient(context);
        const sendRequest =
          rpc.method === "SendStreamingMessage"
            ? SendMessageRequest.fromJSON({
                ...rpc.params,
                tenant: context.key.tenantId,
              })
            : undefined;
        if (sendRequest)
          await assertMessageTaskReferences(
            context.agent.id,
            context.key.tenantId,
            sendRequest,
          );
        const stream = sendRequest
          ? client.sendMessageStream(sendRequest, {
              signal: AbortSignal.any([
                controller.signal,
                AbortSignal.timeout(callTimeout(context.agent)),
              ]),
            })
          : client.resubscribeTask(
              SubscribeToTaskRequest.fromJSON({
                ...rpc.params,
                id: remoteTaskId,
                tenant: context.key.tenantId,
              }),
              {
                signal: AbortSignal.any([
                  controller.signal,
                  AbortSignal.timeout(callTimeout(context.agent)),
                ]),
              },
            );
        Object.entries(SSE_HEADERS).forEach(([key, value]) =>
          res.setHeader(key, value),
        );
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();
        let firstTaskEvent = true;
        for await (const event of stream) {
          const json = StreamResponse.toJSON(event) as Record<string, unknown>;
          const summary = streamEventSummary(event);
          remoteTaskId = summary.remoteTaskId ?? remoteTaskId;
          const bytes = usageByteLength(json);
          outputBytes += bytes;
          eventCount++;
          assertStreamBudget(bytes, eventCount);
          res.write(
            formatSSEEvent({ jsonrpc: "2.0", id: rpc.id, result: json }),
          );
          if (remoteTaskId) {
            await appendTaskEvent({
              agentId: context.agent.id,
              agentInstanceId: context.instanceLease.instance.id,
              tenantId: context.key.tenantId,
              apiKeyId: context.key.id,
              requestId: req.requestId,
              remoteTaskId,
              contextId: summary.contextId,
              operation:
                rpc.method === "SendStreamingMessage"
                  ? "jsonrpc.message.stream"
                  : "jsonrpc.task.subscribe",
              state: summary.state,
              eventType: event.payload?.$case ?? "unknown",
              event: json,
              requestPayload:
                firstTaskEvent && sendRequest
                  ? (SendMessageRequest.toJSON(sendRequest) as Record<
                      string,
                      unknown
                    >)
                  : undefined,
              platformEvents: webhookTypes(
                summary.state,
                firstTaskEvent && Boolean(sendRequest),
              ).map((type) => ({
                type,
                data: {
                  state: summary.state,
                  requestId: req.requestId,
                  transport: "jsonrpc",
                },
              })),
            });
            firstTaskEvent = false;
          }
          await publishRealtime(context.agent.id, {
            ...json,
            requestId: req.requestId,
            tenantId: context.key.tenantId,
          });
        }
      } catch (error) {
        streamError = error;
        if (res.headersSent)
          res.write(formatSSEEvent(jsonRpcError(rpc.id, error)));
        else
          res
            .status(error instanceof AppError ? error.status : 502)
            .json(jsonRpcError(rpc.id, error));
      } finally {
        if (!res.writableEnded) res.end();
        if (context)
          await finish(context, req, {
            operation: rpc.method,
            statusCode:
              streamError instanceof AppError
                ? streamError.status
                : streamError
                  ? 502
                  : 200,
            outputBytes,
            eventCount,
            errorCode:
              streamError instanceof AppError
                ? streamError.code
                : streamError
                  ? "REMOTE_STREAM_ERROR"
                  : undefined,
            errorMessage:
              streamError instanceof Error ? streamError.message : undefined,
            remoteTaskId,
          });
      }
      return;
    }

    let context: GatewayContext | undefined;
    try {
      const supported = new Set([
        "GetExtendedAgentCard",
        "SendMessage",
        "GetTask",
        "CancelTask",
        "ListTasks",
        "CreateTaskPushNotificationConfig",
        "GetTaskPushNotificationConfig",
        "ListTaskPushNotificationConfigs",
        "DeleteTaskPushNotificationConfig",
      ]);
      if (!supported.has(rpc.method))
        throw new AppError(
          404,
          "JSONRPC_METHOD_NOT_FOUND",
          `不支持 JSON-RPC 方法 ${rpc.method}。`,
        );
      let remoteTaskId = taskIdFromParams(rpc.params ?? {});
      context = await gatewayContext(req, rpcScope(rpc.method), remoteTaskId);
      quotaHeaders(res, context.lease);
      const client = await remoteClient(context);
      const params = { ...rpc.params, tenant: context.key.tenantId };
      remoteTaskId = taskIdFromParams(params);
      if (
        [
          "GetTask",
          "CancelTask",
          "CreateTaskPushNotificationConfig",
          "GetTaskPushNotificationConfig",
          "ListTaskPushNotificationConfigs",
          "DeleteTaskPushNotificationConfig",
        ].includes(rpc.method)
      ) {
        if (!remoteTaskId)
          throw new AppError(
            400,
            "JSONRPC_INVALID_REQUEST",
            `${rpc.method} 缺少任务 id。`,
          );
        await assertRemoteTaskTenant(
          context.agent.id,
          remoteTaskId,
          context.key.tenantId,
        );
      }
      let result: unknown;
      if (rpc.method === "GetExtendedAgentCard") {
        result = AgentCard.toJSON(
          await client.getAgentCard({
            signal: AbortSignal.timeout(callTimeout(context.agent)),
          }),
        );
      } else if (rpc.method === "SendMessage") {
        const request = SendMessageRequest.fromJSON(params);
        await assertMessageTaskReferences(
          context.agent.id,
          context.key.tenantId,
          request,
        );
        const sent = await client.sendMessage(request, {
          signal: AbortSignal.timeout(callTimeout(context.agent)),
        });
        const response =
          "messageId" in sent
            ? { payload: { $case: "message" as const, value: sent } }
            : { payload: { $case: "task" as const, value: sent } };
        result = SendMessageResponse.toJSON(response);
        if ("id" in sent) {
          remoteTaskId = sent.id;
          const state = sent.status?.state?.toString();
          await appendTaskEvent({
            agentId: context.agent.id,
            agentInstanceId: context.instanceLease.instance.id,
            tenantId: context.key.tenantId,
            apiKeyId: context.key.id,
            requestId: req.requestId,
            remoteTaskId: sent.id,
            contextId: sent.contextId,
            operation: "jsonrpc.message.send",
            state,
            eventType: "task",
            event: result as Record<string, unknown>,
            requestPayload: SendMessageRequest.toJSON(request) as Record<
              string,
              unknown
            >,
            platformEvents: webhookTypes(state, true).map((type) => ({
              type,
              data: { state, requestId: req.requestId, transport: "jsonrpc" },
            })),
          });
        }
      } else if (rpc.method === "GetTask") {
        result = Task.toJSON(
          await client.getTask(GetTaskRequest.fromJSON(params), {
            signal: AbortSignal.timeout(callTimeout(context.agent)),
          }),
        );
      } else if (rpc.method === "CancelTask") {
        const task = await client.cancelTask(
          CancelTaskRequest.fromJSON(params),
          { signal: AbortSignal.timeout(callTimeout(context.agent)) },
        );
        result = Task.toJSON(task);
        await markTaskCancelled(
          context.agent.id,
          task.id,
          result as Record<string, unknown>,
          {
            tenantId: context.key.tenantId,
            apiKeyId: context.key.id,
            requestId: req.requestId,
            agentInstanceId: context.instanceLease.instance.id,
          },
        );
      } else if (rpc.method === "ListTasks") {
        const request = ListTasksRequest.fromJSON(params);
        result = ListTasksResponse.toJSON(
          ListTasksResponse.fromJSON(
            await listObservedTasks({
              agentId: context.agent.id,
              tenantId: context.key.tenantId,
              contextId: request.contextId || undefined,
              state: request.status ? request.status.toString() : undefined,
              statusTimestampAfter: request.statusTimestampAfter,
              pageSize: request.pageSize,
              pageToken: request.pageToken,
              includeArtifacts: request.includeArtifacts,
            }),
          ),
        );
      } else if (rpc.method === "CreateTaskPushNotificationConfig") {
        result = TaskPushNotificationConfig.toJSON(
          await client.createTaskPushNotificationConfig(
            TaskPushNotificationConfig.fromJSON(params),
            { signal: AbortSignal.timeout(callTimeout(context.agent)) },
          ),
        );
      } else if (rpc.method === "GetTaskPushNotificationConfig") {
        result = TaskPushNotificationConfig.toJSON(
          await client.getTaskPushNotificationConfig(
            GetTaskPushNotificationConfigRequest.fromJSON(params),
            { signal: AbortSignal.timeout(callTimeout(context.agent)) },
          ),
        );
      } else if (rpc.method === "ListTaskPushNotificationConfigs") {
        result = ListTaskPushNotificationConfigsResponse.toJSON(
          await client.listTaskPushNotificationConfig(
            ListTaskPushNotificationConfigsRequest.fromJSON(params),
            { signal: AbortSignal.timeout(callTimeout(context.agent)) },
          ),
        );
      } else {
        await client.deleteTaskPushNotificationConfig(
          DeleteTaskPushNotificationConfigRequest.fromJSON(params),
          { signal: AbortSignal.timeout(callTimeout(context.agent)) },
        );
        result = {};
      }
      const envelope = { jsonrpc: "2.0" as const, id: rpc.id, result };
      res.json(envelope);
      await finish(context, req, {
        operation: rpc.method,
        statusCode: 200,
        outputBytes: usageByteLength(result),
        eventCount: rpc.method === "SendMessage" ? 1 : 0,
        remoteTaskId,
      });
    } catch (error) {
      if (context)
        await finish(context, req, {
          operation: rpc.method,
          statusCode: error instanceof AppError ? error.status : 502,
          errorCode:
            error instanceof AppError ? error.code : "REMOTE_AGENT_ERROR",
          errorMessage: error instanceof Error ? error.message : String(error),
          remoteTaskId: taskIdFromParams(rpc.params ?? {}),
        });
      if (!res.headersSent)
        res
          .status(error instanceof AppError ? error.status : 502)
          .json(jsonRpcError(rpc.id, error));
    }
  }),
);

export { router as gatewayRouter };
