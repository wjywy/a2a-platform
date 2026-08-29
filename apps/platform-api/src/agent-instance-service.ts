import { z } from "zod";
import { pool, query } from "./db.js";
import { AppError, ConflictError, NotFoundError } from "./domain.js";
import {
  isTrustedSymbolInternalUrl,
  symbolUpstreamUrl,
  validateRemoteAgent,
} from "./agent-service.js";
import {
  credentialHeaders,
  credentialSummary,
  decryptCredential,
  encryptCredential,
  upstreamCredentialSchema,
  type UpstreamCredential,
} from "./credential-service.js";
import {
  allowPrivateOutboundTargets,
  assertSafeOutboundUrl,
} from "./url-policy.js";
import { secureFetch } from "./secure-fetch.js";
import type { PlatformAgent } from "./types.js";

export const createInstanceSchema = z.object({
  name: z.string().trim().min(1).max(80),
  cardUrl: z.string().url(),
  weight: z.number().int().min(1).max(10000).default(100),
  priority: z.number().int().min(0).max(10000).default(100),
  status: z.enum(["active", "draining", "disabled"]).default("active"),
  credential: upstreamCredentialSchema.default({ type: "none" }),
});
export const updateInstanceSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    cardUrl: z.string().url().optional(),
    weight: z.number().int().min(1).max(10000).optional(),
    priority: z.number().int().min(0).max(10000).optional(),
    status: z.enum(["active", "draining", "disabled"]).optional(),
    credential: upstreamCredentialSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "至少提供一个更新字段。");

type InstanceRow = {
  id: string;
  agent_id: string;
  name: string;
  card_url: string;
  selected_interface: AgentInstance["selectedInterface"];
  weight: number;
  priority: number;
  status: AgentInstance["status"];
  health_status: AgentInstance["healthStatus"];
  active_requests: number;
  credential_ciphertext: string | null;
  credential_iv: string | null;
  credential_tag: string | null;
  credential_key_version: string | null;
  last_health_at: Date | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
};

export type AgentInstance = {
  id: string;
  agentId: string;
  name: string;
  cardUrl: string;
  selectedInterface: {
    url: string;
    protocolBinding: string;
    protocolVersion: string;
  };
  weight: number;
  priority: number;
  status: "active" | "draining" | "disabled";
  healthStatus: "unknown" | "healthy" | "unhealthy";
  activeRequests: number;
  credential: { type: UpstreamCredential["type"]; configured: boolean };
  lastHealthAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
};

function credentialInput(row: InstanceRow) {
  return {
    credentialCiphertext: row.credential_ciphertext,
    credentialIv: row.credential_iv,
    credentialTag: row.credential_tag,
    credentialKeyVersion: row.credential_key_version,
  };
}

function mapInstance(row: InstanceRow): AgentInstance {
  return {
    id: row.id,
    agentId: row.agent_id,
    name: row.name,
    cardUrl: row.card_url,
    selectedInterface: row.selected_interface,
    weight: row.weight,
    priority: row.priority,
    status: row.status,
    healthStatus: row.health_status,
    activeRequests: row.active_requests,
    credential: credentialSummary(decryptCredential(credentialInput(row))),
    lastHealthAt: row.last_health_at?.toISOString(),
    lastError: row.last_error ?? undefined,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listAgentInstances(
  agentId: string,
): Promise<AgentInstance[]> {
  const rows = await query<InstanceRow>(
    "SELECT * FROM agent_instances WHERE agent_id=$1 ORDER BY priority,name",
    [agentId],
  );
  return rows.map(mapInstance);
}

export async function getAgentInstance(id: string): Promise<AgentInstance> {
  const rows = await query<InstanceRow>(
    "SELECT * FROM agent_instances WHERE id=$1",
    [id],
  );
  if (!rows[0]) throw new NotFoundError("Agent 实例", id);
  return mapInstance(rows[0]);
}

async function rawInstance(id: string): Promise<InstanceRow> {
  const rows = await query<InstanceRow>(
    "SELECT * FROM agent_instances WHERE id=$1",
    [id],
  );
  if (!rows[0]) throw new NotFoundError("Agent 实例", id);
  return rows[0];
}

export async function createAgentInstance(
  agent: PlatformAgent,
  raw: unknown,
): Promise<AgentInstance> {
  const input = createInstanceSchema.parse(raw);
  const validated = await validateRemoteAgent(input.cardUrl, input.credential);
  const encrypted = encryptCredential(input.credential);
  const rows = await query<InstanceRow>(
    `INSERT INTO agent_instances(agent_id,name,card_url,selected_interface,weight,priority,status,
       credential_ciphertext,credential_iv,credential_tag,credential_key_version)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [
      agent.id,
      input.name,
      input.cardUrl,
      JSON.stringify(validated.selectedInterface),
      input.weight,
      input.priority,
      input.status,
      encrypted?.ciphertext ?? null,
      encrypted?.iv ?? null,
      encrypted?.tag ?? null,
      encrypted?.keyVersion ?? null,
    ],
  );
  return mapInstance(rows[0]);
}

export async function updateAgentInstance(
  agentId: string,
  id: string,
  raw: unknown,
): Promise<AgentInstance> {
  const input = updateInstanceSchema.parse(raw);
  const current = await rawInstance(id);
  if (current.agent_id !== agentId) throw new NotFoundError("Agent 实例", id);
  const originChanged = Boolean(
    input.cardUrl &&
    new URL(input.cardUrl).origin !== new URL(current.card_url).origin,
  );
  let selected = current.selected_interface;
  if (input.cardUrl || input.credential) {
    const credential =
      input.credential ??
      (originChanged
        ? { type: "none" as const }
        : decryptCredential(credentialInput(current)));
    selected = (
      await validateRemoteAgent(input.cardUrl ?? current.card_url, credential)
    ).selectedInterface;
  }
  const encrypted =
    input.credential === undefined
      ? undefined
      : encryptCredential(input.credential);
  const rows = await query<InstanceRow>(
    `UPDATE agent_instances SET name=$3,card_url=$4,selected_interface=$5,weight=$6,priority=$7,status=$8,
       credential_ciphertext=$9,credential_iv=$10,credential_tag=$11,credential_key_version=$12,updated_at=now()
     WHERE id=$1 AND agent_id=$2 RETURNING *`,
    [
      id,
      agentId,
      input.name ?? current.name,
      input.cardUrl ?? current.card_url,
      JSON.stringify(selected),
      input.weight ?? current.weight,
      input.priority ?? current.priority,
      input.status ?? current.status,
      input.credential === undefined && !originChanged
        ? current.credential_ciphertext
        : (encrypted?.ciphertext ?? null),
      input.credential === undefined && !originChanged
        ? current.credential_iv
        : (encrypted?.iv ?? null),
      input.credential === undefined && !originChanged
        ? current.credential_tag
        : (encrypted?.tag ?? null),
      input.credential === undefined && !originChanged
        ? current.credential_key_version
        : (encrypted?.keyVersion ?? null),
    ],
  );
  return mapInstance(rows[0]);
}

export async function deleteAgentInstance(
  agentId: string,
  id: string,
): Promise<void> {
  const current = await rawInstance(id);
  if (current.agent_id !== agentId) throw new NotFoundError("Agent 实例", id);
  if (current.status !== "disabled")
    throw new ConflictError(
      "INSTANCE_MUST_BE_DISABLED",
      "删除实例前必须先停用。",
    );
  const counts = await query<{ count: string }>(
    "SELECT count(*) FROM agent_instances WHERE agent_id=$1",
    [agentId],
  );
  if (Number(counts[0].count) <= 1)
    throw new ConflictError(
      "LAST_AGENT_INSTANCE",
      "不能删除 Agent 的最后一个实例。",
    );
  await query("DELETE FROM agent_instances WHERE id=$1 AND agent_id=$2", [
    id,
    agentId,
  ]);
}

export async function credentialForInstance(
  id: string,
): Promise<UpstreamCredential> {
  return decryptCredential(credentialInput(await rawInstance(id)));
}

export async function checkAgentInstance(
  agentId: string,
  instanceId: string,
): Promise<{
  ok: boolean;
  latencyMs: number;
  error?: string;
}> {
  const row = await rawInstance(instanceId);
  if (row.agent_id !== agentId)
    throw new NotFoundError("Agent 实例", instanceId);
  const started = performance.now();
  let ok = false;
  let error: string | undefined;
  try {
    const credential = decryptCredential(credentialInput(row));
    const cardUrl = symbolUpstreamUrl(row.card_url);
    const allowPrivate =
      allowPrivateOutboundTargets() || isTrustedSymbolInternalUrl(cardUrl);
    await validateRemoteAgent(cardUrl, credential, { allowPrivate });
    const endpoint = symbolUpstreamUrl(row.selected_interface.url);
    await assertSafeOutboundUrl(endpoint, {
      purpose: "agent_card",
      allowPrivate:
        allowPrivateOutboundTargets() || isTrustedSymbolInternalUrl(endpoint),
    });
    const response = await secureFetch(endpoint, {
      method: "OPTIONS",
      redirect: "manual",
      headers: credentialHeaders(credential),
      signal: AbortSignal.timeout(10_000),
    });
    if (!(response.ok || response.status === 405))
      throw new Error(`A2A 接口返回 HTTP ${response.status}`);
    ok = true;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "实例健康检查失败";
  }
  const latencyMs = Math.round(performance.now() - started);
  await query(
    `UPDATE agent_instances SET health_status=$2,last_health_at=now(),last_error=$3,updated_at=now()
     WHERE id=$1 AND agent_id=$4`,
    [instanceId, ok ? "healthy" : "unhealthy", error ?? null, agentId],
  );
  await query(
    `INSERT INTO agent_health_checks(agent_id,instance_id,success,latency_ms,error_message,check_type)
     VALUES($1,$2,$3,$4,$5,'a2a')`,
    [row.agent_id, instanceId, ok, latencyMs, error ?? null],
  );
  await refreshAggregateHealth(row.agent_id);
  return { ok, latencyMs, error };
}

export async function refreshAggregateHealth(agentId: string): Promise<void> {
  await query(
    `UPDATE agents SET health_status=summary.health,
       status=CASE WHEN agents.status IN ('online','degraded')
         THEN CASE WHEN summary.health='unhealthy' THEN 'degraded' ELSE 'online' END
         ELSE agents.status END,
       updated_at=now()
     FROM (
       SELECT agent_id,CASE
         WHEN bool_or(status='active' AND health_status='healthy') THEN 'healthy'
         WHEN bool_or(status='active' AND health_status='unknown') THEN 'unknown'
         ELSE 'unhealthy' END AS health
       FROM agent_instances WHERE agent_id=$1 GROUP BY agent_id
     ) summary WHERE agents.id=summary.agent_id`,
    [agentId],
  );
}

export type InstanceLease = {
  instance: AgentInstance;
  release: () => Promise<void>;
};

export async function acquireAgentInstance(
  agent: PlatformAgent,
  preferredInstanceId?: string,
): Promise<InstanceLease> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE agent_instance_leases SET released_at=now()
       WHERE released_at IS NULL AND expires_at<now() AND instance_id IN
         (SELECT id FROM agent_instances WHERE agent_id=$1)`,
      [agent.id],
    );
    await client.query(
      `UPDATE agent_instances i SET active_requests=(
         SELECT count(*) FROM agent_instance_leases l
         WHERE l.instance_id=i.id AND l.released_at IS NULL AND l.expires_at>=now())
       WHERE i.agent_id=$1`,
      [agent.id],
    );
    const order =
      agent.routingStrategy === "least_connections"
        ? "active_requests ASC,priority ASC,random()"
        : agent.routingStrategy === "priority"
          ? "priority ASC,active_requests ASC,random()"
          : "(-ln(GREATEST(random(),0.000001))/weight) ASC";
    let result = preferredInstanceId
      ? await client.query<InstanceRow>(
          `SELECT * FROM agent_instances WHERE id=$1 AND agent_id=$2
           AND status IN ('active','draining') LIMIT 1 FOR UPDATE`,
          [preferredInstanceId, agent.id],
        )
      : await client.query<InstanceRow>(
          `SELECT * FROM agent_instances WHERE agent_id=$1 AND status='active' AND health_status='healthy'
           ORDER BY ${order} LIMIT 1 FOR UPDATE SKIP LOCKED`,
          [agent.id],
        );
    if (!preferredInstanceId && !result.rows[0]) {
      result = await client.query<InstanceRow>(
        `SELECT * FROM agent_instances WHERE agent_id=$1 AND status='active' AND health_status='unknown'
         ORDER BY ${order} LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [agent.id],
      );
    }
    const row = result.rows[0];
    if (!row)
      throw new AppError(
        503,
        preferredInstanceId
          ? "TASK_INSTANCE_UNAVAILABLE"
          : "AGENT_INSTANCE_UNAVAILABLE",
        preferredInstanceId
          ? "任务绑定的 Agent 实例当前不可用。"
          : "Agent 没有可用运行实例。",
      );
    const lease = await client.query<{ id: string }>(
      `INSERT INTO agent_instance_leases(instance_id,expires_at)
       VALUES($1,now()+interval '10 minutes') RETURNING id`,
      [row.id],
    );
    await client.query(
      "UPDATE agent_instances SET active_requests=active_requests+1,updated_at=now() WHERE id=$1",
      [row.id],
    );
    await client.query("COMMIT");
    const instance = mapInstance({
      ...row,
      active_requests: row.active_requests + 1,
    });
    let released = false;
    return {
      instance,
      release: async () => {
        if (released) return;
        const releaseClient = await pool.connect();
        try {
          await releaseClient.query("BEGIN");
          const changed = await releaseClient.query(
            `UPDATE agent_instance_leases SET released_at=now()
             WHERE id=$1 AND released_at IS NULL RETURNING id`,
            [lease.rows[0].id],
          );
          if (changed.rowCount)
            await releaseClient.query(
              `UPDATE agent_instances SET active_requests=GREATEST(0,active_requests-1),updated_at=now()
               WHERE id=$1`,
              [row.id],
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
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function reconcileAgentInstanceLeases(): Promise<void> {
  await query(
    "UPDATE agent_instance_leases SET released_at=now() WHERE released_at IS NULL AND expires_at<now()",
  );
  await query(
    `UPDATE agent_instances i SET active_requests=(
       SELECT count(*) FROM agent_instance_leases l
       WHERE l.instance_id=i.id AND l.released_at IS NULL AND l.expires_at>=now())`,
  );
}
