import type { IntentType, Intent } from "./symbol-intent-service.js";

export type IntentRoutingFixture = {
  name: string;
  input: string;
  intentType: IntentType;
  hasTarget?: boolean;
  hasActiveTask?: boolean;
};

/** Shared regression samples for routing semantics, not user-facing copy. */
export const intentRoutingFixtures: IntentRoutingFixture[] = [
  { name: "能力咨询", input: "你能做什么、会使用哪些数据或工具", intentType: "capability_query" },
  { name: "闲聊", input: "你好", intentType: "small_talk" },
  { name: "越界", input: "帮我直接下单买入", intentType: "out_of_scope" },
  { name: "新研究", input: "帮我分析苹果最近的走势", intentType: "research_request", hasTarget: true },
  { name: "连续追问", input: "刚才那个风险哪个最重要？", intentType: "follow_up_question", hasTarget: true, hasActiveTask: true },
  { name: "澄清回复", input: "苹果", intentType: "clarification_reply", hasTarget: true, hasActiveTask: true },
  { name: "目标纠正", input: "不是苹果，是微软", intentType: "correction", hasTarget: true, hasActiveTask: true },
  { name: "任务控制", input: "先取消这次分析", intentType: "task_control", hasActiveTask: true },
  { name: "无上下文短句", input: "1", intentType: "clarification_reply" },
  { name: "解释澄清", input: "什么东西？", intentType: "clarification_reply", hasActiveTask: true },
];

/** 100 multi-turn regressions. Model labels are test oracles, not accuracy measurements. */
export const multiTurnRoutingFixtures = ["分析一下走势", "我想研究一只股票", "看看最近表现", "帮我做行情研究", "想了解股价变化"].flatMap((start) =>
  ["你能做什么", "会用哪些数据", "你好", "谢谢", "什么东西"].flatMap((detour) =>
    ["AAPL", "MSFT", "TSLA", "NVDA"].map((symbol) => ({
      name: `${start}/${detour}/${symbol}`,
      turns: [
        { text: start, intent: { intentType: "research_request", taskRelation: "new" } },
        { text: detour, intent: detour === "什么东西"
          ? { intentType: "clarification_reply", taskRelation: "uncertain", uncertaintyReasons: ["clarification_explanation"] }
          : { intentType: detour === "你好" || detour === "谢谢" ? "small_talk" : "capability_query", taskRelation: "none" } },
        { text: symbol, intent: { intentType: "clarification_reply", taskRelation: "active", symbol } },
        { text: "刚才那个风险详细说一下", intent: { intentType: "follow_up_question", taskRelation: "active", question: "风险详细说一下" } },
      ] as Array<{ text: string; intent: Intent }>,
      symbol,
    })),
  ),
);
