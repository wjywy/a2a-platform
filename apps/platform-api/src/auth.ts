import crypto, { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "./config.js";
import { query } from "./db.js";
import {
  AppError,
  ForbiddenError,
  UnauthorizedError,
  type TenantMemberRole,
  type TenantRole,
} from "./domain.js";
import { tenantRoleForUser } from "./tenant-service.js";

export type Principal = {
  id: string;
  email?: string;
  displayName?: string;
  platformRole?: "platform_admin";
  tokenId?: string;
};

export type AuthenticatedRequest = Request & {
  principal?: Principal;
  requestId?: string;
  tenantRole?: TenantMemberRole;
  auditTenantId?: string;
};

type CurrentUserRow = {
  email: string;
  display_name: string;
  platform_role: "platform_admin" | null;
  status: "active" | "disabled";
};

type JwtClaims = {
  sub: string;
  iss: string;
  aud?: string;
  exp: number;
  iat: number;
  jti?: string;
  email?: string;
  name?: string;
  platform_role?: "platform_admin";
};

function equalText(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function parseJson<T>(encoded: string): T {
  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as T;
  } catch {
    throw new UnauthorizedError("TOKEN_MALFORMED", "访问令牌格式无效。");
  }
}

export function signAccessToken(
  principal: Omit<Principal, "tokenId">,
  expiresInSeconds = 3600,
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const claims: JwtClaims = {
    sub: principal.id,
    iss: config.jwtIssuer,
    iat: now,
    exp: now + expiresInSeconds,
    jti: crypto.randomUUID(),
    email: principal.email,
    name: principal.displayName,
    platform_role: principal.platformRole,
  };
  const payload = base64url(JSON.stringify(claims));
  const signature = crypto
    .createHmac("sha256", config.jwtSecret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

export function verifyAccessToken(token: string): Principal {
  const pieces = token.split(".");
  if (pieces.length !== 3)
    throw new UnauthorizedError("TOKEN_MALFORMED", "访问令牌格式无效。");
  const [header, payload, signature] = pieces;
  const jwtHeader = parseJson<{ alg?: string; typ?: string }>(header);
  if (jwtHeader.alg !== "HS256")
    throw new UnauthorizedError(
      "TOKEN_ALGORITHM_DENIED",
      "访问令牌签名算法不受支持。",
    );
  const expected = crypto
    .createHmac("sha256", config.jwtSecret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  if (!equalText(signature, expected))
    throw new UnauthorizedError(
      "TOKEN_SIGNATURE_INVALID",
      "访问令牌签名无效。",
    );
  const claims = parseJson<JwtClaims>(payload);
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== config.jwtIssuer)
    throw new UnauthorizedError("TOKEN_ISSUER_INVALID", "访问令牌签发方无效。");
  if (!claims.sub)
    throw new UnauthorizedError(
      "TOKEN_SUBJECT_MISSING",
      "访问令牌缺少用户标识。",
    );
  if (!claims.exp || claims.exp <= now)
    throw new UnauthorizedError("TOKEN_EXPIRED", "访问令牌已过期。");
  if (claims.iat > now + 60)
    throw new UnauthorizedError("TOKEN_NOT_ACTIVE", "访问令牌尚未生效。");
  return {
    id: claims.sub,
    email: claims.email,
    displayName: claims.name,
    platformRole: claims.platform_role,
    tokenId: claims.jti,
  };
}

export function authenticate(
  authorization: string | undefined,
): Principal | undefined {
  const token = authorization?.replace(/^Bearer\s+/i, "");
  if (!token) return undefined;
  if (config.devToken && equalText(token, config.devToken))
    return {
      id: "local-admin",
      displayName: "本地平台管理员",
      platformRole: "platform_admin",
    };
  try {
    return verifyAccessToken(token);
  } catch {
    return undefined;
  }
}

async function resolveCurrentPrincipal(
  principal: Principal,
): Promise<Principal> {
  const rows = await query<CurrentUserRow>(
    `SELECT email,display_name,platform_role,status
     FROM platform_users WHERE id=$1`,
    [principal.id],
  );
  const user = rows[0];
  // Service-to-service tokens created before the customer identity rollout do
  // not have a platform_users record. Keep their existing claims intact.
  if (!user) return principal;
  if (user.status !== "active")
    throw new UnauthorizedError("USER_DISABLED", "用户已被停用。");
  return {
    ...principal,
    email: user.email,
    displayName: user.display_name,
    platformRole: user.platform_role ?? undefined,
  };
}

export async function requireAuthentication(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = req.header("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token)
      throw new UnauthorizedError(
        "AUTHENTICATION_REQUIRED",
        "需要登录后访问。",
      );
    req.principal =
      config.devToken && equalText(token, config.devToken)
        ? {
            id: "local-admin",
            displayName: "本地平台管理员",
            platformRole: "platform_admin",
          }
        : await resolveCurrentPrincipal(verifyAccessToken(token));
    next();
  } catch (error) {
    const appError =
      error instanceof AppError
        ? error
        : new UnauthorizedError("AUTHENTICATION_FAILED", "身份验证失败。");
    res
      .status(appError.status)
      .json({ error: { code: appError.code, message: appError.message } });
  }
}

export function requirePlatformAdmin(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): void {
  if (req.principal?.platformRole !== "platform_admin")
    return next(
      new ForbiddenError(
        "PLATFORM_ADMIN_REQUIRED",
        "此操作仅平台管理员可执行。",
      ),
    );
  next();
}

const roleRank: Record<TenantRole, number> = {
  viewer: 1,
  developer: 2,
  tenant_admin: 3,
  platform_admin: 4,
};
export function hasRole(actual: TenantRole, minimum: TenantRole): boolean {
  return roleRank[actual] >= roleRank[minimum];
}

export function requireTenantRole(minimum: TenantMemberRole) {
  return async (
    req: AuthenticatedRequest,
    _res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.principal)
        throw new UnauthorizedError(
          "AUTHENTICATION_REQUIRED",
          "需要登录后访问。",
        );
      if (req.principal.platformRole === "platform_admin") {
        req.tenantRole = "tenant_admin";
        next();
        return;
      }
      const tenantId = String(
        req.params.tenantId ?? req.body?.tenantId ?? req.query.tenantId ?? "",
      );
      if (!tenantId)
        throw new AppError(
          400,
          "TENANT_CONTEXT_REQUIRED",
          "请求缺少租户上下文。",
        );
      req.auditTenantId = tenantId;
      const actual = await tenantRoleForUser(tenantId, req.principal.id);
      if (!actual || !hasRole(actual, minimum))
        throw new ForbiddenError(
          "TENANT_ROLE_DENIED",
          `此操作至少需要 ${minimum} 角色。`,
        );
      req.tenantRole = actual;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function assertTenantAccess(
  principal: Principal,
  actualRole: TenantMemberRole | undefined,
  minimum: TenantMemberRole,
): void {
  if (principal.platformRole === "platform_admin") return;
  if (!actualRole || !hasRole(actualRole, minimum))
    throw new ForbiddenError(
      "TENANT_ROLE_DENIED",
      `此操作至少需要 ${minimum} 角色。`,
    );
}

export function requireConfiguredJwtSecret(): void {
  if (process.env.NODE_ENV !== "production") return;
  if (config.jwtSecret.length < 32 || config.jwtSecret.startsWith("change-me-"))
    throw new Error(
      "PLATFORM_JWT_SECRET must be a non-default value of at least 32 characters in production",
    );
  if (config.devToken)
    throw new Error("PLATFORM_DEV_TOKEN must be disabled in production");
  if (
    config.credentialEncryptionKey.length < 32 ||
    config.credentialEncryptionKey.startsWith("local-development-")
  )
    throw new Error(
      "CREDENTIAL_ENCRYPTION_KEY must be a non-default value of at least 32 characters in production",
    );
  if (!/^[A-Za-z0-9._-]{1,32}$/.test(config.credentialKeyVersion))
    throw new Error("CREDENTIAL_KEY_VERSION is invalid");
  let previousKeys: Record<string, unknown>;
  try {
    previousKeys = JSON.parse(config.credentialPreviousKeys) as Record<
      string,
      unknown
    >;
  } catch {
    throw new Error("CREDENTIAL_PREVIOUS_KEYS must be a JSON object");
  }
  if (
    !previousKeys ||
    Array.isArray(previousKeys) ||
    Object.entries(previousKeys).some(
      ([version, key]) =>
        !/^[A-Za-z0-9._-]{1,32}$/.test(version) ||
        typeof key !== "string" ||
        key.length < 32,
    )
  )
    throw new Error(
      "CREDENTIAL_PREVIOUS_KEYS must map valid versions to 32+ character keys",
    );
  if (Boolean(config.oidcIssuer) !== Boolean(config.oidcClientId))
    throw new Error(
      "OIDC_ISSUER and OIDC_CLIENT_ID must either both be configured or both be empty",
    );
}
