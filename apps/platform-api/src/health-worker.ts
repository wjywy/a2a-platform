import { config } from "./config.js";
import { getAgentBySlug, listAgents } from "./repositories.js";
import {
  checkAgentInstance,
  listAgentInstances,
  refreshAggregateHealth,
  reconcileAgentInstanceLeases,
} from "./agent-instance-service.js";
import { evaluateAlertRules } from "./alert-service.js";
import {
  enqueuePlatformEvent,
  processTaskEventOutboxBatch,
  processWebhookBatch,
} from "./webhook-service.js";
import { getSettingValue } from "./settings-service.js";
import { pool } from "./db.js";
import type { PoolClient } from "pg";
import { writeAudit } from "./audit-service.js";
import { cleanupAuthArtifacts } from "./oidc-service.js";
import { processNotificationBatch } from "./notification-service.js";
import crypto from "node:crypto";
import { runRetentionCleanup } from "./operations-service.js";

const workerInstanceId = `${process.pid}:${crypto.randomUUID()}`;

async function runRetentionCleanupIfDue(): Promise<void> {
  const due = await pool.query<{ should_run: boolean }>(
    `SELECT coalesce((metadata->>'retentionLastRunAt')::timestamptz < now()-interval '24 hours',true) AS should_run
     FROM worker_heartbeats WHERE worker_name='health-worker'`,
  );
  if (!due.rows[0]?.should_run) return;
  const deleted = await runRetentionCleanup();
  await pool.query(
    `UPDATE worker_heartbeats
     SET metadata=jsonb_set(metadata,'{retentionLastRunAt}',to_jsonb(now()::text),true)
                   || jsonb_build_object('retentionLastDeleted', $1::jsonb),
         updated_at=now()
     WHERE worker_name='health-worker'`,
    [JSON.stringify(deleted)],
  );
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  action: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (cursor < items.length) {
        const item = items[cursor++];
        await action(item);
      }
    },
  );
  await Promise.all(workers);
}

async function runOnce(): Promise<void> {
  const agents = await listAgents();
  await mapWithConcurrency(
    agents.filter((agent) => ["online", "degraded"].includes(agent.status)),
    10,
    async (agent) => {
      const previous = agent.healthStatus;
      const instances = await listAgentInstances(agent.id);
      const results = await Promise.all(
        instances
          .filter((instance) => instance.status === "active")
          .map((instance) => checkAgentInstance(agent.id, instance.id)),
      );
      await refreshAggregateHealth(agent.id);
      const current = await getAgentBySlug(agent.slug);
      const healthy = results.some((result) => result.ok);
      const representative = results.find((result) => !result.ok) ?? results[0];
      if (agent.tenantId && previous !== "unhealthy" && !healthy) {
        await enqueuePlatformEvent({
          type: "agent.degraded",
          tenantId: agent.tenantId,
          agentId: agent.id,
          data: {
            slug: agent.slug,
            error: representative?.error ?? "没有活动实例",
            latencyMs: representative?.latencyMs,
          },
        });
        await writeAudit(
          { actorId: "system:health-worker", tenantId: agent.tenantId },
          "agent.degraded",
          { type: "agent", id: agent.id, agentId: agent.id },
          { instances: instances.length, error: representative?.error },
        );
      }
      if (agent.tenantId && previous === "unhealthy" && healthy) {
        await enqueuePlatformEvent({
          type: "agent.recovered",
          tenantId: agent.tenantId,
          agentId: agent.id,
          data: {
            slug: agent.slug,
            latencyMs: results.find((result) => result.ok)?.latencyMs,
            status: current?.status,
          },
        });
        await writeAudit(
          { actorId: "system:health-worker", tenantId: agent.tenantId },
          "agent.recovered",
          { type: "agent", id: agent.id, agentId: agent.id },
          { instances: instances.length },
        );
      }
    },
  );
  await evaluateAlertRules();
  await reconcileAgentInstanceLeases();
  let outbox;
  let outboxBatches = 0;
  do {
    outbox = await processTaskEventOutboxBatch(100);
    outboxBatches++;
  } while (outbox.processed === 100 && outboxBatches < 10);
  let batch;
  let batches = 0;
  do {
    batch = await processWebhookBatch(25);
    batches++;
  } while (batch.processed === 25 && batches < 20);
  let notificationBatch;
  let notificationBatches = 0;
  do {
    notificationBatch = await processNotificationBatch(25);
    notificationBatches++;
  } while (notificationBatch.processed === 25 && notificationBatches < 20);
  await pool.query("DELETE FROM quota_counters WHERE expires_at<now()");
  await cleanupAuthArtifacts();
  await runRetentionCleanupIfDue();
}

async function loop(): Promise<void> {
  let client: PoolClient | undefined;
  try {
    const acquiredClient = await pool.connect();
    client = acquiredClient;
    const lock = await acquiredClient.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext('a2a-platform-health-worker')) AS acquired",
    );
    if (lock.rows[0].acquired) {
      try {
        await acquiredClient.query(
          `INSERT INTO worker_heartbeats(worker_name,instance_id,last_started_at,metadata)
           VALUES('health-worker',$1,now(),$2)
           ON CONFLICT(worker_name) DO UPDATE SET instance_id=EXCLUDED.instance_id,last_started_at=now(),metadata=worker_heartbeats.metadata || EXCLUDED.metadata,updated_at=now()`,
          [workerInstanceId, JSON.stringify({ pid: process.pid })],
        );
        await runOnce();
        await acquiredClient.query(
          `UPDATE worker_heartbeats SET last_succeeded_at=now(),last_error=NULL,updated_at=now()
           WHERE worker_name='health-worker'`,
        );
      } finally {
        await acquiredClient.query(
          "SELECT pg_advisory_unlock(hashtext('a2a-platform-health-worker'))",
        );
      }
    }
  } catch (error) {
    console.error("Health-check cycle failed:", error);
    try {
      await pool.query(
        `INSERT INTO worker_heartbeats(worker_name,instance_id,last_failed_at,last_error)
         VALUES('health-worker',$1,now(),$2)
         ON CONFLICT(worker_name) DO UPDATE SET last_failed_at=now(),last_error=EXCLUDED.last_error,updated_at=now()`,
        [
          workerInstanceId,
          error instanceof Error
            ? error.message.slice(0, 2000)
            : String(error).slice(0, 2000),
        ],
      );
    } catch (heartbeatError) {
      console.error("Failed to persist worker heartbeat:", heartbeatError);
    }
  } finally {
    client?.release();
    let configuredSeconds = config.healthIntervalMs / 1000;
    try {
      configuredSeconds = Number(
        await getSettingValue(
          "health.intervalSeconds",
          config.healthIntervalMs / 1000,
        ),
      );
    } catch (error) {
      console.error("Failed to read health interval; using fallback:", error);
    }
    const intervalMs = Number.isFinite(configuredSeconds)
      ? Math.min(3600, Math.max(5, configuredSeconds)) * 1000
      : config.healthIntervalMs;
    // This timer is the worker supervisor and must keep the process alive.
    setTimeout(loop, intervalMs);
  }
}

void loop();
