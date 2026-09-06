import { describe, expect, it } from "vitest";
import { intentRoutingFixtures } from "./intent-routing-fixtures.js";
import {
  __symbolIntentInternals,
  decideRoute,
  mergeIntent,
  missingIntentFields,
  resolveContextSelection,
  type IntentDefinition,
} from "./symbol-intent-service.js";

const definition: IntentDefinition = {
  slug: "symbol-market",
  name: "Symbol 市场行情 Agent",
  description: "查询实时行情",
  skill: "market-quote",
  needs: ["symbol"],
};

describe("Symbol intent routing contract", () => {
  const valid = { intentType: "research_request", taskRelation: "new", symbol: "aapl", companyName: "", assetType: "stock", market: "", period: "", question: "", thesis: "", controlAction: "", missing: [], confidence: 0.9, uncertaintyReasons: [] };
  it.each([ { intentType: "unknown" }, { taskRelation: "unknown" }, { controlAction: "buy" }, { confidence: -0.1 }, { confidence: 1.1 }, { route: "research" }, { symbol: "AAPL;DROP" }, { companyName: "x".repeat(201) }, { missing: ["route"] }, { uncertaintyReasons: Array(5).fill("unknown") } ])("rejects invalid structured output: %j", (invalid) => {
    expect(__symbolIntentInternals.intentWireSchema.safeParse({ ...valid, ...invalid }).success).toBe(false);
  });
  it("normalizes empty values and ticker casing", () => {
    expect(__symbolIntentInternals.intentSchema.parse(valid)).toMatchObject({ symbol: "AAPL", companyName: undefined, controlAction: undefined });
  });
  it("does not inherit research slots for a new task or stale diagnostics across turns", () => {
    expect(mergeIntent({ symbol: "AAPL", thesis: "上涨", missing: ["symbol"], uncertaintyReasons: ["old"] }, { intentType: "research_request", taskRelation: "new", missing: [], uncertaintyReasons: [] })).toEqual({ intentType: "research_request", taskRelation: "new", missing: [], uncertaintyReasons: [] });
  });
  it("bounds candidate selection and refuses an ungrounded confirmation", () => {
    const reply = { intentType: "clarification_reply", taskRelation: "active" } as const;
    expect(resolveContextSelection("1", {}, reply).taskRelation).toBe("uncertain");
    expect(resolveContextSelection("是的", {}, reply).taskRelation).toBe("uncertain");
    expect(resolveContextSelection("2", { resolutionCandidates: [{ symbol: "GOOG" }, { symbol: "GOOGL" }] }, reply).symbol).toBe("GOOGL");
  });
  it.each(["1", "继续", "什么东西？"])("treats context-free short reply %s as uncertain", (text) => {
    expect(resolveContextSelection(text, {}, { intentType: "clarification_reply", taskRelation: "none" }).taskRelation).toBe("uncertain");
  });
  it("does not fetch data to explain a clarification even with an existing target", () => {
    expect(decideRoute(definition, { intentType: "clarification_reply", taskRelation: "uncertain", symbol: "AAPL", confidence: 0.99 })).toMatchObject({ route: "agent_response", providerAllowed: false });
  });
  it("covers the shared intent fixture matrix", () => {
    expect(intentRoutingFixtures.map((fixture) => fixture.intentType)).toEqual([
      "capability_query",
      "small_talk",
      "out_of_scope",
      "research_request",
      "follow_up_question",
      "clarification_reply",
      "correction",
      "task_control",
      "clarification_reply",
      "clarification_reply",
    ]);
  });

  it("requires all routing fields in the strict wire schema", () => {
    expect(__symbolIntentInternals.intentWireSchema.safeParse({}).success).toBe(false);
    expect(__symbolIntentInternals.intentJsonSchema.required).toContain("intentType");
    expect(__symbolIntentInternals.intentJsonSchema.properties.intentType.enum).toContain("capability_query");
  });

  it("routes capability questions without a target to the Agent and never to a provider", () => {
    const decision = decideRoute(definition, {
      intentType: "capability_query",
      taskRelation: "none",
      confidence: 0.99,
    });
    expect(decision).toMatchObject({ route: "agent_response", providerAllowed: false, missing: [] });
  });

  it("only reports missing fields for research intent", () => {
    expect(missingIntentFields(definition, { intentType: "capability_query" })).toEqual([]);
    expect(missingIntentFields(definition, { intentType: "research_request" })).toEqual(["symbol"]);
    expect(decideRoute(definition, { intentType: "research_request", confidence: 0.99 })).toMatchObject({
      route: "input_required",
      providerAllowed: false,
      missing: ["symbol"],
    });
  });

  it("lets the latest explicit target replace the prior target", () => {
    expect(
      mergeIntent(
        { symbol: "AAPL", companyName: "苹果", intentType: "research_request" },
        { symbol: "TSLA", intentType: "correction", taskRelation: "active" },
      ),
    ).toMatchObject({ symbol: "TSLA", intentType: "correction" });
  });

  it("blocks low-confidence research before any provider call", () => {
    expect(
      decideRoute(definition, {
        intentType: "research_request",
        symbol: "AAPL",
        confidence: 0.3,
      }),
    ).toMatchObject({ route: "agent_response", providerAllowed: false, reasonCodes: ["low_confidence"] });
  });
});
