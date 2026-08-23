import { z } from "zod";
import type { PoolClient } from "pg";
import { query } from "./db.js";
import { offsetOf, pageResult, paginationSchema, type Page } from "./domain.js";

export type AuditOutcome = "success" | "failure";

export type AuditContext = {
  actorId: string;
  tenantId?: string;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
};

export type AuditEntry = {
  id: number;
  actorId: string;
  tenantId?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  agentId?: string;
  requestId?: string;
  outcome: AuditOutcome;
  detail: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
};

export const auditQuerySchema = paginationSchema.extend({
  tenantId: z.string().uuid().optional(),
  action: z.string().trim().max(100).optional(),
  resourceType: z.string().trim().max(80).optional(),
  outcome: z.enum(["success", "failure"]).optional(),
  search: z.string().trim().max(100).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

type AuditRow = {
  id: string;
  actor_id: string;
  tenant_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  agent_id: string | null;
  request_id: string | null;
  outcome: AuditOutcome;
  detail: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date;
};

function mapAudit(row: AuditRow): AuditEntry {
  return {
    id: Number(row.id),
    actorId: row.actor_id,
    tenantId: row.tenant_id ?? undefined,
    action: row.action,
    resourceType: row.resource_type ?? undefined,
    resourceId: row.resource_id ?? undefined,
    agentId: row.agent_id ?? undefined,
    requestId: row.request_id ?? undefined,
    outcome: row.outcome,
    detail: row.detail,
    ipAddress: row.ip_address ?? undefined,
    userAgent: row.user_agent ?? undefined,
    createdAt: row.created_at.toISOString(),
  };
}

export async function writeAudit(
  context: AuditContext,
  action: string,
  resource: { type?: string; id?: string; agentId?: string } = {},
  detail: Record<string, unknown> = {},
  outcome: AuditOutcome = "success",
  client?: PoolClient,
): Promise<void> {
  const sql = `INSERT INTO audit_logs(
       actor_id, tenant_id, action, resource_type, resource_id, agent_id,
       request_id, outcome, detail, ip_address, user_agent
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`;
  const values = [
    context.actorId,
    context.tenantId ?? null,
    action,
    resource.type ?? null,
    resource.id ?? null,
    resource.agentId ?? null,
    context.requestId ?? null,
    outcome,
    JSON.stringify(detail),
    context.ipAddress ?? null,
    context.userAgent ?? null,
  ];
  if (client) await client.query(sql, values);
  else await query(sql, values);
}

export async function searchAudit(raw: unknown): Promise<Page<AuditEntry>> {
  const input = auditQuerySchema.parse(raw);
  const values: unknown[] = [];
  const clauses: string[] = [];
  const where = (sql: string, value: unknown) => {
    values.push(value);
    clauses.push(sql.replace("?", `$${values.length}`));
  };
  if (input.tenantId) where("tenant_id = ?", input.tenantId);
  if (input.action) where("action = ?", input.action);
  if (input.resourceType) where("resource_type = ?", input.resourceType);
  if (input.outcome) where("outcome = ?", input.outcome);
  if (input.search) {
    values.push(`%${input.search}%`);
    clauses.push(
      `(actor_id ILIKE $${values.length} OR action ILIKE $${values.length} OR detail::text ILIKE $${values.length})`,
    );
  }
  if (input.from) where("created_at >= ?", input.from);
  if (input.to) where("created_at <= ?", input.to);
  const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const count = await query<{ count: string }>(
    `SELECT count(*) FROM audit_logs ${whereSql}`,
    values,
  );
  values.push(input.pageSize, offsetOf(input));
  const rows = await query<AuditRow>(
    `SELECT * FROM audit_logs ${whereSql} ORDER BY created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return pageResult(rows.map(mapAudit), Number(count[0].count), input);
}

export async function auditActions(tenantId?: string): Promise<string[]> {
  const rows = await query<{ action: string }>(
    tenantId
      ? "SELECT DISTINCT action FROM audit_logs WHERE tenant_id=$1 ORDER BY action"
      : "SELECT DISTINCT action FROM audit_logs ORDER BY action",
    tenantId ? [tenantId] : [],
  );
  return rows.map((row) => row.action);
}
