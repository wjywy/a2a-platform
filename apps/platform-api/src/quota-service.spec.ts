import crypto from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("./redis.js", () => ({ getRedis: async () => undefined }));

import { acquireQuota } from "./quota-service.js";
import { pool, query } from "./db.js";
import type { AuthenticatedApiKey } from "./api-key-service.js";

const tenantId = crypto.randomUUID();
const keyId = crypto.randomUUID();
const limits = {
  minuteRequestLimit: 1,
  dailyRequestLimit: 10,
  monthlyRequestLimit: 100,
  concurrentRequestLimit: 1,
};
const key: AuthenticatedApiKey = {
  id: keyId,
  tenantId,
  tenantSlug: "postgres-fallback",
  tenantStatus: "active",
  name: "Fallback test",
  prefix: "a2a_test",
  scopes: ["agent:invoke"],
  allowedAgentIds: [],
  limits,
  tenantLimits: limits,
  keyLimits: limits,
  warningThresholdPercent: 80,
};

afterAll(async () => {
  await query("DELETE FROM quota_counters WHERE subject_id=ANY($1::uuid[])", [
    [tenantId, keyId],
  ]);
  await pool.end();
});

describe("PostgreSQL quota fallback", () => {
  it("atomically reserves a request and rejects the next request at the hard limit", async () => {
    const lease = await acquireQuota(key);
    expect(lease.snapshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subject: "tenant",
          window: "minute",
          used: 1,
          remaining: 0,
        }),
      ]),
    );
    await expect(acquireQuota(key)).rejects.toMatchObject({
      status: 429,
      code: "QUOTA_EXCEEDED",
    });
    await lease.release();
  });
});
