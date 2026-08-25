import {
  authenticateApiKey,
  createApiKey,
  revokeApiKey,
  type AuthenticatedApiKey,
} from "./api-key-service.js";
import { config } from "./config.js";
import { decryptSecret, encryptSecret } from "./credential-service.js";
import { query } from "./db.js";

type StoredStudioCredential = {
  tenant_id: string;
  api_key_id: string;
  secret_ciphertext: string;
  secret_iv: string;
  secret_tag: string;
  secret_key_version: string;
};

export type StudioServiceCredential = {
  secret: string;
  key: AuthenticatedApiKey;
  source: "configured" | "managed";
};

const keyInput = {
  name: "Agent Studio 服务凭据",
  description: "由平台自动托管，仅用于登录后的 Agent Studio 安全代理。",
  scopes: ["agent:invoke", "task:read", "task:cancel"],
};

function decryptStored(row: StoredStudioCredential): string {
  return decryptSecret(
    {
      ciphertext: row.secret_ciphertext,
      iv: row.secret_iv,
      tag: row.secret_tag,
      keyVersion: row.secret_key_version,
    },
    `studio-service:${row.tenant_id}`,
  );
}

async function validManagedCredential(
  tenantId: string,
): Promise<StudioServiceCredential | undefined> {
  const rows = await query<StoredStudioCredential>(
    "SELECT * FROM studio_service_credentials WHERE tenant_id=$1",
    [tenantId],
  );
  const row = rows[0];
  if (!row) return undefined;
  try {
    const secret = decryptStored(row);
    const key = await authenticateApiKey(secret);
    if (key.tenantId !== tenantId || key.id !== row.api_key_id) return undefined;
    return { secret, key, source: "managed" };
  } catch {
    // A revoked or lost service key is transparently rotated below. The old
    // hash remains unusable and the plaintext is never returned to callers.
    return undefined;
  }
}

async function createManagedCredential(
  tenantId: string,
): Promise<StudioServiceCredential> {
  const created = await createApiKey(tenantId, keyInput, "studio-service");
  const encrypted = encryptSecret(created.secret, `studio-service:${tenantId}`);
  const inserted = await query<{ tenant_id: string }>(
    `INSERT INTO studio_service_credentials(
       tenant_id,api_key_id,secret_ciphertext,secret_iv,secret_tag,secret_key_version
     ) VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT(tenant_id) DO NOTHING
     RETURNING tenant_id`,
    [
      tenantId,
      created.id,
      encrypted.ciphertext,
      encrypted.iv,
      encrypted.tag,
      encrypted.keyVersion,
    ],
  );
  if (!inserted[0]) {
    // Concurrent first requests may both generate an encrypted secret. Keep
    // one durable credential and revoke the losing key rather than leak an
    // otherwise invisible, unrestricted capability.
    const existing = await validManagedCredential(tenantId);
    if (existing) {
      await revokeApiKey(tenantId, created.id);
      return existing;
    }
    // A credential encrypted with a retired/missing key cannot be recovered
    // by design. Remove that unusable envelope and rotate its API key before
    // storing the newly generated replacement.
    const stale = await query<{ api_key_id: string }>(
      "DELETE FROM studio_service_credentials WHERE tenant_id=$1 RETURNING api_key_id",
      [tenantId],
    );
    if (stale[0]) await revokeApiKey(tenantId, stale[0].api_key_id);
    const replacement = await query<{ tenant_id: string }>(
      `INSERT INTO studio_service_credentials(
         tenant_id,api_key_id,secret_ciphertext,secret_iv,secret_tag,secret_key_version
       ) VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(tenant_id) DO NOTHING
       RETURNING tenant_id`,
      [
        tenantId,
        created.id,
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.tag,
        encrypted.keyVersion,
      ],
    );
    if (!replacement[0]) {
      await revokeApiKey(tenantId, created.id);
      const concurrent = await validManagedCredential(tenantId);
      if (concurrent) return concurrent;
      throw new Error("无法初始化 Agent Studio 服务凭据。");
    }
  }
  return {
    secret: created.secret,
    key: await authenticateApiKey(created.secret),
    source: "managed",
  };
}

/**
 * Resolve a server-only A2A credential for a tenant. A configured personal
 * key wins; otherwise the platform provisions and encrypts a least-privilege
 * Studio key on first use, so a fresh deployment remains immediately usable.
 */
export async function resolveStudioServiceCredential(
  tenantId: string,
): Promise<StudioServiceCredential> {
  if (config.studioApiKey) {
    const key = await authenticateApiKey(config.studioApiKey);
    return { secret: config.studioApiKey, key, source: "configured" };
  }
  return (await validManagedCredential(tenantId)) ??
    createManagedCredential(tenantId);
}
