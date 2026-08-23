import crypto from "node:crypto";
import nodemailer from "nodemailer";
import type { PoolClient } from "pg";
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
import { config } from "./config.js";
import { getSettingValue } from "./settings-service.js";
import { decryptSecret, encryptSecret } from "./credential-service.js";
import { assertSafeOutboundUrl } from "./url-policy.js";
import { readLimitedResponseText, secureFetch } from "./secure-fetch.js";
import { publishTenantEvent } from "./redis.js";

const notificationTypes = ["webhook", "email"] as const;
const notificationWorkerId = `${process.pid}:${crypto.randomUUID()}`;
const eventTypes = ["alert.triggered", "alert.recovered"] as const;

const channelConfigSchema = z.object({
  timeoutMs: z.number().int().min(500).max(30_000).default(5000),
  maxAttempts: z.number().int().min(1).max(12).default(5),
  subjectPrefix: z.string().trim().max(80).default("[A2A Platform]"),
});

const notificationChannelObjectSchema = z.object({
  tenantId: z.string().uuid(),
  name: z.string().trim().min(2).max(80),
  type: z.enum(notificationTypes),
  destination: z.string().trim().min(3).max(2048),
  enabled: z.boolean().default(true),
  config: channelConfigSchema.partial().default({}),
});
export const createNotificationChannelSchema =
  notificationChannelObjectSchema.superRefine((value, ctx) => {
    if (
      value.type === "email" &&
      !z.string().email().safeParse(value.destination).success
    )
      ctx.addIssue({
        code: "custom",
        path: ["destination"],
        message: "邮件地址格式无效。",
      });
    if (value.type === "webhook") {
      const parsed = z.string().url().safeParse(value.destination);
      if (
        !parsed.success ||
        !["http:", "https:"].includes(new URL(value.destination).protocol)
      )
        ctx.addIssue({
          code: "custom",
          path: ["destination"],
          message: "Webhook 必须是 HTTP(S) URL。",
        });
    }
  });

export const updateNotificationChannelSchema = notificationChannelObjectSchema
  .omit({ tenantId: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "至少提供一个可更新字段。");

export const notificationQuerySchema = paginationSchema.extend({
  tenantId: z.string().uuid().optional(),
  channelId: z.string().uuid().optional(),
  status: z
    .enum(["pending", "delivering", "retrying", "sent", "failed", "suppressed"])
    .optional(),
  eventType: z.enum(eventTypes).optional(),
});

export type NotificationChannel = {
  id: string;
  tenantId: string;
  name: string;
  type: (typeof notificationTypes)[number];
  destination: string;
  enabled: boolean;
  config: z.infer<typeof channelConfigSchema>;
  signingConfigured: boolean;
  lastDeliveryAt?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};
export type NotificationChannelWithSecret = NotificationChannel & {
  signingSecret?: string;
};
export type NotificationRecord = {
  id: number;
  tenantId?: string;
  alertEventId?: number;
  channelId?: string;
  channelName?: string;
  channel: "console" | "webhook" | "email";
  destination?: string;
  eventType?: (typeof eventTypes)[number];
  status:
    "pending" | "delivering" | "retrying" | "sent" | "failed" | "suppressed";
  payload: Record<string, unknown>;
  attempt: number;
  maxAttempts: number;
  nextAttemptAt: string;
  responseStatus?: number;
  responseBody?: string;
  errorMessage?: string;
  deliveredAt?: string;
  createdAt: string;
  updatedAt: string;
};

type ChannelRow = {
  id: string;
  tenant_id: string;
  name: string;
  type: NotificationChannel["type"];
  destination: string;
  enabled: boolean;
  config: Partial<NotificationChannel["config"]>;
  secret_ciphertext: string | null;
  secret_iv: string | null;
  secret_tag: string | null;
  secret_key_version: string | null;
  last_delivery_at: Date | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
};
type RecordRow = {
  id: string;
  tenant_id: string | null;
  alert_event_id: string | null;
  channel_id: string | null;
  channel_name: string | null;
  channel: NotificationRecord["channel"];
  destination: string | null;
  event_type: NotificationRecord["eventType"] | null;
  status: NotificationRecord["status"];
  payload: Record<string, unknown>;
  attempt: number;
  max_attempts: number;
  next_attempt_at: Date;
  response_status: number | null;
  response_body: string | null;
  error_message: string | null;
  delivered_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

const mapChannel = (row: ChannelRow): NotificationChannel => ({
  id: row.id,
  tenantId: row.tenant_id,
  name: row.name,
  type: row.type,
  destination: row.destination,
  enabled: row.enabled,
  config: channelConfigSchema.parse(row.config),
  signingConfigured: Boolean(row.secret_ciphertext),
  lastDeliveryAt: row.last_delivery_at?.toISOString(),
  createdBy: row.created_by,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});
const mapRecord = (row: RecordRow): NotificationRecord => ({
  id: Number(row.id),
  tenantId: row.tenant_id ?? undefined,
  alertEventId: row.alert_event_id ? Number(row.alert_event_id) : undefined,
  channelId: row.channel_id ?? undefined,
  channelName: row.channel_name ?? undefined,
  channel: row.channel,
  destination: row.destination ?? undefined,
  eventType: row.event_type ?? undefined,
  status: row.status,
  payload: row.payload,
  attempt: row.attempt,
  maxAttempts: row.max_attempts,
  nextAttemptAt: row.next_attempt_at.toISOString(),
  responseStatus: row.response_status ?? undefined,
  responseBody: row.response_body ?? undefined,
  errorMessage: row.error_message ?? undefined,
  deliveredAt: row.delivered_at?.toISOString(),
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

export async function listNotificationChannels(
  tenantId?: string,
): Promise<NotificationChannel[]> {
  const rows = tenantId
    ? await query<ChannelRow>(
        "SELECT * FROM notification_channels WHERE tenant_id=$1 ORDER BY created_at DESC",
        [tenantId],
      )
    : await query<ChannelRow>(
        "SELECT * FROM notification_channels ORDER BY created_at DESC",
      );
  return rows.map(mapChannel);
}
export async function getNotificationChannel(
  id: string,
): Promise<NotificationChannel> {
  const rows = await query<ChannelRow>(
    "SELECT * FROM notification_channels WHERE id=$1",
    [id],
  );
  if (!rows[0]) throw new NotFoundError("通知渠道", id);
  return mapChannel(rows[0]);
}
export async function createNotificationChannel(
  raw: unknown,
  actorId: string,
): Promise<NotificationChannelWithSecret> {
  const input = createNotificationChannelSchema.parse(raw);
  if (input.type === "webhook")
    await assertSafeOutboundUrl(input.destination, {
      allowPrivate: process.env.NODE_ENV !== "production",
      purpose: "webhook",
    });
  const secret =
    input.type === "webhook"
      ? `ntf_${crypto.randomBytes(32).toString("base64url")}`
      : undefined;
  const encrypted = secret
    ? encryptSecret(secret, "notification-channel")
    : undefined;
  const rows = await query<ChannelRow>(
    `INSERT INTO notification_channels(tenant_id,name,type,destination,enabled,config,created_by,
      secret_ciphertext,secret_iv,secret_tag,secret_key_version)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [
      input.tenantId,
      input.name,
      input.type,
      input.destination,
      input.enabled,
      JSON.stringify(channelConfigSchema.parse(input.config)),
      actorId,
      encrypted?.ciphertext ?? null,
      encrypted?.iv ?? null,
      encrypted?.tag ?? null,
      encrypted?.keyVersion ?? null,
    ],
  );
  return { ...mapChannel(rows[0]), signingSecret: secret };
}
export async function updateNotificationChannel(
  id: string,
  raw: unknown,
): Promise<NotificationChannel> {
  const input = updateNotificationChannelSchema.parse(raw);
  const current = await getNotificationChannel(id);
  const next = {
    ...current,
    ...input,
    config: { ...current.config, ...input.config },
  };
  const validated = createNotificationChannelSchema.parse(next);
  if (validated.type === "webhook")
    await assertSafeOutboundUrl(validated.destination, {
      allowPrivate: process.env.NODE_ENV !== "production",
      purpose: "webhook",
    });
  const rows = await query<ChannelRow>(
    `UPDATE notification_channels SET name=$2,type=$3,destination=$4,enabled=$5,config=$6,updated_at=now()
     WHERE id=$1 RETURNING *`,
    [
      id,
      validated.name,
      validated.type,
      validated.destination,
      validated.enabled,
      JSON.stringify(channelConfigSchema.parse(validated.config)),
    ],
  );
  return mapChannel(rows[0]);
}
export async function rotateNotificationSecret(
  id: string,
): Promise<{ signingSecret: string }> {
  const channel = await getNotificationChannel(id);
  if (channel.type !== "webhook")
    throw new AppError(400, "CHANNEL_HAS_NO_SECRET", "邮件渠道没有签名密钥。");
  const signingSecret = `ntf_${crypto.randomBytes(32).toString("base64url")}`;
  const encrypted = encryptSecret(signingSecret, "notification-channel");
  await query(
    `UPDATE notification_channels SET secret_ciphertext=$2,secret_iv=$3,secret_tag=$4,
    secret_key_version=$5,updated_at=now() WHERE id=$1`,
    [
      id,
      encrypted.ciphertext,
      encrypted.iv,
      encrypted.tag,
      encrypted.keyVersion,
    ],
  );
  return { signingSecret };
}
export async function deleteNotificationChannel(id: string): Promise<void> {
  await getNotificationChannel(id);
  await query("DELETE FROM notification_channels WHERE id=$1", [id]);
}

const recordSelect = `SELECT n.*,c.name AS channel_name FROM notification_records n
  LEFT JOIN notification_channels c ON c.id=n.channel_id`;
export async function searchNotifications(
  raw: unknown,
): Promise<Page<NotificationRecord>> {
  const input = notificationQuerySchema.parse(raw);
  const values: unknown[] = [],
    clauses: string[] = [];
  const add = (column: string, value: unknown) => {
    values.push(value);
    clauses.push(`${column}=$${values.length}`);
  };
  if (input.tenantId) add("n.tenant_id", input.tenantId);
  if (input.channelId) add("n.channel_id", input.channelId);
  if (input.status) add("n.status", input.status);
  if (input.eventType) add("n.event_type", input.eventType);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const totals = await query<{ count: string }>(
    `SELECT count(*) FROM notification_records n ${where}`,
    values,
  );
  const pageValues = [...values, input.pageSize, offsetOf(input)];
  const rows = await query<RecordRow>(
    `${recordSelect} ${where} ORDER BY n.created_at DESC LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`,
    pageValues,
  );
  return pageResult(rows.map(mapRecord), Number(totals[0].count), input);
}
export async function getNotificationRecord(
  id: number,
): Promise<NotificationRecord> {
  const rows = await query<RecordRow>(`${recordSelect} WHERE n.id=$1`, [id]);
  if (!rows[0]) throw new NotFoundError("通知记录", String(id));
  return mapRecord(rows[0]);
}

export async function enqueueAlertNotifications(
  input: {
    tenantId?: string;
    alertEventId: number;
    eventType: (typeof eventTypes)[number];
    payload: Record<string, unknown>;
  },
  client?: PoolClient,
): Promise<number> {
  const execute = client
    ? async <T extends Record<string, unknown>>(
        text: string,
        values: unknown[],
      ) => (await client.query<T>(text, values)).rows
    : query;
  await execute(
    `INSERT INTO notification_records(tenant_id,alert_event_id,channel,event_type,status,payload,sent_at,delivered_at)
    VALUES($1,$2,'console',$3,'sent',$4,now(),now())`,
    [
      input.tenantId ?? null,
      input.alertEventId,
      input.eventType,
      JSON.stringify(input.payload),
    ],
  );
  if (!input.tenantId) return 1;
  const channels = (
    await execute<ChannelRow>(
      "SELECT * FROM notification_channels WHERE tenant_id=$1 ORDER BY created_at DESC",
      [input.tenantId],
    )
  ).map(mapChannel);
  let enqueued = 1;
  for (const channel of channels.filter((item) => item.enabled)) {
    await execute(
      `INSERT INTO notification_records(tenant_id,alert_event_id,channel_id,channel,destination,event_type,status,payload,max_attempts)
      VALUES($1,$2,$3,$4,$5,$6,'pending',$7,$8)`,
      [
        input.tenantId,
        input.alertEventId,
        channel.id,
        channel.type,
        channel.destination,
        input.eventType,
        JSON.stringify(input.payload),
        channel.config.maxAttempts,
      ],
    );
    enqueued++;
  }
  return enqueued;
}

export async function enqueueNotificationTest(
  tenantId: string,
  channelId: string,
): Promise<NotificationRecord> {
  const channel = await getNotificationChannel(channelId);
  if (channel.tenantId !== tenantId)
    throw new NotFoundError("通知渠道", channelId);
  const inserted = await query<{ id: string }>(
    `INSERT INTO notification_records(tenant_id,channel_id,channel,destination,event_type,status,payload,max_attempts)
     VALUES($1,$2,$3,$4,'alert.triggered','pending',$5,$6) RETURNING id`,
    [
      tenantId,
      channelId,
      channel.type,
      channel.destination,
      JSON.stringify({
        message: "这是一条 A2A Agent 平台测试通知。",
        channelId,
        createdAt: new Date().toISOString(),
      }),
      channel.config.maxAttempts,
    ],
  );
  const rows = await query<RecordRow>(`${recordSelect} WHERE n.id=$1`, [
    inserted[0].id,
  ]);
  return mapRecord(rows[0]);
}

function signingSecret(row: ChannelRow): string | undefined {
  if (
    !row.secret_ciphertext ||
    !row.secret_iv ||
    !row.secret_tag ||
    !row.secret_key_version
  )
    return undefined;
  return decryptSecret(
    {
      ciphertext: row.secret_ciphertext,
      iv: row.secret_iv,
      tag: row.secret_tag,
      keyVersion: row.secret_key_version,
    },
    "notification-channel",
  );
}
async function deliver(
  record: RecordRow,
  channel: ChannelRow,
): Promise<{ status?: number; body?: string }> {
  const channelConfig = channelConfigSchema.parse(channel.config);
  if (channel.type === "email") {
    if (!(await getSettingValue("notifications.emailEnabled", false)))
      throw new AppError(
        503,
        "EMAIL_NOTIFICATIONS_DISABLED",
        "邮件通知已在平台设置中关闭。",
      );
    if (!config.smtpUrl)
      throw new AppError(503, "SMTP_NOT_CONFIGURED", "SMTP_URL 尚未配置。");
    const payload = record.payload;
    const transport = nodemailer.createTransport(config.smtpUrl);
    await transport.sendMail({
      to: channel.destination,
      from: process.env.SMTP_FROM ?? "a2a-platform@localhost",
      subject: `${channelConfig.subjectPrefix} ${record.event_type ?? "平台通知"}`,
      text: `${String(payload.message ?? "平台事件通知")}\n\n${JSON.stringify(payload, null, 2)}`,
    });
    return {};
  }
  await assertSafeOutboundUrl(channel.destination, {
    allowPrivate: process.env.NODE_ENV !== "production",
    purpose: "webhook",
  });
  const body = JSON.stringify({
    id: record.id,
    type: record.event_type,
    occurredAt: record.created_at.toISOString(),
    data: record.payload,
  });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const secret = signingSecret(channel);
  const signature = secret
    ? crypto
        .createHmac("sha256", secret)
        .update(`${timestamp}.${body}`)
        .digest("hex")
    : undefined;
  const response = await secureFetch(channel.destination, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "a2a-agent-platform-notifier/1.0",
      "x-a2a-timestamp": timestamp,
      ...(signature ? { "x-a2a-signature": `sha256=${signature}` } : {}),
    },
    body,
    signal: AbortSignal.timeout(channelConfig.timeoutMs),
    redirect: "manual",
  });
  const responseBody = await readLimitedResponseText(response, 4096, false);
  if (!response.ok)
    throw new AppError(
      502,
      "NOTIFICATION_REJECTED",
      `通知端点返回 ${response.status}。`,
      { responseStatus: response.status, responseBody },
    );
  return { status: response.status, body: responseBody };
}

export async function processNotificationBatch(limit = 25): Promise<{
  processed: number;
  sent: number;
  retried: number;
  failed: number;
}> {
  const result = { processed: 0, sent: 0, retried: 0, failed: 0 };
  for (let index = 0; index < limit; index++) {
    const client = await pool.connect();
    let record: RecordRow | undefined;
    try {
      await client.query("BEGIN");
      const selected = await client.query<RecordRow>(`${recordSelect} WHERE
        ((n.status IN ('pending','retrying') AND n.next_attempt_at<=now()) OR
         (n.status='delivering' AND n.delivery_lease_until<now()))
        ORDER BY n.next_attempt_at,n.id FOR UPDATE OF n SKIP LOCKED LIMIT 1`);
      record = selected.rows[0];
      if (!record) {
        await client.query("ROLLBACK");
        break;
      }
      await client.query(
        `UPDATE notification_records SET status='delivering',attempt=attempt+1,
         delivery_owner=$2,delivery_lease_until=now()+interval '2 minutes',updated_at=now() WHERE id=$1`,
        [record.id, notificationWorkerId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    result.processed++;
    const channels = record.channel_id
      ? await query<ChannelRow>(
          "SELECT * FROM notification_channels WHERE id=$1",
          [record.channel_id],
        )
      : [];
    const channel = channels[0];
    if (!channel?.enabled) {
      await query(
        `UPDATE notification_records SET status='suppressed',error_message='通知渠道已删除或停用',
         delivery_owner=NULL,delivery_lease_until=NULL,updated_at=now() WHERE id=$1 AND delivery_owner=$2`,
        [record.id, notificationWorkerId],
      );
      result.failed++;
      continue;
    }
    try {
      const response = await deliver(
        { ...record, attempt: record.attempt + 1 },
        channel,
      );
      await query(
        `UPDATE notification_records SET status='sent',response_status=$2,response_body=$3,
        delivered_at=now(),sent_at=now(),error_message=NULL,delivery_owner=NULL,
        delivery_lease_until=NULL,updated_at=now() WHERE id=$1 AND delivery_owner=$4`,
        [
          record.id,
          response.status ?? null,
          response.body ?? null,
          notificationWorkerId,
        ],
      );
      await query(
        "UPDATE notification_channels SET last_delivery_at=now(),updated_at=now() WHERE id=$1",
        [channel.id],
      );
      if (record.tenant_id)
        await publishTenantEvent(record.tenant_id, {
          type: "notification.sent",
          notificationId: Number(record.id),
          channelId: channel.id,
        });
      result.sent++;
    } catch (error) {
      const attempt = record.attempt + 1;
      const failed = attempt >= record.max_attempts;
      const delay = Math.min(3600, 2 ** Math.min(attempt, 10) * 5);
      const details = error instanceof AppError ? error.details : undefined;
      await query(
        `UPDATE notification_records SET status=$2,error_message=$3,response_status=$4,response_body=$5,
        next_attempt_at=now()+($6::text||' seconds')::interval,delivery_owner=NULL,
        delivery_lease_until=NULL,updated_at=now() WHERE id=$1 AND delivery_owner=$7`,
        [
          record.id,
          failed ? "failed" : "retrying",
          error instanceof Error ? error.message : String(error),
          typeof details?.responseStatus === "number"
            ? details.responseStatus
            : null,
          typeof details?.responseBody === "string"
            ? details.responseBody
            : null,
          delay,
          notificationWorkerId,
        ],
      );
      if (failed) result.failed++;
      else result.retried++;
      if (record.tenant_id)
        await publishTenantEvent(record.tenant_id, {
          type: failed ? "notification.failed" : "notification.retrying",
          notificationId: Number(record.id),
          channelId: channel.id,
          attempt,
        });
    }
  }
  return result;
}

export async function replayNotification(
  id: number,
): Promise<NotificationRecord> {
  const rows = await query<RecordRow>(`${recordSelect} WHERE n.id=$1`, [id]);
  if (!rows[0]) throw new NotFoundError("通知记录", String(id));
  if (!rows[0].channel_id)
    throw new AppError(
      400,
      "CONSOLE_NOTIFICATION_NOT_REPLAYABLE",
      "控制台通知无需重放。",
    );
  await query(
    `UPDATE notification_records SET status='pending',attempt=0,next_attempt_at=now(),error_message=NULL,
     delivery_owner=NULL,delivery_lease_until=NULL,updated_at=now() WHERE id=$1`,
    [id],
  );
  return mapRecord({
    ...rows[0],
    status: "pending",
    attempt: 0,
    error_message: null,
  });
}
