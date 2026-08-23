import { z } from "zod";
import { pool, query } from "./db.js";
import {
  AppError,
  RateLimitError,
  offsetOf,
  pageResult,
  paginationSchema,
  type Page,
} from "./domain.js";
import type { AuthenticatedApiKey } from "./api-key-service.js";

export type QuotaWindow = "minute" | "day" | "month" | "concurrent";

export type QuotaSnapshot = {
  subject: "tenant" | "api_key";
  window: QuotaWindow;
  used: number;
  limit: number;
  remaining: number;
  resetsAt?: string;
};

export type QuotaLease = {
  keyId: string;
  tenantId: string;
  snapshots: QuotaSnapshot[];
  release(): Promise<void>;
};

export type ConcurrencyLease = { release(): Promise<void> };

export async function acquireAgentConcurrency(
  agentId: string,
  limit: number,
): Promise<ConcurrencyLease> {
  return acquireDatabaseConcurrency("agent", agentId, limit);
}

export type UsageRecordInput = {
  tenantId: string;
  apiKeyId?: string;
  agentId?: string;
  agentInstanceId?: string;
  callerId?: string;
  requestId: string;
  operation: string;
  statusCode: number;
  latencyMs?: number;
  inputBytes?: number;
  outputBytes?: number;
  eventCount?: number;
  errorCode?: string;
  errorMessage?: string;
  remoteTaskId?: string;
};

function timeKeys(now: Date): { expiries: number[]; resets: Date[] } {
  const minuteStart = new Date(now);
  minuteStart.setSeconds(0, 0);
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMinute = new Date(minuteStart.getTime() + 60_000);
  const nextDay = new Date(dayStart.getTime() + 86_400_000);
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return {
    expiries: [
      Math.max(
        60,
        Math.ceil((nextMinute.getTime() - now.getTime()) / 1000) + 60,
      ),
      Math.max(
        3600,
        Math.ceil((nextDay.getTime() - now.getTime()) / 1000) + 3600,
      ),
      Math.max(
        86400,
        Math.ceil((nextMonth.getTime() - now.getTime()) / 1000) + 86400,
      ),
      600,
    ],
    resets: [nextMinute, nextDay, nextMonth],
  };
}

function snapshots(
  counts: number[],
  limits: number[],
  resets: Date[],
  subject: "tenant" | "api_key",
): QuotaSnapshot[] {
  const windows: QuotaWindow[] = ["minute", "day", "month", "concurrent"];
  return windows.map((window, index) => ({
    subject,
    window,
    used: counts[index],
    limit: limits[index],
    remaining: Math.max(0, limits[index] - counts[index]),
    resetsAt: resets[index]?.toISOString(),
  }));
}

export async function acquireQuota(
  key: AuthenticatedApiKey,
): Promise<QuotaLease> {
  const values = (limits: AuthenticatedApiKey["limits"]) => [
    limits.minuteRequestLimit,
    limits.dailyRequestLimit,
    limits.monthlyRequestLimit,
    limits.concurrentRequestLimit,
  ];
  const tenantLimits = values(key.tenantLimits);
  const keyLimits = values(key.keyLimits);
  return acquireDatabaseQuota(key, tenantLimits, keyLimits);
}

async function acquireDatabaseConcurrency(
  subjectType: "agent",
  subjectId: string,
  limit: number,
): Promise<ConcurrencyLease> {
  const client = await pool.connect();
  const start = new Date(0);
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))",
      [`quota:${subjectType}`, subjectId],
    );
    const rows = await client.query<{ count: string }>(
      `INSERT INTO quota_counters(subject_type,subject_id,quota_window,window_start,count,expires_at)
       VALUES($1,$2,'concurrent',$3,1,now()+interval '10 minutes')
       ON CONFLICT(subject_type,subject_id,quota_window,window_start) DO UPDATE
       SET count=quota_counters.count+1,expires_at=now()+interval '10 minutes',updated_at=now()
       RETURNING count`,
      [subjectType, subjectId, start],
    );
    const count = Number(rows.rows[0].count);
    if (count > limit)
      throw new RateLimitError("Agent 当前并发已达到调用策略上限。", {
        code: "AGENT_CONCURRENCY_EXCEEDED",
        agentId: subjectId,
        limit,
        current: count - 1,
      });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  let released = false;
  return {
    release: async () => {
      if (released) return;
      await query(
        `UPDATE quota_counters SET count=GREATEST(0,count-1),updated_at=now()
         WHERE subject_type=$1 AND subject_id=$2 AND quota_window='concurrent' AND window_start=$3`,
        [subjectType, subjectId, start],
      );
      released = true;
    },
  };
}

async function acquireDatabaseQuota(
  key: AuthenticatedApiKey,
  tenantLimits: number[],
  keyLimits: number[],
): Promise<QuotaLease> {
  const client = await pool.connect();
  const now = new Date();
  const clock = timeKeys(now);
  const starts = [
    new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      now.getHours(),
      now.getMinutes(),
    ),
    new Date(now.getFullYear(), now.getMonth(), now.getDate()),
    new Date(now.getFullYear(), now.getMonth(), 1),
    new Date(0),
  ];
  const subjects = [
    { type: "tenant" as const, id: key.tenantId, limits: tenantLimits },
    { type: "api_key" as const, id: key.id, limits: keyLimits },
  ];
  const allSnapshots: QuotaSnapshot[] = [];
  try {
    await client.query("BEGIN");
    for (const subject of subjects) {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))",
        [`quota:${subject.type}`, subject.id],
      );
      const existingRows = await client.query<{
        quota_window: string;
        window_start: Date;
        count: string;
      }>(
        `SELECT quota_window,window_start,count FROM quota_counters
         WHERE subject_type=$1 AND subject_id=$2 AND
           (quota_window,window_start) IN
           (('minute',$3),('day',$4),('month',$5),('concurrent',$6))`,
        [subject.type, subject.id, ...starts],
      );
      const existing = new Map(
        existingRows.rows.map((row) => [
          `${row.quota_window}:${row.window_start.getTime()}`,
          Number(row.count),
        ]),
      );
      const needsSeed = starts
        .slice(0, 3)
        .some(
          (start, index) =>
            !existing.has(
              `${(["minute", "day", "month"] as const)[index]}:${start.getTime()}`,
            ),
        );
      const seed = needsSeed
        ? await databaseCounts(
            client,
            key.tenantId,
            subject.type === "api_key" ? key.id : undefined,
          )
        : [0, 0, 0, 0];
      const counts: number[] = [];
      for (let index = 0; index < 4; index++) {
        const window = (["minute", "day", "month", "concurrent"] as const)[
          index
        ];
        const initial = (window === "concurrent" ? 0 : seed[index]) + 1;
        const rows = await client.query<{ count: string }>(
          `INSERT INTO quota_counters(subject_type,subject_id,quota_window,window_start,count,expires_at)
           VALUES($1,$2,$3,$4,$5,now()+($6::text||' seconds')::interval)
           ON CONFLICT(subject_type,subject_id,quota_window,window_start) DO UPDATE
           SET count=quota_counters.count+1,expires_at=EXCLUDED.expires_at,updated_at=now()
           RETURNING count`,
          [
            subject.type,
            subject.id,
            window,
            starts[index],
            initial,
            clock.expiries[index],
          ],
        );
        counts.push(Number(rows.rows[0].count));
      }
      const state = snapshots(
        counts,
        subject.limits,
        clock.resets,
        subject.type,
      );
      allSnapshots.push(...state);
      const exceeded = state.find((item) => item.used > item.limit);
      if (exceeded)
        throw new RateLimitError(
          `${subject.type === "tenant" ? "租户" : "API Key"}${exceeded.window}调用配额已用尽。`,
          { quotas: allSnapshots, source: "postgres" },
        );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  let released = false;
  return {
    keyId: key.id,
    tenantId: key.tenantId,
    snapshots: allSnapshots,
    release: async () => {
      if (released) return;
      const releaseClient = await pool.connect();
      try {
        await releaseClient.query("BEGIN");
        for (const subject of subjects)
          await releaseClient.query(
            `UPDATE quota_counters SET count=GREATEST(0,count-1),updated_at=now()
             WHERE subject_type=$1 AND subject_id=$2 AND quota_window='concurrent' AND window_start=$3`,
            [subject.type, subject.id, starts[3]],
          );
        await releaseClient.query("COMMIT");
        released = true;
      } catch (error) {
        await releaseClient.query("ROLLBACK");
        throw error;
      } finally {
        releaseClient.release();
      }
    },
  };
}

async function databaseCounts(
  client: {
    query<T extends Record<string, unknown>>(
      text: string,
      values?: unknown[],
    ): Promise<{ rows: T[] }>;
  },
  tenantId: string,
  apiKeyId?: string,
): Promise<number[]> {
  const rows = await client.query<{
    minute: string;
    day: string;
    month: string;
  }>(
    `SELECT count(*) FILTER (WHERE created_at >= date_trunc('minute',now())) AS minute,
       count(*) FILTER (WHERE created_at >= date_trunc('day',now())) AS day,
       count(*) FILTER (WHERE created_at >= date_trunc('month',now())) AS month
     FROM usage_records WHERE tenant_id=$1 ${apiKeyId ? "AND api_key_id=$2" : ""}`,
    apiKeyId ? [tenantId, apiKeyId] : [tenantId],
  );
  return [
    Number(rows.rows[0].minute),
    Number(rows.rows[0].day),
    Number(rows.rows[0].month),
    0,
  ];
}

export async function recordUsage(input: UsageRecordInput): Promise<void> {
  await query(
    `INSERT INTO usage_records(
       tenant_id,api_key_id,agent_id,agent_instance_id,caller_id,request_id,operation,status_code,latency_ms,
       input_bytes,output_bytes,event_count,error_code,error_message,remote_task_id
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      input.tenantId,
      input.apiKeyId ?? null,
      input.agentId ?? null,
      input.agentInstanceId ?? null,
      input.callerId ?? null,
      input.requestId,
      input.operation,
      input.statusCode,
      input.latencyMs ?? null,
      input.inputBytes ?? 0,
      input.outputBytes ?? 0,
      input.eventCount ?? 0,
      input.errorCode ?? null,
      input.errorMessage ?? null,
      input.remoteTaskId ?? null,
    ],
  );
}

export const usageQuerySchema = paginationSchema.extend({
  tenantId: z.string().uuid().optional(),
  apiKeyId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
  operation: z.string().trim().max(80).optional(),
  status: z.enum(["success", "error"]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type UsageRecord = {
  id: number;
  tenantId: string;
  tenantName: string;
  apiKeyId?: string;
  apiKeyName?: string;
  agentId?: string;
  agentName?: string;
  agentInstanceId?: string;
  agentInstanceName?: string;
  callerId?: string;
  requestId: string;
  operation: string;
  statusCode: number;
  latencyMs?: number;
  inputBytes: number;
  outputBytes: number;
  eventCount: number;
  errorCode?: string;
  errorMessage?: string;
  remoteTaskId?: string;
  createdAt: string;
};

type UsageRow = {
  id: string;
  tenant_id: string;
  tenant_name: string;
  api_key_id: string | null;
  api_key_name: string | null;
  agent_id: string | null;
  agent_name: string | null;
  agent_instance_id: string | null;
  agent_instance_name: string | null;
  caller_id: string | null;
  request_id: string;
  operation: string;
  status_code: number;
  latency_ms: number | null;
  input_bytes: number;
  output_bytes: number;
  event_count: number;
  error_code: string | null;
  error_message: string | null;
  remote_task_id: string | null;
  created_at: Date;
};

function mapUsage(row: UsageRow): UsageRecord {
  return {
    id: Number(row.id),
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    apiKeyId: row.api_key_id ?? undefined,
    apiKeyName: row.api_key_name ?? undefined,
    agentId: row.agent_id ?? undefined,
    agentName: row.agent_name ?? undefined,
    agentInstanceId: row.agent_instance_id ?? undefined,
    agentInstanceName: row.agent_instance_name ?? undefined,
    callerId: row.caller_id ?? undefined,
    requestId: row.request_id,
    operation: row.operation,
    statusCode: row.status_code,
    latencyMs: row.latency_ms ?? undefined,
    inputBytes: row.input_bytes,
    outputBytes: row.output_bytes,
    eventCount: row.event_count,
    errorCode: row.error_code ?? undefined,
    errorMessage: row.error_message ?? undefined,
    remoteTaskId: row.remote_task_id ?? undefined,
    createdAt: row.created_at.toISOString(),
  };
}

function usageWhere(input: z.infer<typeof usageQuerySchema>): {
  sql: string;
  values: unknown[];
} {
  const values: unknown[] = [];
  const clauses: string[] = [];
  const add = (column: string, value: unknown, operator = "=") => {
    values.push(value);
    clauses.push(`${column}${operator}$${values.length}`);
  };
  if (input.tenantId) add("u.tenant_id", input.tenantId);
  if (input.apiKeyId) add("u.api_key_id", input.apiKeyId);
  if (input.agentId) add("u.agent_id", input.agentId);
  if (input.operation) add("u.operation", input.operation);
  if (input.status === "success") clauses.push("u.status_code < 400");
  if (input.status === "error") clauses.push("u.status_code >= 400");
  if (input.from) add("u.created_at", input.from, ">=");
  if (input.to) add("u.created_at", input.to, "<=");
  return {
    sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    values,
  };
}

const usageSelect = `SELECT u.*,t.display_name AS tenant_name,k.name AS api_key_name,a.display_name AS agent_name,
  i.name AS agent_instance_name
  FROM usage_records u JOIN tenants t ON t.id=u.tenant_id
  LEFT JOIN api_keys k ON k.id=u.api_key_id LEFT JOIN agents a ON a.id=u.agent_id
  LEFT JOIN agent_instances i ON i.id=u.agent_instance_id`;

export async function searchUsage(raw: unknown): Promise<Page<UsageRecord>> {
  const input = usageQuerySchema.parse(raw);
  const where = usageWhere(input);
  const count = await query<{ count: string }>(
    `SELECT count(*) FROM usage_records u ${where.sql}`,
    where.values,
  );
  const values = [...where.values, input.pageSize, offsetOf(input)];
  const rows = await query<UsageRow>(
    `${usageSelect} ${where.sql} ORDER BY u.created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return pageResult(rows.map(mapUsage), Number(count[0].count), input);
}

export type UsageSummary = {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  failureRate: number;
  averageLatencyMs: number;
  p95LatencyMs: number;
  inputBytes: number;
  outputBytes: number;
  trend: Array<{
    bucket: string;
    requests: number;
    failures: number;
    averageLatencyMs: number;
  }>;
};

export async function usageSummary(raw: unknown): Promise<UsageSummary> {
  const input = usageQuerySchema
    .omit({ page: true, pageSize: true })
    .parse(raw);
  const where = usageWhere({ ...input, page: 1, pageSize: 20 });
  const totals = await query<{
    total: string;
    success: string;
    failed: string;
    average_latency: string | null;
    p95_latency: string | null;
    input_bytes: string;
    output_bytes: string;
  }>(
    `SELECT count(*) AS total,count(*) FILTER(WHERE status_code<400) AS success,
       count(*) FILTER(WHERE status_code>=400) AS failed,avg(latency_ms) AS average_latency,
       percentile_cont(0.95) WITHIN GROUP(ORDER BY latency_ms) AS p95_latency,
       coalesce(sum(input_bytes),0) AS input_bytes,coalesce(sum(output_bytes),0) AS output_bytes
     FROM usage_records u ${where.sql}`,
    where.values,
  );
  const trend = await query<{
    bucket: Date;
    requests: string;
    failures: string;
    average_latency: string | null;
  }>(
    `SELECT date_trunc('hour',u.created_at) AS bucket,count(*) AS requests,
       count(*) FILTER(WHERE status_code>=400) AS failures,avg(latency_ms) AS average_latency
     FROM usage_records u ${where.sql} GROUP BY 1 ORDER BY 1`,
    where.values,
  );
  const row = totals[0];
  const total = Number(row.total);
  return {
    totalRequests: total,
    successfulRequests: Number(row.success),
    failedRequests: Number(row.failed),
    failureRate: total ? Number(row.failed) / total : 0,
    averageLatencyMs: Math.round(Number(row.average_latency ?? 0)),
    p95LatencyMs: Math.round(Number(row.p95_latency ?? 0)),
    inputBytes: Number(row.input_bytes),
    outputBytes: Number(row.output_bytes),
    trend: trend.map((item) => ({
      bucket: item.bucket.toISOString(),
      requests: Number(item.requests),
      failures: Number(item.failures),
      averageLatencyMs: Math.round(Number(item.average_latency ?? 0)),
    })),
  };
}

export async function usageCsv(raw: unknown): Promise<string> {
  const input = usageQuerySchema
    .omit({ page: true, pageSize: true })
    .parse(raw);
  const where = usageWhere({ ...input, page: 1, pageSize: 100 });
  // Keep exports useful for real operations while imposing a hard safety cap so
  // an unfiltered request cannot exhaust the API process heap.
  const exported = await query<UsageRow>(
    `${usageSelect} ${where.sql} ORDER BY u.created_at DESC LIMIT 100000`,
    where.values,
  );
  const quote = (value: unknown) =>
    `"${String(value ?? "").replaceAll('"', '""')}"`;
  const header = [
    "时间",
    "租户",
    "API Key",
    "Agent",
    "操作",
    "状态码",
    "耗时(ms)",
    "输入字节",
    "输出字节",
    "请求ID",
    "错误",
  ];
  const rows = exported
    .map(mapUsage)
    .map((item) =>
      [
        item.createdAt,
        item.tenantName,
        item.apiKeyName,
        item.agentName,
        item.operation,
        item.statusCode,
        item.latencyMs,
        item.inputBytes,
        item.outputBytes,
        item.requestId,
        item.errorMessage,
      ]
        .map(quote)
        .join(","),
    );
  return [`\uFEFF${header.map(quote).join(",")}`, ...rows].join("\r\n");
}

export function usageByteLength(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    throw new AppError(400, "REQUEST_NOT_SERIALIZABLE", "请求体无法序列化。");
  }
}
