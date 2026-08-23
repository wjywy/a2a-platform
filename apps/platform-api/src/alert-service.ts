import crypto from "node:crypto";
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
import { enqueuePlatformEvent } from "./webhook-service.js";
import { enqueueAlertNotifications } from "./notification-service.js";
import { publishTenantEvent } from "./redis.js";

export const alertMetrics = [
  "agent_unhealthy",
  "request_error_rate",
  "latency_ms",
  "quota_usage_percent",
] as const;
export const alertSeverities = ["info", "warning", "critical"] as const;

export const createAlertRuleSchema = z.object({
  tenantId: z.string().uuid().nullable().optional(),
  agentId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(2).max(100),
  metric: z.enum(alertMetrics),
  operator: z.enum(["gt", "lt"]),
  threshold: z.number().nonnegative(),
  windowMinutes: z.number().int().min(1).max(1440).default(5),
  severity: z.enum(alertSeverities).default("warning"),
  cooldownMinutes: z.number().int().min(1).max(10080).default(15),
  enabled: z.boolean().default(true),
});
export const updateAlertRuleSchema = createAlertRuleSchema
  .omit({ tenantId: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "至少提供一个可更新字段。");
export const alertEventQuerySchema = paginationSchema.extend({
  tenantId: z.string().uuid().optional(),
  status: z.enum(["open", "acknowledged", "silenced", "resolved"]).optional(),
  severity: z.enum(alertSeverities).optional(),
  ruleId: z.string().uuid().optional(),
});

export type AlertRule = {
  id: string;
  tenantId?: string;
  agentId?: string;
  name: string;
  metric: (typeof alertMetrics)[number];
  operator: "gt" | "lt";
  threshold: number;
  windowMinutes: number;
  severity: (typeof alertSeverities)[number];
  cooldownMinutes: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};
export type AlertEvent = {
  id: number;
  ruleId: string;
  ruleName: string;
  tenantId?: string;
  status: "open" | "acknowledged" | "silenced" | "resolved";
  value: number;
  message: string;
  fingerprint: string;
  severity: (typeof alertSeverities)[number];
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  silencedUntil?: string;
  metadata: Record<string, unknown>;
  openedAt: string;
  resolvedAt?: string;
  updatedAt: string;
};

type RuleRow = {
  id: string;
  tenant_id: string | null;
  agent_id: string | null;
  name: string;
  metric: AlertRule["metric"];
  operator: "gt" | "lt";
  threshold: string;
  window_minutes: number;
  severity: AlertRule["severity"];
  cooldown_minutes: number;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
};
type EventRow = {
  id: string;
  rule_id: string;
  rule_name: string;
  tenant_id: string | null;
  status: AlertEvent["status"];
  value: string;
  message: string;
  fingerprint: string;
  severity: AlertEvent["severity"];
  acknowledged_by: string | null;
  acknowledged_at: Date | null;
  silenced_until: Date | null;
  metadata: Record<string, unknown>;
  opened_at: Date;
  resolved_at: Date | null;
  updated_at: Date;
};
const mapRule = (r: RuleRow): AlertRule => ({
  id: r.id,
  tenantId: r.tenant_id ?? undefined,
  agentId: r.agent_id ?? undefined,
  name: r.name,
  metric: r.metric,
  operator: r.operator,
  threshold: Number(r.threshold),
  windowMinutes: r.window_minutes,
  severity: r.severity,
  cooldownMinutes: r.cooldown_minutes,
  enabled: r.enabled,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});
const mapEvent = (r: EventRow): AlertEvent => ({
  id: Number(r.id),
  ruleId: r.rule_id,
  ruleName: r.rule_name,
  tenantId: r.tenant_id ?? undefined,
  status: r.status,
  value: Number(r.value),
  message: r.message,
  fingerprint: r.fingerprint,
  severity: r.severity,
  acknowledgedBy: r.acknowledged_by ?? undefined,
  acknowledgedAt: r.acknowledged_at?.toISOString(),
  silencedUntil: r.silenced_until?.toISOString(),
  metadata: r.metadata,
  openedAt: r.opened_at.toISOString(),
  resolvedAt: r.resolved_at?.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

async function assertAlertAgentScope(
  agentId: string | undefined,
  tenantId: string | undefined,
): Promise<void> {
  if (!agentId) return;
  const agents = await query<{ tenant_id: string | null }>(
    "SELECT tenant_id FROM agents WHERE id=$1 AND deleted_at IS NULL",
    [agentId],
  );
  if (!agents[0]) throw new NotFoundError("Agent", agentId);
  if (tenantId && agents[0].tenant_id !== tenantId)
    throw new AppError(
      400,
      "ALERT_AGENT_TENANT_MISMATCH",
      "告警规则的 Agent 不属于所选租户。",
    );
}

export async function listAlertRules(tenantId?: string): Promise<AlertRule[]> {
  const rows = tenantId
    ? await query<RuleRow>(
        "SELECT * FROM alert_rules WHERE tenant_id=$1 ORDER BY created_at DESC",
        [tenantId],
      )
    : await query<RuleRow>(
        "SELECT * FROM alert_rules ORDER BY created_at DESC",
      );
  return rows.map(mapRule);
}
export async function getAlertRule(id: string): Promise<AlertRule> {
  const rows = await query<RuleRow>("SELECT * FROM alert_rules WHERE id=$1", [
    id,
  ]);
  if (!rows[0]) throw new NotFoundError("告警规则", id);
  return mapRule(rows[0]);
}
export async function createAlertRule(
  raw: unknown,
  actorId: string,
): Promise<AlertRule> {
  const input = createAlertRuleSchema.parse(raw);
  await assertAlertAgentScope(
    input.agentId ?? undefined,
    input.tenantId ?? undefined,
  );
  const rows = await query<RuleRow>(
    `INSERT INTO alert_rules(tenant_id,agent_id,name,metric,operator,threshold,window_minutes,
    severity,cooldown_minutes,enabled,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [
      input.tenantId ?? null,
      input.agentId ?? null,
      input.name,
      input.metric,
      input.operator,
      input.threshold,
      input.windowMinutes,
      input.severity,
      input.cooldownMinutes,
      input.enabled,
      actorId,
    ],
  );
  return mapRule(rows[0]);
}
export async function updateAlertRule(
  id: string,
  raw: unknown,
  actorId: string,
): Promise<AlertRule> {
  const input = updateAlertRuleSchema.parse(raw);
  const current = await getAlertRule(id);
  const next = { ...current, ...input };
  await assertAlertAgentScope(
    next.agentId ?? undefined,
    next.tenantId ?? undefined,
  );
  const rows = await query<RuleRow>(
    `UPDATE alert_rules SET agent_id=$2,
    name=$3,metric=$4,operator=$5,threshold=$6,window_minutes=$7,severity=$8,cooldown_minutes=$9,enabled=$10,
    updated_by=$11,updated_at=now() WHERE id=$1 RETURNING *`,
    [
      id,
      next.agentId ?? null,
      next.name,
      next.metric,
      next.operator,
      next.threshold,
      next.windowMinutes,
      next.severity,
      next.cooldownMinutes,
      next.enabled,
      actorId,
    ],
  );
  return mapRule(rows[0]);
}
export async function deleteAlertRule(id: string): Promise<void> {
  await getAlertRule(id);
  await query("DELETE FROM alert_rules WHERE id=$1", [id]);
}

export async function searchAlertEvents(
  raw: unknown,
): Promise<Page<AlertEvent>> {
  const input = alertEventQuerySchema.parse(raw);
  const values: unknown[] = [];
  const clauses: string[] = [];
  const add = (c: string, v: unknown) => {
    values.push(v);
    clauses.push(`${c}=$${values.length}`);
  };
  if (input.tenantId) add("e.tenant_id", input.tenantId);
  if (input.status) add("e.status", input.status);
  if (input.severity) add("e.severity", input.severity);
  if (input.ruleId) add("e.rule_id", input.ruleId);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const total = await query<{ count: string }>(
    `SELECT count(*) FROM alert_events e ${where}`,
    values,
  );
  values.push(input.pageSize, offsetOf(input));
  const rows = await query<EventRow>(
    `SELECT e.*,r.name AS rule_name FROM alert_events e JOIN alert_rules r ON r.id=e.rule_id ${where}
    ORDER BY e.opened_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return pageResult(rows.map(mapEvent), Number(total[0].count), input);
}
export async function getAlertEvent(id: number): Promise<AlertEvent> {
  const rows = await query<EventRow>(
    `SELECT e.*,r.name AS rule_name FROM alert_events e
     JOIN alert_rules r ON r.id=e.rule_id WHERE e.id=$1`,
    [id],
  );
  if (!rows[0]) throw new NotFoundError("告警事件", String(id));
  return mapEvent(rows[0]);
}
export async function acknowledgeAlert(
  id: number,
  actorId: string,
): Promise<AlertEvent> {
  const rows = await query<EventRow>(
    `UPDATE alert_events e
    SET status='acknowledged',acknowledged_by=$2,acknowledged_at=now(),updated_at=now() FROM alert_rules r
    WHERE e.id=$1 AND r.id=e.rule_id AND e.status IN ('open','silenced') RETURNING e.*,r.name AS rule_name`,
    [id, actorId],
  );
  if (!rows[0]) throw new NotFoundError("告警事件", String(id));
  return mapEvent(rows[0]);
}
export async function silenceAlert(
  id: number,
  minutes: number,
): Promise<AlertEvent> {
  if (minutes < 1 || minutes > 10080)
    throw new AppError(
      400,
      "SILENCE_DURATION_INVALID",
      "静默时长须在 1 到 10080 分钟之间。",
    );
  const rows = await query<EventRow>(
    `UPDATE alert_events e SET status='silenced',silenced_until=now()+($2::text||' minutes')::interval,
    updated_at=now() FROM alert_rules r WHERE e.id=$1 AND r.id=e.rule_id AND e.status<>'resolved' RETURNING e.*,r.name AS rule_name`,
    [id, minutes],
  );
  if (!rows[0]) throw new NotFoundError("活动告警事件", String(id));
  return mapEvent(rows[0]);
}

async function metricValue(rule: AlertRule): Promise<number> {
  const values: unknown[] = [rule.windowMinutes];
  const usageClauses: string[] = [];
  if (rule.tenantId) {
    values.push(rule.tenantId);
    usageClauses.push(`tenant_id=$${values.length}`);
  }
  if (rule.agentId) {
    values.push(rule.agentId);
    usageClauses.push(`agent_id=$${values.length}`);
  }
  const usageFilter = usageClauses.length
    ? ` AND ${usageClauses.join(" AND ")}`
    : "";
  if (rule.metric === "agent_unhealthy") {
    const agentValues: unknown[] = [];
    const agentClauses = ["deleted_at IS NULL", "health_status='unhealthy'"];
    if (rule.tenantId) {
      agentValues.push(rule.tenantId);
      agentClauses.push(`tenant_id=$${agentValues.length}`);
    }
    if (rule.agentId) {
      agentValues.push(rule.agentId);
      agentClauses.push(`id=$${agentValues.length}`);
    }
    const r = await query<{ value: string }>(
      `SELECT count(*) AS value FROM agents WHERE ${agentClauses.join(" AND ")}`,
      agentValues,
    );
    return Number(r[0].value);
  }
  if (rule.metric === "request_error_rate") {
    const r = await query<{ value: string }>(
      `SELECT coalesce(avg(CASE WHEN status_code>=400 THEN 100 ELSE 0 END),0) AS value
    FROM usage_records WHERE created_at>now()-($1::text||' minutes')::interval${usageFilter}`,
      values,
    );
    return Number(r[0].value);
  }
  if (rule.metric === "latency_ms") {
    const r = await query<{ value: string }>(
      `SELECT coalesce(avg(latency_ms),0) AS value FROM usage_records
    WHERE created_at>now()-($1::text||' minutes')::interval${usageFilter}`,
      values,
    );
    return Number(r[0].value);
  }
  if (!rule.tenantId) return 0;
  const quotaValues: unknown[] = [rule.tenantId];
  const agentJoin = rule.agentId
    ? ` AND u.agent_id=$${quotaValues.push(rule.agentId)}`
    : "";
  const r = await query<{ value: string }>(
    `SELECT CASE WHEN t.monthly_request_limit=0 THEN 0 ELSE
    count(u.id)*100.0/t.monthly_request_limit END AS value FROM tenants t LEFT JOIN usage_records u ON u.tenant_id=t.id
    AND u.created_at>=date_trunc('month',now())${agentJoin} WHERE t.id=$1 GROUP BY t.monthly_request_limit`,
    quotaValues,
  );
  return Number(r[0]?.value ?? 0);
}
function comparison(rule: AlertRule, value: number): boolean {
  return rule.operator === "gt"
    ? value > rule.threshold
    : value < rule.threshold;
}
function fingerprint(rule: AlertRule): string {
  return crypto
    .createHash("sha256")
    .update(`${rule.id}:${rule.tenantId ?? "platform"}:${rule.agentId ?? "*"}`)
    .digest("hex");
}

export async function evaluateAlertRules(): Promise<{
  evaluated: number;
  triggered: number;
  resolved: number;
}> {
  const rules = (await listAlertRules()).filter((r) => r.enabled);
  const result = { evaluated: rules.length, triggered: 0, resolved: 0 };
  for (const rule of rules) {
    const value = await metricValue(rule);
    const triggered = comparison(rule, value);
    const active = await query<{
      id: string;
      status: AlertEvent["status"];
      silenced_until: Date | null;
    }>(
      `SELECT id,status,silenced_until FROM alert_events
      WHERE rule_id=$1 AND status<>'resolved' ORDER BY opened_at DESC LIMIT 1`,
      [rule.id],
    );
    const recent = await query<{ resolved_at: Date | null }>(
      `SELECT resolved_at FROM alert_events WHERE rule_id=$1 AND status='resolved'
       ORDER BY resolved_at DESC NULLS LAST LIMIT 1`,
      [rule.id],
    );
    const cooldownActive = Boolean(
      recent[0]?.resolved_at &&
      recent[0].resolved_at.getTime() + rule.cooldownMinutes * 60_000 >
        Date.now(),
    );
    if (triggered && !active[0] && !cooldownActive) {
      const message = `${rule.name}：${rule.metric} 当前值 ${value.toFixed(2)}，阈值 ${rule.operator} ${rule.threshold}`;
      const alertClient = await pool.connect();
      let alertEventId: number;
      try {
        await alertClient.query("BEGIN");
        const rows = await alertClient.query<{ id: string }>(
          `INSERT INTO alert_events(rule_id,tenant_id,status,value,message,fingerprint,severity,metadata)
           VALUES($1,$2,'open',$3,$4,$5,$6,$7) RETURNING id`,
          [
            rule.id,
            rule.tenantId ?? null,
            value,
            message,
            fingerprint(rule),
            rule.severity,
            JSON.stringify({
              metric: rule.metric,
              windowMinutes: rule.windowMinutes,
            }),
          ],
        );
        alertEventId = Number(rows.rows[0].id);
        await enqueueAlertNotifications(
          {
            tenantId: rule.tenantId,
            alertEventId,
            eventType: "alert.triggered",
            payload: {
              alertEventId,
              ruleId: rule.id,
              ruleName: rule.name,
              message,
              value,
              severity: rule.severity,
            },
          },
          alertClient,
        );
        await alertClient.query("COMMIT");
      } catch (error) {
        await alertClient.query("ROLLBACK");
        throw error;
      } finally {
        alertClient.release();
      }
      if (rule.tenantId)
        await publishTenantEvent(rule.tenantId, {
          type: "alert.triggered",
          alertEventId,
          ruleId: rule.id,
          severity: rule.severity,
          value,
        });
      if (rule.tenantId)
        await enqueuePlatformEvent({
          type: "agent.degraded",
          tenantId: rule.tenantId,
          agentId: rule.agentId,
          data: {
            alertEventId,
            ruleId: rule.id,
            message,
            value,
            severity: rule.severity,
          },
        });
      result.triggered++;
    } else if (triggered && active[0]) {
      const silenceExpired =
        active[0].status === "silenced" &&
        active[0].silenced_until &&
        active[0].silenced_until <= new Date();
      await query(
        `UPDATE alert_events SET value=$2,status=CASE WHEN $3 THEN 'open' ELSE status END,
         silenced_until=CASE WHEN $3 THEN NULL ELSE silenced_until END,updated_at=now() WHERE id=$1`,
        [active[0].id, value, Boolean(silenceExpired)],
      );
    } else if (!triggered && active[0]) {
      const alertClient = await pool.connect();
      try {
        await alertClient.query("BEGIN");
        await alertClient.query(
          `UPDATE alert_events SET status='resolved',resolved_at=now(),updated_at=now() WHERE id=$1`,
          [active[0].id],
        );
        await enqueueAlertNotifications(
          {
            tenantId: rule.tenantId,
            alertEventId: Number(active[0].id),
            eventType: "alert.recovered",
            payload: {
              alertEventId: Number(active[0].id),
              ruleId: rule.id,
              ruleName: rule.name,
              message: `${rule.name} 已恢复，当前值 ${value.toFixed(2)}`,
              value,
              severity: rule.severity,
            },
          },
          alertClient,
        );
        await alertClient.query("COMMIT");
      } catch (error) {
        await alertClient.query("ROLLBACK");
        throw error;
      } finally {
        alertClient.release();
      }
      if (rule.tenantId)
        await publishTenantEvent(rule.tenantId, {
          type: "alert.recovered",
          alertEventId: Number(active[0].id),
          ruleId: rule.id,
          severity: rule.severity,
          value,
        });
      if (rule.tenantId)
        await enqueuePlatformEvent({
          type: "agent.recovered",
          tenantId: rule.tenantId,
          agentId: rule.agentId,
          data: { alertEventId: Number(active[0].id), ruleId: rule.id, value },
        });
      result.resolved++;
    }
  }
  return result;
}
