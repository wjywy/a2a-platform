import { Router, type Response } from "express";
import { z } from "zod";
import { requireAuthentication, type AuthenticatedRequest } from "./auth.js";
import { config } from "./config.js";
import { AppError, ConflictError } from "./domain.js";
import { asyncHandler } from "./http.js";
import {
  exchangeOidcCode,
  completeOidcCallback,
  createOidcAuthorization,
  oidcEnabled,
} from "./oidc-service.js";
import {
  issueTokenPair,
  login,
  refreshTokens,
  revokeRefreshToken,
  getUser,
  createUser,
  findUserByEmail,
  retireUnverifiedLocalUser,
  registerUser,
} from "./identity-service.js";
import {
  acceptInvitation,
  inspectInvitation,
  listTenantsForUser,
} from "./tenant-service.js";
import {
  isLocalLoginEnabled,
  isSelfRegistrationEnabled,
} from "./settings-service.js";
import { pool } from "./db.js";
import { writeAudit } from "./audit-service.js";

const router = Router();

function requestContext(req: AuthenticatedRequest): {
  userAgent?: string;
  ipAddress?: string;
} {
  return {
    userAgent: req.header("user-agent")?.slice(0, 1000),
    ipAddress: req.ip,
  };
}

function cookie(req: AuthenticatedRequest, name: string): string | undefined {
  const raw = req.header("cookie");
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function setRefreshCookie(res: Response, token: string): void {
  const secure = process.env.NODE_ENV === "production";
  res.setHeader(
    "Set-Cookie",
    `a2a_refresh=${encodeURIComponent(token)}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=${config.refreshTokenDays * 86400}${secure ? "; Secure" : ""}`,
  );
}

function clearRefreshCookie(res: Response): void {
  res.setHeader(
    "Set-Cookie",
    `a2a_refresh=; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
  );
}

function respondWithTokens(
  res: Response,
  tokens: Awaited<ReturnType<typeof issueTokenPair>>,
  status = 200,
): void {
  setRefreshCookie(res, tokens.refreshToken);
  res.status(status).json({
    accessToken: tokens.accessToken,
    accessTokenExpiresIn: tokens.accessTokenExpiresIn,
    refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
    user: tokens.user,
  });
}

router.get(
  "/config",
  asyncHandler(async (_req, res) => {
    res.json({
      localLoginEnabled: await isLocalLoginEnabled(),
      selfRegistrationEnabled: await isSelfRegistrationEnabled(),
      oidcEnabled: oidcEnabled(),
      issuer: oidcEnabled() ? config.oidcIssuer : undefined,
    });
  }),
);

router.get(
  "/invitations/:token",
  asyncHandler(async (req, res) => {
    const token = z.string().min(1).parse(req.params.token);
    res.json({ invitation: await inspectInvitation(token) });
  }),
);

router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const context = requestContext(req);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const user = await registerUser(req.body, context, client);
      await writeAudit(
        {
          actorId: user.id,
          requestId: req.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
        "user.self_registered",
        { type: "user", id: user.id },
        { emailVerified: user.emailVerified },
        "success",
        client,
      );
      const tokens = await issueTokenPair(user, context, client);
      await client.query("COMMIT");
      respondWithTokens(res, tokens, 201);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }),
);

router.post(
  "/invitations/:token/activate",
  asyncHandler(async (req, res) => {
    if (!(await isLocalLoginEnabled()))
      throw new AppError(
        403,
        "LOCAL_ACTIVATION_DISABLED",
        "本地账号激活未启用，请使用企业身份登录后接受邀请。",
      );
    const token = z.string().min(1).parse(req.params.token);
    const invitation = await inspectInvitation(token);
    const input = z
      .object({
        displayName: z.string().trim().min(1).max(100),
        password: z.string().min(12).max(256),
      })
      .parse(req.body);
    const existing = await findUserByEmail(invitation.email);
    if (
      existing?.emailVerified ||
      (existing && !existing.id.startsWith("local:"))
    )
      throw new ConflictError(
        "USER_EXISTS_LOGIN_REQUIRED",
        "该邮箱已有关联账号，请先登录后再接受邀请。",
      );
    const client = await pool.connect();
    let user: Awaited<ReturnType<typeof createUser>>;
    let tokens: Awaited<ReturnType<typeof issueTokenPair>>;
    try {
      await client.query("BEGIN");
      if (existing) await retireUnverifiedLocalUser(existing, client);
      user = await createUser(
        {
          email: invitation.email,
          displayName: input.displayName,
          password: input.password,
        },
        client,
      );
      await acceptInvitation(
        token,
        { id: user.id, email: user.email, displayName: user.displayName },
        client,
      );
      tokens = await issueTokenPair(user, requestContext(req), client);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    respondWithTokens(res, tokens);
  }),
);

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    respondWithTokens(res, await login(req.body, requestContext(req)));
  }),
);

router.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const token =
      cookie(req, "a2a_refresh") ??
      z.string().min(1).parse(req.body?.refreshToken);
    respondWithTokens(res, await refreshTokens(token, requestContext(req)));
  }),
);

router.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const token = cookie(req, "a2a_refresh") ?? req.body?.refreshToken;
    if (typeof token === "string") await revokeRefreshToken(token);
    clearRefreshCookie(res);
    res.status(204).end();
  }),
);

router.get(
  "/me",
  requireAuthentication,
  asyncHandler(async (req, res) => {
    const principal = req.principal!;
    const user =
      principal.id === "local-admin" && config.devToken
        ? {
            id: principal.id,
            email: principal.email ?? "local-admin@localhost",
            displayName: principal.displayName ?? "本地平台管理员",
            platformRole: principal.platformRole,
            status: "active" as const,
            emailVerified: true,
          }
        : await getUser(principal.id);
    const tenants =
      principal.platformRole === "platform_admin"
        ? []
        : await listTenantsForUser(principal.id);
    res.json({ user, tenants });
  }),
);

router.get(
  "/oidc/start",
  asyncHandler(async (req, res) => {
    const authorizationUrl = await createOidcAuthorization(
      typeof req.query.returnTo === "string" ? req.query.returnTo : "/",
    );
    if (req.query.redirect === "true")
      return res.redirect(302, authorizationUrl);
    res.json({ authorizationUrl });
  }),
);

router.get(
  "/oidc/callback",
  asyncHandler(async (req, res) => {
    const result = await completeOidcCallback(
      z.string().min(1).parse(req.query.code),
      z.string().min(1).parse(req.query.state),
    );
    const hash = new URLSearchParams({
      code: result.exchangeCode,
      returnTo: result.returnTo,
    });
    res.redirect(
      302,
      `${config.consoleOrigin}/auth/callback?${hash.toString()}`,
    );
  }),
);

router.post(
  "/oidc/exchange",
  asyncHandler(async (req, res) => {
    const code = z.string().min(1).parse(req.body?.code);
    respondWithTokens(res, await exchangeOidcCode(code, requestContext(req)));
  }),
);

export { router as authRouter };
