import { z } from "zod";
import { pool, query } from "./db.js";
import {
  AppError,
  NotFoundError,
  offsetOf,
  pageResult,
  paginationSchema,
  type Page,
} from "./domain.js";

export const taskQuerySchema = paginationSchema.extend({
  tenantId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
  apiKeyId: z.string().uuid().optional(),
  state: z.string().trim().max(80).optional(),
  search: z.string().trim().max(100).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type TaskSummary = {
  id: number;
  agentId: string;
  agentSlug: string;
  agentName: string;
  agentInstanceId?: string;
  agentInstanceName?: string;
  tenantId?: string;
  tenantName?: string;
  apiKeyId?: string;
  apiKeyName?: string;
  remoteTaskId: string;
  contextId?: string;
  requestId?: string;
  operation: string;
  state?: string;
  statusCode?: number;
  errorCode?: string;
  errorMessage?: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  retryCount: number;
  cancelledAt?: string;
  lastEventAt: string;
  createdAt: string;
  updatedAt: string;
};
export type TaskEvent = {
  id: number;
  sequence: number;
  eventType: string;
  state?: string;
  payload: Record<string, unknown>;
  payloadBytes: number;
  occurredAt: string;
};
export type TaskDetail = TaskSummary & {
  requestPayload?: Record<string, unknown>;
  artifacts: Array<Record<string, unknown>>;
  latestEvent: Record<string, unknown>;
  events: TaskEvent[];
};

type TaskRow = {
  id: string;
  agent_id: string;
  agent_slug: string;
  agent_name: string;
  agent_instance_id: string | null;
  agent_instance_name: string | null;
  tenant_id: string | null;
  tenant_name: string | null;
  api_key_id: string | null;
  api_key_name: string | null;
  remote_task_id: string;
  context_id: string | null;
  request_id: string | null;
  operation: string;
  state: string | null;
  status_code: number | null;
  error_code: string | null;
  error_message: string | null;
  started_at: Date;
  completed_at: Date | null;
  duration_ms: number | null;
  retry_count: number;
  cancelled_at: Date | null;
  last_event_at: Date;
  latest_event: Record<string, unknown>;
  request_payload: Record<string, unknown> | null;
  artifacts: Array<Record<string, unknown>>;
  created_at: Date;
  updated_at: Date;
};
type EventRow = {
  id: string;
  sequence: number;
  event_type: string;
  state: string | null;
  payload: Record<string, unknown>;
  payload_bytes: number;
  occurred_at: Date;
};

const taskSelect = `SELECT s.*,a.slug AS agent_slug,a.display_name AS agent_name,
  i.name AS agent_instance_name,t.display_name AS tenant_name,k.name AS api_key_name
  FROM task_snapshots s JOIN agents a ON a.id=s.agent_id
  LEFT JOIN agent_instances i ON i.id=s.agent_instance_id
  LEFT JOIN tenants t ON t.id=s.tenant_id LEFT JOIN api_keys k ON k.id=s.api_key_id`;
const mapTask = (r: TaskRow): TaskSummary => ({
  id: Number(r.id),
  agentId: r.agent_id,
  agentSlug: r.agent_slug,
  agentName: r.agent_name,
  agentInstanceId: r.agent_instance_id ?? undefined,
  agentInstanceName: r.agent_instance_name ?? undefined,
  tenantId: r.tenant_id ?? undefined,
  tenantName: r.tenant_name ?? undefined,
  apiKeyId: r.api_key_id ?? undefined,
  apiKeyName: r.api_key_name ?? undefined,
  remoteTaskId: r.remote_task_id,
  contextId: r.context_id ?? undefined,
  requestId: r.request_id ?? undefined,
  operation: r.operation,
  state: r.state ?? undefined,
  statusCode: r.status_code ?? undefined,
  errorCode: r.error_code ?? undefined,
  errorMessage: r.error_message ?? undefined,
  startedAt: r.started_at.toISOString(),
  completedAt: r.completed_at?.toISOString(),
  durationMs: r.duration_ms ?? undefined,
  retryCount: r.retry_count,
  cancelledAt: r.cancelled_at?.toISOString(),
  lastEventAt: r.last_event_at.toISOString(),
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});
const mapEvent = (r: EventRow): TaskEvent => ({
  id: Number(r.id),
  sequence: r.sequence,
  eventType: r.event_type,
  state: r.state ?? undefined,
  payload: r.payload,
  payloadBytes: r.payload_bytes,
  occurredAt: r.occurred_at.toISOString(),
});

function taskWhere(input: z.infer<typeof taskQuerySchema>) {
  const values: unknown[] = [];
  const clauses: string[] = [];
  const add = (column: string, value: unknown, operator = "=") => {
    values.push(value);
    clauses.push(`${column}${operator}$${values.length}`);
  };
  if (input.tenantId) add("s.tenant_id", input.tenantId);
  if (input.agentId) add("s.agent_id", input.agentId);
  if (input.apiKeyId) add("s.api_key_id", input.apiKeyId);
  if (input.state) add("s.state", input.state);
  if (input.from) add("s.started_at", input.from, ">=");
  if (input.to) add("s.started_at", input.to, "<=");
  if (input.search) {
    values.push(`%${input.search}%`);
    clauses.push(
      `(s.remote_task_id ILIKE $${values.length} OR s.request_id ILIKE $${values.length} OR s.error_message ILIKE $${values.length})`,
    );
  }
  return {
    sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    values,
  };
}

export async function searchTasks(raw: unknown): Promise<Page<TaskSummary>> {
  const input = taskQuerySchema.parse(raw);
  const where = taskWhere(input);
  const total = await query<{ count: string }>(
    `SELECT count(*) FROM task_snapshots s ${where.sql}`,
    where.values,
  );
  const values = [...where.values, input.pageSize, offsetOf(input)];
  const rows = await query<TaskRow>(
    `${taskSelect} ${where.sql} ORDER BY s.updated_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return pageResult(rows.map(mapTask), Number(total[0].count), input);
}

export async function getTaskDetail(id: number): Promise<TaskDetail> {
  const rows = await query<TaskRow>(`${taskSelect} WHERE s.id=$1`, [id]);
  if (!rows[0]) throw new NotFoundError("任务", String(id));
  const events = await query<EventRow>(
    "SELECT * FROM task_events WHERE task_snapshot_id=$1 ORDER BY sequence",
    [id],
  );
  return {
    ...mapTask(rows[0]),
    requestPayload: rows[0].request_payload ?? undefined,
    artifacts: rows[0].artifacts ?? [],
    latestEvent: rows[0].latest_event,
    events: events.map(mapEvent),
  };
}

export async function findTask(
  agentId: string,
  remoteTaskId: string,
  tenantId: string,
): Promise<TaskDetail> {
  const rows = await query<TaskRow>(
    `${taskSelect} WHERE s.agent_id=$1 AND s.remote_task_id=$2 AND s.tenant_id=$3`,
    [agentId, remoteTaskId, tenantId],
  );
  if (!rows[0]) throw new NotFoundError("任务", remoteTaskId);
  const events = await query<EventRow>(
    "SELECT * FROM task_events WHERE task_snapshot_id=$1 ORDER BY sequence",
    [rows[0].id],
  );
  return {
    ...mapTask(rows[0]),
    requestPayload: rows[0].request_payload ?? undefined,
    artifacts: rows[0].artifacts ?? [],
    latestEvent: rows[0].latest_event,
    events: events.map(mapEvent),
  };
}

export type AppendTaskEventInput = {
  agentId: string;
  agentInstanceId?: string;
  tenantId?: string;
  apiKeyId?: string;
  requestId?: string;
  remoteTaskId: string;
  contextId?: string;
  operation?: string;
  state?: string;
  eventType: string;
  event: Record<string, unknown>;
  requestPayload?: Record<string, unknown>;
  statusCode?: number;
  errorCode?: string;
  errorMessage?: string;
  retryCount?: number;
  platformEvents?: Array<{
    type: "task.created" | "task.working" | "task.completed" | "task.failed";
    data: Record<string, unknown>;
  }>;
};

function eventArtifacts(event: Record<string, unknown>): {
  artifacts: Array<Record<string, unknown>>;
  append: boolean;
} {
  const artifactUpdate = (event.artifactUpdate ?? event.artifact_update) as
    Record<string, unknown> | undefined;
  const artifact = artifactUpdate?.artifact;
  if (artifact && typeof artifact === "object")
    return {
      artifacts: [artifact as Record<string, unknown>],
      append: artifactUpdate?.append === true,
    };
  const task = event.task as Record<string, unknown> | undefined;
  return {
    artifacts: Array.isArray(task?.artifacts)
      ? task.artifacts.filter((item): item is Record<string, unknown> =>
          Boolean(item && typeof item === "object"),
        )
      : [],
    append: false,
  };
}

function mergeArtifacts(
  current: Array<Record<string, unknown>>,
  incoming: Array<Record<string, unknown>>,
  append: boolean,
): Array<Record<string, unknown>> {
  const result = new Map<string, Record<string, unknown>>();
  for (const artifact of current)
    result.set(
      String(artifact.artifactId ?? artifact.id ?? JSON.stringify(artifact)),
      artifact,
    );
  for (const artifact of incoming) {
    const key = String(
      artifact.artifactId ?? artifact.id ?? JSON.stringify(artifact),
    );
    const previous = result.get(key);
    if (append && previous) {
      const previousParts = Array.isArray(previous.parts) ? previous.parts : [];
      const nextParts = Array.isArray(artifact.parts) ? artifact.parts : [];
      result.set(key, {
        ...previous,
        ...artifact,
        metadata: {
          ...((previous.metadata as Record<string, unknown> | undefined) ?? {}),
          ...((artifact.metadata as Record<string, unknown> | undefined) ?? {}),
        },
        parts: [...previousParts, ...nextParts],
      });
    } else result.set(key, artifact);
  }
  return [...result.values()];
}

const terminalStates = new Set([
  "TASK_STATE_COMPLETED",
  "TASK_STATE_FAILED",
  "TASK_STATE_CANCELED",
  "completed",
  "failed",
  "canceled",
  "cancelled",
]);
export async function appendTaskEvent(
  input: AppendTaskEventInput,
): Promise<{ taskId: number; sequence: number }> {
  if (input.platformEvents?.length && !input.tenantId)
    throw new AppError(
      500,
      "TASK_OUTBOX_TENANT_REQUIRED",
      "任务生命周期事件缺少租户上下文。",
    );
  const bytes = Buffer.byteLength(JSON.stringify(input.event), "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialise writers for the same remote task across every API instance.
    // Without this lock two stream consumers could calculate the same sequence
    // and silently lose one event at the unique constraint.
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
      [`${input.tenantId ?? "internal"}:${input.agentId}`, input.remoteTaskId],
    );
    const snapshots = await client.query<{ id: string; started_at: Date }>(
      `INSERT INTO task_snapshots(agent_id,agent_instance_id,tenant_id,api_key_id,request_id,
      remote_task_id,context_id,operation,state,latest_event,status_code,error_code,error_message,retry_count,
      request_payload,completed_at,duration_ms)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
      CASE WHEN $16 THEN now() ELSE NULL END,CASE WHEN $16 THEN 0 ELSE NULL END)
    ON CONFLICT(tenant_id,agent_id,remote_task_id) DO UPDATE SET
      agent_instance_id=COALESCE(task_snapshots.agent_instance_id,EXCLUDED.agent_instance_id),
      api_key_id=COALESCE(task_snapshots.api_key_id,EXCLUDED.api_key_id),request_id=COALESCE(task_snapshots.request_id,EXCLUDED.request_id),
      request_payload=COALESCE(task_snapshots.request_payload,EXCLUDED.request_payload),
      context_id=COALESCE(EXCLUDED.context_id,task_snapshots.context_id),state=COALESCE(EXCLUDED.state,task_snapshots.state),
      latest_event=EXCLUDED.latest_event,status_code=COALESCE(EXCLUDED.status_code,task_snapshots.status_code),
      error_code=COALESCE(EXCLUDED.error_code,task_snapshots.error_code),error_message=COALESCE(EXCLUDED.error_message,task_snapshots.error_message),
      retry_count=GREATEST(task_snapshots.retry_count,EXCLUDED.retry_count),last_event_at=now(),updated_at=now(),
      completed_at=CASE WHEN $16 THEN COALESCE(task_snapshots.completed_at,now()) ELSE task_snapshots.completed_at END,
      duration_ms=CASE WHEN $16 THEN extract(epoch from (now()-task_snapshots.started_at))*1000 ELSE task_snapshots.duration_ms END
    RETURNING id,started_at`,
      [
        input.agentId,
        input.agentInstanceId ?? null,
        input.tenantId ?? null,
        input.apiKeyId ?? null,
        input.requestId ?? null,
        input.remoteTaskId,
        input.contextId ?? null,
        input.operation ?? "message.stream",
        input.state ?? null,
        JSON.stringify(input.event),
        input.statusCode ?? null,
        input.errorCode ?? null,
        input.errorMessage ?? null,
        input.retryCount ?? 0,
        input.requestPayload ? JSON.stringify(input.requestPayload) : null,
        terminalStates.has(input.state ?? ""),
      ],
    );
    const taskId = Number(snapshots.rows[0].id);
    const incomingArtifacts = eventArtifacts(input.event);
    if (incomingArtifacts.artifacts.length) {
      const currentArtifacts = await client.query<{
        artifacts: Array<Record<string, unknown>>;
      }>("SELECT artifacts FROM task_snapshots WHERE id=$1 FOR UPDATE", [
        taskId,
      ]);
      await client.query("UPDATE task_snapshots SET artifacts=$2 WHERE id=$1", [
        taskId,
        JSON.stringify(
          mergeArtifacts(
            currentArtifacts.rows[0]?.artifacts ?? [],
            incomingArtifacts.artifacts,
            incomingArtifacts.append,
          ),
        ),
      ]);
    }
    const sequenceRows = await client.query<{ sequence: number }>(
      "SELECT coalesce(max(sequence),0)+1 AS sequence FROM task_events WHERE task_snapshot_id=$1",
      [taskId],
    );
    const sequence = sequenceRows.rows[0].sequence;
    await client.query(
      `INSERT INTO task_events(task_snapshot_id,sequence,event_type,state,payload,payload_bytes)
      VALUES($1,$2,$3,$4,$5,$6)`,
      [
        taskId,
        sequence,
        input.eventType,
        input.state ?? null,
        JSON.stringify(input.event),
        bytes,
      ],
    );
    for (const platformEvent of input.platformEvents ?? [])
      await client.query(
        `INSERT INTO task_event_outbox(
          task_snapshot_id,tenant_id,agent_id,remote_task_id,event_type,payload,dedupe_key)
         VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(dedupe_key) DO NOTHING`,
        [
          taskId,
          input.tenantId,
          input.agentId,
          input.remoteTaskId,
          platformEvent.type,
          JSON.stringify(platformEvent.data),
          `${taskId}:${sequence}:${platformEvent.type}`,
        ],
      );
    await client.query("COMMIT");
    return { taskId, sequence };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function markTaskCancelled(
  agentId: string,
  remoteTaskId: string,
  event: Record<string, unknown>,
  context?: {
    tenantId: string;
    apiKeyId?: string;
    requestId?: string;
    agentInstanceId?: string;
  },
): Promise<void> {
  const result = await appendTaskEvent({
    agentId,
    agentInstanceId: context?.agentInstanceId,
    remoteTaskId,
    state: "TASK_STATE_CANCELED",
    eventType: "task.cancelled",
    event,
    statusCode: 200,
    tenantId: context?.tenantId,
    apiKeyId: context?.apiKeyId,
    requestId: context?.requestId,
    platformEvents: context
      ? [
          {
            type: "task.failed",
            data: { state: "cancelled", requestId: context.requestId },
          },
        ]
      : undefined,
  });
  await query(
    "UPDATE task_snapshots SET cancelled_at=now(),completed_at=COALESCE(completed_at,now()) WHERE id=$1",
    [result.taskId],
  );
}

export async function taskEventsJson(id: number): Promise<string> {
  return JSON.stringify(await getTaskDetail(id), null, 2);
}

export async function assertRemoteTaskTenant(
  agentId: string,
  remoteTaskId: string,
  tenantId: string,
): Promise<void> {
  const rows = await query<{ tenant_id: string | null }>(
    `SELECT tenant_id FROM task_snapshots
     WHERE agent_id=$1 AND remote_task_id=$2 AND tenant_id=$3`,
    [agentId, remoteTaskId, tenantId],
  );
  if (!rows[0]) throw new NotFoundError("平台代理任务", remoteTaskId);
}

export async function assertKnownRemoteTaskTenant(
  agentId: string,
  remoteTaskId: string,
  tenantId: string,
): Promise<void> {
  const rows = await query<{ owns: boolean; foreign: boolean }>(
    `SELECT bool_or(tenant_id=$3) AS owns,bool_or(tenant_id IS DISTINCT FROM $3) AS foreign
     FROM task_snapshots WHERE agent_id=$1 AND remote_task_id=$2`,
    [agentId, remoteTaskId, tenantId],
  );
  if (rows[0]?.foreign && !rows[0].owns)
    throw new AppError(
      403,
      "TASK_TENANT_DENIED",
      "该任务不属于当前 API Key 所属租户。",
    );
}

export async function taskInstanceBinding(
  agentId: string,
  remoteTaskId: string,
  tenantId: string,
): Promise<string | undefined> {
  const rows = await query<{ agent_instance_id: string | null }>(
    `SELECT agent_instance_id FROM task_snapshots
     WHERE agent_id=$1 AND remote_task_id=$2 AND tenant_id=$3`,
    [agentId, remoteTaskId, tenantId],
  );
  return rows[0]?.agent_instance_id ?? undefined;
}

export async function listObservedTasks(input: {
  agentId: string;
  tenantId: string;
  contextId?: string;
  state?: string;
  statusTimestampAfter?: string;
  pageSize?: number;
  pageToken?: string;
  includeArtifacts?: boolean;
}): Promise<{
  tasks: Array<Record<string, unknown>>;
  nextPageToken: string;
  pageSize: number;
  totalSize: number;
}> {
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 50));
  let offset = 0;
  if (input.pageToken) {
    const decoded = Buffer.from(input.pageToken, "base64url").toString("utf8");
    if (!/^\d+$/.test(decoded))
      throw new AppError(400, "PAGE_TOKEN_INVALID", "任务分页令牌无效。");
    offset = Number(decoded);
  }
  const values: unknown[] = [input.agentId, input.tenantId];
  const clauses = ["agent_id=$1", "tenant_id=$2"];
  if (input.contextId) {
    values.push(input.contextId);
    clauses.push(`context_id=$${values.length}`);
  }
  if (input.state) {
    values.push(input.state);
    clauses.push(`state=$${values.length}`);
  }
  if (input.statusTimestampAfter) {
    const timestamp = new Date(input.statusTimestampAfter);
    if (Number.isNaN(timestamp.getTime()))
      throw new AppError(400, "STATUS_TIMESTAMP_INVALID", "状态时间筛选无效。");
    values.push(timestamp);
    clauses.push(`last_event_at>=$${values.length}`);
  }
  const where = clauses.join(" AND ");
  const totalRows = await query<{ count: string }>(
    `SELECT count(*) FROM task_snapshots WHERE ${where}`,
    values,
  );
  const totalSize = Number(totalRows[0].count);
  const pageValues = [...values, pageSize, offset];
  const rows = await query<{
    remote_task_id: string;
    context_id: string | null;
    state: string | null;
    last_event_at: Date;
    artifacts: Array<Record<string, unknown>>;
  }>(
    `SELECT remote_task_id,context_id,state,last_event_at,artifacts FROM task_snapshots
     WHERE ${where} ORDER BY updated_at DESC,id DESC
     LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`,
    pageValues,
  );
  const nextOffset = offset + rows.length;
  return {
    tasks: rows.map((row) => ({
      id: row.remote_task_id,
      contextId: row.context_id ?? "",
      status: {
        state: row.state ?? "TASK_STATE_UNSPECIFIED",
        timestamp: row.last_event_at.toISOString(),
      },
      artifacts: input.includeArtifacts ? (row.artifacts ?? []) : [],
      history: [],
      metadata: { platformObserved: true },
    })),
    nextPageToken:
      nextOffset < totalSize
        ? Buffer.from(String(nextOffset), "utf8").toString("base64url")
        : "",
    pageSize,
    totalSize,
  };
}

export async function taskStats(tenantId?: string): Promise<{
  total: number;
  working: number;
  completed: number;
  failed: number;
  averageDurationMs: number;
}> {
  const values: unknown[] = tenantId ? [tenantId] : [];
  const where = tenantId ? "WHERE tenant_id=$1" : "";
  const rows = await query<{
    total: string;
    working: string;
    completed: string;
    failed: string;
    average_duration: string | null;
  }>(
    `SELECT count(*) AS total,
    count(*) FILTER(WHERE state ILIKE '%working%' OR state ILIKE '%submitted%') AS working,
    count(*) FILTER(WHERE state ILIKE '%completed%') AS completed,count(*) FILTER(WHERE state ILIKE '%failed%') AS failed,
    avg(duration_ms) AS average_duration FROM task_snapshots ${where}`,
    values,
  );
  return {
    total: Number(rows[0].total),
    working: Number(rows[0].working),
    completed: Number(rows[0].completed),
    failed: Number(rows[0].failed),
    averageDurationMs: Math.round(Number(rows[0].average_duration ?? 0)),
  };
}
