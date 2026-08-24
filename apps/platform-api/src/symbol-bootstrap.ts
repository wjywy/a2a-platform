import { AgentCard } from "@a2a-js/sdk";
import { config } from "./config.js";
import { query } from "./db.js";
import { encryptCredential } from "./credential-service.js";
import { symbolAgentSlugs, symbolCard } from "./symbol-service.js";

/** Registers/upgrades the bundled examples without ever overwriting user agents. */
export async function ensureSymbolBuiltinAgents(): Promise<void> {
  if (!config.symbolInternalToken) {
    console.warn("SYMBOL_INTERNAL_TOKEN is absent; built-in Symbol agents are not registered.");
    return;
  }
  const tenant = await query<{ id: string }>("SELECT id FROM tenants WHERE slug='default' AND status='active'");
  if (!tenant[0]) throw new Error("默认租户不存在，无法注册内置 Symbol Agent。");
  const encrypted = encryptCredential({ type: "bearer", token: config.symbolInternalToken });
  for (const slug of symbolAgentSlugs) {
    const card = AgentCard.toJSON(AgentCard.fromJSON(symbolCard(slug))) as {
      name: string; description: string; supportedInterfaces?: Array<Record<string, unknown>>;
    };
    const selected = card.supportedInterfaces?.[0] as { url: string; protocolBinding: string; protocolVersion: string } | undefined;
    if (!selected) throw new Error(`内置 Agent ${slug} 缺少 HTTP+JSON 接口。`);
    const rows = await query<{ id: string }>(
      `INSERT INTO agents(slug,display_name,description,card_url,card_snapshot,selected_interface,status,health_status,labels,tenant_id,visibility,allowed_tenant_ids,invocation_policy,routing_strategy)
       VALUES($1,$2,$3,$4,$5,$6,'online','healthy',$7,$8,'public','[]'::jsonb,$9,'weighted_round_robin')
       ON CONFLICT(slug) DO UPDATE SET display_name=EXCLUDED.display_name,description=EXCLUDED.description,card_url=EXCLUDED.card_url,card_snapshot=EXCLUDED.card_snapshot,selected_interface=EXCLUDED.selected_interface,labels=EXCLUDED.labels,status='online',health_status='healthy',tenant_id=EXCLUDED.tenant_id,visibility='public',updated_at=now()
       RETURNING id`,
      [slug, card.name, card.description, `${config.platformOrigin}/api/builtin/symbol/${slug}/.well-known/agent-card.json`, JSON.stringify(card), JSON.stringify(selected), JSON.stringify(["symbol", "finance", "built-in"]), tenant[0].id, JSON.stringify({ timeoutMs: 60_000, maxRetries: 0, maxConcurrent: 20 })],
    );
    const agentId = rows[0].id;
    await query(
      `INSERT INTO agent_instances(agent_id,name,card_url,selected_interface,status,health_status,credential_ciphertext,credential_iv,credential_tag,credential_key_version,last_health_at)
       VALUES($1,'built-in',$2,$3,'active','healthy',$4,$5,$6,$7,now())
       ON CONFLICT(agent_id,name) DO UPDATE SET card_url=EXCLUDED.card_url,selected_interface=EXCLUDED.selected_interface,status='active',health_status='healthy',credential_ciphertext=EXCLUDED.credential_ciphertext,credential_iv=EXCLUDED.credential_iv,credential_tag=EXCLUDED.credential_tag,credential_key_version=EXCLUDED.credential_key_version,last_health_at=now(),last_error=NULL,updated_at=now()`,
      [agentId, `${config.platformOrigin}/api/builtin/symbol/${slug}/.well-known/agent-card.json`, JSON.stringify(selected), encrypted?.ciphertext ?? null, encrypted?.iv ?? null, encrypted?.tag ?? null, encrypted?.keyVersion ?? null],
    );
  }
  console.log(`Registered ${symbolAgentSlugs.length} built-in Symbol A2A agents.`);
}
