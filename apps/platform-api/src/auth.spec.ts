import { describe, expect, it } from "vitest";
import {
  authenticate,
  hasRole,
  requireConfiguredJwtSecret,
  signAccessToken,
  verifyAccessToken,
} from "./auth.js";
import { apiKeyPrefix, hashApiKey } from "./api-key-service.js";
import { createAlertRuleSchema } from "./alert-service.js";
import { createTenantSchema, inviteMemberSchema } from "./tenant-service.js";
import { createWebhookSchema } from "./webhook-service.js";
import { config } from "./config.js";

describe("access token security", () => {
  it("signs and verifies a short-lived platform token", () => {
    const token = signAccessToken({
      id: "platform-user-1",
      email: "admin@example.com",
      displayName: "Admin",
      platformRole: "platform_admin",
    });
    expect(token.split(".")).toHaveLength(3);
    expect(verifyAccessToken(token)).toMatchObject({
      id: "platform-user-1",
      email: "admin@example.com",
      platformRole: "platform_admin",
    });
  });

  it("rejects a token whose payload was changed after signing", () => {
    const token = signAccessToken({ id: "member-1" });
    const [header, payload, signature] = token.split(".");
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    claims.sub = "attacker";
    const tampered = `${header}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${signature}`;
    expect(() => verifyAccessToken(tampered)).toThrow("签名无效");
  });

  it("keeps the development token available for local administration", () => {
    expect(authenticate("Bearer dev-admin-token")).toMatchObject({
      id: "local-admin",
      platformRole: "platform_admin",
    });
  });

  it("fails closed when production secrets or the development token are unsafe", () => {
    const saved = {
      nodeEnv: process.env.NODE_ENV,
      jwtSecret: config.jwtSecret,
      devToken: config.devToken,
      credentialEncryptionKey: config.credentialEncryptionKey,
      credentialKeyVersion: config.credentialKeyVersion,
      credentialPreviousKeys: config.credentialPreviousKeys,
    };
    try {
      process.env.NODE_ENV = "production";
      config.jwtSecret = "short";
      expect(() => requireConfiguredJwtSecret()).toThrow("PLATFORM_JWT_SECRET");
      config.jwtSecret = "j".repeat(32);
      expect(() => requireConfiguredJwtSecret()).toThrow("PLATFORM_DEV_TOKEN");
      config.devToken = "";
      config.credentialEncryptionKey = "weak";
      expect(() => requireConfiguredJwtSecret()).toThrow(
        "CREDENTIAL_ENCRYPTION_KEY",
      );
    } finally {
      if (saved.nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = saved.nodeEnv;
      Object.assign(config, {
        jwtSecret: saved.jwtSecret,
        devToken: saved.devToken,
        credentialEncryptionKey: saved.credentialEncryptionKey,
        credentialKeyVersion: saved.credentialKeyVersion,
        credentialPreviousKeys: saved.credentialPreviousKeys,
      });
    }
  });

  it("accepts a versioned production keyring with strong secrets", () => {
    const saved = {
      nodeEnv: process.env.NODE_ENV,
      jwtSecret: config.jwtSecret,
      devToken: config.devToken,
      credentialEncryptionKey: config.credentialEncryptionKey,
      credentialKeyVersion: config.credentialKeyVersion,
      credentialPreviousKeys: config.credentialPreviousKeys,
    };
    try {
      process.env.NODE_ENV = "production";
      Object.assign(config, {
        jwtSecret: "j".repeat(32),
        devToken: "",
        credentialEncryptionKey: "k".repeat(32),
        credentialKeyVersion: "v2",
        credentialPreviousKeys: JSON.stringify({ v1: "p".repeat(32) }),
      });
      expect(() => requireConfiguredJwtSecret()).not.toThrow();
    } finally {
      if (saved.nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = saved.nodeEnv;
      Object.assign(config, {
        jwtSecret: saved.jwtSecret,
        devToken: saved.devToken,
        credentialEncryptionKey: saved.credentialEncryptionKey,
        credentialKeyVersion: saved.credentialKeyVersion,
        credentialPreviousKeys: saved.credentialPreviousKeys,
      });
    }
  });
});

describe("role hierarchy", () => {
  it("allows higher roles to perform lower-role operations", () => {
    expect(hasRole("platform_admin", "tenant_admin")).toBe(true);
    expect(hasRole("tenant_admin", "developer")).toBe(true);
    expect(hasRole("developer", "viewer")).toBe(true);
  });

  it("does not allow a viewer to mutate developer resources", () => {
    expect(hasRole("viewer", "developer")).toBe(false);
    expect(hasRole("developer", "tenant_admin")).toBe(false);
  });
});

describe("API key handling", () => {
  it("uses a deterministic one-way hash and a non-secret prefix", () => {
    const key = "a2a_live_example-secret-material";
    expect(hashApiKey(key)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashApiKey(key)).toBe(hashApiKey(key));
    expect(hashApiKey(`${key}-changed`)).not.toBe(hashApiKey(key));
    expect(apiKeyPrefix(key)).toBe(key.slice(0, 17));
  });
});

describe("governance validation", () => {
  it("applies safe tenant quota defaults", () => {
    expect(
      createTenantSchema.parse({ slug: "team-one", displayName: "团队一" }),
    ).toMatchObject({
      slug: "team-one",
      displayName: "团队一",
      description: "",
    });
  });

  it("rejects malformed invitation roles and email addresses", () => {
    expect(() =>
      inviteMemberSchema.parse({ email: "bad", role: "owner" }),
    ).toThrow();
    expect(
      inviteMemberSchema.parse({ email: "dev@example.com", role: "developer" }),
    ).toMatchObject({
      role: "developer",
      expiresInHours: 72,
    });
  });

  it("accepts every required platform webhook event", () => {
    const parsed = createWebhookSchema.parse({
      name: "A2A events",
      targetUrl: "https://hooks.example.com/a2a",
      events: [
        "task.created",
        "task.working",
        "task.completed",
        "task.failed",
        "agent.degraded",
        "agent.recovered",
      ],
    });
    expect(parsed.maxAttempts).toBe(5);
    expect(parsed.timeoutMs).toBe(5000);
  });

  it("supports quota usage alert rules", () => {
    expect(
      createAlertRuleSchema.parse({
        name: "月配额接近耗尽",
        metric: "quota_usage_percent",
        operator: "gt",
        threshold: 80,
      }).metric,
    ).toBe("quota_usage_percent");
  });
});
