import crypto from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { config } from "./config.js";
import {
  isLocalLoginEnabled,
  isSelfRegistrationEnabled,
} from "./settings-service.js";
import { pool, query } from "./db.js";
import {
  AppError,
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  normalizeEmail,
} from "./domain.js";
import { signAccessToken, type Principal } from "./auth.js";

function derivePassword(
  password: string,
  salt: Buffer,
  options: crypto.ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, options, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}
const passwordSchema = z.string().min(12).max(256);
export const createUserSchema = z.object({
  email: z.string().email().max(254),
  displayName: z.string().trim().min(1).max(100),
  password: passwordSchema.optional(),
  platformRole: z.literal("platform_admin").nullable().optional(),
});
export const updatePlatformRoleSchema = z.object({
  platformRole: z.literal("platform_admin").nullable(),
});
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(256),
});
export const registrationSchema = z.object({
  email: z.string().email().max(254),
  displayName: z.string().trim().min(2).max(100),
  password: passwordSchema,
});

type UserRow = {
  id: string;
  email: string;
  display_name: string;
  password_hash: string | null;
  platform_role: "platform_admin" | null;
  status: "active" | "disabled";
  email_verified: boolean;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type PlatformUser = {
  id: string;
  email: string;
  displayName: string;
  platformRole?: "platform_admin";
  status: "active" | "disabled";
  emailVerified: boolean;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
};

function mapUser(row: UserRow): PlatformUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    platformRole: row.platform_role ?? undefined,
    status: row.status,
    emailVerified: row.email_verified,
    lastLoginAt: row.last_login_at?.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function principal(user: PlatformUser): Principal {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    platformRole: user.platformRole,
  };
}

export async function hashPassword(password: string): Promise<string> {
  passwordSchema.parse(password);
  const salt = crypto.randomBytes(16);
  const derived = await derivePassword(password, salt, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$32768$8$1$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const [algorithm, n, r, p, salt, expected] = encoded.split("$");
  if (algorithm !== "scrypt" || !n || !r || !p || !salt || !expected)
    return false;
  const derived = await derivePassword(password, Buffer.from(salt, "base64"), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024,
  });
  const right = Buffer.from(expected, "base64");
  return (
    right.length === derived.length && crypto.timingSafeEqual(right, derived)
  );
}

export async function getUser(id: string): Promise<PlatformUser> {
  const rows = await query<UserRow>(
    "SELECT * FROM platform_users WHERE id=$1",
    [id],
  );
  if (!rows[0]) throw new NotFoundError("用户", id);
  return mapUser(rows[0]);
}

export async function findUserByEmail(
  email: string,
): Promise<(PlatformUser & { passwordHash?: string }) | undefined> {
  const rows = await query<UserRow>(
    "SELECT * FROM platform_users WHERE email=$1",
    [normalizeEmail(email)],
  );
  if (!rows[0]) return undefined;
  return {
    ...mapUser(rows[0]),
    passwordHash: rows[0].password_hash ?? undefined,
  };
}

export async function createUser(
  raw: unknown,
  client?: PoolClient,
  options: { emailVerified?: boolean } = {},
): Promise<PlatformUser> {
  const input = createUserSchema.parse(raw);
  const email = normalizeEmail(input.email);
  const existing = client
    ? (
        await client.query<{ id: string }>(
          "SELECT id FROM platform_users WHERE email=$1",
          [email],
        )
      ).rows[0]
    : await findUserByEmail(email);
  if (existing)
    throw new ConflictError("USER_EMAIL_EXISTS", "该邮箱已存在用户。");
  const id = `local:${crypto.randomUUID()}`;
  const passwordHash = input.password
    ? await hashPassword(input.password)
    : null;
  const values = [
    id,
    email,
    input.displayName,
    passwordHash,
    input.platformRole ?? null,
    options.emailVerified ?? true,
  ];
  const sql = `INSERT INTO platform_users(id,email,display_name,password_hash,platform_role,email_verified)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING *`;
  const row = client
    ? (await client.query<UserRow>(sql, values)).rows[0]
    : (await query<UserRow>(sql, values))[0];
  return mapUser(row);
}

export async function retireUnverifiedLocalUser(
  user: PlatformUser,
  client: PoolClient,
): Promise<void> {
  if (user.emailVerified || !user.id.startsWith("local:"))
    throw new ConflictError(
      "USER_EXISTS_LOGIN_REQUIRED",
      "该邮箱已有关联账号，请先登录后再接受邀请。",
    );
  const rows = await client.query<{ id: string }>(
    `UPDATE platform_users
     SET email=$2,status='disabled',password_hash=NULL,updated_at=now()
     WHERE id=$1 AND email_verified=false RETURNING *`,
    [user.id, `retired-${crypto.randomUUID()}@invalid.local`],
  );
  if (!rows.rows[0])
    throw new ConflictError(
      "USER_EXISTS_LOGIN_REQUIRED",
      "账号状态已经变化，请登录后接受邀请。",
    );
  await client.query(
    "UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL",
    [user.id],
  );
}

async function enforceRegistrationLimit(
  email: string,
  ipAddress?: string,
): Promise<void> {
  const subjects = [
    {
      type: "ip" as const,
      hash: loginLimitHash("ip", ipAddress || "unknown"),
      interval: "1 hour",
      limit: 20,
    },
    {
      type: "email" as const,
      hash: loginLimitHash("email", email),
      interval: "1 hour",
      limit: 5,
    },
  ];
  const client = await pool.connect();
  let exceeded = false;
  let transactionOpen = false;
  try {
    for (const subject of subjects) {
      await client.query("BEGIN");
      transactionOpen = true;
      const result = await client.query<{ attempt_count: number }>(
        `INSERT INTO auth_registration_limits(subject_type,subject_hash,window_started_at,attempt_count)
         VALUES($1,$2,now(),1)
         ON CONFLICT(subject_type,subject_hash) DO UPDATE SET
           attempt_count=CASE WHEN auth_registration_limits.window_started_at<now()-($3::interval)
             THEN 1 ELSE auth_registration_limits.attempt_count+1 END,
           window_started_at=CASE WHEN auth_registration_limits.window_started_at<now()-($3::interval)
             THEN now() ELSE auth_registration_limits.window_started_at END,
           updated_at=now()
         RETURNING attempt_count`,
        [subject.type, subject.hash, subject.interval],
      );
      if (result.rows[0].attempt_count > subject.limit) {
        exceeded = true;
        await client.query("ROLLBACK");
        transactionOpen = false;
        break;
      }
      await client.query("COMMIT");
      transactionOpen = false;
    }
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK");
    throw new AppError(
      503,
      "REGISTRATION_RATE_LIMIT_UNAVAILABLE",
      "注册保护服务暂时不可用。",
      { cause: error instanceof Error ? error.message : String(error) },
    );
  } finally {
    client.release();
  }
  if (exceeded)
    throw new AppError(
      429,
      "REGISTRATION_RATE_LIMITED",
      "注册请求过于频繁，请稍后再试。",
      { retryAfterSeconds: 3600 },
    );
}

export async function registerUser(
  raw: unknown,
  context: { ipAddress?: string },
  client?: PoolClient,
): Promise<PlatformUser> {
  if (!(await isSelfRegistrationEnabled()))
    throw new AppError(403, "SELF_REGISTRATION_DISABLED", "自助注册未启用。");
  const input = registrationSchema.parse(raw);
  const normalized = { ...input, email: normalizeEmail(input.email) };
  await enforceRegistrationLimit(normalized.email, context.ipAddress);
  try {
    return await createUser(normalized, client, { emailVerified: false });
  } catch (error) {
    if (
      error instanceof ConflictError ||
      (typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23505")
    )
      throw new ConflictError("USER_EMAIL_EXISTS", "该邮箱已存在用户。");
    throw error;
  }
}

export async function listUsers(): Promise<PlatformUser[]> {
  const rows = await query<UserRow>(
    "SELECT * FROM platform_users ORDER BY created_at DESC",
  );
  return rows.map(mapUser);
}

async function revokeUserSessions(
  userId: string,
  client?: PoolClient,
): Promise<void> {
  const sql =
    "UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL";
  if (client) await client.query(sql, [userId]);
  else await query(sql, [userId]);
}

async function lockActivePlatformAdministrators(client: PoolClient): Promise<
  Array<{ id: string }>
> {
  const result = await client.query<{ id: string }>(
    `SELECT id FROM platform_users
     WHERE platform_role='platform_admin' AND status='active'
     ORDER BY id
     FOR UPDATE`,
  );
  return result.rows;
}

function assertPlatformAdministrationRetained(input: {
  user: UserRow;
  activeAdministratorIds: Array<{ id: string }>;
  nextPlatformRole: "platform_admin" | null;
  nextStatus: "active" | "disabled";
}): void {
  const removesLastActiveAdministrator =
    input.user.platform_role === "platform_admin" &&
    input.user.status === "active" &&
    (input.nextPlatformRole !== "platform_admin" ||
      input.nextStatus !== "active");
  if (
    removesLastActiveAdministrator &&
    input.activeAdministratorIds.length <= 1
  )
    throw new ConflictError(
      "LAST_PLATFORM_ADMIN",
      "平台至少需要保留一位启用的平台管理员。",
    );
}

export async function setUserPlatformRole(
  id: string,
  raw: unknown,
): Promise<PlatformUser> {
  const input = updatePlatformRoleSchema.parse(raw);
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    // Lock all current administrators in a stable order. This prevents two
    // concurrent demotions from each observing a different "last admin".
    const activeAdministratorIds = await lockActivePlatformAdministrators(client);
    const target = await client.query<UserRow>(
      "SELECT * FROM platform_users WHERE id=$1 FOR UPDATE",
      [id],
    );
    const current = target.rows[0];
    if (!current) throw new NotFoundError("用户", id);
    assertPlatformAdministrationRetained({
      user: current,
      activeAdministratorIds,
      nextPlatformRole: input.platformRole,
      nextStatus: current.status,
    });
    const changed = current.platform_role !== input.platformRole;
    const result = await client.query<UserRow>(
      `UPDATE platform_users
       SET platform_role=$2,updated_at=now()
       WHERE id=$1 RETURNING *`,
      [id, input.platformRole],
    );
    // A promotion takes effect on the next authenticated request. Keep the
    // current refresh session so the user receives the same role at the next
    // token refresh. A demotion must invalidate renewal credentials instead.
    if (changed && input.platformRole !== "platform_admin")
      await revokeUserSessions(id, client);
    await client.query("COMMIT");
    transactionOpen = false;
    return mapUser(result.rows[0]);
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function setUserStatus(
  id: string,
  status: "active" | "disabled",
): Promise<PlatformUser> {
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    const activeAdministratorIds = await lockActivePlatformAdministrators(client);
    const target = await client.query<UserRow>(
      "SELECT * FROM platform_users WHERE id=$1 FOR UPDATE",
      [id],
    );
    const current = target.rows[0];
    if (!current) throw new NotFoundError("用户", id);
    assertPlatformAdministrationRetained({
      user: current,
      activeAdministratorIds,
      nextPlatformRole: current.platform_role,
      nextStatus: status,
    });
    const result = await client.query<UserRow>(
      "UPDATE platform_users SET status=$2,updated_at=now() WHERE id=$1 RETURNING *",
      [id, status],
    );
    if (status === "disabled") await revokeUserSessions(id, client);
    await client.query("COMMIT");
    transactionOpen = false;
    return mapUser(result.rows[0]);
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function upsertOidcUser(input: {
  issuer: string;
  subject: string;
  email: string;
  displayName?: string;
  emailVerified?: boolean;
}): Promise<PlatformUser> {
  if (!input.emailVerified)
    throw new UnauthorizedError(
      "OIDC_EMAIL_NOT_VERIFIED",
      "企业身份提供方尚未验证该邮箱。",
    );
  const id = `oidc:${crypto.createHash("sha256").update(`${input.issuer}\0${input.subject}`).digest("hex")}`;
  const email = normalizeEmail(input.email);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const linked = await client.query<UserRow>(
      `SELECT u.* FROM external_identities i JOIN platform_users u ON u.id=i.user_id
       WHERE i.issuer=$1 AND i.subject=$2 FOR UPDATE OF i,u`,
      [input.issuer, input.subject],
    );
    if (linked.rows[0]) {
      await client.query(
        "UPDATE external_identities SET last_login_at=now() WHERE issuer=$1 AND subject=$2",
        [input.issuer, input.subject],
      );
      await client.query("COMMIT");
      return mapUser(linked.rows[0]);
    }
    const emailOwner = await client.query<UserRow>(
      "SELECT * FROM platform_users WHERE email=$1 FOR UPDATE",
      [email],
    );
    if (
      emailOwner.rows[0] &&
      !emailOwner.rows[0].email_verified &&
      emailOwner.rows[0].id.startsWith("local:")
    ) {
      await client.query(
        `UPDATE platform_users
         SET email=$2,status='disabled',password_hash=NULL,updated_at=now()
         WHERE id=$1`,
        [emailOwner.rows[0].id, `retired-${crypto.randomUUID()}@invalid.local`],
      );
      await client.query(
        "UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL",
        [emailOwner.rows[0].id],
      );
    } else if (emailOwner.rows[0])
      throw new ConflictError(
        "OIDC_ACCOUNT_LINK_REQUIRED",
        "该邮箱已有平台账号，必须由已登录用户显式关联企业身份。",
      );
    const created = await client.query<UserRow>(
      `INSERT INTO platform_users(id,email,display_name,email_verified)
       VALUES($1,$2,$3,true) RETURNING *`,
      [id, email, input.displayName ?? email],
    );
    await client.query(
      `INSERT INTO external_identities(issuer,subject,user_id,last_login_at)
       VALUES($1,$2,$3,now())`,
      [input.issuer, input.subject, id],
    );
    await client.query("COMMIT");
    return mapUser(created.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  refreshTokenExpiresAt: string;
  user: PlatformUser;
};

function loginLimitHash(type: "email" | "ip", value: string): string {
  return crypto
    .createHmac("sha256", config.jwtSecret)
    .update(`${type}:${value}`)
    .digest("hex");
}

async function enforceLoginLimit(
  email: string,
  ipAddress?: string,
): Promise<string> {
  const emailHash = loginLimitHash("email", email);
  const subjects = [
    {
      type: "email" as const,
      hash: emailHash,
      interval: "15 minutes",
      limit: 10,
    },
    {
      type: "ip" as const,
      hash: loginLimitHash("ip", ipAddress || "unknown"),
      interval: "1 minute",
      limit: 60,
    },
  ];
  const client = await pool.connect();
  let exceeded = false;
  try {
    await client.query("BEGIN");
    for (const subject of subjects) {
      const result = await client.query<{ attempt_count: number }>(
        `INSERT INTO auth_login_limits(subject_type,subject_hash,window_started_at,attempt_count)
         VALUES($1,$2,now(),1)
         ON CONFLICT(subject_type,subject_hash) DO UPDATE SET
           attempt_count=CASE WHEN auth_login_limits.window_started_at<now()-($3::interval)
             THEN 1 ELSE auth_login_limits.attempt_count+1 END,
           window_started_at=CASE WHEN auth_login_limits.window_started_at<now()-($3::interval)
             THEN now() ELSE auth_login_limits.window_started_at END,
           updated_at=now()
         RETURNING attempt_count`,
        [subject.type, subject.hash, subject.interval],
      );
      if (result.rows[0].attempt_count > subject.limit) exceeded = true;
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw new AppError(
      503,
      "LOGIN_RATE_LIMIT_UNAVAILABLE",
      "登录保护服务暂时不可用。",
      { cause: error instanceof Error ? error.message : String(error) },
    );
  } finally {
    client.release();
  }
  if (exceeded)
    throw new AppError(
      429,
      "LOGIN_RATE_LIMITED",
      "登录尝试过于频繁，请稍后再试。",
      {
        retryAfterSeconds: 60,
      },
    );
  return emailHash;
}

export async function issueTokenPair(
  user: PlatformUser,
  context: { userAgent?: string; ipAddress?: string },
  client?: PoolClient,
): Promise<TokenPair> {
  if (user.status !== "active")
    throw new UnauthorizedError("USER_DISABLED", "用户已被停用。");
  const refreshToken = `a2a_refresh_${crypto.randomBytes(48).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + config.refreshTokenDays * 86_400_000);
  const sql = `INSERT INTO auth_sessions(user_id,refresh_token_hash,user_agent,ip_address,expires_at)
     VALUES($1,$2,$3,$4,$5)`;
  const values = [
    user.id,
    tokenHash(refreshToken),
    context.userAgent ?? null,
    context.ipAddress ?? null,
    expiresAt,
  ];
  if (client) await client.query(sql, values);
  else await query(sql, values);
  return {
    accessToken: signAccessToken(principal(user), config.accessTokenSeconds),
    refreshToken,
    accessTokenExpiresIn: config.accessTokenSeconds,
    refreshTokenExpiresAt: expiresAt.toISOString(),
    user,
  };
}

export async function login(
  raw: unknown,
  context: { userAgent?: string; ipAddress?: string },
): Promise<TokenPair> {
  if (!(await isLocalLoginEnabled()))
    throw new AppError(403, "LOCAL_LOGIN_DISABLED", "账号密码登录未启用。");
  const input = loginSchema.parse(raw);
  const email = normalizeEmail(input.email);
  const emailLimitHash = await enforceLoginLimit(email, context.ipAddress);
  const user = await findUserByEmail(email);
  const valid = Boolean(
    user?.passwordHash &&
    (await verifyPassword(input.password, user.passwordHash)),
  );
  if (!user || !valid)
    throw new UnauthorizedError("LOGIN_FAILED", "邮箱或密码错误。");
  if (user.status !== "active")
    throw new UnauthorizedError("USER_DISABLED", "用户已被停用。");
  await query(
    "DELETE FROM auth_login_limits WHERE subject_type='email' AND subject_hash=$1",
    [emailLimitHash],
  );
  await query("UPDATE platform_users SET last_login_at=now() WHERE id=$1", [
    user.id,
  ]);
  return issueTokenPair(user, context);
}

export async function refreshTokens(
  refreshToken: string,
  context: { userAgent?: string; ipAddress?: string },
): Promise<TokenPair> {
  if (!refreshToken.startsWith("a2a_refresh_"))
    throw new UnauthorizedError("REFRESH_TOKEN_INVALID", "刷新令牌无效。");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<UserRow & { session_id: string }>(
      `SELECT u.*,s.id AS session_id FROM auth_sessions s
       JOIN platform_users u ON u.id=s.user_id
       WHERE s.refresh_token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now()
       FOR UPDATE OF s`,
      [tokenHash(refreshToken)],
    );
    if (!result.rows[0])
      throw new UnauthorizedError(
        "REFRESH_TOKEN_INVALID",
        "刷新令牌无效或已过期。",
      );
    await client.query(
      "UPDATE auth_sessions SET revoked_at=now(),last_used_at=now() WHERE id=$1",
      [result.rows[0].session_id],
    );
    await client.query("COMMIT");
    return await issueTokenPair(mapUser(result.rows[0]), context);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  await query(
    "UPDATE auth_sessions SET revoked_at=now() WHERE refresh_token_hash=$1",
    [tokenHash(refreshToken)],
  );
}

export async function resetPassword(
  userId: string,
  password: string,
): Promise<void> {
  await query(
    `UPDATE platform_users SET password_hash=$2,updated_at=now() WHERE id=$1`,
    [userId, await hashPassword(password)],
  );
  await query(
    "UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL",
    [userId],
  );
}
