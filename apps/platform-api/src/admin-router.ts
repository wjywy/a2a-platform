import { Router } from "express";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { z } from "zod";
import {
  requireAuthentication,
  requirePlatformAdmin,
  requireTenantRole,
  assertTenantAccess,
} from "./auth.js";
import {
  asyncHandler,
  auditContext,
  optionalQuery,
  pathParam,
} from "./http.js";
import { writeAudit, searchAudit, auditActions } from "./audit-service.js";
import { AppError, NotFoundError } from "./domain.js";
import {
  createTenant,
  deleteTenant,
  getTenant,
  searchTenants,
  updateTenant,
  changeTenantStatus,
  listMembers,
  inviteMember,
  updateMember,
  removeMember,
  acceptInvitation,
  tenantRoleForUser,
  listTenantsForUser,
  listInvitations,
  revokeInvitation,
} from "./tenant-service.js";
import {
  createApiKey,
  getApiKey,
  listApiKeys,
  revokeApiKey,
  updateApiKey,
} from "./api-key-service.js";
import { config } from "./config.js";
import { resolveStudioServiceCredential } from "./studio-service-credential.js";
import {
  createWebhook,
  deleteWebhook,
  getWebhook,
  listDeliveries,
  listWebhooks,
  replayDelivery,
  rotateWebhookSecret,
  testWebhook,
  updateWebhook,
} from "./webhook-service.js";
import {
  acknowledgeAlert,
  createAlertRule,
  deleteAlertRule,
  getAlertEvent,
  getAlertRule,
  listAlertRules,
  searchAlertEvents,
  silenceAlert,
  updateAlertRule,
} from "./alert-service.js";
import { searchUsage, usageCsv, usageSummary } from "./quota-service.js";
import {
  getTaskDetail,
  searchTasks,
  taskEventsJson,
  taskStats,
} from "./task-service.js";
import { getSymbolRunTrajectory } from "./symbol-graph.js";
import {
  archiveSymbolConversation,
  getSymbolConversation,
  isSymbolAgentSlug,
  listSymbolConversations,
  renameSymbolConversation,
} from "./symbol-service.js";
import {
  appendStudioMessage,
  createStudioLabel,
  createStudioConversation,
  deleteStudioLabel,
  forkStudioConversation,
  getStudioConversation,
  listStudioConversationEvents,
  listStudioMessageRevisions,
  listStudioLabels,
  recordStudioMessageFeedback,
  replaceStudioConversationLabels,
  searchStudioConversations,
  updateStudioConversation,
  updateStudioMessage,
} from "./studio-conversation-service.js";
import { exportStudioConversation } from "./studio-conversation-export.js";
import {
  getSetting,
  getSettingValue,
  listSettings,
  updateSetting,
} from "./settings-service.js";
import { subscribePattern } from "./redis.js";
import { SSE_HEADERS, formatSSEEvent } from "@a2a-js/sdk";
import {
  createAgent,
  dashboardSummary,
  deleteAgent,
  getAgentBySlug,
  listAgents,
  listCardRevisions,
  listHealthChecks,
  refreshAgentCard,
  updateAgent,
  updateAgentStatus,
} from "./repositories.js";
import {
  checkAgent,
  diffAgentCards,
  registerAgentSchema,
  updateAgentSchema,
  validateRemoteAgent,
} from "./agent-service.js";
import {
  createUser,
  listUsers,
  resetPassword,
  setUserStatus,
} from "./identity-service.js";
import {
  checkAgentInstance,
  createAgentInstance,
  deleteAgentInstance,
  listAgentInstances,
  updateAgentInstance,
} from "./agent-instance-service.js";
import {
  createNotificationChannel,
  deleteNotificationChannel,
  enqueueNotificationTest,
  getNotificationChannel,
  getNotificationRecord,
  listNotificationChannels,
  replayNotification,
  rotateNotificationSecret,
  searchNotifications,
  updateNotificationChannel,
} from "./notification-service.js";

const router = Router();
router.use(requireAuthentication);
const id = (req: Parameters<typeof pathParam>[0], name: string) =>
  pathParam(req, name);
const actor = (req: { principal?: { id: string } }) =>
  req.principal?.id ?? "unknown";

async function readableTenant(
  req: Parameters<typeof auditContext>[0],
  tenantId: string | undefined,
): Promise<string | undefined> {
  if (req.principal?.platformRole === "platform_admin") return tenantId;
  if (!tenantId)
    throw new AppError(
      400,
      "TENANT_CONTEXT_REQUIRED",
      "非平台管理员必须指定 tenantId。",
    );
  const role = await tenantRoleForUser(tenantId, req.principal!.id);
  assertTenantAccess(req.principal!, role, "viewer");
  return tenantId;
}

async function assertAlertAccess(
  req: Parameters<typeof auditContext>[0],
  tenantId: string | undefined,
  minimum: "viewer" | "developer" | "tenant_admin",
): Promise<void> {
  if (req.principal?.platformRole === "platform_admin") return;
  if (!tenantId)
    throw new AppError(
      403,
      "PLATFORM_ALERT_ADMIN_REQUIRED",
      "平台级告警仅平台管理员可访问。",
    );
  const role = await tenantRoleForUser(tenantId, req.principal!.id);
  assertTenantAccess(req.principal!, role, minimum);
}

async function agentPermission(
  req: Parameters<typeof auditContext>[0],
  slug: string,
  minimum: "viewer" | "developer" | "tenant_admin",
) {
  const agent = await getAgentBySlug(slug);
  if (!agent) throw new NotFoundError("Agent", slug);
  if (req.principal?.platformRole === "platform_admin") return agent;
  if (!agent.tenantId)
    throw new AppError(
      403,
      "AGENT_TENANT_REQUIRED",
      "该 Agent 尚未分配租户，仅平台管理员可管理。",
    );
  const role = await tenantRoleForUser(agent.tenantId, req.principal!.id);
  assertTenantAccess(req.principal!, role, minimum);
  return agent;
}

/** Permission check for an authenticated Studio session calling an A2A agent. */
async function studioAgentPermission(
  req: Parameters<typeof auditContext>[0],
  tenantId: string,
  slug: string,
) {
  const agent = await getAgentBySlug(slug);
  if (!agent) throw new NotFoundError("Agent", slug);
  if (req.principal?.platformRole !== "platform_admin") {
    const role = await tenantRoleForUser(tenantId, req.principal!.id);
    assertTenantAccess(req.principal!, role, "developer");
  }
  if (
    agent.tenantId !== tenantId &&
    agent.visibility !== "public" &&
    !agent.allowedTenantIds.includes(tenantId)
  )
    throw new AppError(
      403,
      "AGENT_TENANT_DENIED",
      "该 Agent 未授权给当前租户。",
    );
  return agent;
}

router.get(
  "/session",
  asyncHandler(async (req, res) => {
    const tenants =
      req.principal?.platformRole === "platform_admin"
        ? []
        : await listTenantsForUser(req.principal!.id);
    res.json({ principal: req.principal, tenants });
  }),
);
router.get(
  "/me/tenants",
  asyncHandler(async (req, res) => {
    res.json({ tenants: await listTenantsForUser(req.principal!.id) });
  }),
);

/**
 * Authenticated Studio-to-gateway bridge.  This is deliberately separate
 * from the public A2A gateway: browser clients authenticate with their login
 * token, while the tenant API key stays in the API process environment.
 */
router.post(
  "/studio/agents/:slug/a2a/rest/message:stream",
  asyncHandler(async (req, res) => {
    const tenantId = z.string().uuid().parse(req.body?.tenantId);
    const agent = await studioAgentPermission(req, tenantId, id(req, "slug"));
    const serviceCredential = await resolveStudioServiceCredential(tenantId);
    const credential = serviceCredential.key;
    if (credential.tenantId !== tenantId)
      throw new AppError(
        403,
        "STUDIO_CREDENTIAL_TENANT_MISMATCH",
        "当前租户与在线调试服务凭据不匹配。",
      );
    const gatewayUrl = new URL(
      `/agents/${encodeURIComponent(agent.slug)}/a2a/rest/message:stream`,
      `${config.symbolInternalOrigin}/`,
    );
    const response = await fetch(gatewayUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": serviceCredential.secret,
        "x-request-id": req.requestId ?? crypto.randomUUID(),
      },
      body: JSON.stringify(req.body?.request ?? {}),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => undefined);
      const error = payload as { error?: { code?: string; message?: string } } | undefined;
      throw new AppError(
        response.status,
        error?.error?.code ?? "STUDIO_GATEWAY_FAILED",
        error?.error?.message ?? `Agent 调用失败 (${response.status})。`,
      );
    }
    if (!response.body)
      throw new AppError(502, "STUDIO_STREAM_MISSING", "Agent 未返回流式响应。");
    res.status(response.status);
    res.setHeader("content-type", response.headers.get("content-type") ?? "text/event-stream; charset=utf-8");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.setHeader("x-accel-buffering", "no");
    res.flushHeaders();
    Readable.fromWeb(response.body as never).pipe(res);
    await writeAudit(auditContext(req, tenantId), "studio.agent_invoked", {
      type: "agent",
      id: agent.id,
      agentId: agent.id,
    });
  }),
);
router.get(
  "/users",
  requirePlatformAdmin,
  asyncHandler(async (_req, res) => {
    res.json({ users: await listUsers() });
  }),
);
router.post(
  "/users",
  requirePlatformAdmin,
  asyncHandler(async (req, res) => {
    const user = await createUser(req.body);
    await writeAudit(auditContext(req), "user.created", {
      type: "user",
      id: user.id,
    });
    res.status(201).json({ user });
  }),
);
router.post(
  "/users/:userId/password",
  requirePlatformAdmin,
  asyncHandler(async (req, res) => {
    const password = z.string().min(12).max(256).parse(req.body?.password);
    await resetPassword(id(req, "userId"), password);
    await writeAudit(auditContext(req), "user.password_reset", {
      type: "user",
      id: id(req, "userId"),
    });
    res.status(204).end();
  }),
);
router.post(
  "/users/:userId/status",
  requirePlatformAdmin,
  asyncHandler(async (req, res) => {
    const status = z.enum(["active", "disabled"]).parse(req.body?.status);
    const user = await setUserStatus(id(req, "userId"), status);
    await writeAudit(auditContext(req), `user.${status}`, {
      type: "user",
      id: user.id,
    });
    res.json({ user });
  }),
);
router.get(
  "/events",
  asyncHandler(async (req, res) => {
    const tenantId = await readableTenant(req, optionalQuery(req, "tenantId"));
    Object.entries(SSE_HEADERS).forEach(([key, value]) =>
      res.setHeader(key, value),
    );
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    res.write(
      formatSSEEvent({
        type: "platform.connected",
        occurredAt: new Date().toISOString(),
      }),
    );
    const listener = (message: string, channel: string) => {
      try {
        const event = JSON.parse(message) as { tenantId?: string };
        if (!tenantId || event.tenantId === tenantId) {
          res.write(formatSSEEvent({ channel, ...event }));
        }
      } catch {
        res.write(formatSSEEvent({ channel, message }));
      }
    };
    const unsubscribes = await Promise.all([
      subscribePattern("agent:*:events", listener),
      subscribePattern("platform:*:events", listener),
    ]);
    const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15_000);
    req.on("close", () => {
      clearInterval(heartbeat);
      void Promise.all(unsubscribes.map((unsubscribe) => unsubscribe()));
    });
  }),
);
router.post(
  "/invitations/:token/accept",
  asyncHandler(async (req, res) => {
    if (!req.principal?.email)
      throw new AppError(400, "EMAIL_REQUIRED", "访问令牌中缺少邮箱。");
    const member = await acceptInvitation(id(req, "token"), {
      id: req.principal.id,
      email: req.principal.email,
      displayName: req.principal.displayName,
    });
    await writeAudit(
      auditContext(req, member.tenantId),
      "member.invitation_accepted",
      { type: "tenant_member", id: member.id },
      { email: member.email },
    );
    res.json({ member });
  }),
);

router.get(
  "/dashboard",
  asyncHandler(async (req, res) => {
    const tenantId = await readableTenant(req, optionalQuery(req, "tenantId"));
    res.json({
      summary: await dashboardSummary(tenantId),
      taskStats: await taskStats(tenantId),
      usage: await usageSummary({ tenantId }),
    });
  }),
);

router.get(
  "/tenants",
  requirePlatformAdmin,
  asyncHandler(async (req, res) => {
    res.json(await searchTenants(req.query));
  }),
);
router.post(
  "/tenants",
  requirePlatformAdmin,
  asyncHandler(async (req, res) => {
    const tenant = await createTenant(req.body);
    await writeAudit(
      auditContext(req, tenant.id),
      "tenant.created",
      { type: "tenant", id: tenant.id },
      { slug: tenant.slug },
    );
    res.status(201).json({ tenant });
  }),
);
router.get(
  "/tenants/:tenantId",
  requireTenantRole("viewer"),
  asyncHandler(async (req, res) => {
    res.json({ tenant: await getTenant(id(req, "tenantId")) });
  }),
);
router.patch(
  "/tenants/:tenantId",
  requireTenantRole("tenant_admin"),
  asyncHandler(async (req, res) => {
    const tenantId = id(req, "tenantId");
    const tenant = await updateTenant(tenantId, req.body);
    await writeAudit(
      auditContext(req, tenantId),
      "tenant.updated",
      { type: "tenant", id: tenantId },
      req.body,
    );
    res.json({ tenant });
  }),
);
router.post(
  "/tenants/:tenantId/status",
  requirePlatformAdmin,
  asyncHandler(async (req, res) => {
    const tenantId = id(req, "tenantId");
    const status = z.enum(["active", "suspended"]).parse(req.body?.status);
    const tenant = await changeTenantStatus(tenantId, status);
    await writeAudit(auditContext(req, tenantId), `tenant.${status}`, {
      type: "tenant",
      id: tenantId,
    });
    res.json({ tenant });
  }),
);
router.delete(
  "/tenants/:tenantId",
  requirePlatformAdmin,
  asyncHandler(async (req, res) => {
    const tenantId = id(req, "tenantId");
    await deleteTenant(tenantId);
    await writeAudit(auditContext(req, tenantId), "tenant.deleted", {
      type: "tenant",
      id: tenantId,
    });
    res.status(204).end();
  }),
);

router.get(
  "/tenants/:tenantId/members",
  requireTenantRole("viewer"),
  asyncHandler(async (req, res) => {
    res.json({ members: await listMembers(id(req, "tenantId")) });
  }),
);
router.post(
  "/tenants/:tenantId/members/invite",
  requireTenantRole("tenant_admin"),
  asyncHandler(async (req, res) => {
    const tenantId = id(req, "tenantId");
    const result = await inviteMember(tenantId, req.body, actor(req));
    await writeAudit(
      auditContext(req, tenantId),
      "member.invited",
      { type: "tenant_member", id: result.member.id },
      { email: result.member.email, role: result.member.role },
    );
    res.status(201).json(result);
  }),
);
router.get(
  "/tenants/:tenantId/invitations",
  requireTenantRole("tenant_admin"),
  asyncHandler(async (req, res) => {
    res.json({ invitations: await listInvitations(id(req, "tenantId")) });
  }),
);
router.delete(
  "/tenants/:tenantId/invitations/:invitationId",
  requireTenantRole("tenant_admin"),
  asyncHandler(async (req, res) => {
    const tenantId = id(req, "tenantId");
    await revokeInvitation(tenantId, id(req, "invitationId"));
    await writeAudit(auditContext(req, tenantId), "invitation.revoked", {
      type: "invitation",
      id: id(req, "invitationId"),
    });
    res.status(204).end();
  }),
);
router.patch(
  "/tenants/:tenantId/members/:memberId",
  requireTenantRole("tenant_admin"),
  asyncHandler(async (req, res) => {
    const tenantId = id(req, "tenantId");
    const member = await updateMember(tenantId, id(req, "memberId"), req.body);
    await writeAudit(
      auditContext(req, tenantId),
      "member.updated",
      { type: "tenant_member", id: member.id },
      { role: member.role, status: member.status },
    );
    res.json({ member });
  }),
);
router.delete(
  "/tenants/:tenantId/members/:memberId",
  requireTenantRole("tenant_admin"),
  asyncHandler(async (req, res) => {
    const tenantId = id(req, "tenantId");
    const memberId = id(req, "memberId");
    await removeMember(tenantId, memberId);
    await writeAudit(auditContext(req, tenantId), "member.removed", {
      type: "tenant_member",
      id: memberId,
    });
    res.status(204).end();
  }),
);

router.get(
  "/tenants/:tenantId/api-keys",
  requireTenantRole("viewer"),
  asyncHandler(async (req, res) => {
    res.json({
      keys: await listApiKeys(
        id(req, "tenantId"),
        req.query.includeRevoked !== "false",
      ),
    });
  }),
);
router.post(
  "/tenants/:tenantId/api-keys",
  requireTenantRole("tenant_admin"),
  asyncHandler(async (req, res) => {
    const tenantId = id(req, "tenantId");
    const key = await createApiKey(tenantId, req.body, actor(req));
    await writeAudit(
      auditContext(req, tenantId),
      "api_key.created",
      { type: "api_key", id: key.id },
      { name: key.name, scopes: key.scopes },
    );
    res.status(201).json({ key });
  }),
);
router.get(
  "/tenants/:tenantId/api-keys/:keyId",
  requireTenantRole("viewer"),
  asyncHandler(async (req, res) => {
    res.json({ key: await getApiKey(id(req, "tenantId"), id(req, "keyId")) });
  }),
);
router.patch(
  "/tenants/:tenantId/api-keys/:keyId",
  requireTenantRole("tenant_admin"),
  asyncHandler(async (req, res) => {
    const tenantId = id(req, "tenantId");
    const key = await updateApiKey(tenantId, id(req, "keyId"), req.body);
    await writeAudit(
      auditContext(req, tenantId),
      "api_key.updated",
      { type: "api_key", id: key.id },
      { name: key.name, scopes: key.scopes },
    );
    res.json({ key });
  }),
);
router.post(
  "/tenants/:tenantId/api-keys/:keyId/revoke",
  requireTenantRole("tenant_admin"),
  asyncHandler(async (req, res) => {
    const tenantId = id(req, "tenantId");
    const key = await revokeApiKey(tenantId, id(req, "keyId"));
    await writeAudit(auditContext(req, tenantId), "api_key.revoked", {
      type: "api_key",
      id: key.id,
    });
    res.json({ key });
  }),
);

router.get(
  "/agents",
  asyncHandler(async (req, res) => {
    let tenantId = optionalQuery(req, "tenantId");
    if (req.principal?.platformRole !== "platform_admin") {
      if (!tenantId)
        throw new AppError(
          400,
          "TENANT_CONTEXT_REQUIRED",
          "非平台管理员查询 Agent 时必须指定 tenantId。",
        );
      const role = await tenantRoleForUser(tenantId, req.principal!.id);
      assertTenantAccess(req.principal!, role, "viewer");
    }
    res.json({
      agents: await listAgents({
        status: optionalQuery(req, "status"),
        search: optionalQuery(req, "search"),
        tenantId,
        visibility: optionalQuery(req, "visibility"),
      }),
    });
  }),
);
router.post(
  "/agents",
  asyncHandler(async (req, res) => {
    const defaultTimeoutMs = Number(
      await getSettingValue("gateway.defaultTimeoutMs", 60_000),
    );
    const input = registerAgentSchema.parse({
      ...req.body,
      invocationPolicy: req.body?.invocationPolicy ?? {
        timeoutMs: defaultTimeoutMs,
        maxRetries: 0,
        maxConcurrent: 20,
      },
    });
    if (req.principal?.platformRole !== "platform_admin") {
      if (!input.tenantId)
        throw new AppError(
          400,
          "TENANT_CONTEXT_REQUIRED",
          "注册 Agent 必须指定 tenantId。",
        );
      const role = await tenantRoleForUser(input.tenantId, req.principal!.id);
      assertTenantAccess(req.principal!, role, "developer");
      if (input.visibility === "public" || input.allowedTenantIds.length) {
        throw new AppError(
          403,
          "AGENT_VISIBILITY_ADMIN_REQUIRED",
          "公开 Agent 或授权其他租户只能由平台管理员配置。",
        );
      }
    }
    if (await getAgentBySlug(input.slug))
      throw new AppError(409, "AGENT_SLUG_EXISTS", "Agent slug 已被使用。");
    const validated = await validateRemoteAgent(input.cardUrl);
    const agent = await createAgent({ ...input, ...validated });
    await writeAudit(
      auditContext(req, agent.tenantId),
      "agent.registered",
      { type: "agent", id: agent.id, agentId: agent.id },
      { cardUrl: input.cardUrl },
    );
    res.status(201).json({ agent });
  }),
);
router.get(
  "/agents/:slug",
  asyncHandler(async (req, res) => {
    res.json({ agent: await agentPermission(req, id(req, "slug"), "viewer") });
  }),
);
router.patch(
  "/agents/:slug",
  asyncHandler(async (req, res) => {
    const agent = await agentPermission(req, id(req, "slug"), "developer");
    const input = updateAgentSchema.parse(req.body);
    if (req.principal?.platformRole !== "platform_admin") {
      if (input.tenantId !== undefined && input.tenantId !== agent.tenantId) {
        throw new AppError(
          403,
          "AGENT_TENANT_TRANSFER_DENIED",
          "租户成员不能把 Agent 转移到其他租户。",
        );
      }
      if (
        input.visibility === "public" ||
        input.allowedTenantIds !== undefined
      ) {
        throw new AppError(
          403,
          "AGENT_VISIBILITY_ADMIN_REQUIRED",
          "公开 Agent 或跨租户授权只能由平台管理员配置。",
        );
      }
    }
    const updated = await updateAgent(agent.id, input);
    await writeAudit(
      auditContext(req, agent.tenantId),
      "agent.updated",
      { type: "agent", id: agent.id, agentId: agent.id },
      req.body,
    );
    res.json({ agent: updated });
  }),
);
router.delete(
  "/agents/:slug",
  asyncHandler(async (req, res) => {
    const agent = await agentPermission(req, id(req, "slug"), "tenant_admin");
    if (agent.status === "online" || agent.status === "degraded")
      throw new AppError(
        409,
        "AGENT_MUST_BE_OFFLINE",
        "删除前必须先下线 Agent。",
      );
    await deleteAgent(agent.id);
    await writeAudit(auditContext(req, agent.tenantId), "agent.deleted", {
      type: "agent",
      id: agent.id,
      agentId: agent.id,
    });
    res.status(204).end();
  }),
);
router.post(
  "/agents/:slug/refresh-card",
  asyncHandler(async (req, res) => {
    const agent = await agentPermission(req, id(req, "slug"), "developer");
    const validated = await validateRemoteAgent(agent.cardUrl);
    const diff = diffAgentCards(agent.cardSnapshot, validated.card);
    const updated = await refreshAgentCard(
      agent.id,
      validated.card,
      validated.selectedInterface,
      actor(req),
      diff,
    );
    await writeAudit(
      auditContext(req, agent.tenantId),
      "agent.card_refreshed",
      { type: "agent", id: agent.id, agentId: agent.id },
      { diff },
    );
    res.json({ agent: updated, diff });
  }),
);
router.get(
  "/agents/:slug/card-revisions",
  asyncHandler(async (req, res) => {
    const agent = await agentPermission(req, id(req, "slug"), "viewer");
    res.json({ revisions: await listCardRevisions(agent.id) });
  }),
);
router.get(
  "/agents/:slug/instances",
  asyncHandler(async (req, res) => {
    const agent = await agentPermission(req, id(req, "slug"), "viewer");
    res.json({ instances: await listAgentInstances(agent.id) });
  }),
);
router.post(
  "/agents/:slug/instances",
  asyncHandler(async (req, res) => {
    const agent = await agentPermission(req, id(req, "slug"), "developer");
    const instance = await createAgentInstance(agent, req.body);
    await writeAudit(
      auditContext(req, agent.tenantId),
      "agent_instance.created",
      {
        type: "agent_instance",
        id: instance.id,
        agentId: agent.id,
      },
    );
    res.status(201).json({ instance });
  }),
);
router.patch(
  "/agents/:slug/instances/:instanceId",
  asyncHandler(async (req, res) => {
    const agent = await agentPermission(req, id(req, "slug"), "developer");
    const instance = await updateAgentInstance(
      agent.id,
      id(req, "instanceId"),
      req.body,
    );
    await writeAudit(
      auditContext(req, agent.tenantId),
      "agent_instance.updated",
      {
        type: "agent_instance",
        id: instance.id,
        agentId: agent.id,
      },
    );
    res.json({ instance });
  }),
);
router.delete(
  "/agents/:slug/instances/:instanceId",
  asyncHandler(async (req, res) => {
    const agent = await agentPermission(req, id(req, "slug"), "tenant_admin");
    await deleteAgentInstance(agent.id, id(req, "instanceId"));
    await writeAudit(
      auditContext(req, agent.tenantId),
      "agent_instance.deleted",
      {
        type: "agent_instance",
        id: id(req, "instanceId"),
        agentId: agent.id,
      },
    );
    res.status(204).end();
  }),
);
router.post(
  "/agents/:slug/instances/:instanceId/health-check",
  asyncHandler(async (req, res) => {
    const agent = await agentPermission(req, id(req, "slug"), "developer");
    const result = await checkAgentInstance(agent.id, id(req, "instanceId"));
    await writeAudit(
      auditContext(req, agent.tenantId),
      "agent_instance.health_checked",
      {
        type: "agent_instance",
        id: id(req, "instanceId"),
        agentId: agent.id,
      },
      result,
    );
    res.json({ result });
  }),
);
router.post(
  "/agents/:slug/health-check",
  asyncHandler(async (req, res) => {
    const agent = await agentPermission(req, id(req, "slug"), "developer");
    const result = await checkAgent(agent);
    await writeAudit(
      auditContext(req, agent.tenantId),
      "agent.health_checked",
      { type: "agent", id: agent.id, agentId: agent.id },
      result,
    );
    res.json({ result, health: await listHealthChecks(agent.id) });
  }),
);
router.get(
  "/agents/:slug/health",
  asyncHandler(async (req, res) => {
    const agent = await agentPermission(req, id(req, "slug"), "viewer");
    res.json({ health: await listHealthChecks(agent.id) });
  }),
);
router.post(
  "/agents/:slug/status",
  asyncHandler(async (req, res) => {
    const agent = await agentPermission(req, id(req, "slug"), "developer");
    const status = z.enum(["online", "offline"]).parse(req.body?.status);
    if (status === "online") {
      const instances = await listAgentInstances(agent.id);
      const health = await Promise.all(
        instances
          .filter((item) => item.status === "active")
          .map((item) => checkAgentInstance(agent.id, item.id)),
      );
      if (!health.some((item) => item.ok)) {
        throw new AppError(
          409,
          "AGENT_HEALTH_CHECK_FAILED",
          `上线前没有任何健康实例：${health
            .map((item) => item.error)
            .filter(Boolean)
            .join("；")}`,
        );
      }
    }
    const updated = await updateAgentStatus(
      agent.id,
      status,
      status === "online" ? "healthy" : undefined,
    );
    await writeAudit(auditContext(req, agent.tenantId), `agent.${status}`, {
      type: "agent",
      id: agent.id,
      agentId: agent.id,
    });
    res.json({ agent: updated });
  }),
);

router.get(
  "/tasks",
  asyncHandler(async (req, res) => {
    if (req.principal?.platformRole !== "platform_admin") {
      const tenantId = optionalQuery(req, "tenantId");
      if (!tenantId)
        throw new AppError(
          400,
          "TENANT_CONTEXT_REQUIRED",
          "必须指定 tenantId。",
        );
      const role = await tenantRoleForUser(tenantId, req.principal!.id);
      assertTenantAccess(req.principal!, role, "viewer");
    }
    res.json(await searchTasks(req.query));
  }),
);
router.get(
  "/symbol-conversations",
  asyncHandler(async (req, res) => {
    const tenantId = await readableTenant(req, optionalQuery(req, "tenantId"));
    const slug = optionalQuery(req, "agentSlug");
    if (!tenantId || !slug || !isSymbolAgentSlug(slug))
      throw new AppError(
        400,
        "SYMBOL_CONVERSATION_QUERY_INVALID",
        "必须指定有效的 tenantId 与 agentSlug。",
      );
    res.json({
      conversations: await listSymbolConversations(
        tenantId,
        slug,
        optionalQuery(req, "includeArchived") === "true",
      ),
    });
  }),
);
router.get(
  "/studio-conversations",
  asyncHandler(async (req, res) => {
    const tenantId = await readableTenant(req, optionalQuery(req, "tenantId"));
    if (!tenantId)
      throw new AppError(400, "TENANT_CONTEXT_REQUIRED", "必须指定 tenantId。");
    res.json(await searchStudioConversations({ ...req.query, tenantId }));
  }),
);
router.get(
  "/studio-labels",
  asyncHandler(async (req, res) => {
    const tenantId = await readableTenant(req, optionalQuery(req, "tenantId"));
    if (!tenantId)
      throw new AppError(400, "TENANT_CONTEXT_REQUIRED", "必须指定 tenantId。");
    res.json({ labels: await listStudioLabels(tenantId) });
  }),
);
router.post(
  "/studio-labels",
  requireTenantRole("developer"),
  asyncHandler(async (req, res) => {
    const tenantId = await readableTenant(req, req.body?.tenantId);
    if (!tenantId)
      throw new AppError(400, "TENANT_CONTEXT_REQUIRED", "必须指定 tenantId。");
    const label = await createStudioLabel(
      { ...req.body, tenantId },
      actor(req),
    );
    await writeAudit(
      auditContext(req, tenantId),
      "studio_label.created",
      { type: "studio_label", id: label.id },
      { name: label.name, color: label.color },
    );
    res.status(201).json({ label });
  }),
);
router.delete(
  "/studio-labels/:labelId",
  requireTenantRole("developer"),
  asyncHandler(async (req, res) => {
    const tenantId = await readableTenant(req, optionalQuery(req, "tenantId"));
    if (!tenantId)
      throw new AppError(400, "TENANT_CONTEXT_REQUIRED", "必须指定 tenantId。");
    const labelId = id(req, "labelId");
    await deleteStudioLabel(labelId, tenantId);
    await writeAudit(auditContext(req, tenantId), "studio_label.deleted", {
      type: "studio_label",
      id: labelId,
    });
    res.status(204).end();
  }),
);
router.post(
  "/studio-conversations",
  requireTenantRole("developer"),
  asyncHandler(async (req, res) => {
    const tenantId = await readableTenant(req, req.body?.tenantId);
    if (!tenantId)
      throw new AppError(400, "TENANT_CONTEXT_REQUIRED", "必须指定 tenantId。");
    const conversation = await createStudioConversation(
      { ...req.body, tenantId },
      actor(req),
    );
    await writeAudit(
      auditContext(req, tenantId),
      "studio_conversation.created",
      { type: "studio_conversation", id: conversation.id },
      { agentSlug: conversation.agentSlug },
    );
    res.status(201).json({ conversation });
  }),
);
router.get(
  "/studio-conversations/:conversationId",
  asyncHandler(async (req, res) => {
    const tenantId = await readableTenant(req, optionalQuery(req, "tenantId"));
    if (!tenantId)
      throw new AppError(400, "TENANT_CONTEXT_REQUIRED", "必须指定 tenantId。");
    res.json({
      conversation: await getStudioConversation(
        id(req, "conversationId"),
        tenantId,
      ),
    });
  }),
);
router.get(
  "/studio-conversations/:conversationId/export",
  asyncHandler(async (req, res) => {
    const tenantId = await readableTenant(req, optionalQuery(req, "tenantId"));
    if (!tenantId)
      throw new AppError(400, "TENANT_CONTEXT_REQUIRED", "必须指定 tenantId。");
    const format = z
      .enum(["markdown", "json", "text"])
      .default("markdown")
      .parse(optionalQuery(req, "format"));
    const exported = await exportStudioConversation(
      id(req, "conversationId"),
      tenantId,
      format,
    );
    const filename = `a2a-conversation-${id(req, "conversationId").slice(0, 8)}.${exported.extension}`;
    res
      .type(exported.contentType)
      .setHeader("Content-Disposition", `attachment; filename="${filename}"`)
      .send(exported.content);
  }),
);
router.patch(
  "/studio-conversations/:conversationId",
  requireTenantRole("developer"),
  asyncHandler(async (req, res) => {
    const tenantId = await readableTenant(
      req,
      req.body?.tenantId ?? optionalQuery(req, "tenantId"),
    );
    if (!tenantId)
      throw new AppError(400, "TENANT_CONTEXT_REQUIRED", "必须指定 tenantId。");
    const conversation = await updateStudioConversation(
      id(req, "conversationId"),
      tenantId,
      req.body,
      actor(req),
    );
    await writeAudit(
      auditContext(req, tenantId),
      "studio_conversation.updated",
      { type: "studio_conversation", id: conversation.id },
      { status: conversation.status, title: conversation.title },
    );
    res.json({ conversation });
  }),
);
router.post(
  "/studio-conversations/:conversationId/messages",
  requireTenantRole("developer"),
  asyncHandler(async (req, res) => {
    const tenantId = await readableTenant(req, req.body?.tenantId);
    if (!tenantId)
      throw new AppError(400, "TENANT_CONTEXT_REQUIRED", "必须指定 tenantId。");
    const message = await appendStudioMessage(
      id(req, "conversationId"),
      tenantId,
      req.body,
      actor(req),
    );
    await writeAudit(
      auditContext(req, tenantId),
      "studio_message.created",
      { type: "studio_message", id: message.id },
      { conversationId: id(req, "conversationId"), role: message.role },
    );
    res.status(201).json({ message });
  }),
);
router.patch(
  "/studio-conversations/:conversationId/messages/:messageId",
  requireTenantRole("developer"),
  asyncHandler(async (req, res) => {
    const tenantId = await readableTenant(
      req,
      req.body?.tenantId ?? optionalQuery(req, "tenantId"),
    );
    if (!tenantId)
      throw new AppError(400, "TENANT_CONTEXT_REQUIRED", "必须指定 tenantId。");
    const message = await updateStudioMessage(
      id(req, "conversationId"),
      id(req, "messageId"),
      tenantId,
      req.body,
      actor(req),
    );
    await writeAudit(
      auditContext(req, tenantId),
      "studio_message.updated",
      { type: "studio_message", id: message.id },
      { conversationId: id(req, "conversationId"), status: message.status },
    );
    res.json({ message });
  }),
);
router.get(
  "/studio-conversations/:conversationId/messages/:messageId/revisions",
  asyncHandler(async (req, res) => {
    const tenantId = await readableTenant(req, optionalQuery(req, "tenantId"));
    if (!tenantId)
      throw new AppError(400, "TENANT_CONTEXT_REQUIRED", "必须指定 tenantId。");
    res.json({
      revisions: await listStudioMessageRevisions(
        id(req, "conversationId"),
        id(req, "messageId"),
        tenantId,
      ),
    });
  }),
);
router.put(
  "/studio-conversations/:conversationId/labels",
  requireTenantRole("developer"),
  asyncHandler(async (req, res) => {
    const tenantId = await readableTenant(req, req.body?.tenantId);
    if (!tenantId)
      throw new AppError(400, "TENANT_CONTEXT_REQUIRED", "必须指定 tenantId。");
    const labels = await replaceStudioConversationLabels(
      id(req, "conversationId"),
      tenantId,
      req.body,
      actor(req),
    );
    res.json({ labels });
  }),
);
router.post(
  "/studio-conversations/:conversationId/fork",
  requireTenantRole("developer"),
  asyncHandler(async (req, res) => {
    const tenantId = await readableTenant(req, req.body?.tenantId);
    if (!tenantId)
      throw new AppError(400, "TENANT_CONTEXT_REQUIRED", "必须指定 tenantId。");
    const conversation = await forkStudioConversation(
      id(req, "conversationId"),
      tenantId,
      req.body,
      actor(req),
    );
    await writeAudit(
      auditContext(req, tenantId),
      "studio_conversation.forked",
      { type: "studio_conversation", id: conversation.id },
      { sourceConversationId: id(req, "conversationId") },
    );
    res.status(201).json({ conversation });
  }),
);
router.get(
  "/studio-conversations/:conversationId/events",
  asyncHandler(async (req, res) => {
    const tenantId = await readableTenant(req, optionalQuery(req, "tenantId"));
    if (!tenantId)
      throw new AppError(400, "TENANT_CONTEXT_REQUIRED", "必须指定 tenantId。");
    res.json({
      events: await listStudioConversationEvents(
        id(req, "conversationId"),
        tenantId,
      ),
    });
  }),
);
router.put(
  "/studio-conversations/:conversationId/messages/:messageId/feedback",
  requireTenantRole("developer"),
  asyncHandler(async (req, res) => {
    const tenantId = await readableTenant(req, req.body?.tenantId);
    if (!tenantId)
      throw new AppError(400, "TENANT_CONTEXT_REQUIRED", "必须指定 tenantId。");
    const feedback = await recordStudioMessageFeedback(
      id(req, "conversationId"),
      id(req, "messageId"),
      tenantId,
      req.body,
      actor(req),
    );
    res.json({ feedback });
  }),
);
router.get(
  "/symbol-conversations/:taskId",
  asyncHandler(async (req, res) => {
    const tenantId = await readableTenant(req, optionalQuery(req, "tenantId"));
    if (!tenantId)
      throw new AppError(400, "TENANT_CONTEXT_REQUIRED", "必须指定 tenantId。");
    const conversation = await getSymbolConversation(
      tenantId,
      id(req, "taskId"),
    );
    if (!conversation) throw new NotFoundError("会话", id(req, "taskId"));
    res.json({ conversation });
  }),
);
router.patch(
  "/symbol-conversations/:taskId",
  requireTenantRole("developer"),
  asyncHandler(async (req, res) => {
    const tenantId = await readableTenant(req, optionalQuery(req, "tenantId"));
    if (!tenantId)
      throw new AppError(400, "TENANT_CONTEXT_REQUIRED", "必须指定 tenantId。");
    const title = z.string().trim().min(1).max(96).parse(req.body?.title);
    const conversation = await renameSymbolConversation(
      tenantId,
      id(req, "taskId"),
      title,
    );
    if (!conversation) throw new NotFoundError("会话", id(req, "taskId"));
    await writeAudit(
      auditContext(req, tenantId),
      "symbol_conversation.renamed",
      { type: "symbol_conversation", id: conversation.taskId },
      { title },
    );
    res.json({ conversation });
  }),
);
router.post(
  "/symbol-conversations/:taskId/archive",
  requireTenantRole("developer"),
  asyncHandler(async (req, res) => {
    const tenantId = await readableTenant(req, optionalQuery(req, "tenantId"));
    if (!tenantId)
      throw new AppError(400, "TENANT_CONTEXT_REQUIRED", "必须指定 tenantId。");
    const archived = z
      .boolean()
      .optional()
      .default(true)
      .parse(req.body?.archived);
    const conversation = await archiveSymbolConversation(
      tenantId,
      id(req, "taskId"),
      archived,
    );
    if (!conversation) throw new NotFoundError("会话", id(req, "taskId"));
    await writeAudit(
      auditContext(req, tenantId),
      archived
        ? "symbol_conversation.archived"
        : "symbol_conversation.restored",
      { type: "symbol_conversation", id: conversation.taskId },
    );
    res.json({ conversation });
  }),
);
router.get(
  "/tasks/:taskId",
  asyncHandler(async (req, res) => {
    const task = await getTaskDetail(Number(id(req, "taskId")));
    await readableTenant(req, task.tenantId);
    res.json({ task });
  }),
);
router.get(
  "/tasks/:taskId/events.json",
  asyncHandler(async (req, res) => {
    const task = await getTaskDetail(Number(id(req, "taskId")));
    await readableTenant(req, task.tenantId);
    res
      .type("application/json")
      .attachment(`task-${task.remoteTaskId}-events.json`)
      .send(await taskEventsJson(task.id));
  }),
);

router.get(
  "/agent-runs/:agentSlug/:taskId",
  asyncHandler(async (req, res) => {
    const tenantId = await readableTenant(req, optionalQuery(req, "tenantId"));
    if (!tenantId) {
      throw new AppError(
        400,
        "TENANT_CONTEXT_REQUIRED",
        "必须指定 tenantId。 ",
      );
    }
    const run = await getSymbolRunTrajectory(
      tenantId,
      id(req, "taskId"),
      id(req, "agentSlug"),
    );
    res.json({ run: run ?? null });
  }),
);

router.get(
  "/usage",
  asyncHandler(async (req, res) => {
    const tenantId = optionalQuery(req, "tenantId");
    if (req.principal?.platformRole !== "platform_admin") {
      if (!tenantId)
        throw new AppError(
          400,
          "TENANT_CONTEXT_REQUIRED",
          "必须指定 tenantId。",
        );
      const role = await tenantRoleForUser(tenantId, req.principal!.id);
      assertTenantAccess(req.principal!, role, "viewer");
    }
    res.json(await searchUsage(req.query));
  }),
);
router.get(
  "/usage/summary",
  asyncHandler(async (req, res) => {
    const tenantId = optionalQuery(req, "tenantId");
    if (req.principal?.platformRole !== "platform_admin") {
      if (!tenantId)
        throw new AppError(
          400,
          "TENANT_CONTEXT_REQUIRED",
          "必须指定 tenantId。",
        );
      const role = await tenantRoleForUser(tenantId, req.principal!.id);
      assertTenantAccess(req.principal!, role, "viewer");
    }
    res.json({ summary: await usageSummary(req.query) });
  }),
);
router.get(
  "/usage/export.csv",
  asyncHandler(async (req, res) => {
    const tenantId = optionalQuery(req, "tenantId");
    if (req.principal?.platformRole !== "platform_admin") {
      if (!tenantId)
        throw new AppError(
          400,
          "TENANT_CONTEXT_REQUIRED",
          "必须指定 tenantId。",
        );
      const role = await tenantRoleForUser(tenantId, req.principal!.id);
      assertTenantAccess(req.principal!, role, "viewer");
    }
    res
      .type("text/csv")
      .attachment(`usage-${new Date().toISOString().slice(0, 10)}.csv`)
      .send(await usageCsv(req.query));
  }),
);

router.get(
  "/tenants/:tenantId/webhooks",
  requireTenantRole("viewer"),
  asyncHandler(async (req, res) => {
    res.json({ webhooks: await listWebhooks(id(req, "tenantId")) });
  }),
);
router.post(
  "/tenants/:tenantId/webhooks",
  requireTenantRole("developer"),
  asyncHandler(async (req, res) => {
    const tenantId = id(req, "tenantId");
    const webhook = await createWebhook(tenantId, req.body);
    await writeAudit(
      auditContext(req, tenantId),
      "webhook.created",
      { type: "webhook", id: webhook.id },
      { events: webhook.events },
    );
    res.status(201).json({ webhook });
  }),
);
router.get(
  "/tenants/:tenantId/webhooks/:webhookId",
  requireTenantRole("viewer"),
  asyncHandler(async (req, res) => {
    res.json({
      webhook: await getWebhook(id(req, "tenantId"), id(req, "webhookId")),
    });
  }),
);
router.patch(
  "/tenants/:tenantId/webhooks/:webhookId",
  requireTenantRole("developer"),
  asyncHandler(async (req, res) => {
    const tenantId = id(req, "tenantId");
    const webhook = await updateWebhook(
      tenantId,
      id(req, "webhookId"),
      req.body,
    );
    await writeAudit(
      auditContext(req, tenantId),
      "webhook.updated",
      { type: "webhook", id: webhook.id },
      req.body,
    );
    res.json({ webhook });
  }),
);
router.delete(
  "/tenants/:tenantId/webhooks/:webhookId",
  requireTenantRole("developer"),
  asyncHandler(async (req, res) => {
    const tenantId = id(req, "tenantId");
    const webhookId = id(req, "webhookId");
    await deleteWebhook(tenantId, webhookId);
    await writeAudit(auditContext(req, tenantId), "webhook.deleted", {
      type: "webhook",
      id: webhookId,
    });
    res.status(204).end();
  }),
);
router.post(
  "/tenants/:tenantId/webhooks/:webhookId/rotate-secret",
  requireTenantRole("tenant_admin"),
  asyncHandler(async (req, res) => {
    const tenantId = id(req, "tenantId");
    const result = await rotateWebhookSecret(tenantId, id(req, "webhookId"));
    await writeAudit(auditContext(req, tenantId), "webhook.secret_rotated", {
      type: "webhook",
      id: id(req, "webhookId"),
    });
    res.json(result);
  }),
);
router.post(
  "/tenants/:tenantId/webhooks/:webhookId/test",
  requireTenantRole("developer"),
  asyncHandler(async (req, res) => {
    const tenantId = id(req, "tenantId");
    const delivery = await testWebhook(tenantId, id(req, "webhookId"));
    await writeAudit(auditContext(req, tenantId), "webhook.test_enqueued", {
      type: "webhook",
      id: id(req, "webhookId"),
    });
    res.status(202).json({ delivery });
  }),
);
router.get(
  "/tenants/:tenantId/webhooks/:webhookId/deliveries",
  requireTenantRole("viewer"),
  asyncHandler(async (req, res) => {
    res.json(
      await listDeliveries(
        id(req, "tenantId"),
        id(req, "webhookId"),
        req.query,
      ),
    );
  }),
);
router.post(
  "/tenants/:tenantId/webhook-deliveries/:deliveryId/replay",
  requireTenantRole("developer"),
  asyncHandler(async (req, res) => {
    const tenantId = id(req, "tenantId");
    const delivery = await replayDelivery(tenantId, id(req, "deliveryId"));
    await writeAudit(auditContext(req, tenantId), "webhook.delivery_replayed", {
      type: "webhook_delivery",
      id: delivery.id,
    });
    res.status(202).json({ delivery });
  }),
);

router.get(
  "/tenants/:tenantId/notification-channels",
  requireTenantRole("viewer"),
  asyncHandler(async (req, res) => {
    res.json({ channels: await listNotificationChannels(id(req, "tenantId")) });
  }),
);
router.post(
  "/tenants/:tenantId/notification-channels",
  requireTenantRole("tenant_admin"),
  asyncHandler(async (req, res) => {
    const tenantId = id(req, "tenantId");
    const channel = await createNotificationChannel(
      { ...req.body, tenantId },
      actor(req),
    );
    await writeAudit(
      auditContext(req, tenantId),
      "notification_channel.created",
      { type: "notification_channel", id: channel.id },
      {
        name: channel.name,
        type: channel.type,
        destination: channel.destination,
      },
    );
    res.status(201).json({ channel });
  }),
);
router.patch(
  "/tenants/:tenantId/notification-channels/:channelId",
  requireTenantRole("tenant_admin"),
  asyncHandler(async (req, res) => {
    const tenantId = id(req, "tenantId");
    const current = await getNotificationChannel(id(req, "channelId"));
    if (current.tenantId !== tenantId)
      throw new NotFoundError("通知渠道", current.id);
    const channel = await updateNotificationChannel(current.id, req.body);
    await writeAudit(
      auditContext(req, tenantId),
      "notification_channel.updated",
      {
        type: "notification_channel",
        id: channel.id,
      },
      req.body,
    );
    res.json({ channel });
  }),
);
router.delete(
  "/tenants/:tenantId/notification-channels/:channelId",
  requireTenantRole("tenant_admin"),
  asyncHandler(async (req, res) => {
    const tenantId = id(req, "tenantId");
    const current = await getNotificationChannel(id(req, "channelId"));
    if (current.tenantId !== tenantId)
      throw new NotFoundError("通知渠道", current.id);
    await deleteNotificationChannel(current.id);
    await writeAudit(
      auditContext(req, tenantId),
      "notification_channel.deleted",
      {
        type: "notification_channel",
        id: current.id,
      },
    );
    res.status(204).end();
  }),
);
router.post(
  "/tenants/:tenantId/notification-channels/:channelId/rotate-secret",
  requireTenantRole("tenant_admin"),
  asyncHandler(async (req, res) => {
    const tenantId = id(req, "tenantId");
    const current = await getNotificationChannel(id(req, "channelId"));
    if (current.tenantId !== tenantId)
      throw new NotFoundError("通知渠道", current.id);
    const revealed = await rotateNotificationSecret(current.id);
    await writeAudit(
      auditContext(req, tenantId),
      "notification_channel.secret_rotated",
      {
        type: "notification_channel",
        id: current.id,
      },
    );
    res.json(revealed);
  }),
);
router.post(
  "/tenants/:tenantId/notification-channels/:channelId/test",
  requireTenantRole("developer"),
  asyncHandler(async (req, res) => {
    const tenantId = id(req, "tenantId");
    const record = await enqueueNotificationTest(
      tenantId,
      id(req, "channelId"),
    );
    await writeAudit(
      auditContext(req, tenantId),
      "notification_channel.test_enqueued",
      {
        type: "notification_record",
        id: String(record.id),
      },
    );
    res.status(202).json({ record });
  }),
);
router.get(
  "/notifications",
  asyncHandler(async (req, res) => {
    const tenantId = await readableTenant(req, optionalQuery(req, "tenantId"));
    res.json(await searchNotifications({ ...req.query, tenantId }));
  }),
);
router.post(
  "/notifications/:notificationId/replay",
  asyncHandler(async (req, res) => {
    const notificationId = Number(id(req, "notificationId"));
    const current = await getNotificationRecord(notificationId);
    await assertAlertAccess(req, current.tenantId, "developer");
    const record = await replayNotification(notificationId);
    await writeAudit(
      auditContext(req, record.tenantId),
      "notification.replayed",
      {
        type: "notification_record",
        id: String(record.id),
      },
    );
    res.status(202).json({ record, previous: current });
  }),
);

router.get(
  "/alerts/rules",
  asyncHandler(async (req, res) => {
    const tenantId = await readableTenant(req, optionalQuery(req, "tenantId"));
    res.json({ rules: await listAlertRules(tenantId) });
  }),
);
router.post(
  "/alerts/rules",
  asyncHandler(async (req, res) => {
    const tenantId = req.body?.tenantId as string | undefined;
    if (req.principal?.platformRole !== "platform_admin") {
      if (!tenantId)
        throw new AppError(
          400,
          "TENANT_CONTEXT_REQUIRED",
          "必须指定 tenantId。",
        );
      const role = await tenantRoleForUser(tenantId, req.principal!.id);
      assertTenantAccess(req.principal!, role, "tenant_admin");
    }
    const rule = await createAlertRule(req.body, actor(req));
    await writeAudit(auditContext(req, rule.tenantId), "alert_rule.created", {
      type: "alert_rule",
      id: rule.id,
    });
    res.status(201).json({ rule });
  }),
);
router.get(
  "/alerts/rules/:ruleId",
  asyncHandler(async (req, res) => {
    const rule = await getAlertRule(id(req, "ruleId"));
    await assertAlertAccess(req, rule.tenantId, "viewer");
    res.json({ rule });
  }),
);
router.patch(
  "/alerts/rules/:ruleId",
  asyncHandler(async (req, res) => {
    const current = await getAlertRule(id(req, "ruleId"));
    await assertAlertAccess(req, current.tenantId, "tenant_admin");
    const rule = await updateAlertRule(current.id, req.body, actor(req));
    await writeAudit(
      auditContext(req, rule.tenantId),
      "alert_rule.updated",
      { type: "alert_rule", id: rule.id },
      req.body,
    );
    res.json({ rule });
  }),
);
router.delete(
  "/alerts/rules/:ruleId",
  asyncHandler(async (req, res) => {
    const current = await getAlertRule(id(req, "ruleId"));
    await assertAlertAccess(req, current.tenantId, "tenant_admin");
    await deleteAlertRule(current.id);
    await writeAudit(
      auditContext(req, current.tenantId),
      "alert_rule.deleted",
      { type: "alert_rule", id: current.id },
    );
    res.status(204).end();
  }),
);
router.get(
  "/alerts/events",
  asyncHandler(async (req, res) => {
    const tenantId = await readableTenant(req, optionalQuery(req, "tenantId"));
    res.json(await searchAlertEvents({ ...req.query, tenantId }));
  }),
);
router.post(
  "/alerts/events/:eventId/acknowledge",
  asyncHandler(async (req, res) => {
    const current = await getAlertEvent(Number(id(req, "eventId")));
    await assertAlertAccess(req, current.tenantId, "tenant_admin");
    const event = await acknowledgeAlert(
      Number(id(req, "eventId")),
      actor(req),
    );
    await writeAudit(auditContext(req, event.tenantId), "alert.acknowledged", {
      type: "alert_event",
      id: String(event.id),
    });
    res.json({ event });
  }),
);
router.post(
  "/alerts/events/:eventId/silence",
  asyncHandler(async (req, res) => {
    const minutes = z.number().int().parse(req.body?.minutes);
    const current = await getAlertEvent(Number(id(req, "eventId")));
    await assertAlertAccess(req, current.tenantId, "tenant_admin");
    const event = await silenceAlert(Number(id(req, "eventId")), minutes);
    await writeAudit(
      auditContext(req, event.tenantId),
      "alert.silenced",
      { type: "alert_event", id: String(event.id) },
      { minutes },
    );
    res.json({ event });
  }),
);

router.get(
  "/audit",
  asyncHandler(async (req, res) => {
    const tenantId = await readableTenant(req, optionalQuery(req, "tenantId"));
    res.json(await searchAudit({ ...req.query, tenantId }));
  }),
);
router.get(
  "/audit/actions",
  asyncHandler(async (req, res) => {
    const tenantId = await readableTenant(req, optionalQuery(req, "tenantId"));
    res.json({ actions: await auditActions(tenantId) });
  }),
);
router.get(
  "/settings",
  requirePlatformAdmin,
  asyncHandler(async (_req, res) => {
    res.json({ settings: await listSettings() });
  }),
);
router.get(
  "/settings/:key",
  requirePlatformAdmin,
  asyncHandler(async (req, res) => {
    res.json({ setting: await getSetting(id(req, "key")) });
  }),
);
router.put(
  "/settings/:key",
  requirePlatformAdmin,
  asyncHandler(async (req, res) => {
    const key = id(req, "key");
    const setting = await updateSetting(key, req.body, actor(req));
    await writeAudit(auditContext(req), "platform_setting.updated", {
      type: "platform_setting",
      id: key,
    });
    res.json({ setting });
  }),
);

export { router as adminRouter };
