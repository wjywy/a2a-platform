import { describe, expect, it } from "vitest";
import { buildSymbolModelContext, __symbolContextInternals } from "./symbol-context.js";

describe("bounded Symbol model context", () => {
  it("keeps the latest question, prior question and unresolved memory together", () => {
    const context = buildSymbolModelContext({
      slug: "symbol-market",
      userMessage: "刚才提到的风险哪个最重要？",
      transcript: [
        { role: "user", text: "分析 AAPL", at: "2026-09-05T00:00:00.000Z" },
        { role: "agent", text: "风险需要结合波动和回撤观察。", at: "2026-09-05T00:01:00.000Z" },
      ],
      intent: { symbol: "AAPL", question: "刚才提到的风险哪个最重要？" },
      memory: {
        enabled: true,
        entries: [
          {
            id: "memory-1",
            tenantId: "tenant",
            agentSlug: "symbol-market",
            scope: "conversation",
            subjectType: "conversation",
            subjectId: "conversation",
            category: "open_question",
            content: { question: "波动是否会扩大" },
            source: { kind: "test" },
            confidence: 0.9,
            observedAt: "2026-09-05T00:01:00.000Z",
            expiresAt: "2026-12-01T00:00:00.000Z",
            status: "active",
          },
        ],
        usedEntryIds: ["memory-1"],
        summary: {
          unresolvedQuestions: ["波动是否会扩大"],
          recognizedEntities: ["AAPL"],
          latestCorrections: [],
        },
      },
      evidence: { token: "must not enter prompt", close: 200 },
    });
    expect(context.userPrompt).toContain("刚才提到的风险哪个最重要");
    expect(context.userPrompt).toContain("波动是否会扩大");
    expect(context.userPrompt).toContain("AAPL");
    expect(context.userPrompt).not.toContain("must not enter prompt");
    expect(context.systemPrompt).toContain("固定句子");
    const marketContext = buildSymbolModelContext({
      slug: "symbol-technical-options",
      userMessage: "分析期权 Gamma",
      intent: { symbol: "AAPL" },
      evidence: { longbridge: { freshness: "live" }, gamma: { modeled: true } },
    });
    expect(marketContext.systemPrompt).toContain("Black-Scholes");
    expect(marketContext.systemPrompt).toContain("缺失值当作零");
  });

  it("bounds large transcript and evidence payloads", () => {
    const context = buildSymbolModelContext({
      slug: "symbol-company",
      userMessage: "继续",
      transcript: [{ role: "user", text: "x".repeat(3000), at: "2026-09-05T00:00:00.000Z" }],
      intent: { symbol: "AAPL" },
      evidence: { value: "y".repeat(20_000) },
      maxChars: 1000,
    });
    expect(context.userPrompt.length).toBeLessThanOrEqual(1100);
    expect(() => JSON.parse(context.userPrompt.split("\n").slice(1).join("\n"))).not.toThrow();
    expect(
      __symbolContextInternals.safeJson({
        authorization: "secret",
        apiKey: "app-key",
        appSecret: "app-secret",
        ok: 1,
      }),
    ).toEqual({ ok: 1 });
  });

  it("redacts secrets embedded in text and ignores disabled or superseded memory", () => {
    const context = buildSymbolModelContext({
      slug: "symbol-market", userMessage: "DEEPSEEK_API_KEY=private-value 分析行情", intent: {},
      transcript: [{ role: "user", text: "Bearer private-bearer", at: "2026-09-06" }],
      memory: { enabled: false, entries: [], usedEntryIds: [], summary: { recognizedEntities: ["DELETED_ENTITY"], unresolvedQuestions: ["DELETED_QUESTION"], latestCorrections: [] } },
    });
    expect(context.userPrompt).not.toContain("private-value"); expect(context.userPrompt).not.toContain("private-bearer");
    expect(context.userPrompt).not.toContain("DELETED_");
  });
});
