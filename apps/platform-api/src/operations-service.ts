import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { pool, query } from "./db.js";
import { getRedis } from "./redis.js";
import { getSettingValue } from "./settings-service.js";

const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));

export type Readiness = {
  ok: boolean;
  database: {
    ok: boolean;
    latencyMs: number;
    migration?: string;
    expectedMigration?: string;
    error?: string;
  };
  redis: { ok: boolean; latencyMs: number; error?: string };
  worker: {
    ok: boolean;
    lastSucceededAt?: string;
    ageSeconds?: number;
    error?: string;
  };
};

export async function readiness(): Promise<Readiness> {
  const database: Readiness["database"] = { ok: false, latencyMs: 0 };
  const redisState: Readiness["redis"] = { ok: false, latencyMs: 0 };
  const worker: Readiness["worker"] = { ok: false };
  const databaseStarted = performance.now();
  try {
    const expectedMigration = (await readdir(migrationsDir))
      .filter((file) => file.endsWith(".sql"))
      .sort()
      .at(-1);
    const result = await pool.query<{ id: string }>(
      "SELECT id FROM schema_migrations ORDER BY id DESC LIMIT 1",
    );
    database.latencyMs = Math.round(performance.now() - databaseStarted);
    database.migration = result.rows[0]?.id;
    database.expectedMigration = expectedMigration;
    database.ok = Boolean(
      expectedMigration && result.rows[0]?.id === expectedMigration,
    );
    if (!database.ok) database.error = "数据库迁移版本落后。";
    const heartbeat = await pool.query<{
      last_succeeded_at: Date | null;
      last_error: string | null;
    }>(
      "SELECT last_succeeded_at,last_error FROM worker_heartbeats WHERE worker_name='health-worker'",
    );
    if (heartbeat.rows[0]?.last_succeeded_at) {
      const ageSeconds = Math.max(
        0,
        Math.round(
          (Date.now() - heartbeat.rows[0].last_succeeded_at!.getTime()) / 1000,
        ),
      );
      const healthIntervalSeconds = Number(
        await getSettingValue("health.intervalSeconds", 30),
      );
      const heartbeatDeadlineSeconds = Math.max(
        180,
        healthIntervalSeconds * 3 + 30,
      );
      worker.lastSucceededAt =
        heartbeat.rows[0].last_succeeded_at.toISOString();
      worker.ageSeconds = ageSeconds;
      worker.ok = ageSeconds <= heartbeatDeadlineSeconds;
      if (!worker.ok) worker.error = "后台 Worker 心跳超时。";
    } else
      worker.error =
        heartbeat.rows[0]?.last_error ?? "后台 Worker 尚无成功心跳。";
  } catch (error) {
    database.latencyMs = Math.round(performance.now() - databaseStarted);
    database.error = error instanceof Error ? error.message : String(error);
  }
  const redisStarted = performance.now();
  try {
    const redis = await getRedis();
    if (!redis) throw new Error("Redis 不可用。");
    await redis.ping();
    redisState.ok = true;
    redisState.latencyMs = Math.round(performance.now() - redisStarted);
  } catch (error) {
    redisState.latencyMs = Math.round(performance.now() - redisStarted);
    redisState.error = error instanceof Error ? error.message : String(error);
  }
  return {
    ok: database.ok && redisState.ok && worker.ok,
    database,
    redis: redisState,
    worker,
  };
}

const metricName = (value: string) => value.replaceAll(/[^a-zA-Z0-9_]/g, "_");
export async function prometheusMetrics(): Promise<string> {
  const [agents, requests, workers, queues] = await Promise.all([
    query<{ status: string; count: string }>(
      "SELECT status,count(*) FROM agents WHERE deleted_at IS NULL GROUP BY status",
    ),
    query<{ status_class: string; count: string; latency_sum: string }>(
      `SELECT CASE WHEN status_code<400 THEN 'success' ELSE 'error' END AS status_class,
       count(*),coalesce(sum(latency_ms),0) AS latency_sum FROM usage_records
       WHERE created_at>=now()-interval '5 minutes' GROUP BY 1`,
    ),
    query<{ worker_name: string; age_seconds: string | null }>(
      "SELECT worker_name,extract(epoch FROM now()-last_succeeded_at)::text AS age_seconds FROM worker_heartbeats",
    ),
    query<{ queue: string; count: string }>(
      `SELECT 'webhook' AS queue,count(*) FROM webhook_deliveries WHERE status IN ('pending','retrying')
       UNION ALL SELECT 'notification',count(*) FROM notification_records WHERE status IN ('pending','retrying')
       UNION ALL SELECT 'task_outbox',count(*) FROM task_event_outbox WHERE status IN ('pending','processing')`,
    ),
  ]);
  const lines = [
    "# HELP a2a_platform_agent_count Number of registered agents by status.",
    "# TYPE a2a_platform_agent_count gauge",
    ...agents.map(
      (row) =>
        `a2a_platform_agent_count{status="${metricName(row.status)}"} ${row.count}`,
    ),
    "# HELP a2a_platform_requests_5m Calls recorded during the last five minutes.",
    "# TYPE a2a_platform_requests_5m gauge",
    ...requests.map(
      (row) =>
        `a2a_platform_requests_5m{result="${row.status_class}"} ${row.count}`,
    ),
    "# HELP a2a_platform_latency_ms_sum_5m Total recorded latency during the last five minutes.",
    "# TYPE a2a_platform_latency_ms_sum_5m gauge",
    ...requests.map(
      (row) =>
        `a2a_platform_latency_ms_sum_5m{result="${row.status_class}"} ${row.latency_sum}`,
    ),
    "# HELP a2a_platform_worker_heartbeat_age_seconds Age of the last successful worker cycle.",
    "# TYPE a2a_platform_worker_heartbeat_age_seconds gauge",
    ...workers.map(
      (row) =>
        `a2a_platform_worker_heartbeat_age_seconds{worker="${metricName(row.worker_name)}"} ${row.age_seconds ?? "-1"}`,
    ),
    "# HELP a2a_platform_queue_depth Pending durable jobs.",
    "# TYPE a2a_platform_queue_depth gauge",
    ...queues.map(
      (row) =>
        `a2a_platform_queue_depth{queue="${metricName(row.queue)}"} ${row.count}`,
    ),
  ];
  return `${lines.join("\n")}\n`;
}

export async function runRetentionCleanup(
  batchSize = 5000,
): Promise<Record<string, number>> {
  const statements: Array<[string, string]> = [
    [
      "usage",
      `DELETE FROM usage_records u USING tenants t WHERE u.ctid IN
      (SELECT u2.ctid FROM usage_records u2 JOIN tenants t2 ON t2.id=u2.tenant_id
       WHERE u2.created_at<now()-(t2.data_retention_days::text||' days')::interval LIMIT $1)
      AND t.id=u.tenant_id`,
    ],
    [
      "tasks",
      `DELETE FROM task_snapshots s USING tenants t WHERE s.ctid IN
      (SELECT s2.ctid FROM task_snapshots s2 JOIN tenants t2 ON t2.id=s2.tenant_id
       WHERE s2.created_at<now()-(t2.data_retention_days::text||' days')::interval LIMIT $1)
      AND t.id=s.tenant_id`,
    ],
    [
      "audit",
      `DELETE FROM audit_logs a USING tenants t WHERE a.ctid IN
      (SELECT a2.ctid FROM audit_logs a2 JOIN tenants t2 ON t2.id=a2.tenant_id
       WHERE a2.created_at<now()-(t2.data_retention_days::text||' days')::interval LIMIT $1)
      AND t.id=a.tenant_id`,
    ],
    [
      "health",
      `DELETE FROM agent_health_checks h USING agents a,tenants t WHERE h.ctid IN
      (SELECT h2.ctid FROM agent_health_checks h2 JOIN agents a2 ON a2.id=h2.agent_id JOIN tenants t2 ON t2.id=a2.tenant_id
       WHERE h2.checked_at<now()-(t2.data_retention_days::text||' days')::interval LIMIT $1)
      AND a.id=h.agent_id AND t.id=a.tenant_id`,
    ],
    [
      "webhooks",
      `DELETE FROM webhook_deliveries d USING tenants t WHERE d.ctid IN
      (SELECT d2.ctid FROM webhook_deliveries d2 JOIN tenants t2 ON t2.id=d2.tenant_id
       WHERE d2.created_at<now()-(t2.data_retention_days::text||' days')::interval LIMIT $1)
      AND t.id=d.tenant_id`,
    ],
    [
      "notifications",
      `DELETE FROM notification_records n USING tenants t WHERE n.ctid IN
      (SELECT n2.ctid FROM notification_records n2 JOIN tenants t2 ON t2.id=n2.tenant_id
       WHERE n2.created_at<now()-(t2.data_retention_days::text||' days')::interval LIMIT $1)
      AND t.id=n.tenant_id`,
    ],
  ];
  const result: Record<string, number> = {};
  for (const [name, sql] of statements) {
    let total = 0;
    for (let batch = 0; batch < 20; batch++) {
      const deleted = await pool.query(sql, [batchSize]);
      const count = deleted.rowCount ?? 0;
      total += count;
      if (count < batchSize) break;
    }
    result[name] = total;
  }
  return result;
}
