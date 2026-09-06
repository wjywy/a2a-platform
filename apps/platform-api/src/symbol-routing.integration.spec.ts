import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "./config.js";
import { symbolRouter } from "./symbol-router.js";
import { symbolAgentSlugs } from "./symbol-service.js";
import { multiTurnRoutingFixtures } from "./intent-routing-fixtures.js";
import type { Intent } from "./symbol-intent-service.js";

// Exercise the real HTTP/SSE, service, model parsing and routing; isolate persistence and providers.
const state = vi.hoisted(() => ({ rows: new Map<string, any>(), graph: vi.fn(), reset: vi.fn() }));
vi.mock("./redis.js", () => ({ getRedis: async () => undefined }));
vi.mock("./db.js", () => ({
  query: async (_sql: string, params: string[]) => {
    const row = state.rows.get(params[0]);
    return row && row.tenant_id === params[1] && row.agent_slug === params[2] ? [structuredClone(row)] : [];
  },
  transaction: async (fn: any) => fn({ query: async (_sql: string, p: any[]) => {
    state.rows.set(p[0], { task_id: p[0], context_id: p[1], tenant_id: p[2], agent_slug: p[3], state: p[4], user_message: p[5], title: p[6], intent: JSON.parse(p[7]), transcript: JSON.parse(p[8]), result: p[9] ? JSON.parse(p[9]) : null, memory_summary: JSON.parse(p[10]), memory_entry_ids: JSON.parse(p[11]), evidence: JSON.parse(p[12]), stream_state: JSON.parse(p[13]), routing_trace: JSON.parse(p[14]), active_intent: JSON.parse(p[15]), clarification_history: JSON.parse(p[16]) });
    return { rows: [] };
  } }),
}));
vi.mock("./symbol-graph.js", () => ({ runSymbolGraph: state.graph, recordSymbolInterrupt: vi.fn() }));
vi.mock("./agent-policy-service.js", () => ({ getAgentPolicyBySlug: async () => undefined }));
vi.mock("./memory-service.js", () => ({
  readMemoryContext: async () => ({ enabled: false, entries: [], usedEntryIds: [], summary: { unresolvedQuestions: [], recognizedEntities: [], latestCorrections: [] } }),
  writeMemory: async () => ({ id: "test-memory" }), resetMemory: state.reset,
}));

const app = express().use(express.json()).use(symbolRouter).use((err: Error, _req: any, res: any, _next: any) => res.status(400).json({ error: err.message }));
const originalKey = config.deepseekApiKey;
const originalToken = config.symbolInternalToken;
let extracted: Intent;
let modelAnswer: string;
let modelRequests: any[];
let providerRequests: string[];
let modelFailure = false;
let malformed = false;
let searchQuotes: any[];

function wire(intent: Intent) {
  return { intentType: "research_request", taskRelation: "new", symbol: "", companyName: "", assetType: "", market: "", period: "", question: "", thesis: "", controlAction: "", missing: [], confidence: 0.99, uncertaintyReasons: [], ...intent };
}
beforeEach(() => {
  state.rows.clear(); state.graph.mockReset().mockResolvedValue({ data: { source: "deterministic-test-provider", market: { realtime: { price: 200, meta: { provider: "test", status: "available", freshness: "unknown" } } } } });
  state.reset.mockReset().mockResolvedValue(1);
  extracted = {}; modelAnswer = "这是模型针对当前问题生成的回答。"; modelRequests = []; providerRequests = []; modelFailure = false; malformed = false;
  searchQuotes = [{ symbol: "AAPL", shortname: "Apple 苹果" }];
  config.deepseekApiKey = "test-routing-key"; config.symbolInternalToken = "test-routing-token";
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (!String(url).includes("api.deepseek.com")) {
      providerRequests.push(String(url));
      return Response.json({ quotes: searchQuotes });
    }
    const body = JSON.parse(String(init?.body)); modelRequests.push(body);
    if (modelFailure) return new Response("", { status: 503 });
    if (body.tools) return Response.json({ choices: [{ message: { tool_calls: [{ function: { name: "extract_symbol_intent", arguments: malformed ? "{" : JSON.stringify(wire(extracted)) } }] } }] });
    if (body.stream) return new Response([modelAnswer.slice(0, 4), modelAnswer.slice(4)].map((content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
    return Response.json({ choices: [{ message: { content: modelAnswer } }] });
  }));
});
afterEach(() => { config.deepseekApiKey = originalKey; config.symbolInternalToken = originalToken; vi.unstubAllGlobals(); });

async function send(slug: string, text: string, task?: any, streaming = false, tenant = "tenant-a") {
  const response = await request(app).post(`/api/builtin/symbol/${slug}/${tenant}/message:${streaming ? "stream" : "send"}`)
    .set("authorization", "Bearer test-routing-token").send({ message: { parts: [{ text }], ...(task ? { taskId: task.id, contextId: task.contextId } : {}) } });
  expect(response.status).toBe(200);
  return streaming ? response.text : response.body;
}
function events(text: string): any[] { return text.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => JSON.parse(line.slice(5))); }

describe("seven Symbol agents through real HTTP and model boundary", () => {
  it.each(symbolAgentSlugs)("%s answers capabilities with model text and zero providers over send and SSE", async (slug) => {
    extracted = { intentType: "capability_query", taskRelation: "none", missing: ["symbol"] };
    modelAnswer = `我可以协助你了解 ${slug} 的研究能力。`;
    const task = await send(slug, "你能做什么、会使用哪些数据或工具");
    expect(task.status.state).toBe("TASK_STATE_COMPLETED");
    expect(task.status.message.parts[0].text).toBe(modelAnswer);
    expect(task.metadata.route).toMatchObject({ intentType: "capability_query", route: "agent_response", providerAllowed: false });
    const stream = events(await send(slug, "你能做什么", undefined, true));
    const terminal = stream.find((item) => item.task)?.task;
    expect(terminal.status.message.parts[0].text).toBe(modelAnswer);
    const deltas = stream.filter((item) => item.statusUpdate?.status.message);
    expect(deltas).toHaveLength(2);
    expect(deltas.at(-1).statusUpdate.metadata.route).toEqual(terminal.metadata.route);
    expect(deltas.at(-1).statusUpdate.status.message.parts[0].text).toBe(modelAnswer);
    expect(state.graph).not.toHaveBeenCalled(); expect(providerRequests).toEqual([]);
    const replay = await request(app).get(`/api/builtin/symbol/${slug}/tenant-a/tasks/${task.id}:subscribe`).set("authorization", "Bearer test-routing-token");
    expect(events(replay.text).at(-1).task.metadata.route).toEqual(task.metadata.route);
    expect(JSON.stringify(task)).not.toContain("reasonCodes");
  });

  it.each(symbolAgentSlugs)("%s enforces all eight intent boundaries", async (slug) => {
    for (const type of ["capability_query", "small_talk", "out_of_scope", "task_control", "research_request", "follow_up_question", "clarification_reply", "correction"] as const) {
      state.graph.mockClear(); extracted = { intentType: type, taskRelation: "new", symbol: "AAPL", thesis: "利润能持续增长" };
      const task = await send(slug, "当前测试输入");
      const research = ["research_request", "follow_up_question", "clarification_reply", "correction"].includes(type);
      expect(state.graph).toHaveBeenCalledTimes(research ? 1 : 0);
      expect(task.metadata.route.providerAllowed).toBe(research);
    }
  });

  it.each(multiTurnRoutingFixtures)("restores task through detour: $name", async (fixture) => {
    let task: any;
    for (const [index, turn] of fixture.turns.entries()) {
      extracted = turn.intent;
      const next = await send("symbol-market", turn.text, task);
      if (task) { expect(next.id).toBe(task.id); expect(next.contextId).toBe(task.contextId); }
      task = next;
      expect(state.graph).toHaveBeenCalledTimes(Math.max(0, index - 1));
      if (index === 0) expect(task.status.state).toBe("TASK_STATE_INPUT_REQUIRED");
      if (index === 1) expect(task.status.state).toBe("TASK_STATE_COMPLETED");
    }
    expect(task.metadata.intent.symbol).toBe(fixture.symbol);
    expect(state.rows.get(task.id).routing_trace).toHaveLength(4);
  });

  it("recomputes missing even when model returns an empty array; critic also needs thesis", async () => {
    extracted = { intentType: "research_request", taskRelation: "new", missing: [] };
    const empty = await send("symbol-market", "帮我分析走势");
    expect(empty.metadata.missing).toEqual(["symbol"]);
    extracted.symbol = "AAPL";
    const critic = await send("symbol-critic", "审查苹果");
    expect(critic.metadata.missing).toEqual(["thesis"]);
    expect(providerRequests).toEqual([]); expect(state.graph).not.toHaveBeenCalled();
  });

  it("resolves a company, presents ambiguity, and selects only provider candidates", async () => {
    extracted = { intentType: "research_request", taskRelation: "new", companyName: "苹果" };
    const unique = await send("symbol-market", "帮我分析苹果");
    expect(unique.metadata.intent.symbol).toBe("AAPL");
    state.graph.mockClear();
    searchQuotes = [{ symbol: "GOOG", shortname: "Alphabet" }, { symbol: "GOOGL", shortname: "Alphabet" }];
    extracted = { intentType: "research_request", taskRelation: "new", companyName: "Alphabet" };
    const collecting = await send("symbol-market", "分析 Alphabet");
    expect(collecting.status.state).toBe("TASK_STATE_INPUT_REQUIRED"); expect(state.graph).not.toHaveBeenCalled();
    extracted = { intentType: "clarification_reply", taskRelation: "active" };
    const selected = await send("symbol-market", "2", collecting);
    expect(selected.metadata.intent.symbol).toBe("GOOGL"); expect(state.graph).toHaveBeenCalledTimes(1);
  });

  it("does not reuse old target for a new task and clears resolved target on correction", async () => {
    extracted = { intentType: "research_request", taskRelation: "new", symbol: "AAPL" };
    const first = await send("symbol-market", "分析 AAPL");
    extracted = { intentType: "correction", taskRelation: "active", companyName: "微软" };
    searchQuotes = [{ symbol: "MSFT", shortname: "微软 Microsoft" }];
    const corrected = await send("symbol-market", "不是苹果，是微软", first);
    expect(corrected.metadata.intent.symbol).toBe("MSFT");
    extracted = { intentType: "research_request", taskRelation: "new" };
    state.graph.mockClear();
    const fresh = await send("symbol-market", "换个新任务", corrected);
    expect(fresh.metadata.missing).toEqual(["symbol"]); expect(state.graph).not.toHaveBeenCalled();
  });

  it("blocks contradictory company and code before graph execution", async () => {
    extracted = { intentType: "research_request", taskRelation: "new", symbol: "MSFT", companyName: "苹果" };
    const task = await send("symbol-market", "分析苹果 MSFT");
    expect(task.metadata.route.providerAllowed).toBe(false); expect(state.graph).not.toHaveBeenCalled();
  });

  it("preserves bounded clarification history and isolates tenants and agents", async () => {
    extracted = { intentType: "research_request", taskRelation: "new" };
    let task = await send("symbol-market", "分析走势");
    for (let i = 0; i < 10; i++) {
      extracted = { intentType: "clarification_reply", taskRelation: "active" }; modelAnswer = `模型澄清第 ${i} 轮`;
      task = await send("symbol-market", "还没决定", task);
    }
    expect(state.rows.get(task.id).clarification_history).toHaveLength(8);
    expect(JSON.stringify(modelRequests.at(-1))).toContain("clarificationHistory");
    for (const [slug, tenant] of [["symbol-market", "tenant-b"], ["symbol-company", "tenant-a"]]) {
      const forbidden = await request(app).post(`/api/builtin/symbol/${slug}/${tenant}/message:send`).set("authorization", "Bearer test-routing-token").send({ message: { taskId: task.id, parts: [{ text: "刚才那个" }] } });
      expect(forbidden.status).toBe(400);
    }
    expect(state.graph).not.toHaveBeenCalled();
  });

  it("resets only the current conversation and excludes its previous transcript from the next model turn", async () => {
    extracted = { intentType: "research_request", taskRelation: "new", symbol: "TSLA" };
    const first = await send("symbol-market", "分析 TSLA");
    extracted = { intentType: "task_control", taskRelation: "active", controlAction: "reset_memory" };
    const reset = await send("symbol-market", "清除当前会话记忆", first);
    expect(state.reset).toHaveBeenCalledWith({ tenantId: "tenant-a", agentSlug: "symbol-market", conversationId: first.id }, "conversation");
    modelRequests = []; state.graph.mockClear();
    extracted = { intentType: "follow_up_question", taskRelation: "uncertain", uncertaintyReasons: ["missing_context"] };
    await send("symbol-market", "刚才那个", reset);
    expect(JSON.stringify(modelRequests)).not.toContain("TSLA"); expect(state.graph).not.toHaveBeenCalled();
  });

  it.each(["model-error", "invalid-json"])("returns real failure without providers for %s", async (kind) => {
    modelFailure = kind === "model-error"; malformed = kind === "invalid-json";
    const task = await send("symbol-market", "分析 AAPL");
    expect(task.status.state).toBe("TASK_STATE_FAILED");
    expect(task.status.message.metadata.messageSource).toBe("protocol");
    expect(state.graph).not.toHaveBeenCalled(); expect(providerRequests).toEqual([]);
  });
});
