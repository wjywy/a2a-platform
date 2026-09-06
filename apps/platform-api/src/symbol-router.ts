import { Router } from "express";
import crypto from "node:crypto";
import {
  AgentCard,
  formatSSEEvent,
  SSE_HEADERS,
  StreamResponse,
  Task,
  TaskStatusUpdateEvent,
} from "@a2a-js/sdk";
import { asyncHandler } from "./http.js";
import { config } from "./config.js";
import type { RoutingDecision } from "./symbol-intent-service.js";
import {
  cancelSymbolTask,
  getSymbolTask,
  handleSymbolMessage,
  isSymbolAgentSlug,
  symbolCard,
  type SymbolAgentSlug,
} from "./symbol-service.js";
import {
  abortSymbolStream,
  appendSymbolStreamEvent,
  appendSymbolStreamText,
  bindSymbolStream,
  createSymbolStream,
  findSymbolStream,
  subscribeSymbolStream,
  type ActiveSymbolStream,
} from "./symbol-stream-service.js";

const router = Router();

function authorized(value: string | undefined) {
  // Cards are deliberately public to satisfy discovery and health checks. Only
  // the private execution endpoint needs the per-deployment internal token.
  return (
    Boolean(config.symbolInternalToken) &&
    value === `Bearer ${config.symbolInternalToken}`
  );
}
function requireInternal(req: import("express").Request) {
  if (!authorized(req.header("authorization"))) {
    const error = new Error("内置 Symbol Agent 只接受平台网关的调用。");
    Object.assign(error, { status: 401, code: "SYMBOL_AGENT_UNAUTHORIZED" });
    throw error;
  }
}

function streamingStatusEvent(input: {
  taskId: string;
  contextId: string;
  text?: string;
  sequence?: number;
  textHash?: string;
  route?: Pick<RoutingDecision, "intentType" | "taskRelation" | "route" | "missing" | "providerAllowed">;
}): Record<string, unknown> {
  const message = input.text
    ? {
        messageId: crypto.randomUUID(),
        taskId: input.taskId,
        contextId: input.contextId,
        role: "ROLE_AGENT",
        parts: [{ text: input.text }],
        metadata: { messageSource: "agent-authored" },
        extensions: [],
        referenceTaskIds: [],
      }
    : undefined;
  return StreamResponse.toJSON({
    payload: {
      $case: "statusUpdate",
      value: TaskStatusUpdateEvent.fromJSON({
        taskId: input.taskId,
        contextId: input.contextId,
        status: {
          state: "TASK_STATE_WORKING",
          message,
          timestamp: new Date().toISOString(),
        },
        metadata: {
          streaming: true,
          ...(input.route ? { route: input.route } : {}),
          messageSource: input.text ? "agent-authored" : "protocol",
          ...(input.sequence !== undefined ? { sequence: input.sequence } : {}),
          ...(input.textHash ? { textHash: input.textHash } : {}),
          ...(input.text !== undefined ? { textLength: input.text.length } : {}),
        },
      }),
    },
  }) as Record<string, unknown>;
}

export const __symbolRouterInternals = { streamingStatusEvent };

function requestTenant(req: import("express").Request) {
  const pathTenant = req.params.tenant;
  if (typeof pathTenant === "string" && pathTenant) return pathTenant;
  const body = req.body as { tenant?: unknown } | undefined;
  return typeof body?.tenant === "string" ? body.tenant : "";
}

function requestTaskId(req: import("express").Request) {
  const body = req.body as {
    message?: { taskId?: unknown };
    id?: unknown;
  } | undefined;
  if (typeof body?.message?.taskId === "string" && body.message.taskId)
    return body.message.taskId;
  return typeof body?.id === "string" && body.id ? body.id : undefined;
}

function terminalStreamEvent(result: Record<string, unknown>) {
  return StreamResponse.toJSON({
    payload: { $case: "task", value: Task.fromJSON(result) },
  }) as Record<string, unknown>;
}

function writeStreamHeaders(res: import("express").Response) {
  Object.entries(SSE_HEADERS).forEach(([key, value]) =>
    res.setHeader(key, value),
  );
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
}

function writeStreamEvent(
  res: import("express").Response,
  event: Record<string, unknown>,
) {
  if (!res.destroyed && !res.writableEnded) res.write(formatSSEEvent(event));
}

async function executeSymbolStream(
  stream: ActiveSymbolStream,
  slug: import("./symbol-service.js").SymbolAgentSlug,
  tenantId: string,
  body: unknown,
  requestId: string,
) {
  let route: Parameters<typeof streamingStatusEvent>[0]["route"];
  try {
    const result = await handleSymbolMessage(slug, tenantId, body, {
      requestId,
      signal: stream.controller.signal,
      onRoute: (decision) => { route = { intentType: decision.intentType, taskRelation: decision.taskRelation, route: decision.route, missing: decision.missing, providerAllowed: decision.providerAllowed }; },
      onStart: ({ taskId, contextId }) => {
        bindSymbolStream(stream, tenantId, slug, taskId, contextId);
        appendSymbolStreamEvent(
          stream,
          streamingStatusEvent({ taskId, contextId }),
        );
      },
      onDelta: (delta, { taskId, contextId }) => {
        const snapshot = appendSymbolStreamText(stream, delta);
        appendSymbolStreamEvent(
          stream,
          streamingStatusEvent({
            taskId,
            contextId,
            text: snapshot.text,
            route,
            sequence: snapshot.sequence,
            textHash: crypto
              .createHash("sha256")
              .update(snapshot.text)
              .digest("hex"),
          }),
        );
      },
    });
    appendSymbolStreamEvent(
      stream,
      terminalStreamEvent(result as Record<string, unknown>),
    );
    return result;
  } catch (error) {
    appendSymbolStreamEvent(stream, {
      error: {
        message:
          error instanceof Error ? error.message : "Symbol Agent 流式调用失败。",
      },
    });
    throw error;
  } finally {
    stream.complete();
  }
}

router.options(
  "/api/builtin/symbol/:slug/:tenant/message\\:send",
  (_req, res) => res.sendStatus(204),
);
router.options("/api/builtin/symbol/:slug/message\\:send", (_req, res) =>
  res.sendStatus(204),
);
router.options(
  "/api/builtin/symbol/:slug/:tenant/message\\:stream",
  (_req, res) => res.sendStatus(204),
);
router.options("/api/builtin/symbol/:slug/message\\:stream", (_req, res) =>
  res.sendStatus(204),
);
router.options("/api/builtin/symbol/:slug", (_req, res) => res.sendStatus(204));

function serveCard(
  req: import("express").Request,
  res: import("express").Response,
): void {
  const slug = String(req.params.slug);
  if (!isSymbolAgentSlug(slug)) {
    res.status(404).json({ error: "Agent 不存在" });
    return;
  }
  res.setHeader(
    "Link",
    `</api/builtin/symbol/${slug}/.well-known/agent-card.json>; rel="agent-card"`,
  );
  res.json(AgentCard.toJSON(AgentCard.fromJSON(symbolCard(slug))));
}

router.get("/api/builtin/symbol/:slug", serveCard);
router.get(
  "/api/builtin/symbol/:slug/.well-known/agent-card.json",
  serveCard,
);

async function send(
  req: import("express").Request,
  res: import("express").Response,
): Promise<void> {
  const slug = String(req.params.slug);
  if (!isSymbolAgentSlug(slug)) {
    res.status(404).json({ error: "Agent 不存在" });
    return;
  }
  requireInternal(req);
  const tenantId = requestTenant(req);
  if (!tenantId) {
    res.status(400).json({ error: "缺少 tenant。" });
    return;
  }
  const task = await handleSymbolMessage(slug, tenantId, req.body);
  res.json(task);
}
router.post(
  "/api/builtin/symbol/:slug/:tenant/message\\:send",
  asyncHandler(send),
);
router.post("/api/builtin/symbol/:slug/message\\:send", asyncHandler(send));

async function stream(
  req: import("express").Request,
  res: import("express").Response,
): Promise<void> {
  const slug = String(req.params.slug);
  if (!isSymbolAgentSlug(slug)) {
    res.status(404).json({ error: "Agent 不存在" });
    return;
  }
  requireInternal(req);
  const tenantId = requestTenant(req);
  if (!tenantId) {
    res.status(400).json({ error: "缺少 tenant。" });
    return;
  }
  const activeTaskId = requestTaskId(req);
  const existing = activeTaskId
    ? findSymbolStream(tenantId, slug, activeTaskId)
    : undefined;
  const active =
    existing && !existing.done
      ? existing
      : createSymbolStream({ tenantId, slug, taskId: activeTaskId });
  writeStreamHeaders(res);
  const unsubscribe = subscribeSymbolStream(active, (event) =>
    writeStreamEvent(res, event),
  );
  const onClose = () => unsubscribe();
  res.once("close", onClose);
  try {
    await executeSymbolStream(
      active,
      slug,
      tenantId,
      req.body,
      req.header("x-request-id") ?? crypto.randomUUID(),
    );
  } catch {
    // The execution layer has already published the error so a later
    // subscriber sees the same terminal failure as the original client.
  } finally {
    res.off("close", onClose);
    unsubscribe();
    if (!res.destroyed && !res.writableEnded) res.end();
  }
}
router.post(
  "/api/builtin/symbol/:slug/:tenant/message\\:stream",
  asyncHandler(stream),
);
router.post("/api/builtin/symbol/:slug/message\\:stream", asyncHandler(stream));

async function subscribe(
  req: import("express").Request,
  res: import("express").Response,
): Promise<void> {
  const slug = String(req.params.slug);
  const tenantId = requestTenant(req);
  const taskId = String(req.params.taskId);
  if (!isSymbolAgentSlug(slug) || !tenantId || !taskId) {
    res.status(404).json({ error: "任务不存在" });
    return;
  }
  requireInternal(req);
  const active = findSymbolStream(tenantId, slug, taskId);
  if (active) {
    writeStreamHeaders(res);
    const unsubscribe = subscribeSymbolStream(active, (event) =>
      writeStreamEvent(res, event),
    );
    const onClose = () => unsubscribe();
    res.once("close", onClose);
    try {
      await active.completion;
    } finally {
      res.off("close", onClose);
      unsubscribe();
      if (!res.destroyed && !res.writableEnded) res.end();
    }
    return;
  }
  const result = await getSymbolTask(slug, tenantId, taskId);
  if (!result) {
    res.status(404).json({ error: "任务不存在" });
    return;
  }
  writeStreamHeaders(res);
  writeStreamEvent(res, terminalStreamEvent(result));
  if (!res.destroyed && !res.writableEnded) res.end();
}
router.get(
  "/api/builtin/symbol/:slug/:tenant/tasks/:taskId\\:subscribe",
  asyncHandler(subscribe),
);
router.post(
  "/api/builtin/symbol/:slug/:tenant/tasks/:taskId\\:subscribe",
  asyncHandler(subscribe),
);
router.get(
  "/api/builtin/symbol/:slug/tasks/:taskId\\:subscribe",
  asyncHandler(subscribe),
);
router.post(
  "/api/builtin/symbol/:slug/tasks/:taskId\\:subscribe",
  asyncHandler(subscribe),
);

async function task(
  req: import("express").Request,
  res: import("express").Response,
): Promise<void> {
  const slug = String(req.params.slug);
  const tenantId = requestTenant(req);
  const taskId = String(req.params.taskId);
  if (!isSymbolAgentSlug(slug) || !tenantId || !taskId) {
    res.status(404).json({ error: "任务不存在" });
    return;
  }
  requireInternal(req);
  const result = await getSymbolTask(slug, tenantId, taskId);
  if (!result) {
    res.status(404).json({ error: "任务不存在" });
    return;
  }
  res.json(result);
}
async function cancel(
  req: import("express").Request,
  res: import("express").Response,
): Promise<void> {
  const slug = String(req.params.slug);
  const tenantId = requestTenant(req);
  const taskId = String(req.params.taskId);
  if (!isSymbolAgentSlug(slug) || !tenantId || !taskId) {
    res.status(404).json({ error: "任务不存在" });
    return;
  }
  requireInternal(req);
  abortSymbolStream(tenantId, slug, taskId);
  const result = await cancelSymbolTask(slug, tenantId, taskId);
  if (!result) {
    res.status(404).json({ error: "任务不存在" });
    return;
  }
  res.json(result);
}
router.get(
  "/api/builtin/symbol/:slug/:tenant/tasks/:taskId",
  asyncHandler(task),
);
router.post(
  "/api/builtin/symbol/:slug/:tenant/tasks/:taskId\\:cancel",
  asyncHandler(cancel),
);

export { router as symbolRouter };
