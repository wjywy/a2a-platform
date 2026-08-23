import crypto from "node:crypto";
import { z } from "zod";
import { query } from "./db.js";
import {
  AppError,
  NotFoundError,
  offsetOf,
  pageResult,
  paginationSchema,
  type Page,
} from "./domain.js";
import { getTenant } from "./tenant-service.js";
import {
  allowPrivateOutboundTargets,
  assertSafeOutboundUrl,
} from "./url-policy.js";
import { getSettingValue } from "./settings-service.js";
import { decryptSecret, encryptSecret } from "./credential-service.js";
import { readLimitedResponseText, secureFetch } from "./secure-fetch.js";

export const webhookEventTypes = [
  "task.created",
  "task.working",
  "task.completed",
  "task.failed",
  "agent.degraded",
  "agent.recovered",
] as const;
export type WebhookEventType = (typeof webhookEventTypes)[number];
export type WebhookDeliveryStatus =
  "pending" | "delivering" | "succeeded" | "retrying" | "dead_letter";

export const createWebhookSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).default(""),
  targetUrl: z
    .string()
    .url()
    .refine(
      (value) => ["http:", "https:"].includes(new URL(value).protocol),
      "仅支持 HTTP(S) 地址。",
    ),
  events: z.array(z.enum(webhookEventTypes)).min(1),
  enabled: z.boolean().default(true),
  timeoutMs: z.number().int().min(500).max(30_000).default(5000),
  maxAttempts: z.number().int().min(1).max(12).default(5),
});

export const updateWebhookSchema = createWebhookSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "至少提供一个可更新字段。");

export const deliveryQuerySchema = paginationSchema.extend({
  status: z
    .enum(["pending", "delivering", "succeeded", "retrying", "dead_letter"])
    .optional(),
  eventType: z.enum(webhookEventTypes).optional(),
});

export type WebhookEndpoint = {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  targetUrl: string;
  events: WebhookEventType[];
  enabled: boolean;
  timeoutMs: number;
  maxAttempts: number;
  lastDeliveryAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type WebhookWithSecret = WebhookEndpoint & { signingSecret: string };

export type WebhookDelivery = {
  id: string;
  webhookId: string;
  tenantId: string;
  eventId: string;
  eventType: WebhookEventType;
  payload: Record<string, unknown>;
  attempt: number;
  status: WebhookDeliveryStatus;
  responseStatus?: number;
  responseBody?: string;
  errorMessage?: string;
  nextAttemptAt: string;
  deliveredAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type PlatformEvent = {
  id?: string;
  type: WebhookEventType;
  tenantId: string;
  agentId?: string;
  taskId?: string;
  occurredAt?: string;
  data: Record<string, unknown>;
};

type HookRow = {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  target_url: string;
  signing_secret: string | null;
  secret_ciphertext: string | null;
  secret_iv: string | null;
  secret_tag: string | null;
  secret_key_version: string | null;
  events: WebhookEventType[];
  enabled: boolean;
  timeout_ms: number;
  max_attempts: number;
  last_delivery_at: Date | null;
  created_at: Date;
  updated_at: Date;
};
type DeliveryRow = {
  id: string;
  webhook_id: string;
  tenant_id: string;
  event_id: string;
  event_type: WebhookEventType;
  payload: Record<string, unknown>;
  attempt: number;
  status: WebhookDeliveryStatus;
  response_status: number | null;
  response_body: string | null;
  error_message: string | null;
  next_attempt_at: Date;
  delivered_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function mapHook(row: HookRow): WebhookEndpoint {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    description: row.description,
    targetUrl: row.target_url,
    events: row.events,
    enabled: row.enabled,
    timeoutMs: row.timeout_ms,
    maxAttempts: row.max_attempts,
    lastDeliveryAt: row.last_delivery_at?.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function signingSecret(row: HookRow, webhookId = row.id): string {
  if (
    row.secret_ciphertext &&
    row.secret_iv &&
    row.secret_tag &&
    row.secret_key_version
  )
    return decryptSecret(
      {
        ciphertext: row.secret_ciphertext,
        iv: row.secret_iv,
        tag: row.secret_tag,
        keyVersion: row.secret_key_version,
      },
      `webhook:${webhookId}`,
    );
  if (row.signing_secret) return row.signing_secret;
  throw new AppError(500, "WEBHOOK_SECRET_MISSING", "Webhook 签名密钥不可用。");
}
function mapDelivery(row: DeliveryRow): WebhookDelivery {
  return {
    id: row.id,
    webhookId: row.webhook_id,
    tenantId: row.tenant_id,
    eventId: row.event_id,
    eventType: row.event_type,
    payload: row.payload,
    attempt: row.attempt,
    status: row.status,
    responseStatus: row.response_status ?? undefined,
    responseBody: row.response_body ?? undefined,
    errorMessage: row.error_message ?? undefined,
    nextAttemptAt: row.next_attempt_at.toISOString(),
    deliveredAt: row.delivered_at?.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listWebhooks(
  tenantId: string,
): Promise<WebhookEndpoint[]> {
  await getTenant(tenantId);
  return (
    await query<HookRow>(
      "SELECT * FROM webhook_endpoints WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC",
      [tenantId],
    )
  ).map(mapHook);
}

export async function getWebhook(
  tenantId: string,
  id: string,
  includeSecret = false,
): Promise<WebhookEndpoint | WebhookWithSecret> {
  const rows = await query<HookRow>(
    "SELECT * FROM webhook_endpoints WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL",
    [id, tenantId],
  );
  if (!rows[0]) throw new NotFoundError("Webhook", id);
  const hook = mapHook(rows[0]);
  return includeSecret
    ? { ...hook, signingSecret: signingSecret(rows[0]) }
    : hook;
}

export async function createWebhook(
  tenantId: string,
  raw: unknown,
): Promise<WebhookWithSecret> {
  await getTenant(tenantId);
  const defaultMaxAttempts = Number(
    await getSettingValue("webhook.defaultMaxAttempts", 5),
  );
  const source =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : raw;
  const input = createWebhookSchema.parse(
    typeof source === "object" && source !== null && !("maxAttempts" in source)
      ? { ...source, maxAttempts: defaultMaxAttempts }
      : source,
  );
  await assertSafeOutboundUrl(input.targetUrl, {
    purpose: "webhook",
    allowPrivate: allowPrivateOutboundTargets(),
  });
  const secret = crypto.randomBytes(32).toString("base64url");
  const id = crypto.randomUUID();
  const bound = encryptSecret(secret, `webhook:${id}`);
  const rows = await query<HookRow>(
    `INSERT INTO webhook_endpoints(
    id,tenant_id,name,description,target_url,signing_secret,secret_ciphertext,secret_iv,secret_tag,
    secret_key_version,events,enabled,timeout_ms,max_attempts)
    VALUES($1,$2,$3,$4,$5,NULL,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [
      id,
      tenantId,
      input.name,
      input.description,
      input.targetUrl,
      bound.ciphertext,
      bound.iv,
      bound.tag,
      bound.keyVersion,
      JSON.stringify(input.events),
      input.enabled,
      input.timeoutMs,
      input.maxAttempts,
    ],
  );
  return { ...mapHook(rows[0]), signingSecret: secret };
}

export async function updateWebhook(
  tenantId: string,
  id: string,
  raw: unknown,
): Promise<WebhookEndpoint> {
  const input = updateWebhookSchema.parse(raw);
  const current = (await getWebhook(tenantId, id)) as WebhookEndpoint;
  const next = { ...current, ...input };
  await assertSafeOutboundUrl(next.targetUrl, {
    purpose: "webhook",
    allowPrivate: allowPrivateOutboundTargets(),
  });
  const rows = await query<HookRow>(
    `UPDATE webhook_endpoints SET name=$3,description=$4,target_url=$5,events=$6,
    enabled=$7,timeout_ms=$8,max_attempts=$9,updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL RETURNING *`,
    [
      id,
      tenantId,
      next.name,
      next.description,
      next.targetUrl,
      JSON.stringify(next.events),
      next.enabled,
      next.timeoutMs,
      next.maxAttempts,
    ],
  );
  if (!next.enabled)
    await query(
      `UPDATE webhook_deliveries SET status='dead_letter',
       error_message='Webhook 已停用，未投递事件已取消',updated_at=now()
       WHERE webhook_id=$1 AND status IN ('pending','retrying','delivering')`,
      [id],
    );
  return mapHook(rows[0]);
}

export async function rotateWebhookSecret(
  tenantId: string,
  id: string,
): Promise<{ signingSecret: string }> {
  await getWebhook(tenantId, id);
  const signingSecret = crypto.randomBytes(32).toString("base64url");
  const encrypted = encryptSecret(signingSecret, `webhook:${id}`);
  await query(
    `UPDATE webhook_endpoints SET signing_secret=NULL,secret_ciphertext=$3,secret_iv=$4,
     secret_tag=$5,secret_key_version=$6,updated_at=now() WHERE id=$1 AND tenant_id=$2`,
    [
      id,
      tenantId,
      encrypted.ciphertext,
      encrypted.iv,
      encrypted.tag,
      encrypted.keyVersion,
    ],
  );
  return { signingSecret };
}

export async function deleteWebhook(
  tenantId: string,
  id: string,
): Promise<void> {
  await getWebhook(tenantId, id);
  await query(
    "UPDATE webhook_endpoints SET enabled=false,deleted_at=now(),updated_at=now() WHERE id=$1 AND tenant_id=$2",
    [id, tenantId],
  );
  await query(
    `UPDATE webhook_deliveries SET status='dead_letter',
     error_message='Webhook 已删除，未投递事件已取消',updated_at=now()
     WHERE webhook_id=$1 AND status IN ('pending','retrying','delivering')`,
    [id],
  );
}

export async function enqueuePlatformEvent(
  event: PlatformEvent,
): Promise<number> {
  const normalized = {
    ...event,
    id: event.id ?? crypto.randomUUID(),
    occurredAt: event.occurredAt ?? new Date().toISOString(),
  };
  const hooks = await query<{ id: string }>(
    `SELECT id FROM webhook_endpoints WHERE tenant_id=$1 AND enabled=true
    AND deleted_at IS NULL AND events ? $2`,
    [event.tenantId, event.type],
  );
  for (const hook of hooks)
    await query(
      `INSERT INTO webhook_deliveries(webhook_id,tenant_id,event_id,event_type,payload)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT(webhook_id,event_id) DO NOTHING`,
      [
        hook.id,
        event.tenantId,
        normalized.id,
        event.type,
        JSON.stringify(normalized),
      ],
    );
  return hooks.length;
}

export async function listDeliveries(
  tenantId: string,
  webhookId: string,
  raw: unknown,
): Promise<Page<WebhookDelivery>> {
  await getWebhook(tenantId, webhookId);
  const input = deliveryQuerySchema.parse(raw);
  const values: unknown[] = [tenantId, webhookId];
  const clauses = ["tenant_id=$1", "webhook_id=$2"];
  if (input.status) {
    values.push(input.status);
    clauses.push(`status=$${values.length}`);
  }
  if (input.eventType) {
    values.push(input.eventType);
    clauses.push(`event_type=$${values.length}`);
  }
  const where = `WHERE ${clauses.join(" AND ")}`;
  const total = await query<{ count: string }>(
    `SELECT count(*) FROM webhook_deliveries ${where}`,
    values,
  );
  values.push(input.pageSize, offsetOf(input));
  const rows = await query<DeliveryRow>(
    `SELECT * FROM webhook_deliveries ${where}
    ORDER BY created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return pageResult(rows.map(mapDelivery), Number(total[0].count), input);
}

export async function replayDelivery(
  tenantId: string,
  deliveryId: string,
): Promise<WebhookDelivery> {
  const rows = await query<DeliveryRow>(
    "SELECT * FROM webhook_deliveries WHERE id=$1 AND tenant_id=$2",
    [deliveryId, tenantId],
  );
  if (!rows[0]) throw new NotFoundError("Webhook 投递", deliveryId);
  const hook = (await getWebhook(
    tenantId,
    rows[0].webhook_id,
  )) as WebhookEndpoint;
  if (!hook.enabled)
    throw new AppError(409, "WEBHOOK_DISABLED", "已停用的 Webhook 不能重放。");
  const eventId = crypto.randomUUID();
  const payload = { ...rows[0].payload, id: eventId };
  const copy = await query<DeliveryRow>(
    `INSERT INTO webhook_deliveries(webhook_id,tenant_id,event_id,event_type,payload)
    VALUES($1,$2,$3,$4,$5) RETURNING *`,
    [
      rows[0].webhook_id,
      tenantId,
      eventId,
      rows[0].event_type,
      JSON.stringify(payload),
    ],
  );
  return mapDelivery(copy[0]);
}

function signature(secret: string, timestamp: string, body: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
}

export async function processWebhookBatch(limit = 25): Promise<{
  processed: number;
  succeeded: number;
  retried: number;
  deadLettered: number;
}> {
  const deliveries = await query<DeliveryRow & HookRow>(
    `WITH claimed AS (
      SELECT d.id FROM webhook_deliveries d JOIN webhook_endpoints active ON active.id=d.webhook_id
      WHERE ((d.status IN ('pending','retrying') AND d.next_attempt_at<=now())
        OR (d.status='delivering' AND d.updated_at<now()-interval '2 minutes'))
        AND active.enabled=true AND active.deleted_at IS NULL
      ORDER BY d.next_attempt_at LIMIT $1 FOR UPDATE OF d SKIP LOCKED)
    UPDATE webhook_deliveries d SET status='delivering',updated_at=now() FROM claimed c,
      webhook_endpoints w WHERE d.id=c.id AND w.id=d.webhook_id RETURNING d.*,w.target_url,w.signing_secret,
      w.secret_ciphertext,w.secret_iv,w.secret_tag,w.secret_key_version,w.timeout_ms,w.max_attempts`,
    [limit],
  );
  const result = {
    processed: deliveries.length,
    succeeded: 0,
    retried: 0,
    deadLettered: 0,
  };
  for (const row of deliveries) {
    const body = JSON.stringify(row.payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    let responseStatus: number | undefined;
    try {
      await assertSafeOutboundUrl(row.target_url, {
        purpose: "webhook",
        allowPrivate: allowPrivateOutboundTargets(),
      });
      const response = await secureFetch(row.target_url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "A2A-Agent-Platform-Webhook/1.0",
          "x-a2a-event-id": row.event_id,
          "x-a2a-event": row.event_type,
          "x-a2a-timestamp": timestamp,
          "x-a2a-signature": `sha256=${signature(signingSecret(row, row.webhook_id), timestamp, body)}`,
        },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(row.timeout_ms),
      });
      responseStatus = response.status;
      const responseBody = await readLimitedResponseText(response, 4000, false);
      if (!response.ok)
        throw new AppError(
          502,
          "WEBHOOK_HTTP_ERROR",
          `Webhook 返回 HTTP ${response.status}`,
          { responseBody },
        );
      await query(
        `UPDATE webhook_deliveries SET status='succeeded',attempt=attempt+1,response_status=$2,response_body=$3,
        delivered_at=now(),updated_at=now() WHERE id=$1`,
        [row.id, response.status, responseBody],
      );
      await query(
        "UPDATE webhook_endpoints SET last_delivery_at=now() WHERE id=$1",
        [row.webhook_id],
      );
      result.succeeded++;
    } catch (error) {
      const attempt = row.attempt + 1;
      const dead = attempt >= row.max_attempts;
      const delay = Math.min(3600, Math.pow(2, attempt) * 5);
      const message = error instanceof Error ? error.message : "未知投递错误";
      await query(
        `UPDATE webhook_deliveries SET status=$2,attempt=$3,response_status=$4,error_message=$5,
        next_attempt_at=now()+($6::text||' seconds')::interval,updated_at=now() WHERE id=$1`,
        [
          row.id,
          dead ? "dead_letter" : "retrying",
          attempt,
          responseStatus ?? null,
          message,
          delay,
        ],
      );
      if (dead) result.deadLettered++;
      else result.retried++;
    }
  }
  return result;
}

type TaskOutboxRow = {
  id: string;
  tenant_id: string;
  agent_id: string;
  remote_task_id: string;
  event_type:
    "task.created" | "task.working" | "task.completed" | "task.failed";
  payload: Record<string, unknown>;
  attempt: number;
  created_at: Date;
};

export async function processTaskEventOutboxBatch(limit = 100): Promise<{
  processed: number;
  dispatched: number;
  retried: number;
  deadLettered: number;
}> {
  const rows = await query<TaskOutboxRow>(
    `WITH claimed AS (
       SELECT id FROM task_event_outbox
       WHERE (status='pending' AND available_at<=now())
          OR (status='processing' AND updated_at<now()-interval '2 minutes')
       ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED)
     UPDATE task_event_outbox o SET status='processing',updated_at=now()
     FROM claimed c WHERE o.id=c.id RETURNING o.*`,
    [limit],
  );
  const result = {
    processed: rows.length,
    dispatched: 0,
    retried: 0,
    deadLettered: 0,
  };
  for (const row of rows) {
    try {
      await enqueuePlatformEvent({
        id: `task-outbox-${row.id}`,
        type: row.event_type,
        tenantId: row.tenant_id,
        agentId: row.agent_id,
        taskId: row.remote_task_id,
        occurredAt: row.created_at.toISOString(),
        data: row.payload,
      });
      await query(
        "UPDATE task_event_outbox SET status='dispatched',updated_at=now() WHERE id=$1",
        [row.id],
      );
      result.dispatched++;
    } catch (error) {
      const attempt = row.attempt + 1;
      const dead = attempt >= 12;
      const delay = Math.min(3600, Math.pow(2, attempt) * 5);
      await query(
        `UPDATE task_event_outbox SET status=$2,attempt=$3,
         available_at=now()+($4::text||' seconds')::interval,error_message=$5,updated_at=now()
         WHERE id=$1`,
        [
          row.id,
          dead ? "dead_letter" : "pending",
          attempt,
          delay,
          error instanceof Error ? error.message : String(error),
        ],
      );
      if (dead) result.deadLettered++;
      else result.retried++;
    }
  }
  return result;
}

export async function testWebhook(
  tenantId: string,
  id: string,
): Promise<WebhookDelivery> {
  const hook = await getWebhook(tenantId, id);
  if (!hook.enabled)
    throw new AppError(409, "WEBHOOK_DISABLED", "请先启用 Webhook。");
  const eventId = crypto.randomUUID();
  const payload = {
    id: eventId,
    type: "task.completed",
    tenantId,
    occurredAt: new Date().toISOString(),
    data: { test: true, message: "A2A Agent Platform Webhook 连通性测试" },
  };
  const rows = await query<DeliveryRow>(
    `INSERT INTO webhook_deliveries(webhook_id,tenant_id,event_id,event_type,payload)
    VALUES($1,$2,$3,'task.completed',$4) RETURNING *`,
    [id, tenantId, eventId, JSON.stringify(payload)],
  );
  return mapDelivery(rows[0]);
}
