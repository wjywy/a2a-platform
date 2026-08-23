import crypto from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { config } from "./config.js";
import { pool, query } from "./db.js";
import { AppError, UnauthorizedError } from "./domain.js";
import {
  issueTokenPair,
  upsertOidcUser,
  type TokenPair,
} from "./identity-service.js";

type Discovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
};

let discoveryCache: { value: Discovery; expiresAt: number } | undefined;

export function oidcEnabled(): boolean {
  return Boolean(config.oidcIssuer && config.oidcClientId);
}

async function discovery(): Promise<Discovery> {
  if (!oidcEnabled())
    throw new AppError(503, "OIDC_NOT_CONFIGURED", "OIDC 尚未配置。");
  if (discoveryCache && discoveryCache.expiresAt > Date.now())
    return discoveryCache.value;
  const response = await fetch(
    `${config.oidcIssuer}/.well-known/openid-configuration`,
    {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok)
    throw new AppError(502, "OIDC_DISCOVERY_FAILED", "无法读取 OIDC 配置。");
  const value = (await response.json()) as Discovery;
  if (
    value.issuer !== config.oidcIssuer ||
    !value.authorization_endpoint ||
    !value.token_endpoint ||
    !value.jwks_uri
  )
    throw new AppError(502, "OIDC_DISCOVERY_INVALID", "OIDC 配置无效。");
  discoveryCache = { value, expiresAt: Date.now() + 300_000 };
  return value;
}

function hash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function challenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

export async function createOidcAuthorization(returnTo = "/"): Promise<string> {
  const metadata = await discovery();
  const state = crypto.randomBytes(32).toString("base64url");
  const nonce = crypto.randomBytes(32).toString("base64url");
  const verifier = crypto.randomBytes(48).toString("base64url");
  const safeReturnTo =
    returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
  await query(
    `INSERT INTO oidc_login_states(state_hash,nonce,code_verifier,return_to,expires_at)
     VALUES($1,$2,$3,$4,now()+interval '10 minutes')`,
    [hash(state), nonce, verifier, safeReturnTo],
  );
  const url = new URL(metadata.authorization_endpoint);
  url.search = new URLSearchParams({
    client_id: config.oidcClientId,
    redirect_uri: config.oidcRedirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: challenge(verifier),
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

async function verifyIdToken(
  idToken: string,
  metadata: Discovery,
  nonce: string,
): Promise<JWTPayload> {
  const jwks = createRemoteJWKSet(new URL(metadata.jwks_uri));
  const result = await jwtVerify(idToken, jwks, {
    issuer: config.oidcIssuer,
    audience: config.oidcClientId,
  });
  if (result.payload.nonce !== nonce)
    throw new UnauthorizedError("OIDC_NONCE_INVALID", "OIDC nonce 校验失败。");
  return result.payload;
}

export async function completeOidcCallback(
  code: string,
  state: string,
): Promise<{
  exchangeCode: string;
  returnTo: string;
}> {
  if (!code || !state)
    throw new UnauthorizedError("OIDC_CALLBACK_INVALID", "OIDC 回调参数缺失。");
  const client = await pool.connect();
  let loginState: { nonce: string; code_verifier: string; return_to: string };
  try {
    await client.query("BEGIN");
    const result = await client.query<typeof loginState>(
      `DELETE FROM oidc_login_states WHERE state_hash=$1 AND expires_at>now()
       RETURNING nonce,code_verifier,return_to`,
      [hash(state)],
    );
    if (!result.rows[0])
      throw new UnauthorizedError(
        "OIDC_STATE_INVALID",
        "OIDC state 无效或已过期。",
      );
    loginState = result.rows[0];
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const metadata = await discovery();
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.oidcRedirectUri,
    client_id: config.oidcClientId,
    code_verifier: loginState.code_verifier,
  });
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
  };
  if (config.oidcClientSecret) {
    headers.authorization = `Basic ${Buffer.from(`${config.oidcClientId}:${config.oidcClientSecret}`).toString("base64")}`;
  }
  const response = await fetch(metadata.token_endpoint, {
    method: "POST",
    headers,
    body: form,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new UnauthorizedError(
      "OIDC_TOKEN_EXCHANGE_FAILED",
      "OIDC 授权码交换失败。",
    );
  const token = (await response.json()) as { id_token?: string };
  if (!token.id_token)
    throw new UnauthorizedError(
      "OIDC_ID_TOKEN_MISSING",
      "OIDC 响应缺少 ID Token。",
    );
  const claims = await verifyIdToken(
    token.id_token,
    metadata,
    loginState.nonce,
  );
  if (
    !claims.sub ||
    typeof claims.email !== "string" ||
    claims.email_verified !== true
  )
    throw new UnauthorizedError(
      "OIDC_CLAIMS_INVALID",
      "OIDC 用户信息缺少 sub、已验证邮箱或 email_verified=true。",
    );
  const user = await upsertOidcUser({
    issuer: metadata.issuer,
    subject: claims.sub,
    email: claims.email,
    displayName: typeof claims.name === "string" ? claims.name : claims.email,
    emailVerified: claims.email_verified === true,
  });
  const exchangeCode = `a2a_exchange_${crypto.randomBytes(32).toString("base64url")}`;
  await query(
    `INSERT INTO auth_exchange_codes(code_hash,user_id,expires_at)
     VALUES($1,$2,now()+interval '2 minutes')`,
    [hash(exchangeCode), user.id],
  );
  return { exchangeCode, returnTo: loginState.return_to };
}

export async function exchangeOidcCode(
  exchangeCode: string,
  context: { userAgent?: string; ipAddress?: string },
): Promise<TokenPair> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ user_id: string }>(
      `UPDATE auth_exchange_codes SET consumed_at=now()
       WHERE code_hash=$1 AND consumed_at IS NULL AND expires_at>now()
       RETURNING user_id`,
      [hash(exchangeCode)],
    );
    if (!result.rows[0])
      throw new UnauthorizedError(
        "OIDC_EXCHANGE_INVALID",
        "登录交换码无效或已使用。",
      );
    const users = await client.query<{
      id: string;
      email: string;
      display_name: string;
      platform_role: "platform_admin" | null;
      status: "active" | "disabled";
      email_verified: boolean;
      last_login_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }>(
      "UPDATE platform_users SET last_login_at=now() WHERE id=$1 RETURNING *",
      [result.rows[0].user_id],
    );
    await client.query("COMMIT");
    const row = users.rows[0];
    return issueTokenPair(
      {
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        platformRole: row.platform_role ?? undefined,
        status: row.status,
        emailVerified: row.email_verified,
        lastLoginAt: row.last_login_at?.toISOString(),
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      },
      context,
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function cleanupAuthArtifacts(): Promise<void> {
  await query("DELETE FROM oidc_login_states WHERE expires_at<now()");
  await query(
    "DELETE FROM auth_exchange_codes WHERE expires_at<now() OR consumed_at<now()-interval '1 day'",
  );
  await query(
    "DELETE FROM auth_sessions WHERE expires_at<now()-interval '7 days' OR revoked_at<now()-interval '30 days'",
  );
  await query(
    "DELETE FROM auth_registration_limits WHERE updated_at<now()-interval '2 hours'",
  );
}
