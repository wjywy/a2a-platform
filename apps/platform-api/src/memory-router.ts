import { Router } from "express";
import { z } from "zod";
import {
  assertTenantAccess,
  requireAuthentication,
  requireTenantRole,
  type AuthenticatedRequest,
} from "./auth.js";
import { asyncHandler, auditContext, optionalQuery, pathParam } from "./http.js";
import { AppError } from "./domain.js";
import { writeAudit } from "./audit-service.js";
import {
  getAgentPolicyBySlug,
  updateAgentPolicy,
  type MemoryScope,
} from "./agent-policy-service.js";
import {
  deleteMemory,
  readMemoryContext,
  resetMemory,
} from "./memory-service.js";
import {
  resolveLongbridgeCredential,
  saveLongbridgeCredential,
} from "./market-data-credentials.js";
import { isSymbolAgentSlug } from "./symbol-service.js";
import { listTenantsForUser, tenantRoleForUser } from "./tenant-service.js";

const router = Router();

const memoryScope = z.enum(["conversation", "user", "agent", "tenant"]);

function slug(req: AuthenticatedRequest) {
  const value = pathParam(req, "agentSlug");
  if (!isSymbolAgentSlug(value))
    throw new AppError(400, "INVALID_AGENT", "Agent 标识无效。");
  return value;
}

function errorFromMemory(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  const known: Record<string, { status: number; message: string }> = {
    MEMORY_CONTROL_DISABLED: { status: 403, message: "当前记忆策略不允许用户控制。" },
    MEMORY_SCOPE_DENIED: { status: 403, message: "当前记忆策略不允许该范围。" },
    MEMORY_SUBJECT_REQUIRED: { status: 400, message: "当前操作缺少受信任的记忆主体。" },
    POLICY_VERSION_CONFLICT: { status: 409, message: "Agent 策略版本已变化，请重新读取后再修改。" },
  };
  const current = known[message];
  if (current) throw new AppError(current.status, message, current.message);
  throw error;
}

async function userTenant(
  req: AuthenticatedRequest,
  requested?: string,
): Promise<string> {
  if (requested) {
    if (req.principal?.platformRole === "platform_admin") return requested;
    const tenants = await listTenantsForUser(req.principal!.id);
    if (!tenants.some((tenant) => tenant.id === requested))
      throw new AppError(404, "MEMORY_NOT_FOUND", "记忆不存在。 ");
    return requested;
  }
  if (req.principal?.platformRole === "platform_admin")
    throw new AppError(400, "TENANT_CONTEXT_REQUIRED", "平台管理员必须指定租户上下文。 ");
  const tenants = await listTenantsForUser(req.principal!.id);
  if (tenants.length !== 1)
    throw new AppError(400, "TENANT_CONTEXT_REQUIRED", "当前用户需要明确租户上下文。 ");
  return tenants[0].id;
}

async function assertAdminTenant(
  req: AuthenticatedRequest,
  tenantId: string,
  minimum: "viewer" | "developer" | "tenant_admin",
) {
  if (req.principal?.platformRole === "platform_admin") return;
  const role = await tenantRoleForUser(tenantId, req.principal!.id);
  assertTenantAccess(req.principal!, role, minimum);
}

function publicPolicy(policy: Awaited<ReturnType<typeof getAgentPolicyBySlug>>) {
  if (!policy) return undefined;
  return {
    enabled: policy.memoryEnabled,
    readScopes: policy.memoryReadScopes,
    writeScopes: policy.memoryWriteScopes,
    categories: policy.memoryCategories,
    retentionDays: policy.retentionDays,
    maxEntries: policy.maxEntries,
    maxContextChars: policy.maxContextChars,
    allowUserControl: policy.allowUserControl,
    allowCrossConversation: policy.allowCrossConversation,
    allowCrossAgent: policy.allowCrossAgent,
    version: policy.version,
  };
}

router.get(
  "/api/memory",
  requireAuthentication,
  asyncHandler(async (req, res) => {
    const agentSlug = String(optionalQuery(req, "agentSlug") ?? "");
    if (!isSymbolAgentSlug(agentSlug))
      throw new AppError(400, "INVALID_AGENT", "Agent 标识无效。 ");
    const tenantId = await userTenant(req, optionalQuery(req, "tenantId"));
    const conversationId = optionalQuery(req, "conversationId");
    if (conversationId) z.string().uuid().parse(conversationId);
    try {
      const context = await readMemoryContext({
        tenantId,
        agentSlug,
        conversationId,
        userId: req.principal!.id,
      });
      res.json({ agentSlug, entries: context.entries, summary: context.summary });
    } catch (error) {
      errorFromMemory(error);
    }
  }),
);

router.delete(
  "/api/memory/:memoryId",
  requireAuthentication,
  asyncHandler(async (req, res) => {
    const agentSlug = String(optionalQuery(req, "agentSlug") ?? "");
    if (!isSymbolAgentSlug(agentSlug))
      throw new AppError(400, "INVALID_AGENT", "删除记忆必须指定有效 Agent。 ");
    const tenantId = await userTenant(req, optionalQuery(req, "tenantId"));
    const conversationId = optionalQuery(req, "conversationId");
    if (conversationId) z.string().uuid().parse(conversationId);
    const deleted = await deleteMemory(
      { tenantId, agentSlug, conversationId, userId: req.principal!.id },
      pathParam(req, "memoryId"),
    );
    if (!deleted) throw new AppError(404, "MEMORY_NOT_FOUND", "记忆不存在。 ");
    await writeAudit(auditContext(req, tenantId), "memory.deleted", {
      type: "agent_memory",
      id: pathParam(req, "memoryId"),
    });
    res.status(204).end();
  }),
);

router.post(
  "/api/memory/reset",
  requireAuthentication,
  asyncHandler(async (req, res) => {
    const agentSlug = String(req.body?.agentSlug ?? "");
    if (!isSymbolAgentSlug(agentSlug))
      throw new AppError(400, "INVALID_AGENT", "Agent 标识无效。 ");
    const tenantId = await userTenant(req, req.body?.tenantId);
    const scope = memoryScope.parse(req.body?.scope) as MemoryScope;
    const conversationId = req.body?.conversationId as string | undefined;
    if (conversationId) z.string().uuid().parse(conversationId);
    if (scope === "agent" || scope === "tenant")
      throw new AppError(403, "MEMORY_SCOPE_DENIED", "用户不能重置 Agent 或租户范围记忆。 ");
    try {
      const deletedCount = await resetMemory(
        { tenantId, agentSlug, conversationId, userId: req.principal!.id },
        scope,
      );
      await writeAudit(auditContext(req, tenantId), "memory.reset", {
        type: "agent_memory_scope",
        id: `${agentSlug}:${scope}`,
      });
      res.json({ deletedCount, agentSlug, scope });
    } catch (error) {
      errorFromMemory(error);
    }
  }),
);

router.get(
  "/api/admin/agents/:agentSlug/memory-policy",
  requireAuthentication,
  requireTenantRole("viewer"),
  asyncHandler(async (req, res) => {
    const tenantId = optionalQuery(req, "tenantId");
    if (!tenantId)
      throw new AppError(400, "TENANT_CONTEXT_REQUIRED", "必须指定 tenantId。 ");
    await assertAdminTenant(req, tenantId, "viewer");
    const policy = await getAgentPolicyBySlug(slug(req));
    if (!policy) throw new AppError(404, "INVALID_AGENT", "Agent 策略不存在。 ");
    res.json({ agentSlug: slug(req), policy: publicPolicy(policy) });
  }),
);

router.patch(
  "/api/admin/agents/:agentSlug/memory-policy",
  requireAuthentication,
  requireTenantRole("developer"),
  asyncHandler(async (req, res) => {
    const tenantId = await userTenant(req, req.body?.tenantId ?? optionalQuery(req, "tenantId"));
    await assertAdminTenant(req, tenantId, "developer");
    const current = await getAgentPolicyBySlug(slug(req));
    if (!current) throw new AppError(404, "INVALID_AGENT", "Agent 策略不存在。 ");
    try {
      const { tenantId: _tenantId, ...policyInput } = req.body ?? {};
      const updated = await updateAgentPolicy(current.agentId, policyInput, req.principal!.id);
      await writeAudit(auditContext(req, tenantId), "agent.memory_policy.updated", {
        type: "agent_policy",
        id: current.agentId,
        agentId: current.agentId,
      }, { version: updated.version });
      res.json({ agentSlug: slug(req), policy: publicPolicy(updated) });
    } catch (error) {
      errorFromMemory(error);
    }
  }),
);

router.get(
  "/api/admin/agents/:agentSlug/memories",
  requireAuthentication,
  requireTenantRole("viewer"),
  asyncHandler(async (req, res) => {
    const tenantId = optionalQuery(req, "tenantId");
    if (!tenantId)
      throw new AppError(400, "TENANT_CONTEXT_REQUIRED", "必须指定 tenantId。 ");
    await assertAdminTenant(req, tenantId, "viewer");
    const conversationId = optionalQuery(req, "conversationId");
    if (conversationId) z.string().uuid().parse(conversationId);
    const context = await readMemoryContext({
      tenantId,
      agentSlug: slug(req),
      conversationId,
    });
    res.json({ agentSlug: slug(req), entries: context.entries, summary: context.summary });
  }),
);

router.post(
  "/api/admin/agents/:agentSlug/memory/reset",
  requireAuthentication,
  requireTenantRole("tenant_admin"),
  asyncHandler(async (req, res) => {
    const tenantId = z.string().uuid().parse(req.body?.tenantId);
    await assertAdminTenant(req, tenantId, "tenant_admin");
    const scope = memoryScope.parse(req.body?.scope) as MemoryScope;
    const conversationId = req.body?.conversationId as string | undefined;
    if (conversationId) z.string().uuid().parse(conversationId);
    if (scope === "conversation" && !conversationId)
      throw new AppError(400, "MEMORY_SUBJECT_REQUIRED", "重置 conversation scope 必须指定 conversationId。 ");
    try {
      const deletedCount = await resetMemory(
        { tenantId, agentSlug: slug(req), conversationId },
        scope,
      );
      await writeAudit(auditContext(req, tenantId), "memory.admin_reset", {
        type: "agent_memory_scope",
        id: `${slug(req)}:${scope}`,
      });
      res.json({ deletedCount, agentSlug: slug(req), scope });
    } catch (error) {
      errorFromMemory(error);
    }
  }),
);

router.get(
  "/api/admin/tenants/:tenantId/market-data/longbridge",
  requireAuthentication,
  requireTenantRole("viewer"),
  asyncHandler(async (req, res) => {
    const tenantId = pathParam(req, "tenantId");
    await assertAdminTenant(req, tenantId, "viewer");
    const resolved = await resolveLongbridgeCredential(tenantId);
    res.json({ provider: "longbridge", summary: resolved.summary });
  }),
);

router.put(
  "/api/admin/tenants/:tenantId/market-data/longbridge",
  requireAuthentication,
  requireTenantRole("tenant_admin"),
  asyncHandler(async (req, res) => {
    const tenantId = pathParam(req, "tenantId");
    await assertAdminTenant(req, tenantId, "tenant_admin");
    const credential = z
      .object({
        appKey: z.string().min(1).max(512),
        appSecret: z.string().min(1).max(2048),
        accessToken: z.string().min(1).max(8192),
      })
      .strict()
      .parse(req.body);
    const summary = await saveLongbridgeCredential(tenantId, credential);
    await writeAudit(auditContext(req, tenantId), "market_data.credential.updated", {
      type: "market_data_credential",
      id: `${tenantId}:longbridge`,
    }, { provider: "longbridge" });
    res.json({ provider: "longbridge", summary });
  }),
);

export { router as memoryRouter };
