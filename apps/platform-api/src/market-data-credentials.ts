import { z } from "zod";
import { config } from "./config.js";
import { decryptSecret, encryptSecret } from "./credential-service.js";
import { query } from "./db.js";

export const longbridgeCredentialSchema = z.object({
  appKey: z.string().min(1).max(512),
  appSecret: z.string().min(1).max(2048),
  accessToken: z.string().min(1).max(8192),
});
export type LongbridgeCredential = z.infer<typeof longbridgeCredentialSchema>;

type CredentialRow = {
  tenant_id: string;
  provider: "longbridge";
  secret_ciphertext: string;
  secret_iv: string;
  secret_tag: string;
  secret_key_version: string;
  credential_status: "configured" | "invalid" | "expired" | "disabled";
  last_checked_at: Date | null;
};

export type CredentialSummary = {
  configured: boolean;
  source: "environment" | "tenant" | "none";
  status: CredentialRow["credential_status"] | "missing";
  lastCheckedAt?: string;
};

function environmentCredential(): LongbridgeCredential | undefined {
  const candidate = {
    appKey: config.longbridgeAppKey,
    appSecret: config.longbridgeAppSecret,
    accessToken: config.longbridgeAccessToken,
  };
  if (!candidate.appKey || !candidate.appSecret || !candidate.accessToken)
    return undefined;
  return longbridgeCredentialSchema.parse(candidate);
}

function decryptRow(row: CredentialRow): LongbridgeCredential {
  return longbridgeCredentialSchema.parse(
    JSON.parse(
      decryptSecret(
        {
          ciphertext: row.secret_ciphertext,
          iv: row.secret_iv,
          tag: row.secret_tag,
          keyVersion: row.secret_key_version,
        },
        `market-data:${row.tenant_id}:${row.provider}`,
      ),
    ),
  );
}

export async function resolveLongbridgeCredential(
  tenantId: string,
): Promise<{ credential?: LongbridgeCredential; summary: CredentialSummary }> {
  const fromEnvironment = environmentCredential();
  if (fromEnvironment)
    return {
      credential: fromEnvironment,
      summary: { configured: true, source: "environment", status: "configured" },
    };
  const rows = await query<CredentialRow>(
    `SELECT tenant_id,provider,secret_ciphertext,secret_iv,secret_tag,
            secret_key_version,credential_status,last_checked_at
       FROM market_data_credentials
      WHERE tenant_id=$1 AND provider='longbridge'`,
    [tenantId],
  );
  const row = rows[0];
  if (!row)
    return { summary: { configured: false, source: "none", status: "missing" } };
  if (row.credential_status !== "configured")
    return {
      summary: {
        configured: false,
        source: "tenant",
        status: row.credential_status,
        lastCheckedAt: row.last_checked_at?.toISOString(),
      },
    };
  return {
    credential: decryptRow(row),
    summary: {
      configured: true,
      source: "tenant",
      status: row.credential_status,
      lastCheckedAt: row.last_checked_at?.toISOString(),
    },
  };
}

export async function saveLongbridgeCredential(
  tenantId: string,
  credentialInput: unknown,
): Promise<CredentialSummary> {
  const credential = longbridgeCredentialSchema.parse(credentialInput);
  const encrypted = encryptSecret(
    JSON.stringify(credential),
    `market-data:${tenantId}:longbridge`,
  );
  await query(
    `INSERT INTO market_data_credentials(
       tenant_id,provider,secret_ciphertext,secret_iv,secret_tag,secret_key_version,
       credential_status,last_checked_at
     ) VALUES($1,'longbridge',$2,$3,$4,$5,'configured',NULL)
     ON CONFLICT(tenant_id,provider) DO UPDATE SET
       secret_ciphertext=EXCLUDED.secret_ciphertext,secret_iv=EXCLUDED.secret_iv,
       secret_tag=EXCLUDED.secret_tag,secret_key_version=EXCLUDED.secret_key_version,
       credential_status='configured',last_checked_at=NULL,updated_at=now()`,
    [
      tenantId,
      encrypted.ciphertext,
      encrypted.iv,
      encrypted.tag,
      encrypted.keyVersion,
    ],
  );
  return { configured: true, source: "tenant", status: "configured" };
}

export const __marketCredentialInternals = {
  decryptRow,
  environmentCredential,
};
