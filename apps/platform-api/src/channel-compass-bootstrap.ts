import { AgentCard } from "@a2a-js/sdk";
import { ensureAgentPolicy } from "./agent-policy-service.js";
import {
  channelCompassCard,
  channelCompassSlug,
} from "./channel-compass-service.js";
import { config } from "./config.js";
import { encryptCredential } from "./credential-service.js";
import { query } from "./db.js";

export async function ensureChannelCompassAgent(): Promise<void> {
  if (!config.channelCompassInternalToken) {
    if (process.env.NODE_ENV === "production")
      throw new Error(
        "生产环境必须配置 CHANNEL_COMPASS_INTERNAL_TOKEN 或 SYMBOL_INTERNAL_TOKEN，才能注册渠道罗盘。",
      );
    console.warn(
      "Channel Compass internal token is absent; the built-in agent is not registered.",
    );
    return;
  }
  const tenants = await query<{ id: string }>(
    "SELECT id FROM tenants WHERE slug='default' AND status='active'",
  );
  if (!tenants[0]) throw new Error("默认租户不存在，无法注册渠道罗盘。");
  const card = AgentCard.toJSON(
    AgentCard.fromJSON(channelCompassCard()),
  ) as {
    name: string;
    description: string;
    supportedInterfaces?: Array<Record<string, unknown>>;
  };
  const selectedInterface = card.supportedInterfaces?.[0];
  if (!selectedInterface)
    throw new Error("渠道罗盘 Agent Card 缺少 HTTP+JSON 接口。");
  const cardUrl = `${config.platformOrigin}/api/builtin/channel-compass/.well-known/agent-card.json`;
  const rows = await query<{ id: string }>(
    `INSERT INTO agents(
       slug,display_name,description,card_url,card_snapshot,selected_interface,
       status,health_status,labels,tenant_id,visibility,allowed_tenant_ids,
       invocation_policy,routing_strategy
     ) VALUES($1,$2,$3,$4,$5,$6,'online','healthy',$7,$8,'public','[]'::jsonb,$9,'weighted_round_robin')
     ON CONFLICT(slug) DO UPDATE SET display_name=EXCLUDED.display_name,
       description=EXCLUDED.description,card_url=EXCLUDED.card_url,
       card_snapshot=EXCLUDED.card_snapshot,
       selected_interface=EXCLUDED.selected_interface,labels=EXCLUDED.labels,
       status='online',health_status='healthy',tenant_id=EXCLUDED.tenant_id,
       visibility='public',updated_at=now()
     RETURNING id`,
    [
      channelCompassSlug,
      card.name,
      card.description,
      cardUrl,
      JSON.stringify(card),
      JSON.stringify(selectedInterface),
      JSON.stringify(["ecommerce", "channel", "analytics", "built-in"]),
      tenants[0].id,
      JSON.stringify({ timeoutMs: 60_000, maxRetries: 0, maxConcurrent: 12 }),
    ],
  );
  const agentId = rows[0].id;
  await ensureAgentPolicy(agentId, "channel-compass-bootstrap");
  const encrypted = encryptCredential({
    type: "bearer",
    token: config.channelCompassInternalToken,
  });
  await query(
    `INSERT INTO agent_instances(
       agent_id,name,card_url,selected_interface,status,health_status,
       credential_ciphertext,credential_iv,credential_tag,
       credential_key_version,last_health_at
     ) VALUES($1,'built-in',$2,$3,'active','healthy',$4,$5,$6,$7,now())
     ON CONFLICT(agent_id,name) DO UPDATE SET card_url=EXCLUDED.card_url,
       selected_interface=EXCLUDED.selected_interface,status='active',
       health_status='healthy',credential_ciphertext=EXCLUDED.credential_ciphertext,
       credential_iv=EXCLUDED.credential_iv,credential_tag=EXCLUDED.credential_tag,
       credential_key_version=EXCLUDED.credential_key_version,last_health_at=now(),
       last_error=NULL,updated_at=now()`,
    [
      agentId,
      cardUrl,
      JSON.stringify(selectedInterface),
      encrypted?.ciphertext ?? null,
      encrypted?.iv ?? null,
      encrypted?.tag ?? null,
      encrypted?.keyVersion ?? null,
    ],
  );
  console.log("Registered built-in Channel Compass A2A agent.");
}
