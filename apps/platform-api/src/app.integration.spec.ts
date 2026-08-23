import http from "node:http";
import crypto from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { pool, query } from "./db.js";
import { hashApiKey } from "./api-key-service.js";
import { processWebhookBatch } from "./webhook-service.js";
import { processNotificationBatch } from "./notification-service.js";
import { signAccessToken } from "./auth.js";
import {
  createUser,
  issueTokenPair,
  upsertOidcUser,
} from "./identity-service.js";
import { SendMessageResponse, Task } from "@a2a-js/sdk";
import { config } from "./config.js";
import {
  appendTaskEvent,
  getTaskDetail,
  markTaskCancelled,
} from "./task-service.js";

const admin = "Bearer dev-admin-token";
const unique = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
const registrationIpSeed = Math.floor(Math.random() * 60_000);
const registrationIp = (offset: number) => {
  const value = registrationIpSeed + offset;
  return `198.18.${Math.floor(value / 250) % 250}.${(value % 250) + 1}`;
};
const createdTenantIds: string[] = [];
const createdAgentIds: string[] = [];
const createdUserIds: string[] = [];
let failingWebhookServer: http.Server;
let failingWebhookUrl: string;
let rpcAgentServer: http.Server;
let rpcAgentUrl: string;

async function createTenant(slug: string) {
  const response = await request(createApp())
    .post("/api/admin/tenants")
    .set("Authorization", admin)
    .send({ slug, displayName: `测试租户 ${slug}`, minuteRequestLimit: 10 });
  expect(response.status).toBe(201);
  createdTenantIds.push(response.body.tenant.id);
  return response.body.tenant as { id: string; slug: string };
}

async function createKey(
  tenantId: string,
  input: Record<string, unknown> = {},
) {
  const response = await request(createApp())
    .post(`/api/admin/tenants/${tenantId}/api-keys`)
    .set("Authorization", admin)
    .send({
      name: "Integration Key",
      scopes: ["agent:invoke", "task:read", "task:cancel"],
      ...input,
    });
  expect(response.status).toBe(201);
  return response.body.key as { id: string; secret: string; prefix: string };
}

beforeAll(async () => {
  failingWebhookServer = http.createServer((_req, res) => {
    res.writeHead(503, { "content-type": "text/plain" });
    res.end("temporary unavailable");
  });
  await new Promise<void>((resolve) =>
    failingWebhookServer.listen(0, "127.0.0.1", resolve),
  );
  const address = failingWebhookServer.address();
  if (!address || typeof address === "string")
    throw new Error("mock webhook server did not bind");
  failingWebhookUrl = `http://127.0.0.1:${address.port}/events`;
  rpcAgentServer = http.createServer((incoming, response) => {
    const chunks: Buffer[] = [];
    incoming.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    incoming.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        id: string | number;
        method: string;
      };
      if (!["SendMessage", "GetTask"].includes(body.method)) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "unsupported" }));
        return;
      }
      const task = Task.fromJSON({
        id: `rpc-task-${unique}`,
        contextId: `rpc-context-${unique}`,
        status: { state: "TASK_STATE_COMPLETED" },
        artifacts: [],
        history: [],
        metadata: {},
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result:
            body.method === "GetTask"
              ? Task.toJSON(task)
              : SendMessageResponse.toJSON({
                  payload: { $case: "task", value: task },
                }),
        }),
      );
    });
  });
  await new Promise<void>((resolve) =>
    rpcAgentServer.listen(0, "127.0.0.1", resolve),
  );
  const rpcAddress = rpcAgentServer.address();
  if (!rpcAddress || typeof rpcAddress === "string")
    throw new Error("mock RPC Agent did not bind");
  rpcAgentUrl = `http://127.0.0.1:${rpcAddress.port}/rpc`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    failingWebhookServer.close((error) => (error ? reject(error) : resolve())),
  );
  await new Promise<void>((resolve, reject) =>
    rpcAgentServer.close((error) => (error ? reject(error) : resolve())),
  );
  if (createdAgentIds.length) {
    await query("DELETE FROM agents WHERE id = ANY($1::uuid[])", [
      createdAgentIds,
    ]);
  }
  if (createdTenantIds.length) {
    await query("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [
      createdTenantIds,
    ]);
  }
  if (createdUserIds.length)
    await query("DELETE FROM platform_users WHERE id = ANY($1::text[])", [
      createdUserIds,
    ]);
  await pool.end();
});

describe("admin authentication and tenant lifecycle", () => {
  it("returns a structured authentication error without a token", async () => {
    const response = await request(createApp()).get("/api/admin/tenants");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("AUTHENTICATION_REQUIRED");
  });

  it("rate-limits repeated local login attempts in shared storage", async () => {
    const email = `rate-limit-${unique}@example.com`;
    for (let attempt = 0; attempt < 10; attempt++) {
      const response = await request(createApp())
        .post("/api/auth/login")
        .send({ email, password: "wrong-password" });
      expect(response.status).toBe(401);
    }
    const limited = await request(createApp())
      .post("/api/auth/login")
      .send({ email, password: "wrong-password" });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("LOGIN_RATE_LIMITED");
  });

  it("never links an OIDC identity to an existing local account by email", async () => {
    const email = `oidc-link-${unique}@example.com`;
    const local = await createUser({
      email,
      displayName: "Existing Local Admin",
      password: "safe-integration-password-456",
      platformRole: "platform_admin",
    });
    createdUserIds.push(local.id);
    await expect(
      upsertOidcUser({
        issuer: "https://idp.example.com",
        subject: `subject-${unique}`,
        email,
        emailVerified: true,
      }),
    ).rejects.toMatchObject({ code: "OIDC_ACCOUNT_LINK_REQUIRED" });
    await expect(
      upsertOidcUser({
        issuer: "https://idp.example.com",
        subject: `unverified-${unique}`,
        email: `unverified-${unique}@example.com`,
        emailVerified: false,
      }),
    ).rejects.toMatchObject({ code: "OIDC_EMAIL_NOT_VERIFIED" });
  });

  it("lets a verified OIDC identity reclaim an unverified self-registration", async () => {
    const email = `oidc-reclaim-${unique}@example.com`;
    const local = await createUser(
      {
        email,
        displayName: "Unverified Placeholder",
        password: "safe-unverified-placeholder-123",
      },
      undefined,
      { emailVerified: false },
    );
    createdUserIds.push(local.id);
    await issueTokenPair(local, {});
    const reclaimed = await upsertOidcUser({
      issuer: "https://idp.example.com",
      subject: `reclaim-${unique}`,
      email,
      displayName: "Verified Owner",
      emailVerified: true,
    });
    createdUserIds.push(reclaimed.id);
    expect(reclaimed).toMatchObject({
      displayName: "Verified Owner",
      emailVerified: true,
    });
    expect(reclaimed.id).not.toBe(local.id);
    const state = await query<{
      status: string;
      password_hash: string | null;
      active_sessions: string;
    }>(
      `SELECT u.status,u.password_hash,
        (SELECT count(*) FROM auth_sessions s WHERE s.user_id=u.id AND s.revoked_at IS NULL)::text AS active_sessions
       FROM platform_users u WHERE u.id=$1`,
      [local.id],
    );
    expect(state[0]).toMatchObject({
      status: "disabled",
      password_hash: null,
      active_sessions: "0",
    });
  });

  it("creates, searches, edits, suspends and reactivates a tenant", async () => {
    const tenant = await createTenant(`lifecycle-${unique}`);
    const search = await request(createApp())
      .get(`/api/admin/tenants?search=${tenant.slug}&page=1&pageSize=5`)
      .set("Authorization", admin);
    expect(search.status).toBe(200);
    expect(search.body.total).toBe(1);
    expect(search.body.items[0].slug).toBe(tenant.slug);

    const edit = await request(createApp())
      .patch(`/api/admin/tenants/${tenant.id}`)
      .set("Authorization", admin)
      .send({ description: "integration lifecycle", dailyRequestLimit: 1234 });
    expect(edit.status).toBe(200);
    expect(edit.body.tenant.dailyRequestLimit).toBe(1234);

    const suspend = await request(createApp())
      .post(`/api/admin/tenants/${tenant.id}/status`)
      .set("Authorization", admin)
      .send({ status: "suspended" });
    expect(suspend.status).toBe(200);
    expect(suspend.body.tenant.status).toBe("suspended");

    const activate = await request(createApp())
      .post(`/api/admin/tenants/${tenant.id}/status`)
      .set("Authorization", admin)
      .send({ status: "active" });
    expect(activate.body.tenant.status).toBe("active");
  });
});

describe("self registration and the safe Agent catalog", () => {
  it("registers and signs in a customer without granting tenant or platform roles", async () => {
    const email = `self-register-${unique}@example.com`;
    const registration = await request(createApp())
      .post("/api/auth/register")
      .set("X-Forwarded-For", registrationIp(1))
      .send({
        email,
        displayName: "Self Registered Customer",
        password: "safe-self-registration-123",
      });
    expect(registration.status).toBe(201);
    expect(registration.body.accessToken).toBeTruthy();
    expect(registration.body.user).toMatchObject({
      email,
      emailVerified: false,
      status: "active",
    });
    expect(registration.body.user.platformRole).toBeUndefined();
    createdUserIds.push(registration.body.user.id);

    const session = await request(createApp())
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${registration.body.accessToken}`);
    expect(session.status).toBe(200);
    expect(session.body.tenants).toEqual([]);

    const duplicate = await request(createApp())
      .post("/api/auth/register")
      .set("X-Forwarded-For", registrationIp(1))
      .send({
        email,
        displayName: "Duplicate Customer",
        password: "safe-self-registration-456",
      });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("USER_EMAIL_EXISTS");
  });

  it("rejects an exhausted IP bucket without creating an email bucket", async () => {
    const ip = "198.51.100.99";
    const ipHash = crypto
      .createHmac("sha256", config.jwtSecret)
      .update(`ip:${ip}`)
      .digest("hex");
    await query(
      `INSERT INTO auth_registration_limits(subject_type,subject_hash,window_started_at,attempt_count)
       VALUES('ip',$1,now(),20)
       ON CONFLICT(subject_type,subject_hash) DO UPDATE
       SET window_started_at=now(),attempt_count=20,updated_at=now()`,
      [ipHash],
    );
    const before = await query<{ count: string }>(
      "SELECT count(*) FROM auth_registration_limits",
    );
    const limited = await request(createApp())
      .post("/api/auth/register")
      .set("X-Forwarded-For", ip)
      .send({
        email: `blocked-${unique}@example.com`,
        displayName: "Blocked Customer",
        password: "safe-blocked-registration-123",
      });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("REGISTRATION_RATE_LIMITED");
    const after = await query<{ count: string }>(
      "SELECT count(*) FROM auth_registration_limits",
    );
    expect(after[0].count).toBe(before[0].count);
  });

  it("replaces an unverified placeholder before granting an invitation role", async () => {
    const tenant = await createTenant(`reclaim-invite-${unique}`);
    const email = `reclaim-invite-${unique}@example.com`;
    const registration = await request(createApp())
      .post("/api/auth/register")
      .set("X-Forwarded-For", registrationIp(2))
      .send({
        email,
        displayName: "Unverified Placeholder",
        password: "safe-placeholder-password-123",
      });
    expect(registration.status).toBe(201);
    const oldUserId = registration.body.user.id as string;
    createdUserIds.push(oldUserId);
    const invitation = await request(createApp())
      .post(`/api/admin/tenants/${tenant.id}/members/invite`)
      .set("Authorization", admin)
      .send({ email, role: "developer", displayName: "Verified Invitee" });
    expect(invitation.status).toBe(201);
    const activation = await request(createApp())
      .post(`/api/auth/invitations/${invitation.body.invitationToken}/activate`)
      .send({
        displayName: "Verified Invitee",
        password: "safe-verified-invitee-123",
      });
    expect(activation.status).toBe(200);
    const newUserId = activation.body.user.id as string;
    createdUserIds.push(newUserId);
    expect(newUserId).not.toBe(oldUserId);
    expect(activation.body.user.emailVerified).toBe(true);

    const oldSession = await request(createApp())
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${registration.body.accessToken}`);
    expect(oldSession.status).toBe(200);
    expect(oldSession.body.user.status).toBe("disabled");
    expect(oldSession.body.tenants).toEqual([]);
    const newSession = await request(createApp())
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${activation.body.accessToken}`);
    expect(newSession.status).toBe(200);
    expect(newSession.body.tenants).toEqual([
      expect.objectContaining({ id: tenant.id, role: "developer" }),
    ]);
  });

  it("shows only public Agents before a customer receives tenant access", async () => {
    const owner = await createTenant(`catalog-owner-${unique}`);
    const publicSlug = `catalog-public-${unique}`;
    const privateSlug = `catalog-private-${unique}`;
    await insertTestAgent(owner.id, publicSlug, "public");
    await insertTestAgent(owner.id, privateSlug, "private");
    const registration = await request(createApp())
      .post("/api/auth/register")
      .set("X-Forwarded-For", registrationIp(3))
      .send({
        email: `catalog-public-${unique}@example.com`,
        displayName: "Catalog Customer",
        password: "safe-catalog-password-123",
      });
    createdUserIds.push(registration.body.user.id);
    const catalog = await request(createApp())
      .get("/api/catalog/agents")
      .set("Authorization", `Bearer ${registration.body.accessToken}`);
    expect(catalog.status).toBe(200);
    const ownFixtures = catalog.body.items.filter((agent: { slug: string }) =>
      agent.slug.startsWith("catalog-"),
    );
    expect(ownFixtures.map((agent: { slug: string }) => agent.slug)).toEqual([
      publicSlug,
    ]);
    expect(ownFixtures[0]).toMatchObject({
      access: "public",
      manageable: false,
      administrable: false,
      cardUrl: expect.stringContaining(
        `/agents/${publicSlug}/.well-known/agent-card.json`,
      ),
    });
    expect(JSON.stringify(ownFixtures[0])).not.toContain("127.0.0.1:9");
  });

  it("adds tenant-owned and explicitly granted Agents to a member catalog", async () => {
    const owner = await createTenant(`catalog-member-${unique}`);
    const provider = await createTenant(`catalog-provider-${unique}`);
    const ownedSlug = `catalog-owned-${unique}`;
    const grantedSlug = `catalog-granted-${unique}`;
    await insertTestAgent(owner.id, ownedSlug, "private");
    const grantedAgentId = await insertTestAgent(
      provider.id,
      grantedSlug,
      "tenant",
    );
    await query("UPDATE agents SET allowed_tenant_ids=$2 WHERE id=$1", [
      grantedAgentId,
      JSON.stringify([owner.id]),
    ]);
    const registration = await request(createApp())
      .post("/api/auth/register")
      .set("X-Forwarded-For", registrationIp(4))
      .send({
        email: `catalog-member-${unique}@example.com`,
        displayName: "Tenant Catalog Developer",
        password: "safe-catalog-password-456",
      });
    const user = registration.body.user as { id: string; email: string };
    createdUserIds.push(user.id);
    await query(
      `INSERT INTO tenant_members(tenant_id,user_id,email,display_name,role,status,accepted_at)
       VALUES($1,$2,$3,'Tenant Catalog Developer','developer','active',now())`,
      [owner.id, user.id, user.email],
    );
    const catalog = await request(createApp())
      .get(`/api/catalog/agents?tenantId=${owner.id}`)
      .set("Authorization", `Bearer ${registration.body.accessToken}`);
    expect(catalog.status).toBe(200);
    const fixtures = new Map(
      catalog.body.items
        .filter((agent: { slug: string }) =>
          [ownedSlug, grantedSlug].includes(agent.slug),
        )
        .map((agent: { slug: string }) => [agent.slug, agent]),
    );
    expect(fixtures.get(ownedSlug)).toMatchObject({
      access: "tenant_owner",
      manageable: true,
      administrable: false,
    });
    expect(fixtures.get(grantedSlug)).toMatchObject({
      access: "tenant_grant",
      manageable: false,
      administrable: false,
    });
  });
});

describe("tenant membership and role protection", () => {
  it("lets a first-time customer activate an invited account and receive tenant scope", async () => {
    const tenant = await createTenant(`activate-${unique}`);
    const email = `activate-${unique}@example.com`;
    const invitation = await request(createApp())
      .post(`/api/admin/tenants/${tenant.id}/members/invite`)
      .set("Authorization", admin)
      .send({ email, displayName: "Invited Customer", role: "developer" });
    const activation = await request(createApp())
      .post(`/api/auth/invitations/${invitation.body.invitationToken}/activate`)
      .send({
        displayName: "Invited Customer",
        password: "safe-integration-password-123",
      });
    expect(activation.status).toBe(200);
    expect(activation.body.accessToken).toBeTruthy();
    createdUserIds.push(activation.body.user.id);
    const me = await request(createApp())
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${activation.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.tenants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: tenant.id, role: "developer" }),
      ]),
    );
  });

  it("invites a member and writes a tenant-scoped audit record", async () => {
    const tenant = await createTenant(`members-${unique}`);
    const invitation = await request(createApp())
      .post(`/api/admin/tenants/${tenant.id}/members/invite`)
      .set("Authorization", admin)
      .send({
        email: `developer-${unique}@example.com`,
        displayName: "Integration Developer",
        role: "developer",
      });
    expect(invitation.status).toBe(201);
    expect(invitation.body.invitationToken.length).toBeGreaterThan(30);
    expect(invitation.body.member.status).toBe("invited");

    const audit = await request(createApp())
      .get(`/api/admin/audit?tenantId=${tenant.id}&action=member.invited`)
      .set("Authorization", admin);
    expect(audit.status).toBe(200);
    expect(audit.body.items[0]).toMatchObject({
      action: "member.invited",
      tenantId: tenant.id,
    });
  });

  it("prevents removing the last active tenant administrator", async () => {
    const tenant = await createTenant(`last-admin-${unique}`);
    const rows = await query<{ id: string }>(
      `INSERT INTO tenant_members(tenant_id,user_id,email,display_name,role,status,accepted_at)
       VALUES($1,'sole-admin',$2,'Sole Admin','tenant_admin','active',now()) RETURNING id`,
      [tenant.id, `sole-admin-${unique}@example.com`],
    );
    const response = await request(createApp())
      .delete(`/api/admin/tenants/${tenant.id}/members/${rows[0].id}`)
      .set("Authorization", admin);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("LAST_TENANT_ADMIN");
  });

  it("rejects a viewer attempting a tenant-admin mutation", async () => {
    const tenant = await createTenant(`viewer-role-${unique}`);
    await query(
      `INSERT INTO tenant_members(tenant_id,user_id,email,display_name,role,status,accepted_at)
       VALUES($1,'viewer-user',$2,'Read Only','viewer','active',now())`,
      [tenant.id, `viewer-${unique}@example.com`],
    );
    const viewerToken = signAccessToken({
      id: "viewer-user",
      email: `viewer-${unique}@example.com`,
    });
    const response = await request(createApp())
      .patch(`/api/admin/tenants/${tenant.id}`)
      .set("Authorization", `Bearer ${viewerToken}`)
      .send({ description: "unauthorized mutation" });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("TENANT_ROLE_DENIED");
  });

  it("never falls back to global dashboard, audit or alert scope for a tenant user", async () => {
    const own = await createTenant(`scope-own-${unique}`);
    const other = await createTenant(`scope-other-${unique}`);
    await query(
      `INSERT INTO tenant_members(tenant_id,user_id,email,display_name,role,status,accepted_at)
       VALUES($1,'scoped-viewer',$2,'Scoped Viewer','viewer','active',now())`,
      [own.id, `scoped-${unique}@example.com`],
    );
    const token = signAccessToken({ id: "scoped-viewer" });
    const missingScope = await request(createApp())
      .get("/api/admin/dashboard")
      .set("Authorization", `Bearer ${token}`);
    expect(missingScope.status).toBe(400);
    expect(missingScope.body.error.code).toBe("TENANT_CONTEXT_REQUIRED");

    const crossTenantAudit = await request(createApp())
      .get(`/api/admin/audit?tenantId=${other.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(crossTenantAudit.status).toBe(403);

    const globalRule = await request(createApp())
      .post("/api/admin/alerts/rules")
      .set("Authorization", admin)
      .send({
        name: `Global rule ${unique}`,
        metric: "latency_ms",
        operator: "gt",
        threshold: 1000,
      });
    expect(globalRule.status).toBe(201);
    const mutateGlobal = await request(createApp())
      .patch(`/api/admin/alerts/rules/${globalRule.body.rule.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ enabled: false });
    expect(mutateGlobal.status).toBe(403);
    expect(mutateGlobal.body.error.code).toBe("PLATFORM_ALERT_ADMIN_REQUIRED");
    await query("DELETE FROM alert_rules WHERE id=$1", [
      globalRule.body.rule.id,
    ]);
  });
});

describe("API key storage and gateway authorization", () => {
  it("shows the secret once and stores only a hash and prefix", async () => {
    const tenant = await createTenant(`key-storage-${unique}`);
    const key = await createKey(tenant.id, {
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    });
    expect(key.secret).toMatch(/^a2a_live_/);
    const stored = await query<{ secret_hash: string; key_prefix: string }>(
      "SELECT secret_hash,key_prefix FROM api_keys WHERE id=$1",
      [key.id],
    );
    expect(stored[0].secret_hash).toBe(hashApiKey(key.secret));
    expect(stored[0].secret_hash).not.toContain(key.secret);
    expect(stored[0].key_prefix).toBe(key.prefix);

    const list = await request(createApp())
      .get(`/api/admin/tenants/${tenant.id}/api-keys`)
      .set("Authorization", admin);
    expect(JSON.stringify(list.body)).not.toContain(key.secret);
    expect(list.body.keys[0].prefix).toBe(key.prefix);
  });

  it("returns distinct invalid, revoked, expired and scope errors", async () => {
    const tenant = await createTenant(`key-errors-${unique}`);
    const agentId = await insertTestAgent(
      tenant.id,
      `key-agent-${unique}`,
      "private",
    );
    const invalid = await request(createApp())
      .post(`/agents/key-agent-${unique}/a2a/rest/message:send`)
      .set("X-API-Key", "a2a_live_not-valid")
      .send({});
    expect(invalid.status).toBe(401);
    expect(invalid.body.error.code).toBe("API_KEY_INVALID");

    const revokedKey = await createKey(tenant.id);
    await request(createApp())
      .post(`/api/admin/tenants/${tenant.id}/api-keys/${revokedKey.id}/revoke`)
      .set("Authorization", admin);
    const revoked = await request(createApp())
      .post(`/agents/key-agent-${unique}/a2a/rest/message:send`)
      .set("X-API-Key", revokedKey.secret)
      .send({});
    expect(revoked.body.error.code).toBe("API_KEY_REVOKED");
    const rejectedUsage = await query<{ error_code: string }>(
      "SELECT error_code FROM usage_records WHERE api_key_id=$1 ORDER BY created_at DESC LIMIT 1",
      [revokedKey.id],
    );
    expect(rejectedUsage[0].error_code).toBe("API_KEY_REVOKED");

    const expiredKey = await createKey(tenant.id);
    await query(
      "UPDATE api_keys SET expires_at=now()-interval '1 minute' WHERE id=$1",
      [expiredKey.id],
    );
    const expired = await request(createApp())
      .post(`/agents/key-agent-${unique}/a2a/rest/message:send`)
      .set("X-API-Key", expiredKey.secret)
      .send({});
    expect(expired.body.error.code).toBe("API_KEY_EXPIRED");

    const readOnlyKey = await createKey(tenant.id, { scopes: ["task:read"] });
    const denied = await request(createApp())
      .post(`/agents/key-agent-${unique}/a2a/rest/message:send`)
      .set("X-API-Key", readOnlyKey.secret)
      .send({});
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("API_KEY_SCOPE_DENIED");
    expect(createdAgentIds).toContain(agentId);
  });

  it("limits the external catalog to explicit per-key Agent grants", async () => {
    const tenant = await createTenant(`catalog-grants-${unique}`);
    const allowedId = await insertTestAgent(
      tenant.id,
      `catalog-allowed-${unique}`,
      "public",
    );
    await insertTestAgent(tenant.id, `catalog-denied-${unique}`, "public");
    const key = await createKey(tenant.id, { agentIds: [allowedId] });
    const catalog = await request(createApp())
      .get("/v1/agents")
      .set("X-API-Key", key.secret);
    expect(catalog.status).toBe(200);
    expect(
      catalog.body.agents.map((agent: { slug: string }) => agent.slug),
    ).toEqual([`catalog-allowed-${unique}`]);
  });

  it("proxies a JSON-RPC SendMessage call and persists its selected instance", async () => {
    const tenant = await createTenant(`jsonrpc-${unique}`);
    const slug = `jsonrpc-agent-${unique}`;
    const agentId = await insertTestAgent(tenant.id, slug, "private");
    const selectedInterface = {
      url: rpcAgentUrl,
      protocolBinding: "JSONRPC",
      protocolVersion: "1.0",
      tenant: "",
    };
    const instance = await query<{ id: string }>(
      `INSERT INTO agent_instances(agent_id,name,card_url,selected_interface,status,health_status)
       VALUES($1,'rpc-backend',$2,$3,'active','healthy') RETURNING id`,
      [agentId, `${rpcAgentUrl}/card`, JSON.stringify(selectedInterface)],
    );
    await query("UPDATE agents SET selected_interface=$2 WHERE id=$1", [
      agentId,
      JSON.stringify(selectedInterface),
    ]);
    const key = await createKey(tenant.id);
    const response = await request(createApp())
      .post(`/agents/${slug}/a2a/jsonrpc`)
      .set("X-API-Key", key.secret)
      .send({
        jsonrpc: "2.0",
        id: 7,
        method: "SendMessage",
        params: {
          message: {
            messageId: crypto.randomUUID(),
            role: "ROLE_USER",
            parts: [
              {
                content: { $case: "text", value: "hello" },
                mediaType: "text/plain",
              },
            ],
          },
        },
      });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ jsonrpc: "2.0", id: 7 });
    const stored = await query<{
      agent_instance_id: string;
      request_payload: Record<string, unknown>;
    }>(
      "SELECT agent_instance_id,request_payload FROM task_snapshots WHERE agent_id=$1 AND remote_task_id=$2",
      [agentId, `rpc-task-${unique}`],
    );
    expect(stored[0].agent_instance_id).toBe(instance[0].id);
    expect(stored[0].request_payload).toHaveProperty("message");
    await query(
      `INSERT INTO agent_instances(agent_id,name,card_url,selected_interface,status,health_status,priority)
       VALUES($1,'wrong-priority-backend','http://127.0.0.1:9/card',$2,'active','healthy',0)`,
      [
        agentId,
        JSON.stringify({
          ...selectedInterface,
          url: "http://127.0.0.1:9/rpc",
        }),
      ],
    );
    await query("UPDATE agents SET routing_strategy='priority' WHERE id=$1", [
      agentId,
    ]);
    const getTask = await request(createApp())
      .post(`/agents/${slug}/a2a/jsonrpc`)
      .set("X-API-Key", key.secret)
      .send({
        jsonrpc: "2.0",
        id: 9,
        method: "GetTask",
        params: { id: `rpc-task-${unique}` },
      });
    expect(getTask.status).toBe(200);
    expect(getTask.body.result.id).toBe(`rpc-task-${unique}`);
  });

  it("isolates private agents between tenants", async () => {
    const owner = await createTenant(`owner-${unique}`);
    const consumer = await createTenant(`consumer-${unique}`);
    await insertTestAgent(owner.id, `private-agent-${unique}`, "private");
    const key = await createKey(consumer.id);
    const response = await request(createApp())
      .get(`/agents/private-agent-${unique}/a2a/rest/tasks/remote-task`)
      .set("X-API-Key", key.secret);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("AGENT_ACCESS_DENIED");
  });

  it("binds task read access to the API Key tenant even for a public Agent", async () => {
    const owner = await createTenant(`task-owner-${unique}`);
    const consumer = await createTenant(`task-consumer-${unique}`);
    const agentId = await insertTestAgent(
      owner.id,
      `public-task-agent-${unique}`,
      "public",
    );
    await appendTaskEvent({
      agentId,
      tenantId: owner.id,
      remoteTaskId: `private-task-${unique}`,
      state: "TASK_STATE_WORKING",
      eventType: "task",
      event: { id: `private-task-${unique}` },
    });
    const key = await createKey(consumer.id);
    const response = await request(createApp())
      .get(
        `/agents/public-task-agent-${unique}/a2a/rest/tasks/private-task-${unique}`,
      )
      .set("X-API-Key", key.secret);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("TASK_TENANT_DENIED");
  });

  it("keeps identical remote Task IDs isolated for each tenant", async () => {
    const first = await createTenant(`same-task-a-${unique}`);
    const second = await createTenant(`same-task-b-${unique}`);
    const agentId = await insertTestAgent(
      first.id,
      `same-task-agent-${unique}`,
      "public",
    );
    const remoteTaskId = `shared-sequence-1-${unique}`;
    await appendTaskEvent({
      agentId,
      tenantId: first.id,
      remoteTaskId,
      eventType: "task",
      event: { owner: "first" },
    });
    await appendTaskEvent({
      agentId,
      tenantId: second.id,
      remoteTaskId,
      eventType: "task",
      event: { owner: "second" },
    });
    const rows = await query<{
      tenant_id: string;
      latest_event: { owner: string };
    }>(
      `SELECT tenant_id,latest_event FROM task_snapshots
       WHERE agent_id=$1 AND remote_task_id=$2 ORDER BY tenant_id`,
      [agentId, remoteTaskId],
    );
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.tenant_id))).toEqual(
      new Set([first.id, second.id]),
    );
    expect(new Set(rows.map((row) => row.latest_event.owner))).toEqual(
      new Set(["first", "second"]),
    );
  });

  it("appends streamed artifact parts instead of replacing prior output", async () => {
    const tenant = await createTenant(`artifact-${unique}`);
    const agentId = await insertTestAgent(
      tenant.id,
      `artifact-agent-${unique}`,
      "private",
    );
    const remoteTaskId = `artifact-task-${unique}`;
    await appendTaskEvent({
      agentId,
      tenantId: tenant.id,
      remoteTaskId,
      eventType: "artifact-update",
      event: {
        artifactUpdate: {
          append: false,
          artifact: {
            artifactId: "report",
            name: "report.txt",
            metadata: { format: "text" },
            parts: [{ text: "first" }],
          },
        },
      },
    });
    await appendTaskEvent({
      agentId,
      tenantId: tenant.id,
      remoteTaskId,
      eventType: "artifact-update",
      event: {
        artifactUpdate: {
          append: true,
          artifact: {
            artifactId: "report",
            metadata: { final: true },
            parts: [{ text: " second" }],
          },
        },
      },
    });
    const rows = await query<{
      artifacts: Array<{
        artifactId: string;
        metadata: Record<string, unknown>;
        parts: Array<{ text: string }>;
      }>;
    }>(
      `SELECT artifacts FROM task_snapshots
       WHERE tenant_id=$1 AND agent_id=$2 AND remote_task_id=$3`,
      [tenant.id, agentId, remoteTaskId],
    );
    expect(rows[0].artifacts).toEqual([
      expect.objectContaining({
        artifactId: "report",
        metadata: { format: "text", final: true },
        parts: [{ text: "first" }, { text: " second" }],
      }),
    ]);
  });

  it("rejects cross-tenant Task references embedded in SendMessage", async () => {
    const owner = await createTenant(`reference-owner-${unique}`);
    const consumer = await createTenant(`reference-consumer-${unique}`);
    const slug = `reference-agent-${unique}`;
    const agentId = await insertTestAgent(owner.id, slug, "public");
    const selectedInterface = {
      url: rpcAgentUrl,
      protocolBinding: "JSONRPC",
      protocolVersion: "1.0",
      tenant: "",
    };
    await query(
      `INSERT INTO agent_instances(agent_id,name,card_url,selected_interface,status,health_status)
       VALUES($1,'reference-backend',$2,$3,'active','healthy')`,
      [agentId, `${rpcAgentUrl}/card`, JSON.stringify(selectedInterface)],
    );
    const foreignTaskId = `foreign-reference-${unique}`;
    await appendTaskEvent({
      agentId,
      tenantId: owner.id,
      remoteTaskId: foreignTaskId,
      eventType: "task",
      event: { id: foreignTaskId },
    });
    const key = await createKey(consumer.id);
    const response = await request(createApp())
      .post(`/agents/${slug}/a2a/jsonrpc`)
      .set("X-API-Key", key.secret)
      .send({
        jsonrpc: "2.0",
        id: 8,
        method: "SendMessage",
        params: {
          message: {
            messageId: crypto.randomUUID(),
            role: "ROLE_USER",
            parts: [],
            referenceTaskIds: [foreignTaskId],
          },
        },
      });
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe(-32000);
    expect(response.body.error.data.status).toBe(404);
  });

  it("rejects all gateway traffic while a tenant is suspended", async () => {
    const tenant = await createTenant(`suspended-${unique}`);
    await insertTestAgent(tenant.id, `suspended-agent-${unique}`, "private");
    const key = await createKey(tenant.id);
    await query("UPDATE tenants SET status='suspended' WHERE id=$1", [
      tenant.id,
    ]);
    const response = await request(createApp())
      .get(`/agents/suspended-agent-${unique}/a2a/rest/tasks/task-1`)
      .set("X-API-Key", key.secret);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("TENANT_SUSPENDED");
  });

  it("returns 429 with quota details when the API key minute limit is exhausted", async () => {
    const tenant = await createTenant(`quota-${unique}`);
    await insertTestAgent(tenant.id, `quota-agent-${unique}`, "private");
    const key = await createKey(tenant.id, { minuteRequestLimit: 1 });
    await query(
      `INSERT INTO usage_records(tenant_id,api_key_id,request_id,operation,status_code)
       VALUES($1,$2,$3,'message.send',200)`,
      [tenant.id, key.id, `quota-seed-${unique}`],
    );
    await request(createApp())
      .get(`/agents/quota-agent-${unique}/a2a/rest/tasks/task-1`)
      .set("X-API-Key", key.secret);
    const response = await request(createApp())
      .get(`/agents/quota-agent-${unique}/a2a/rest/tasks/task-2`)
      .set("X-API-Key", key.secret);
    expect(response.status).toBe(429);
    expect(response.body.error.code).toBe("QUOTA_EXCEEDED");
    expect(response.body.error.details.quotas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ window: "minute", limit: 1, remaining: 0 }),
      ]),
    );
  });
});

describe("agent registration and task cancellation persistence", () => {
  it("returns a precise Card-unreachable error without creating an agent", async () => {
    const tenant = await createTenant(`card-error-${unique}`);
    const response = await request(createApp())
      .post("/api/admin/agents")
      .set("Authorization", admin)
      .send({
        slug: `unreachable-${unique}`,
        displayName: "Unreachable Agent",
        cardUrl: "http://127.0.0.1:9/.well-known/agent-card.json",
        tenantId: tenant.id,
      });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("AGENT_CARD_UNREACHABLE");
    const rows = await query<{ count: string }>(
      "SELECT count(*) FROM agents WHERE slug=$1",
      [`unreachable-${unique}`],
    );
    expect(Number(rows[0].count)).toBe(0);
  });

  it("stores a cancellation event and marks the task terminal", async () => {
    const tenant = await createTenant(`task-cancel-${unique}`);
    const agentId = await insertTestAgent(
      tenant.id,
      `task-agent-${unique}`,
      "private",
    );
    await markTaskCancelled(
      agentId,
      `cancelled-task-${unique}`,
      {
        id: `cancelled-task-${unique}`,
        status: { state: "TASK_STATE_CANCELED" },
      },
      { tenantId: tenant.id, requestId: `cancel-request-${unique}` },
    );
    const rows = await query<{ id: string }>(
      "SELECT id FROM task_snapshots WHERE agent_id=$1 AND remote_task_id=$2",
      [agentId, `cancelled-task-${unique}`],
    );
    const task = await getTaskDetail(Number(rows[0].id));
    expect(task.state).toBe("TASK_STATE_CANCELED");
    expect(task.cancelledAt).toBeTruthy();
    expect(task.events[0].eventType).toBe("task.cancelled");
    const outbox = await query<{ event_type: string; status: string }>(
      "SELECT event_type,status FROM task_event_outbox WHERE task_snapshot_id=$1",
      [task.id],
    );
    expect(outbox).toEqual([{ event_type: "task.failed", status: "pending" }]);
  });
});

describe("webhook delivery worker", () => {
  it("signs, attempts and dead-letters a failed delivery", async () => {
    const tenant = await createTenant(`webhook-${unique}`);
    const hook = await request(createApp())
      .post(`/api/admin/tenants/${tenant.id}/webhooks`)
      .set("Authorization", admin)
      .send({
        name: "Failing receiver",
        targetUrl: failingWebhookUrl,
        events: ["task.completed"],
        maxAttempts: 1,
        timeoutMs: 1000,
      });
    expect(hook.status).toBe(201);
    expect(hook.body.webhook.signingSecret).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    const secretRows = await query<{
      signing_secret: string | null;
      secret_ciphertext: string | null;
    }>(
      "SELECT signing_secret,secret_ciphertext FROM webhook_endpoints WHERE id=$1",
      [hook.body.webhook.id],
    );
    expect(secretRows[0].signing_secret).toBeNull();
    expect(secretRows[0].secret_ciphertext).toBeTruthy();

    const queued = await request(createApp())
      .post(
        `/api/admin/tenants/${tenant.id}/webhooks/${hook.body.webhook.id}/test`,
      )
      .set("Authorization", admin);
    expect(queued.status).toBe(202);
    const result = await processWebhookBatch(10);
    expect(result.deadLettered).toBeGreaterThanOrEqual(1);

    const deliveries = await request(createApp())
      .get(
        `/api/admin/tenants/${tenant.id}/webhooks/${hook.body.webhook.id}/deliveries?status=dead_letter`,
      )
      .set("Authorization", admin);
    expect(deliveries.status).toBe(200);
    expect(deliveries.body.items[0]).toMatchObject({
      status: "dead_letter",
      responseStatus: 503,
    });
  });

  it("dead-letters a durable alert notification after its configured attempts", async () => {
    const tenant = await createTenant(`notification-${unique}`);
    const channel = await request(createApp())
      .post(`/api/admin/tenants/${tenant.id}/notification-channels`)
      .set("Authorization", admin)
      .send({
        name: "Failing alert destination",
        type: "webhook",
        destination: failingWebhookUrl,
        config: { maxAttempts: 1, timeoutMs: 1000 },
      });
    expect(channel.status).toBe(201);
    expect(channel.body.channel.signingSecret).toMatch(/^ntf_/);
    await request(createApp())
      .post(
        `/api/admin/tenants/${tenant.id}/notification-channels/${channel.body.channel.id}/test`,
      )
      .set("Authorization", admin);
    await query(
      `UPDATE notification_records SET status='delivering',delivery_owner='crashed-worker',
       delivery_lease_until=now()-interval '1 minute'
       WHERE channel_id=$1 AND event_type='alert.triggered'`,
      [channel.body.channel.id],
    );
    const processed = await processNotificationBatch(10);
    expect(processed.failed).toBeGreaterThanOrEqual(1);
    const records = await request(createApp())
      .get(`/api/admin/notifications?tenantId=${tenant.id}&status=failed`)
      .set("Authorization", admin);
    expect(records.body.items[0]).toMatchObject({
      status: "failed",
      responseStatus: 503,
    });
  });
});

async function insertTestAgent(
  tenantId: string,
  slug: string,
  visibility: "private" | "tenant" | "public",
) {
  const card = {
    name: slug,
    description: "integration test agent",
    version: "1.0.0",
    capabilities: { streaming: true },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: [],
    supportedInterfaces: [
      {
        url: "http://127.0.0.1:9/a2a",
        protocolBinding: "HTTP+JSON",
        protocolVersion: "1.0",
        tenant: "",
      },
    ],
  };
  const rows = await query<{ id: string }>(
    `INSERT INTO agents(slug,display_name,description,card_url,card_snapshot,selected_interface,status,health_status,
       labels,tenant_id,visibility,allowed_tenant_ids,invocation_policy)
     VALUES($1,$2,'test','http://127.0.0.1:9/.well-known/agent-card.json',$3,$4,'online','healthy','[]',$5,$6,'[]',$7)
     RETURNING id`,
    [
      slug,
      slug,
      JSON.stringify(card),
      JSON.stringify(card.supportedInterfaces[0]),
      tenantId,
      visibility,
      JSON.stringify({ timeoutMs: 1000, maxRetries: 0, maxConcurrent: 2 }),
    ],
  );
  createdAgentIds.push(rows[0].id);
  return rows[0].id;
}
