import { z } from "zod";
import {
  defaultAgentPolicy,
  getAgentPolicyBySlug,
  memoryCategorySchema,
  memoryScopeSchema,
  type MemoryCategory,
  type MemoryScope,
} from "./agent-policy-service.js";
import { query, transaction } from "./db.js";
import { getRedis } from "./redis.js";

export const memorySubjectSchema = z.object({
  tenantId: z.string().uuid(),
  agentSlug: z.string().min(3).max(64),
  conversationId: z.string().uuid().optional(),
  userId: z.string().min(1).max(256).optional(),
  apiKeyId: z.string().uuid().optional(),
});
export type MemorySubject = z.infer<typeof memorySubjectSchema>;

export const memoryWriteSchema = z.object({
  scope: memoryScopeSchema,
  category: memoryCategorySchema,
  content: z.record(z.unknown()),
  sourceConversationId: z.string().uuid().optional(),
  sourceMessageId: z.string().max(256).optional(),
  sourceKind: z.string().min(1).max(64).default("agent"),
  confidence: z.number().min(0).max(1).default(0.5),
  observedAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
  supersedesId: z.string().uuid().optional(),
});
export type MemoryWrite = z.input<typeof memoryWriteSchema>;

export type MemoryItem = {
  id: string;
  tenantId: string;
  agentSlug: string;
  scope: MemoryScope;
  subjectType: "conversation" | "user" | "api_key" | "tenant";
  subjectId: string;
  category: MemoryCategory;
  content: Record<string, unknown>;
  source: {
    conversationId?: string;
    messageId?: string;
    kind: string;
  };
  confidence: number;
  observedAt: string;
  expiresAt: string;
  status: "active" | "superseded" | "expired" | "redacted";
};

export type MemoryContext = {
  enabled: boolean;
  entries: MemoryItem[];
  usedEntryIds: string[];
  summary: {
    unresolvedQuestions: string[];
    recognizedEntities: string[];
    latestCorrections: Array<Record<string, unknown>>;
  };
  degradedReason?: string;
};

type MemoryRow = {
  id: string;
  tenant_id: string;
  agent_id: string;
  scope: MemoryScope;
  subject_type: MemoryItem["subjectType"];
  subject_id: string;
  category: MemoryCategory;
  content: Record<string, unknown>;
  source_conversation_id: string | null;
  source_message_id: string | null;
  source_kind: string;
  confidence: number | string;
  observed_at: Date;
  expires_at: Date;
  superseded_by: string | null;
  deleted_at: Date | null;
  redacted_at: Date | null;
};

function cacheKey(subject: MemorySubject, policyVersion = 0) {
  const identity = subject.conversationId
    ? `conversation:${subject.conversationId}`
    : subject.userId
      ? `user:${subject.userId}`
      : subject.apiKeyId
        ? `api_key:${subject.apiKeyId}`
        : `tenant:${subject.tenantId}`;
  return `symbol:memory:${subject.tenantId}:${subject.agentSlug}:v${policyVersion}:${identity}`;
}

function mapMemory(row: MemoryRow, agentSlug: string): MemoryItem {
  const expired = row.expires_at.getTime() <= Date.now();
  return {
    id: row.id,
    tenantId: row.tenant_id,
    agentSlug,
    scope: row.scope,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    category: row.category,
    content: row.content,
    source: {
      conversationId: row.source_conversation_id ?? undefined,
      messageId: row.source_message_id ?? undefined,
      kind: row.source_kind,
    },
    confidence: Number(row.confidence),
    observedAt: row.observed_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    status:
      row.deleted_at || row.redacted_at
        ? "redacted"
        : row.superseded_by
          ? "superseded"
          : expired
            ? "expired"
            : "active",
  };
}

function subjectForScope(subject: MemorySubject, scope: MemoryScope) {
  if (scope === "conversation" && subject.conversationId)
    return { subjectType: "conversation", subjectId: subject.conversationId };
  if (scope === "user" && subject.userId)
    return { subjectType: "user", subjectId: subject.userId };
  if (scope === "agent")
    return { subjectType: "agent", subjectId: subject.agentSlug };
  if (scope === "tenant")
    return { subjectType: "tenant", subjectId: subject.tenantId };
  return undefined;
}

function effectiveScopes(
  policy: ReturnType<typeof policyForOrDefault>,
  mode: "read" | "write",
) {
  const scopes = mode === "read" ? policy.memoryReadScopes : policy.memoryWriteScopes;
  return scopes.filter((scope) => {
    if (scope === "user" && !policy.allowCrossConversation) return false;
    if (scope === "agent" && !policy.allowCrossAgent) return false;
    return true;
  });
}

function containsSensitiveKey(value: unknown, path = ""): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value))
    return value.some((item, index) => containsSensitiveKey(item, `${path}[${index}]`));
  return Object.entries(value).some(([key, child]) => {
    const normalized = key.toLowerCase().replace(/[-_]/g, "");
    if (
      [
        "token",
        "secret",
        "password",
        "authorization",
        "credential",
        "ciphertext",
        "apikey",
        "appkey",
        "privatekey",
        "encryptionkey",
      ].some((needle) => normalized.includes(needle))
    )
      return true;
    return containsSensitiveKey(child, `${path}.${key}`);
  });
}

function policyForOrDefault(policy: Awaited<ReturnType<typeof getAgentPolicyBySlug>>) {
  return policy ?? {
    ...defaultAgentPolicy,
    id: "default",
    agentId: "default",
    version: 1,
    updatedBy: "system",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

export function selectRelevantMemories(
  entries: MemoryItem[],
  maxEntries: number,
  maxContextChars: number,
): MemoryItem[] {
  const active = entries
    .filter((entry) => entry.status === "active")
    .sort((left, right) => {
      const confidence = right.confidence - left.confidence;
      if (confidence !== 0) return confidence;
      return right.observedAt.localeCompare(left.observedAt);
    });
  const selected: MemoryItem[] = [];
  let chars = 0;
  for (const item of active.slice(0, maxEntries)) {
    const itemChars = JSON.stringify(item.content).length;
    if (itemChars > maxContextChars || chars + itemChars > maxContextChars)
      continue;
    selected.push(item);
    chars += itemChars;
  }
  return selected;
}

function contextSummary(entries: MemoryItem[]): MemoryContext["summary"] {
  const unresolvedQuestions: string[] = [];
  const recognizedEntities: string[] = [];
  const latestCorrections: Array<Record<string, unknown>> = [];
  for (const entry of entries) {
    const values = Object.values(entry.content).filter(
      (value): value is string => typeof value === "string",
    );
    if (entry.category === "open_question") unresolvedQuestions.push(...values);
    if (entry.category === "fact") recognizedEntities.push(...values);
    if (entry.category === "summary" && typeof entry.content.recognizedEntity === "string")
      recognizedEntities.push(entry.content.recognizedEntity);
    if (entry.category === "correction") latestCorrections.push(entry.content);
  }
  return {
    unresolvedQuestions: [...new Set(unresolvedQuestions)].slice(0, 20),
    recognizedEntities: [...new Set(recognizedEntities)].slice(0, 20),
    latestCorrections: latestCorrections.slice(0, 10),
  };
}

async function agentIdForSlug(slug: string) {
  const rows = await query<{ id: string }>(
    "SELECT id FROM agents WHERE slug=$1 AND deleted_at IS NULL",
    [slug],
  );
  return rows[0]?.id;
}

async function invalidateMemoryCache(subject: MemorySubject, policyVersion = 0) {
  const redis = await getRedis();
  if (!redis) return;
  await redis.del(cacheKey(subject, policyVersion));
}

export async function readMemoryContext(
  subjectInput: MemorySubject,
): Promise<MemoryContext> {
  const subject = memorySubjectSchema.parse(subjectInput);
  const policy = policyForOrDefault(await getAgentPolicyBySlug(subject.agentSlug));
  if (!policy.memoryEnabled)
    return {
      enabled: false,
      entries: [],
      usedEntryIds: [],
      summary: { unresolvedQuestions: [], recognizedEntities: [], latestCorrections: [] },
    };
  const redis = await getRedis();
  const cached = await redis?.get(cacheKey(subject, policy.version));
  if (cached) return JSON.parse(cached) as MemoryContext;
  const agentId = await agentIdForSlug(subject.agentSlug);
  if (!agentId)
    return {
      enabled: true,
      entries: [],
      usedEntryIds: [],
      summary: { unresolvedQuestions: [], recognizedEntities: [], latestCorrections: [] },
      degradedReason: "Agent 不存在，无法读取记忆。",
    };
  const allowed = effectiveScopes(policy, "read").filter((scope) =>
    subjectForScope(subject, scope),
  );
  if (!allowed.length)
    return {
      enabled: true,
      entries: [],
      usedEntryIds: [],
      summary: { unresolvedQuestions: [], recognizedEntities: [], latestCorrections: [] },
    };
  const bindings: unknown[] = [subject.tenantId, agentId, allowed];
  const predicates = allowed.map((scope) => {
    const scoped = subjectForScope(subject, scope)!;
    bindings.push(scoped.subjectType, scoped.subjectId);
    const typeIndex = bindings.length - 1;
    const idIndex = bindings.length;
    return `(scope='${scope}' AND subject_type=$${typeIndex} AND subject_id=$${idIndex})`;
  });
  // The scope list is bound as an array; each branch still binds the trusted
  // server-derived subject identity. This avoids accepting identity fields
  // from the A2A message body.
  const rows = await query<MemoryRow>(
    `SELECT m.* FROM agent_memories m
     WHERE m.tenant_id=$1 AND m.agent_id=$2
       AND m.scope = ANY($3::text[])
       AND (${predicates.join(" OR ")})
       AND m.deleted_at IS NULL AND m.redacted_at IS NULL
       AND m.expires_at > now() AND m.superseded_by IS NULL
     ORDER BY m.confidence DESC,m.observed_at DESC
     LIMIT $${bindings.push(policy.maxEntries)}`,
    bindings,
  );
  const items = selectRelevantMemories(
    rows.map((row) => mapMemory(row, subject.agentSlug)),
    policy.maxEntries,
    policy.maxContextChars,
  );
  const context = {
    enabled: true,
    entries: items,
    usedEntryIds: items.map((item) => item.id),
    summary: contextSummary(items),
  };
  if (redis) await redis.set(cacheKey(subject, policy.version), JSON.stringify(context), { EX: 300 });
  return context;
}

export async function writeMemory(
  subjectInput: MemorySubject,
  input: MemoryWrite,
): Promise<MemoryItem> {
  const subject = memorySubjectSchema.parse(subjectInput);
  const value = memoryWriteSchema.parse(input);
  if (containsSensitiveKey(value.content))
    throw new Error("记忆内容包含禁止持久化的敏感字段。 ");
  const policy = policyForOrDefault(await getAgentPolicyBySlug(subject.agentSlug));
  if (!policy.memoryEnabled || !effectiveScopes(policy, "write").includes(value.scope))
    throw new Error("MEMORY_SCOPE_DENIED");
  if (!policy.memoryCategories.includes(value.category))
    throw new Error("MEMORY_CATEGORY_DENIED");
  const scoped = subjectForScope(subject, value.scope);
  if (!scoped) throw new Error("MEMORY_SUBJECT_REQUIRED");
  const agentId = await agentIdForSlug(subject.agentSlug);
  if (!agentId) throw new Error("Agent 不存在，无法写入记忆。 ");
  const observedAt = value.observedAt ? new Date(value.observedAt) : new Date();
  const policyExpiry = new Date(observedAt);
  policyExpiry.setUTCDate(policyExpiry.getUTCDate() + policy.retentionDays);
  const requestedExpiry = value.expiresAt ? new Date(value.expiresAt) : policyExpiry;
  const expiresAt = requestedExpiry < policyExpiry ? requestedExpiry : policyExpiry;
  const rows = await transaction(async (client) => {
    const inserted = await client.query<MemoryRow>(
      `INSERT INTO agent_memories(
         tenant_id,agent_id,scope,subject_type,subject_id,category,content,
         source_conversation_id,source_message_id,source_kind,confidence,
         observed_at,expires_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        subject.tenantId,
        agentId,
        value.scope,
        scoped.subjectType,
        scoped.subjectId,
        value.category,
        JSON.stringify(value.content),
        value.sourceConversationId ?? null,
        value.sourceMessageId ?? null,
        value.sourceKind,
        value.confidence,
        observedAt,
        expiresAt,
      ],
    );
    if (value.supersedesId) {
      await client.query(
        `UPDATE agent_memories SET superseded_by=$1,updated_at=now()
         WHERE id=$2 AND tenant_id=$3 AND agent_id=$4`,
        [inserted.rows[0].id, value.supersedesId, subject.tenantId, agentId],
      );
    }
    return inserted.rows;
  });
  await invalidateMemoryCache(subject, policy.version);
  return mapMemory(rows[0], subject.agentSlug);
}

export async function deleteMemory(
  subjectInput: MemorySubject,
  memoryId: string,
): Promise<boolean> {
  const subject = memorySubjectSchema.parse(subjectInput);
  const policy = policyForOrDefault(await getAgentPolicyBySlug(subject.agentSlug));
  const agentId = await agentIdForSlug(subject.agentSlug);
  if (!agentId) return false;
  const scopes = ["conversation", "user", "agent", "tenant"] as MemoryScope[];
  const predicates: string[] = [];
  const values: unknown[] = [memoryId, subject.tenantId, agentId];
  for (const scope of scopes) {
    const scoped = subjectForScope(subject, scope);
    if (!scoped) continue;
    values.push(scope, scoped.subjectType, scoped.subjectId);
    const base = values.length - 2;
    predicates.push(`(scope=$${base} AND subject_type=$${base + 1} AND subject_id=$${base + 2})`);
  }
  if (!predicates.length) return false;
  const rows = await query<{ id: string }>(
    `UPDATE agent_memories SET deleted_at=now(),redacted_at=now(),content='{}'::jsonb,updated_at=now()
     WHERE id=$1 AND tenant_id=$2 AND agent_id=$3 AND deleted_at IS NULL
       AND (${predicates.join(" OR ")}) RETURNING id`,
    values,
  );
  if (rows[0]) await invalidateMemoryCache(subject, policy.version);
  return Boolean(rows[0]);
}

export async function resetMemory(
  subjectInput: MemorySubject,
  scope: MemoryScope,
): Promise<number> {
  const subject = memorySubjectSchema.parse(subjectInput);
  const policy = policyForOrDefault(await getAgentPolicyBySlug(subject.agentSlug));
  if (!policy.allowUserControl) throw new Error("MEMORY_CONTROL_DISABLED");
  if (!effectiveScopes(policy, "write").includes(scope)) throw new Error("MEMORY_SCOPE_DENIED");
  const scoped = subjectForScope(subject, scope);
  if (!scoped) throw new Error("MEMORY_SUBJECT_REQUIRED");
  const agentId = await agentIdForSlug(subject.agentSlug);
  if (!agentId) return 0;
  const rows = await query<{ id: string }>(
    `UPDATE agent_memories SET deleted_at=now(),redacted_at=now(),content='{}'::jsonb,updated_at=now()
     WHERE tenant_id=$1 AND agent_id=$2 AND scope=$3 AND subject_type=$4 AND subject_id=$5
       AND deleted_at IS NULL RETURNING id`,
    [subject.tenantId, agentId, scope, scoped.subjectType, scoped.subjectId],
  );
  await invalidateMemoryCache(subject, policy.version);
  return rows.length;
}

export const __memoryInternals = {
  cacheKey,
  containsSensitiveKey,
  contextSummary,
  mapMemory,
  selectRelevantMemories,
  subjectForScope,
  effectiveScopes,
};
