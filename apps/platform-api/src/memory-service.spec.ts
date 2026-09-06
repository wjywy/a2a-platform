import { describe, expect, it } from "vitest";
import { __memoryInternals, selectRelevantMemories } from "./memory-service.js";

const item = (id: string, content: Record<string, unknown>, confidence = 0.5) => ({
  id,
  tenantId: "00000000-0000-0000-0000-000000000001",
  agentSlug: "symbol-market",
  scope: "conversation" as const,
  subjectType: "conversation" as const,
  subjectId: "00000000-0000-0000-0000-000000000002",
  category: "fact" as const,
  content,
  source: { kind: "test" },
  confidence,
  observedAt: `2026-09-0${id}T00:00:00.000Z`,
  expiresAt: "2026-12-01T00:00:00.000Z",
  status: "active" as const,
});

describe("scoped Agent memory", () => {
  it("selects active memories by confidence and context budget", () => {
    const selected = selectRelevantMemories(
      [item("1", { text: "new" }, 0.9), item("2", { text: "old" }, 0.2)],
      1,
      100,
    );
    expect(selected.map((entry) => entry.id)).toEqual(["1"]);
  });

  it("never exceeds the character budget, including when one entry is oversized", () => {
    const selected = selectRelevantMemories(
      [
        item("1", { text: "x".repeat(101) }, 1),
        item("2", { text: "fits" }, 0.9),
        item("3", { text: "also fits" }, 0.8),
      ],
      10,
      40,
    );
    expect(selected.map((entry) => entry.id)).toEqual(["2", "3"]);
    expect(
      selected.reduce((total, entry) => total + JSON.stringify(entry.content).length, 0),
    ).toBeLessThanOrEqual(40);
  });

  it("never treats superseded or deleted content as selectable", () => {
    expect(
      selectRelevantMemories(
        [
          item("1", { text: "superseded" }),
          { ...item("2", { text: "deleted" }), status: "redacted" as const },
        ],
        10,
        1000,
      ).map((entry) => entry.id),
    ).toEqual(["1"]);
  });

  it("derives scope subjects only from trusted server context", () => {
    const subject = {
      tenantId: "00000000-0000-0000-0000-000000000001",
      agentSlug: "symbol-market",
      conversationId: "00000000-0000-0000-0000-000000000002",
    };
    expect(__memoryInternals.subjectForScope(subject, "conversation")).toEqual({
      subjectType: "conversation",
      subjectId: subject.conversationId,
    });
    expect(__memoryInternals.subjectForScope(subject, "user")).toBeUndefined();
  });

  it("rejects credential-like memory fields", () => {
    expect(__memoryInternals.containsSensitiveKey({ access_token: "secret" })).toBe(true);
    expect(__memoryInternals.containsSensitiveKey({ apiKey: "secret" })).toBe(true);
    expect(__memoryInternals.containsSensitiveKey({ nested: { appSecret: "secret" } })).toBe(true);
    expect(__memoryInternals.containsSensitiveKey({ preference: "中文" })).toBe(false);
  });

  it("keeps cross-scope policy gates explicit", () => {
    const policy = {
      memoryReadScopes: ["conversation", "user", "agent", "tenant"] as const,
      memoryWriteScopes: ["conversation", "user"] as const,
      allowCrossConversation: false,
      allowCrossAgent: false,
    } as never;
    expect(__memoryInternals.effectiveScopes(policy, "read")).toEqual([
      "conversation",
      "tenant",
    ]);
    expect(__memoryInternals.effectiveScopes(policy, "write")).toEqual([
      "conversation",
    ]);
  });

  it("maps expiry/supersession states and versions cache identity by scope", () => {
    const base = {
      id: "memory-row",
      tenant_id: "00000000-0000-0000-0000-000000000001",
      agent_id: "agent-row",
      scope: "conversation",
      subject_type: "conversation",
      subject_id: "00000000-0000-0000-0000-000000000002",
      category: "summary",
      content: { recognizedEntity: "AAPL" },
      source_conversation_id: null,
      source_message_id: null,
      source_kind: "test",
      confidence: 0.8,
      observed_at: new Date("2026-09-01T00:00:00.000Z"),
      expires_at: new Date("2026-09-02T00:00:00.000Z"),
      superseded_by: null,
      deleted_at: null,
      redacted_at: null,
    };
    expect(__memoryInternals.mapMemory(base as never, "symbol-market").status).toBe(
      "expired",
    );
    expect(
      __memoryInternals.mapMemory(
        { ...base, expires_at: new Date("2099-09-02T00:00:00.000Z"), superseded_by: "new-row" } as never,
        "symbol-market",
      ).status,
    ).toBe("superseded");
    const conversationKey = __memoryInternals.cacheKey(
      {
        tenantId: base.tenant_id,
        agentSlug: "symbol-market",
        conversationId: base.subject_id,
      },
      3,
    );
    const userKey = __memoryInternals.cacheKey(
      { tenantId: base.tenant_id, agentSlug: "symbol-market", userId: "user-1" },
      3,
    );
    expect(conversationKey).toContain(":v3:conversation:");
    expect(userKey).toContain(":v3:user:user-1");
    expect(conversationKey).not.toBe(userKey);
  });
});
