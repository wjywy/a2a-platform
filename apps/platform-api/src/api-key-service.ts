import crypto from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { pool, query } from "./db.js";
import {
  AppError,
  NotFoundError,
  UnauthorizedError,
  type ApiKeyScope,
  type TenantStatus,
} from "./domain.js";
import { getTenant } from "./tenant-service.js";

export const apiKeyScopes = [
  "agent:invoke",
  "task:read",
  "task:cancel",
  "usage:read",
] as const;

const nullableLimit = z
  .number()
  .int()
  .min(1)
  .max(1_000_000_000)
  .nullable()
  .optional();

export const createApiKeySchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).default(""),
  scopes: z.array(z.enum(apiKeyScopes)).min(1).default(["agent:invoke"]),
  expiresAt: z.string().datetime().nullable().optional(),
  minuteRequestLimit: nullableLimit,
  dailyRequestLimit: nullableLimit,
  monthlyRequestLimit: nullableLimit,
  concurrentRequestLimit: nullableLimit,
  agentIds: z.array(z.string().uuid()).max(500).default([]),
});

export const updateApiKeySchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    description: z.string().trim().max(300).optional(),
    scopes: z.array(z.enum(apiKeyScopes)).min(1).optional(),
    expiresAt: z.string().datetime().nullable().optional(),
    minuteRequestLimit: nullableLimit,
    dailyRequestLimit: nullableLimit,
    monthlyRequestLimit: nullableLimit,
    concurrentRequestLimit: nullableLimit,
    agentIds: z.array(z.string().uuid()).max(500).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "至少提供一个可更新字段。");

export type ApiKeyLimits = {
  minuteRequestLimit?: number;
  dailyRequestLimit?: number;
  monthlyRequestLimit?: number;
  concurrentRequestLimit?: number;
};

export type ApiKey = ApiKeyLimits & {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  prefix: string;
  scopes: ApiKeyScope[];
  expiresAt?: string;
  lastUsedAt?: string;
  revokedAt?: string;
  createdBy: string;
  createdAt: string;
  agentIds: string[];
};

export type RevealedApiKey = ApiKey & { secret: string };

export type AuthenticatedApiKey = {
  id: string;
  tenantId: string;
  tenantSlug: string;
  tenantStatus: TenantStatus;
  name: string;
  prefix: string;
  scopes: ApiKeyScope[];
  limits: Required<ApiKeyLimits>;
  tenantLimits: Required<ApiKeyLimits>;
  keyLimits: Required<ApiKeyLimits>;
  warningThresholdPercent: number;
  allowedAgentIds: string[];
};

type ApiKeyRow = {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  key_prefix: string;
  scopes: ApiKeyScope[];
  expires_at: Date | null;
  last_used_at: Date | null;
  revoked_at: Date | null;
  minute_request_limit: number | null;
  daily_request_limit: number | null;
  monthly_request_limit: number | null;
  concurrent_request_limit: number | null;
  created_by: string;
  created_at: Date;
};

function mapKey(row: ApiKeyRow): ApiKey {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    description: row.description,
    prefix: row.key_prefix,
    scopes: row.scopes,
    expiresAt: row.expires_at?.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString(),
    revokedAt: row.revoked_at?.toISOString(),
    minuteRequestLimit: row.minute_request_limit ?? undefined,
    dailyRequestLimit: row.daily_request_limit ?? undefined,
    monthlyRequestLimit: row.monthly_request_limit ?? undefined,
    concurrentRequestLimit: row.concurrent_request_limit ?? undefined,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    agentIds: [],
  };
}

async function attachAgentGrants(keys: ApiKey[]): Promise<ApiKey[]> {
  if (!keys.length) return keys;
  const rows = await query<{ api_key_id: string; agent_id: string }>(
    "SELECT api_key_id,agent_id FROM api_key_agent_grants WHERE api_key_id=ANY($1::uuid[])",
    [keys.map((key) => key.id)],
  );
  const grants = new Map<string, string[]>();
  for (const row of rows)
    grants.set(row.api_key_id, [
      ...(grants.get(row.api_key_id) ?? []),
      row.agent_id,
    ]);
  return keys.map((key) => ({ ...key, agentIds: grants.get(key.id) ?? [] }));
}

async function validateAgentGrants(
  tenantId: string,
  agentIds: string[],
): Promise<void> {
  if (!agentIds.length) return;
  const rows = await query<{ id: string }>(
    `SELECT id FROM agents WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL AND
      (visibility='public' OR tenant_id=$2 OR (visibility='tenant' AND allowed_tenant_ids ? ($2::text)))`,
    [agentIds, tenantId],
  );
  if (rows.length !== new Set(agentIds).size)
    throw new AppError(
      400,
      "API_KEY_AGENT_GRANT_INVALID",
      "包含租户无权访问的 Agent。",
    );
}

async function replaceAgentGrants(
  keyId: string,
  agentIds: string[],
  client?: PoolClient,
): Promise<void> {
  const execute = client
    ? (text: string, values: unknown[]) => client.query(text, values)
    : (text: string, values: unknown[]) => query(text, values);
  await execute("DELETE FROM api_key_agent_grants WHERE api_key_id=$1", [
    keyId,
  ]);
  if (agentIds.length)
    await execute(
      `INSERT INTO api_key_agent_grants(api_key_id,agent_id)
       SELECT $1,unnest($2::uuid[])`,
      [keyId, [...new Set(agentIds)]],
    );
}

function createSecret(): string {
  return `a2a_live_${crypto.randomBytes(32).toString("base64url")}`;
}

export function hashApiKey(secret: string): string {
  return crypto.createHash("sha256").update(secret, "utf8").digest("hex");
}

export function apiKeyPrefix(secret: string): string {
  return secret.slice(0, 17);
}

export async function listApiKeys(
  tenantId: string,
  includeRevoked = true,
): Promise<ApiKey[]> {
  await getTenant(tenantId);
  const rows = await query<ApiKeyRow>(
    `SELECT * FROM api_keys WHERE tenant_id=$1 ${includeRevoked ? "" : "AND revoked_at IS NULL"} ORDER BY created_at DESC`,
    [tenantId],
  );
  return attachAgentGrants(rows.map(mapKey));
}

export async function getApiKey(tenantId: string, id: string): Promise<ApiKey> {
  const rows = await query<ApiKeyRow>(
    "SELECT * FROM api_keys WHERE id=$1 AND tenant_id=$2",
    [id, tenantId],
  );
  if (!rows[0]) throw new NotFoundError("API Key", id);
  return (await attachAgentGrants([mapKey(rows[0])]))[0];
}

export async function createApiKey(
  tenantId: string,
  raw: unknown,
  createdBy: string,
): Promise<RevealedApiKey> {
  await getTenant(tenantId);
  const input = createApiKeySchema.parse(raw);
  await validateAgentGrants(tenantId, input.agentIds);
  if (input.expiresAt && new Date(input.expiresAt) <= new Date()) {
    throw new AppError(400, "EXPIRY_IN_PAST", "过期时间必须晚于当前时间。");
  }
  const secret = createSecret();
  const client = await pool.connect();
  let row: ApiKeyRow;
  try {
    await client.query("BEGIN");
    const result = await client.query<ApiKeyRow>(
      `INSERT INTO api_keys(
         tenant_id,name,description,key_prefix,secret_hash,scopes,expires_at,
         minute_request_limit,daily_request_limit,monthly_request_limit,concurrent_request_limit,created_by
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        tenantId,
        input.name,
        input.description,
        apiKeyPrefix(secret),
        hashApiKey(secret),
        JSON.stringify(input.scopes),
        input.expiresAt ? new Date(input.expiresAt) : null,
        input.minuteRequestLimit ?? null,
        input.dailyRequestLimit ?? null,
        input.monthlyRequestLimit ?? null,
        input.concurrentRequestLimit ?? null,
        createdBy,
      ],
    );
    row = result.rows[0];
    await replaceAgentGrants(row.id, input.agentIds, client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return { ...(await attachAgentGrants([mapKey(row)]))[0], secret };
}

export async function updateApiKey(
  tenantId: string,
  id: string,
  raw: unknown,
): Promise<ApiKey> {
  const input = updateApiKeySchema.parse(raw);
  const current = await getApiKey(tenantId, id);
  if (current.revokedAt)
    throw new AppError(409, "API_KEY_REVOKED", "已撤销的 API Key 不能编辑。");
  if (input.expiresAt && new Date(input.expiresAt) <= new Date()) {
    throw new AppError(400, "EXPIRY_IN_PAST", "过期时间必须晚于当前时间。");
  }
  const next = { ...current, ...input };
  await validateAgentGrants(tenantId, next.agentIds);
  const client = await pool.connect();
  let row: ApiKeyRow;
  try {
    await client.query("BEGIN");
    const result = await client.query<ApiKeyRow>(
      `UPDATE api_keys SET name=$3,description=$4,scopes=$5,expires_at=$6,
         minute_request_limit=$7,daily_request_limit=$8,monthly_request_limit=$9,concurrent_request_limit=$10
       WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [
        id,
        tenantId,
        next.name,
        next.description,
        JSON.stringify(next.scopes),
        next.expiresAt ? new Date(next.expiresAt) : null,
        next.minuteRequestLimit ?? null,
        next.dailyRequestLimit ?? null,
        next.monthlyRequestLimit ?? null,
        next.concurrentRequestLimit ?? null,
      ],
    );
    row = result.rows[0];
    await replaceAgentGrants(id, next.agentIds, client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return (await attachAgentGrants([mapKey(row)]))[0];
}

export async function revokeApiKey(
  tenantId: string,
  id: string,
): Promise<ApiKey> {
  const current = await getApiKey(tenantId, id);
  if (current.revokedAt) return current;
  const rows = await query<ApiKeyRow>(
    "UPDATE api_keys SET revoked_at=now() WHERE id=$1 AND tenant_id=$2 RETURNING *",
    [id, tenantId],
  );
  return (await attachAgentGrants([mapKey(rows[0])]))[0];
}

export async function authenticateApiKey(
  secret: string,
): Promise<AuthenticatedApiKey> {
  const hash = hashApiKey(secret);
  const rows = await query<{
    id: string;
    tenant_id: string;
    tenant_slug: string;
    tenant_status: TenantStatus;
    name: string;
    key_prefix: string;
    scopes: ApiKeyScope[];
    key_minute_limit: number | null;
    key_daily_limit: number | null;
    key_monthly_limit: number | null;
    key_concurrent_limit: number | null;
    tenant_minute_limit: number;
    tenant_daily_limit: number;
    tenant_monthly_limit: number;
    tenant_concurrent_limit: number;
    warning_threshold_percent: number;
    revoked_at: Date | null;
    expires_at: Date | null;
    agent_ids: string[];
  }>(
    `SELECT k.id,k.tenant_id,t.slug AS tenant_slug,t.status AS tenant_status,k.name,k.key_prefix,k.scopes,
       k.minute_request_limit AS key_minute_limit,k.daily_request_limit AS key_daily_limit,
       k.monthly_request_limit AS key_monthly_limit,k.concurrent_request_limit AS key_concurrent_limit,
       t.minute_request_limit AS tenant_minute_limit,t.daily_request_limit AS tenant_daily_limit,
       t.monthly_request_limit AS tenant_monthly_limit,t.concurrent_request_limit AS tenant_concurrent_limit,
       t.warning_threshold_percent,k.revoked_at,k.expires_at,
       ARRAY(SELECT g.agent_id::text FROM api_key_agent_grants g WHERE g.api_key_id=k.id) AS agent_ids
     FROM api_keys k JOIN tenants t ON t.id=k.tenant_id
     WHERE k.secret_hash=$1 AND t.deleted_at IS NULL`,
    [hash],
  );
  const row = rows[0];
  if (!row) throw new UnauthorizedError("API_KEY_INVALID", "API Key 无效。");
  if (row.revoked_at)
    throw new UnauthorizedError("API_KEY_REVOKED", "API Key 已撤销。");
  if (row.expires_at && row.expires_at <= new Date())
    throw new UnauthorizedError("API_KEY_EXPIRED", "API Key 已过期。");
  await query("UPDATE api_keys SET last_used_at=now() WHERE id=$1", [row.id]);
  return {
    id: row.id,
    tenantId: row.tenant_id,
    tenantSlug: row.tenant_slug,
    tenantStatus: row.tenant_status,
    name: row.name,
    prefix: row.key_prefix,
    scopes: row.scopes,
    tenantLimits: {
      minuteRequestLimit: row.tenant_minute_limit,
      dailyRequestLimit: row.tenant_daily_limit,
      monthlyRequestLimit: row.tenant_monthly_limit,
      concurrentRequestLimit: row.tenant_concurrent_limit,
    },
    keyLimits: {
      minuteRequestLimit: row.key_minute_limit ?? row.tenant_minute_limit,
      dailyRequestLimit: row.key_daily_limit ?? row.tenant_daily_limit,
      monthlyRequestLimit: row.key_monthly_limit ?? row.tenant_monthly_limit,
      concurrentRequestLimit:
        row.key_concurrent_limit ?? row.tenant_concurrent_limit,
    },
    limits: {
      minuteRequestLimit: Math.min(
        row.key_minute_limit ?? row.tenant_minute_limit,
        row.tenant_minute_limit,
      ),
      dailyRequestLimit: Math.min(
        row.key_daily_limit ?? row.tenant_daily_limit,
        row.tenant_daily_limit,
      ),
      monthlyRequestLimit: Math.min(
        row.key_monthly_limit ?? row.tenant_monthly_limit,
        row.tenant_monthly_limit,
      ),
      concurrentRequestLimit: Math.min(
        row.key_concurrent_limit ?? row.tenant_concurrent_limit,
        row.tenant_concurrent_limit,
      ),
    },
    warningThresholdPercent: row.warning_threshold_percent,
    allowedAgentIds: row.agent_ids ?? [],
  };
}

export async function apiKeyAuditIdentity(
  secret: string,
): Promise<{ id: string; tenantId: string; prefix: string } | undefined> {
  const rows = await query<{
    id: string;
    tenant_id: string;
    key_prefix: string;
  }>(
    `SELECT k.id,k.tenant_id,k.key_prefix FROM api_keys k
     JOIN tenants t ON t.id=k.tenant_id
     WHERE k.secret_hash=$1 AND t.deleted_at IS NULL`,
    [hashApiKey(secret)],
  );
  return rows[0]
    ? {
        id: rows[0].id,
        tenantId: rows[0].tenant_id,
        prefix: rows[0].key_prefix,
      }
    : undefined;
}

export function requireApiKeyScope(
  key: AuthenticatedApiKey,
  scope: ApiKeyScope,
): void {
  if (!key.scopes.includes(scope)) {
    throw new AppError(
      403,
      "API_KEY_SCOPE_DENIED",
      `API Key 缺少 ${scope} 作用域。`,
      {
        requiredScope: scope,
        grantedScopes: key.scopes,
      },
    );
  }
}
