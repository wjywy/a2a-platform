import { pathToFileURL } from "node:url";

type TaskEvidence = { id: string; contextId: string; status: { state: string; message?: { metadata?: { messageSource?: string }; parts?: Array<{ text?: string }> } }; metadata?: { route?: { intentType?: string; route?: string; providerAllowed?: boolean } } };
export type RoutingSmokeResult = { name: string; ok: boolean; skipped?: boolean; detail: string };

/** Run on the application server. Credentials never leave loopback and redirects are forbidden. */
export async function verifySymbolRouting(checkOnly = false): Promise<RoutingSmokeResult[]> {
  const origin = new URL(process.env.SYMBOL_SMOKE_ORIGIN ?? "http://127.0.0.1:8080");
  const tenant = process.env.SYMBOL_SMOKE_TENANT_ID;
  const token = process.env.SYMBOL_INTERNAL_TOKEN;
  if (!["127.0.0.1", "[::1]"].includes(origin.hostname) || !["http:", "https:"].includes(origin.protocol) || origin.username || origin.password)
    return [{ name: "Symbol routing smoke", ok: false, detail: "只允许服务器本机回环地址，禁止向外部地址发送内部令牌。" }];
  if (checkOnly || !tenant || !token) return [{ name: "Symbol routing smoke", ok: false, skipped: true,
    detail: "未执行网络请求。真实验证需在应用服务器提供测试租户和内置调用令牌；DeepSeek key 保留在服务端。" }];
  const results: RoutingSmokeResult[] = [];
  let prior: TaskEvidence | undefined;
  const scenarios = [
    { name: "capability", text: "你能完成哪些任务、会使用哪些数据或工具", type: "capability_query", route: "agent_response", fresh: true },
    { name: "missing-target", text: "我想分析一只股票的近期走势", type: "research_request", route: "input_required", fresh: true },
    { name: "clarification", text: "苹果", type: "clarification_reply", route: "research", fresh: false },
    { name: "follow-up", text: "刚才那个风险详细说一下", type: "follow_up_question", route: "research", fresh: false },
    { name: "apple-research", text: "帮我分析苹果", type: "research_request", route: "research", fresh: true },
  ];
  for (const scenario of scenarios) {
    if (scenario.fresh) prior = undefined;
    try {
      const response = await fetch(`${origin.origin}/api/builtin/symbol/symbol-market/${encodeURIComponent(tenant)}/message:stream`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: { parts: [{ text: scenario.text }], ...(prior ? { taskId: prior.id, contextId: prior.contextId } : {}) } }),
        signal: AbortSignal.timeout(120_000), redirect: "error",
      });
      if (!response.ok) throw new Error("HTTP_FAILURE");
      const events = (await response.text()).split(/\r?\n/).filter((line) => line.startsWith("data:"))
        .map((line) => JSON.parse(line.slice(5)) as { task?: TaskEvidence; statusUpdate?: { status?: { message?: { parts?: Array<{ text?: string }> } } } });
      const task = events.findLast((event) => event.task)?.task;
      if (!task) throw new Error("MISSING_TERMINAL_TASK");
      const route = task.metadata?.route;
      const cumulative = events.filter((event) => event.statusUpdate?.status?.message).at(-1)?.statusUpdate?.status?.message?.parts?.[0]?.text;
      const finalText = task.status.message?.parts?.[0]?.text;
      const expectedState = scenario.route === "input_required" ? "TASK_STATE_INPUT_REQUIRED" : "TASK_STATE_COMPLETED";
      const ok = route?.intentType === scenario.type && route?.route === scenario.route
        && route.providerAllowed === (scenario.route === "research") && task.status.state === expectedState
        && task.status.message?.metadata?.messageSource === "agent-authored" && Boolean(finalText) && cumulative === finalText
        && (!prior || (prior.id === task.id && prior.contextId === task.contextId));
      results.push({ name: scenario.name, ok, detail: `routeMatched=${ok}; streamMatched=${cumulative === finalText}; completed=${task.status.state === expectedState}` });
      prior = task;
      if (!ok) break;
    } catch {
      results.push({ name: scenario.name, ok: false, detail: "调用失败或不符合 SSE/Task 契约；原始错误与响应未输出。" });
      break;
    }
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await verifySymbolRouting(process.argv.includes("--check-config"));
  for (const result of results) console.log(`${result.skipped ? "SKIP" : result.ok ? "PASS" : "FAIL"} ${result.name}: ${result.detail}`);
  if (results.some((result) => !result.ok && !result.skipped)) process.exitCode = 1;
}
