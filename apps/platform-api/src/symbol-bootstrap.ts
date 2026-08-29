import { AgentCard } from "@a2a-js/sdk";
import { config } from "./config.js";
import { query, transaction } from "./db.js";
import { encryptCredential } from "./credential-service.js";
import { symbolAgentSlugs, symbolCard } from "./symbol-service.js";

/**
 * The first market prototype was registered as a remote Vercel Agent Card.
 * It belongs to this product, however, and must use the in-platform runtime
 * so a stale external deployment can never leave Studio waiting indefinitely.
 */
export const legacyMarketAgentCardUrl =
  "https://traestockh2cr.vercel.app/api/a2a/market/.well-known/agent-card.json";
export const legacyMarketAgentSlug = "market";

type SerializedSymbolCard = {
  name: string;
  description: string;
  supportedInterfaces?: Array<Record<string, unknown>>;
};

type SymbolRuntime = {
  card: SerializedSymbolCard;
  cardUrl: string;
  selectedInterface: {
    url: string;
    protocolBinding: string;
    protocolVersion: string;
    tenant?: string;
  };
};

function runtimeFor(slug: (typeof symbolAgentSlugs)[number]): SymbolRuntime {
  const card = AgentCard.toJSON(
    AgentCard.fromJSON(symbolCard(slug)),
  ) as SerializedSymbolCard;
  const selected = card.supportedInterfaces?.[0] as
    SymbolRuntime["selectedInterface"] | undefined;
  if (!selected) throw new Error(`内置 Agent ${slug} 缺少 HTTP+JSON 接口。`);
  return {
    card,
    cardUrl: `${config.platformOrigin}/api/builtin/symbol/${slug}/.well-known/agent-card.json`,
    selectedInterface: selected,
  };
}

/**
 * Replaces only the platform-owned legacy record: it is in the default tenant,
 * uses the historic `market` slug, and has the exact Vercel Card URL. Other
 * customer-managed remote Agents are deliberately untouched. Its public slug
 * and Studio history stay intact while future calls use the bundled runtime.
 */
async function migrateLegacyMarketRuntime(
  runtime: SymbolRuntime,
  encrypted: ReturnType<typeof encryptCredential>,
): Promise<number> {
  const legacyAgents = await query<{ id: string }>(
    `SELECT a.id FROM agents a
     JOIN tenants t ON t.id=a.tenant_id
     WHERE a.slug=$1 AND a.card_url=$2 AND a.deleted_at IS NULL
       AND t.slug='default' AND t.status='active'`,
    [legacyMarketAgentSlug, legacyMarketAgentCardUrl],
  );
  let migrated = 0;
  for (const legacy of legacyAgents) {
    const didMigrate = await transaction(async (client) => {
      const agent = await client.query<{ id: string }>(
        `UPDATE agents
         SET card_url=$2, card_snapshot=$3, selected_interface=$4,
             status='online', health_status='healthy', version=version+1,
             updated_at=now()
         WHERE id=$1 AND slug=$5 AND card_url=$6 AND deleted_at IS NULL
         RETURNING id`,
        [
          legacy.id,
          runtime.cardUrl,
          JSON.stringify(runtime.card),
          JSON.stringify(runtime.selectedInterface),
          legacyMarketAgentSlug,
          legacyMarketAgentCardUrl,
        ],
      );
      if (!agent.rows[0]) return false;
      const instance = await client.query<{ id: string }>(
        `UPDATE agent_instances
         SET card_url=$2, selected_interface=$3, status='active',
             health_status='healthy', credential_ciphertext=$4,
             credential_iv=$5, credential_tag=$6, credential_key_version=$7,
             last_health_at=now(), last_error=NULL, updated_at=now()
         WHERE agent_id=$1 AND name='default'
         RETURNING id`,
        [
          legacy.id,
          runtime.cardUrl,
          JSON.stringify(runtime.selectedInterface),
          encrypted?.ciphertext ?? null,
          encrypted?.iv ?? null,
          encrypted?.tag ?? null,
          encrypted?.keyVersion ?? null,
        ],
      );
      const targetId = instance.rows[0]?.id ?? (
        await client.query<{ id: string }>(
          `INSERT INTO agent_instances(agent_id,name,card_url,selected_interface,status,health_status,
            credential_ciphertext,credential_iv,credential_tag,credential_key_version,last_health_at)
           VALUES($1,'built-in-market',$2,$3,'active','healthy',$4,$5,$6,$7,now())
           ON CONFLICT(agent_id,name) DO UPDATE SET card_url=EXCLUDED.card_url,
             selected_interface=EXCLUDED.selected_interface,status='active',health_status='healthy',
             credential_ciphertext=EXCLUDED.credential_ciphertext,credential_iv=EXCLUDED.credential_iv,
             credential_tag=EXCLUDED.credential_tag,credential_key_version=EXCLUDED.credential_key_version,
             last_health_at=now(),last_error=NULL,updated_at=now()
           RETURNING id`,
          [
            legacy.id,
            runtime.cardUrl,
            JSON.stringify(runtime.selectedInterface),
            encrypted?.ciphertext ?? null,
            encrypted?.iv ?? null,
            encrypted?.tag ?? null,
            encrypted?.keyVersion ?? null,
          ],
        )
      ).rows[0].id;
      await client.query(
        `UPDATE agent_instances
         SET status='disabled', health_status='unhealthy',
             last_error='已迁移至平台内置 Symbol 市场 Agent。',updated_at=now()
         WHERE agent_id=$1 AND id<>$2 AND status<>'disabled'`,
        [legacy.id, targetId],
      );
      return true;
    });
    if (didMigrate) migrated += 1;
  }
  return migrated;
}

/** Registers or upgrades bundled Agents and repairs the known legacy market runtime. */
export async function ensureSymbolBuiltinAgents(): Promise<void> {
  if (!config.symbolInternalToken) {
    console.warn(
      "SYMBOL_INTERNAL_TOKEN is absent; built-in Symbol agents are not registered.",
    );
    return;
  }
  const tenant = await query<{ id: string }>(
    "SELECT id FROM tenants WHERE slug='default' AND status='active'",
  );
  if (!tenant[0])
    throw new Error("默认租户不存在，无法注册内置 Symbol Agent。");
  const encrypted = encryptCredential({
    type: "bearer",
    token: config.symbolInternalToken,
  });
  const migrated = await migrateLegacyMarketRuntime(
    runtimeFor("symbol-market"),
    encrypted,
  );
  for (const slug of symbolAgentSlugs) {
    const runtime = runtimeFor(slug);
    const rows = await query<{ id: string }>(
      `INSERT INTO agents(slug,display_name,description,card_url,card_snapshot,selected_interface,status,health_status,labels,tenant_id,visibility,allowed_tenant_ids,invocation_policy,routing_strategy)
       VALUES($1,$2,$3,$4,$5,$6,'online','healthy',$7,$8,'public','[]'::jsonb,$9,'weighted_round_robin')
       ON CONFLICT(slug) DO UPDATE SET display_name=EXCLUDED.display_name,description=EXCLUDED.description,card_url=EXCLUDED.card_url,card_snapshot=EXCLUDED.card_snapshot,selected_interface=EXCLUDED.selected_interface,labels=EXCLUDED.labels,status='online',health_status='healthy',tenant_id=EXCLUDED.tenant_id,visibility='public',updated_at=now()
       RETURNING id`,
      [
        slug,
        runtime.card.name,
        runtime.card.description,
        runtime.cardUrl,
        JSON.stringify(runtime.card),
        JSON.stringify(runtime.selectedInterface),
        JSON.stringify(["symbol", "finance", "built-in"]),
        tenant[0].id,
        JSON.stringify({ timeoutMs: 60_000, maxRetries: 0, maxConcurrent: 20 }),
      ],
    );
    const agentId = rows[0].id;
    await query(
      `INSERT INTO agent_instances(agent_id,name,card_url,selected_interface,status,health_status,credential_ciphertext,credential_iv,credential_tag,credential_key_version,last_health_at)
       VALUES($1,'built-in',$2,$3,'active','healthy',$4,$5,$6,$7,now())
       ON CONFLICT(agent_id,name) DO UPDATE SET card_url=EXCLUDED.card_url,selected_interface=EXCLUDED.selected_interface,status='active',health_status='healthy',credential_ciphertext=EXCLUDED.credential_ciphertext,credential_iv=EXCLUDED.credential_iv,credential_tag=EXCLUDED.credential_tag,credential_key_version=EXCLUDED.credential_key_version,last_health_at=now(),last_error=NULL,updated_at=now()`,
      [
        agentId,
        runtime.cardUrl,
        JSON.stringify(runtime.selectedInterface),
        encrypted?.ciphertext ?? null,
        encrypted?.iv ?? null,
        encrypted?.tag ?? null,
        encrypted?.keyVersion ?? null,
      ],
    );
  }
  if (migrated)
    console.log(
      `Migrated ${migrated} legacy market Agent runtime(s) to built-in Symbol.`,
    );
  console.log(
    `Registered ${symbolAgentSlugs.length} built-in Symbol A2A agents.`,
  );
}
