import type { AgentCard } from "@a2a-js/sdk";
import { query } from "./db.js";
import type {
  AgentCardRevision,
  AgentStatus,
  AuditLog,
  DashboardSummary,
  HealthCheck,
  HealthStatus,
  PlatformAgent,
} from "./types.js";
import {
  offsetOf,
  pageResult,
  type Page,
  type PaginationInput,
} from "./domain.js";

type AgentRow = {
  id: string;
  slug: string;
  display_name: string;
  card_url: string;
  card_snapshot: AgentCard;
  selected_interface: PlatformAgent["selectedInterface"];
  status: AgentStatus;
  health_status: HealthStatus;
  labels: string[];
  version: number;
  tenant_id: string | null;
  description: string;
  visibility: PlatformAgent["visibility"];
  allowed_tenant_ids: string[];
  invocation_policy: PlatformAgent["invocationPolicy"];
  routing_strategy: PlatformAgent["routingStrategy"];
  created_at: Date;
  updated_at: Date;
};

function toAgent(row: AgentRow): PlatformAgent {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    cardUrl: row.card_url,
    cardSnapshot: row.card_snapshot,
    selectedInterface: row.selected_interface,
    status: row.status,
    healthStatus: row.health_status,
    labels: row.labels,
    version: row.version,
    tenantId: row.tenant_id ?? undefined,
    description: row.description ?? "",
    visibility: row.visibility ?? "private",
    allowedTenantIds: row.allowed_tenant_ids ?? [],
    invocationPolicy: row.invocation_policy ?? {
      timeoutMs: 60000,
      maxRetries: 0,
      maxConcurrent: 20,
    },
    routingStrategy: row.routing_strategy ?? "weighted_round_robin",
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listAgents(
  filters: {
    status?: string;
    search?: string;
    tenantId?: string;
    visibility?: string;
  } = {},
): Promise<PlatformAgent[]> {
  const clauses: string[] = ["deleted_at IS NULL"];
  const values: unknown[] = [];
  if (filters.status && filters.status !== "all") {
    values.push(filters.status);
    clauses.push(`status = $${values.length}`);
  }
  if (filters.search) {
    values.push(`%${filters.search}%`);
    clauses.push(
      `(display_name ILIKE $${values.length} OR slug ILIKE $${values.length} OR labels::text ILIKE $${values.length})`,
    );
  }
  if (filters.tenantId) {
    values.push(filters.tenantId);
    clauses.push(`tenant_id = $${values.length}`);
  }
  if (filters.visibility) {
    values.push(filters.visibility);
    clauses.push(`visibility = $${values.length}`);
  }
  return (
    await query<AgentRow>(
      `SELECT * FROM agents WHERE ${clauses.join(" AND ")} ORDER BY updated_at DESC`,
      values,
    )
  ).map(toAgent);
}

export async function listVisibleAgents(
  tenantIds: string[],
  filters: { status?: string; search?: string } & Partial<PaginationInput> = {},
): Promise<Page<PlatformAgent>> {
  const pagination: PaginationInput = {
    page: filters.page ?? 1,
    pageSize: filters.pageSize ?? 20,
  };
  const values: unknown[] = [tenantIds];
  const clauses = [
    "deleted_at IS NULL",
    `(visibility='public' OR tenant_id=ANY($1::uuid[])
      OR (visibility='tenant' AND allowed_tenant_ids ?| $1::text[]))`,
  ];
  if (filters.status && filters.status !== "all") {
    values.push(filters.status);
    clauses.push(`status=$${values.length}`);
  }
  if (filters.search) {
    values.push(`%${filters.search}%`);
    clauses.push(
      `(display_name ILIKE $${values.length} OR slug ILIKE $${values.length}
        OR labels::text ILIKE $${values.length})`,
    );
  }
  const count = await query<{ count: string }>(
    `SELECT count(*) FROM agents WHERE ${clauses.join(" AND ")}`,
    values,
  );
  values.push(pagination.pageSize, offsetOf(pagination));
  const rows = await query<AgentRow>(
    `SELECT * FROM agents WHERE ${clauses.join(" AND ")}
       ORDER BY CASE status WHEN 'online' THEN 0 WHEN 'degraded' THEN 1 ELSE 2 END,
         display_name,updated_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return pageResult(rows.map(toAgent), Number(count[0].count), pagination);
}

export async function updateAgent(
  id: string,
  input: {
    displayName?: string;
    description?: string;
    labels?: string[];
    tenantId?: string | null;
    visibility?: PlatformAgent["visibility"];
    allowedTenantIds?: string[];
    invocationPolicy?: PlatformAgent["invocationPolicy"];
    routingStrategy?: PlatformAgent["routingStrategy"];
  },
): Promise<PlatformAgent | undefined> {
  const current = await query<AgentRow>(
    "SELECT * FROM agents WHERE id=$1 AND deleted_at IS NULL",
    [id],
  );
  if (!current[0]) return undefined;
  const value = { ...toAgent(current[0]), ...input };
  const rows = await query<AgentRow>(
    `UPDATE agents SET display_name=$2,description=$3,labels=$4,tenant_id=$5,
    visibility=$6,allowed_tenant_ids=$7,invocation_policy=$8,routing_strategy=$9,
    version=version+1,updated_at=now()
    WHERE id=$1 AND deleted_at IS NULL RETURNING *`,
    [
      id,
      value.displayName,
      value.description,
      JSON.stringify(value.labels),
      value.tenantId ?? null,
      value.visibility,
      JSON.stringify(value.allowedTenantIds),
      JSON.stringify(value.invocationPolicy),
      value.routingStrategy,
    ],
  );
  return rows[0] ? toAgent(rows[0]) : undefined;
}

export async function refreshAgentCard(
  id: string,
  card: AgentCard,
  selectedInterface: PlatformAgent["selectedInterface"],
  fetchedBy = "system",
  changeSummary: Record<string, unknown> = {},
): Promise<PlatformAgent | undefined> {
  const rows = await query<AgentRow>(
    "UPDATE agents SET card_snapshot = $2, selected_interface = $3, version = version + 1, updated_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING *",
    [id, JSON.stringify(card), JSON.stringify(selectedInterface)],
  );
  if (rows[0])
    await query(
      `INSERT INTO agent_card_revisions(agent_id,version,card_snapshot,selected_interface,change_summary,fetched_by)
    VALUES($1,$2,$3,$4,$5,$6)`,
      [
        id,
        rows[0].version,
        JSON.stringify(card),
        JSON.stringify(selectedInterface),
        JSON.stringify(changeSummary),
        fetchedBy,
      ],
    );
  return rows[0] ? toAgent(rows[0]) : undefined;
}

export async function deleteAgent(id: string): Promise<boolean> {
  return (
    (
      await query<{ id: string }>(
        `UPDATE agents SET deleted_at=now(),status='offline',updated_at=now()
    WHERE id=$1 AND deleted_at IS NULL RETURNING id`,
        [id],
      )
    ).length > 0
  );
}

export async function getAgentBySlug(
  slug: string,
): Promise<PlatformAgent | undefined> {
  const rows = await query<AgentRow>(
    "SELECT * FROM agents WHERE slug = $1 AND deleted_at IS NULL",
    [slug],
  );
  return rows[0] ? toAgent(rows[0]) : undefined;
}

export async function createAgent(input: {
  slug: string;
  displayName: string;
  cardUrl: string;
  card: AgentCard;
  selectedInterface: PlatformAgent["selectedInterface"];
  labels: string[];
  description?: string;
  tenantId?: string;
  visibility?: PlatformAgent["visibility"];
  allowedTenantIds?: string[];
  invocationPolicy?: PlatformAgent["invocationPolicy"];
  routingStrategy?: PlatformAgent["routingStrategy"];
}): Promise<PlatformAgent> {
  const rows = await query<AgentRow>(
    `INSERT INTO agents(slug,display_name,description,card_url,card_snapshot,selected_interface,labels,tenant_id,visibility,allowed_tenant_ids,invocation_policy,routing_strategy)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      input.slug,
      input.displayName,
      input.description ?? "",
      input.cardUrl,
      JSON.stringify(input.card),
      JSON.stringify(input.selectedInterface),
      JSON.stringify(input.labels),
      input.tenantId ?? null,
      input.visibility ?? "private",
      JSON.stringify(input.allowedTenantIds ?? []),
      JSON.stringify(
        input.invocationPolicy ?? {
          timeoutMs: 60000,
          maxRetries: 0,
          maxConcurrent: 20,
        },
      ),
      input.routingStrategy ?? "weighted_round_robin",
    ],
  );
  await query(
    `INSERT INTO agent_card_revisions(agent_id,version,card_snapshot,selected_interface,change_summary,fetched_by)
    VALUES($1,$2,$3,$4,$5,'registration')`,
    [
      rows[0].id,
      rows[0].version,
      JSON.stringify(input.card),
      JSON.stringify(input.selectedInterface),
      JSON.stringify({ type: "initial" }),
    ],
  );
  await query(
    `INSERT INTO agent_instances(agent_id,name,card_url,selected_interface,status,health_status)
     VALUES($1,'default',$2,$3,'disabled','unknown')
     ON CONFLICT(agent_id,name) DO NOTHING`,
    [rows[0].id, input.cardUrl, JSON.stringify(input.selectedInterface)],
  );
  return toAgent(rows[0]);
}

export async function listCardRevisions(
  agentId: string,
): Promise<AgentCardRevision[]> {
  const rows = await query<{
    id: string;
    agent_id: string;
    version: number;
    card_snapshot: AgentCard;
    selected_interface: PlatformAgent["selectedInterface"];
    change_summary: Record<string, unknown>;
    fetched_by: string;
    fetched_at: Date;
  }>(
    "SELECT * FROM agent_card_revisions WHERE agent_id=$1 ORDER BY version DESC",
    [agentId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    agentId: r.agent_id,
    version: r.version,
    cardSnapshot: r.card_snapshot,
    selectedInterface: r.selected_interface,
    changeSummary: r.change_summary,
    fetchedBy: r.fetched_by,
    fetchedAt: r.fetched_at.toISOString(),
  }));
}

export async function updateAgentStatus(
  id: string,
  status: AgentStatus,
  healthStatus?: HealthStatus,
): Promise<PlatformAgent | undefined> {
  const rows = await query<AgentRow>(
    `UPDATE agents
     SET status = $2,
         health_status = COALESCE($3, health_status),
         version = version + 1,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, status, healthStatus ?? null],
  );
  return rows[0] ? toAgent(rows[0]) : undefined;
}

export async function updateHealth(
  id: string,
  success: boolean,
  latencyMs: number | undefined,
  errorMessage?: string,
): Promise<void> {
  await query(
    `INSERT INTO agent_health_checks(agent_id, success, latency_ms, error_message)
     VALUES ($1, $2, $3, $4)`,
    [id, success, latencyMs ?? null, errorMessage ?? null],
  );
  await query(
    `UPDATE agents
     SET health_status = $2,
         status = CASE WHEN status = 'online' AND $2 = 'unhealthy' THEN 'degraded' WHEN status = 'degraded' AND $2 = 'healthy' THEN 'online' ELSE status END,
         updated_at = now()
     WHERE id = $1`,
    [id, success ? "healthy" : "unhealthy"],
  );
}

type AuditRow = {
  id: number;
  actor_id: string;
  action: string;
  agent_id: string | null;
  request_id: string | null;
  detail: Record<string, unknown>;
  created_at: Date;
};

export async function listAudit(agentId?: string): Promise<AuditLog[]> {
  const rows = agentId
    ? await query<AuditRow>(
        "SELECT * FROM audit_logs WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 100",
        [agentId],
      )
    : await query<AuditRow>(
        "SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100",
      );
  return rows.map((row) => ({
    id: row.id,
    actorId: row.actor_id,
    action: row.action,
    agentId: row.agent_id,
    requestId: row.request_id,
    detail: row.detail,
    createdAt: row.created_at.toISOString(),
  }));
}

export async function listHealthChecks(
  agentId: string,
): Promise<HealthCheck[]> {
  const rows = await query<{
    checked_at: Date;
    success: boolean;
    latency_ms: number | null;
    error_message: string | null;
  }>(
    "SELECT checked_at, success, latency_ms, error_message FROM agent_health_checks WHERE agent_id = $1 ORDER BY checked_at DESC LIMIT 30",
    [agentId],
  );
  return rows.map((row) => ({
    checkedAt: row.checked_at.toISOString(),
    success: row.success,
    latencyMs: row.latency_ms,
    errorMessage: row.error_message,
  }));
}

export async function dashboardSummary(
  tenantId?: string,
): Promise<DashboardSummary> {
  const agentFilter = tenantId ? " WHERE tenant_id=$1" : "";
  const taskFilter = tenantId ? " WHERE tenant_id=$1" : "";
  const values = tenantId ? [tenantId] : [];
  const [counts] = await query<{
    total: string;
    online: string;
    degraded: string;
    unhealthy: string;
    tasks: string;
  }>(
    `SELECT
    (SELECT count(*) FROM agents${agentFilter}) AS total,
    (SELECT count(*) FROM agents${agentFilter}${tenantId ? " AND" : " WHERE"} status = 'online') AS online,
    (SELECT count(*) FROM agents${agentFilter}${tenantId ? " AND" : " WHERE"} status = 'degraded') AS degraded,
    (SELECT count(*) FROM agents${agentFilter}${tenantId ? " AND" : " WHERE"} health_status = 'unhealthy') AS unhealthy,
    (SELECT count(*) FROM task_snapshots${taskFilter}) AS tasks`,
    values,
  );
  const recentAudit = tenantId
    ? await query<AuditRow>(
        "SELECT * FROM audit_logs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100",
        [tenantId],
      ).then((rows) =>
        rows.map((row) => ({
          id: row.id,
          actorId: row.actor_id,
          action: row.action,
          agentId: row.agent_id,
          requestId: row.request_id,
          detail: row.detail,
          createdAt: row.created_at.toISOString(),
        })),
      )
    : await listAudit();
  return {
    totalAgents: Number(counts.total),
    onlineAgents: Number(counts.online),
    degradedAgents: Number(counts.degraded),
    unhealthyAgents: Number(counts.unhealthy),
    taskCount: Number(counts.tasks),
    recentAudit,
  };
}
