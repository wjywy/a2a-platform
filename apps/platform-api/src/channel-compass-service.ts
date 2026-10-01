import crypto from "node:crypto";
import { AgentCard } from "@a2a-js/sdk";
import { config } from "./config.js";
import { query } from "./db.js";
import {
  loadChannelKnowledge,
  type ChannelKnowledgeContext,
} from "./channel-compass-knowledge.js";
import {
  ChannelDataApiError,
  httpChannelToolInvoker,
  type ChannelIntent,
  type ChannelToolInput,
  type ChannelToolInvoker,
  type ChannelToolName,
  type ChannelToolResult,
} from "./channel-compass-tools.js";
import {
  createChannelVisualization,
  type ChannelVisualization,
} from "./channel-compass-visualization.js";

export const channelCompassSlug = "channel-compass" as const;

type StoredIntent = {
  kind: Exclude<ChannelIntent, "capability">;
  channels: string[];
  period: ChannelToolInput["period"];
};

type TranscriptEntry = {
  role: "user" | "agent";
  text: string;
  at: string;
};

type ToolCallRecord = {
  name: ChannelToolName | "create_channel_visualization";
  startedAt: string;
  finishedAt: string;
  status: "completed";
  source?: string;
  asOf?: string;
};

type StoredTask = {
  task_id: string;
  context_id: string;
  tenant_id: string;
  state: "collecting" | "completed" | "failed" | "cancelled";
  user_message: string;
  intent: StoredIntent | { kind: "capability" };
  transcript: TranscriptEntry[];
  tool_calls: ToolCallRecord[];
  knowledge_refs: ChannelKnowledgeContext["refs"];
  result: ChannelAnalysisArtifact | { answer: string; errorCode?: string } | null;
};

export type ChannelAnalysisArtifact = {
  answer: string;
  intent: StoredIntent;
  toolResults: Array<{ tool: ChannelToolName; result: ChannelToolResult }>;
  toolCalls: ToolCallRecord[];
  knowledgeRefs: ChannelKnowledgeContext["refs"];
  visualization: ChannelVisualization;
};

export type ChannelCompassHooks = {
  signal?: AbortSignal;
  onStart?: (session: {
    taskId: string;
    contextId: string;
  }) => void | Promise<void>;
};

export type ChannelAnalysisDependencies = {
  toolInvoker?: ChannelToolInvoker;
  loadKnowledge?: typeof loadChannelKnowledge;
  createVisualization?: typeof createChannelVisualization;
  now?: () => Date;
};

const channelAliases: Array<[RegExp, string]> = [
  [/(?:天猫|tmall)/iu, "天猫"],
  [/(?:京东|jd)/iu, "京东"],
  [/(?:抖音|douyin|tiktok)/iu, "抖音"],
  [/(?:拼多多|pdd)/iu, "拼多多"],
];

function isoNow() {
  return new Date().toISOString();
}

export function classifyChannelIntent(
  text: string,
  previous?: Exclude<ChannelIntent, "capability">,
): ChannelIntent {
  const normalized = text.trim();
  if (
    /^(?:你好|您好|hello|hi|你是谁|你能做什么|帮助|使用说明|介绍一下)[！!。.]?$/iu.test(
      normalized,
    )
  )
    return "capability";
  if (/(?:周报|月报|日报|经营报告|汇报话术|汇报材料|生成报告)/u.test(normalized))
    return "weekly_report";
  if (/(?:补货|备货|安全库存|缺货优先级|采购优先级)/u.test(normalized))
    return "replenishment";
  if (/(?:异常|飙升|预警|周转变慢|库存积压|滞销|缺货)/u.test(normalized))
    return "anomaly";
  if (/(?:为什么|原因|归因|下滑|下降|波动|变差)/u.test(normalized))
    return "attribution";
  if (previous && /^(?:继续|详细一点|展开|再分析|那呢|然后呢)[？?！!。.]?$/u.test(normalized))
    return previous;
  return "overview";
}

function extractChannels(text: string, previous: string[] = []) {
  const found = channelAliases
    .filter(([pattern]) => pattern.test(text))
    .map(([, name]) => name);
  return found.length ? [...new Set(found)] : previous;
}

function extractPeriod(
  text: string,
  previous?: ChannelToolInput["period"],
): ChannelToolInput["period"] {
  const dates = [...text.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)].map(
    (match) => match[1],
  );
  if (dates.length)
    return { raw: text, start: dates[0], ...(dates[1] ? { end: dates[1] } : {}) };
  if (/(?:本周|上周|本月|上月|近\d+[天周月]|今天|昨天)/u.test(text))
    return { raw: text };
  return previous ?? { raw: "由渠道数据 API 使用最新完整统计周期" };
}

function toolsFor(intent: Exclude<ChannelIntent, "capability">): ChannelToolName[] {
  if (intent === "attribution") return ["get_channel_attribution"];
  if (intent === "anomaly") return ["detect_channel_anomalies"];
  if (intent === "replenishment") return ["get_replenishment_priority"];
  if (intent === "weekly_report")
    return [
      "get_channel_overview",
      "detect_channel_anomalies",
      "get_replenishment_priority",
    ];
  return ["get_channel_overview"];
}

function assertNoEducationIdentityData(value: unknown) {
  const serialized = JSON.stringify(value);
  if (/(?:学校|学生姓名|学生名单|学号)/u.test(serialized)) {
    throw new ChannelDataApiError(
      "渠道数据工具返回了禁止输出的教育身份信息，本次结果已拦截。",
      "CHANNEL_DATA_SENSITIVE_CONTENT",
    );
  }
}

function markdownCell(value: string) {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function displayValue(value: number | string, unit?: string) {
  const formatted =
    typeof value === "number"
      ? new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value)
      : value;
  return `${formatted}${unit ?? ""}`;
}

function reportMarkdown(input: {
  intent: StoredIntent;
  results: Array<{ tool: ChannelToolName; result: ChannelToolResult }>;
  knowledge: ChannelKnowledgeContext;
  visualization: ChannelVisualization;
}) {
  const requestedKnowledge = new Set(
    input.results.flatMap(({ result }) => result.knowledgeKeys),
  );
  const matchingKnowledge = input.knowledge.entries.filter((entry) =>
    requestedKnowledge.has(entry.key),
  );
  const knowledge = (matchingKnowledge.length
    ? matchingKnowledge
    : input.knowledge.entries
  ).slice(0, 5);
  const sources = input.results
    .map(({ result }) => `${result.source}（截至 ${result.asOf}）`)
    .filter((value, index, values) => values.indexOf(value) === index);
  const conclusions = input.results.map(
    ({ result }) => `- **${result.title}**：${result.conclusion}`,
  );
  const facts = input.results.flatMap(({ result }) =>
    result.facts.map((fact) => {
      const change =
        fact.change === undefined
          ? "—"
          : `${fact.change > 0 ? "+" : ""}${displayValue(fact.change, fact.changeUnit)}`;
      return `| ${markdownCell(fact.channel ?? "全部渠道")} | ${markdownCell(fact.metric)} | ${markdownCell(displayValue(fact.value, fact.unit))} | ${markdownCell(fact.period ?? "工具返回周期")} | ${markdownCell(change)} |`;
    }),
  );
  const reasons = input.results.flatMap(({ result }) =>
    result.reasons.map(
      (reason) =>
        `- **${reason.title}**：${reason.detail}\n  - 证据：${reason.evidence.join("；")}`,
    ),
  );
  const actions = input.results.flatMap(({ result }) => result.actions);
  return [
    "# 渠道罗盘分析",
    "",
    `> 数据来源：${sources.join("；")}  `,
    `> 已调用：${input.results.map(({ tool }) => `\`${tool}\``).join("、")}、\`create_channel_visualization\``,
    "",
    "## 结论",
    "",
    ...conclusions,
    "",
    "## 数据依据",
    "",
    "| 渠道 | 指标 | 数值 | 周期 | 变化 |",
    "| --- | --- | ---: | --- | ---: |",
    ...facts,
    "",
    "## 原因分析",
    "",
    ...(reasons.length
      ? reasons
      : ["- 数据工具未返回可确认的归因证据，本次不做原因推断。"]),
    "",
    "## 行动建议",
    "",
    ...(actions.length
      ? actions.map((action) => `- ${action}`)
      : ["- 数据工具未返回可执行建议；建议补充证据后再制定动作。"]),
    "",
    "### 指标口径与策略依据",
    "",
    ...knowledge.map(
      (entry) => `- **${entry.title}**：${entry.content}（${entry.sourceTitle}）`,
    ),
    "",
    "## 可视化",
    "",
    `![${input.visualization.title}](${input.visualization.url})`,
    "",
    `[打开原图](${input.visualization.url})（链接有效至 ${input.visualization.expiresAt}）`,
  ].join("\n");
}

export async function executeChannelAnalysis(
  input: {
    tenantId: string;
    taskId: string;
    contextId: string;
    query: string;
    intent: StoredIntent;
    previousIntent?: Exclude<ChannelIntent, "capability">;
    signal?: AbortSignal;
  },
  dependencies: ChannelAnalysisDependencies = {},
): Promise<ChannelAnalysisArtifact> {
  const toolInvoker = dependencies.toolInvoker ?? httpChannelToolInvoker;
  const knowledgeLoader = dependencies.loadKnowledge ?? loadChannelKnowledge;
  const visualizationCreator =
    dependencies.createVisualization ?? createChannelVisualization;
  const now = dependencies.now ?? (() => new Date());
  const invocations = await Promise.all(
    toolsFor(input.intent.kind).map(async (tool) => {
      const startedAt = now().toISOString();
      const result = await toolInvoker.invoke(
        tool,
        {
          tenantId: input.tenantId,
          query: input.query,
          channels: input.intent.channels,
          period: input.intent.period,
          timezone: "Asia/Shanghai",
          taskId: input.taskId,
          contextId: input.contextId,
          previousIntent: input.previousIntent,
        },
        input.signal,
      );
      assertNoEducationIdentityData(result);
      return {
        tool,
        result,
        call: {
          name: tool,
          startedAt,
          finishedAt: now().toISOString(),
          status: "completed" as const,
          source: result.source,
          asOf: result.asOf,
        },
      };
    }),
  );
  const knowledge = await knowledgeLoader(input.intent.kind);
  const chartStartedAt = now().toISOString();
  const visualization = await visualizationCreator({
    tenantId: input.tenantId,
    taskId: input.taskId,
    spec: invocations[0].result.chart,
  });
  const toolCalls: ToolCallRecord[] = [
    ...invocations.map(({ call }) => call),
    {
      name: "create_channel_visualization",
      startedAt: chartStartedAt,
      finishedAt: now().toISOString(),
      status: "completed",
    },
  ];
  const toolResults = invocations.map(({ tool, result }) => ({ tool, result }));
  const answer = reportMarkdown({
    intent: input.intent,
    results: toolResults,
    knowledge,
    visualization,
  });
  return {
    answer,
    intent: input.intent,
    toolResults,
    toolCalls,
    knowledgeRefs: knowledge.refs,
    visualization,
  };
}

function userText(body: unknown) {
  const message = (body as { message?: Record<string, unknown> } | undefined)
    ?.message;
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  const text = parts
    .map((part) =>
      part && typeof part === "object" && "text" in part
        ? String((part as { text: unknown }).text)
        : "",
    )
    .join("\n")
    .trim();
  return {
    text,
    taskId:
      typeof message?.taskId === "string" ? message.taskId : undefined,
    contextId:
      typeof message?.contextId === "string" ? message.contextId : undefined,
  };
}

function agentMessage(text: string, taskId: string, contextId: string, source: "agent-authored" | "protocol") {
  return {
    messageId: crypto.randomUUID(),
    taskId,
    contextId,
    role: "ROLE_AGENT",
    parts: [{ text }],
    metadata: { messageSource: source },
    extensions: [],
    referenceTaskIds: [],
  };
}

function taskJson(input: {
  taskId: string;
  contextId: string;
  state: string;
  text: string;
  artifact?: ChannelAnalysisArtifact;
  metadata?: Record<string, unknown>;
  messageSource?: "agent-authored" | "protocol";
}) {
  return {
    id: input.taskId,
    contextId: input.contextId,
    status: {
      state: input.state,
      message: agentMessage(
        input.text,
        input.taskId,
        input.contextId,
        input.messageSource ?? "agent-authored",
      ),
      timestamp: isoNow(),
    },
    artifacts: input.artifact
      ? [
          {
            artifactId: "channel-compass-report",
            name: "渠道经营分析",
            description: "渠道罗盘基于真实工具数据与本地知识库生成的结果",
            parts: [{ data: input.artifact }, { text: input.text }],
            metadata: {},
            extensions: [],
          },
        ]
      : [],
    history: [],
    metadata: input.metadata ?? {},
  };
}

async function loadTask(taskId: string, tenantId: string) {
  const rows = await query<StoredTask>(
    `SELECT * FROM channel_compass_tasks
     WHERE task_id=$1 AND tenant_id=$2 AND expires_at>now()`,
    [taskId, tenantId],
  );
  return rows[0];
}

async function loadTaskByContext(contextId: string, tenantId: string) {
  const rows = await query<StoredTask>(
    `SELECT * FROM channel_compass_tasks
     WHERE context_id=$1 AND tenant_id=$2 AND expires_at>now()
     ORDER BY updated_at DESC LIMIT 1`,
    [contextId, tenantId],
  );
  return rows[0];
}

async function saveTask(task: StoredTask) {
  await query(
    `INSERT INTO channel_compass_tasks(
       task_id,context_id,tenant_id,state,user_message,intent,transcript,
       tool_calls,knowledge_refs,result
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT(task_id) DO UPDATE SET state=EXCLUDED.state,
       user_message=EXCLUDED.user_message,intent=EXCLUDED.intent,
       transcript=EXCLUDED.transcript,tool_calls=EXCLUDED.tool_calls,
       knowledge_refs=EXCLUDED.knowledge_refs,result=EXCLUDED.result,
       updated_at=now(),expires_at=now()+interval '30 days'`,
    [
      task.task_id,
      task.context_id,
      task.tenant_id,
      task.state,
      task.user_message,
      JSON.stringify(task.intent),
      JSON.stringify(task.transcript),
      JSON.stringify(task.tool_calls),
      JSON.stringify(task.knowledge_refs),
      task.result ? JSON.stringify(task.result) : null,
    ],
  );
}

const capabilityAnswer = `我是“渠道罗盘”，面向电商运营、商品和财务人员提供多渠道经营分析。\n\n我可以：\n\n- 查询天猫、京东、抖音、拼多多等渠道的 GMV、毛利、ROI、退货率等指标；\n- 调用归因工具定位 ROI 下降和销量波动；\n- 识别退货、库存周转等异常；\n- 根据库存与销量预测生成补货优先级；\n- 生成经营周报与汇报话术。\n\n经营结论只使用已配置的数据工具和本地知识库；没有真实数据时我会明确说明，不会编造。每次正式分析都会生成图表链接。`;

function publicFailure(error: unknown) {
  if (error instanceof ChannelDataApiError)
    return { message: error.message, code: error.code };
  if (error instanceof Error && error.name === "AbortError")
    return { message: "渠道分析任务已取消。", code: "CHANNEL_TASK_CANCELLED" };
  return {
    message: "渠道数据、知识库或可视化工具调用失败，未生成任何经营结论。",
    code: "CHANNEL_ANALYSIS_FAILED",
  };
}

export async function handleChannelCompassMessage(
  tenantId: string,
  body: unknown,
  hooks: ChannelCompassHooks = {},
) {
  const incoming = userText(body);
  if (!incoming.text)
    throw new Error("A2A message.parts 中必须包含非空 text。");
  let current = incoming.taskId
    ? await loadTask(incoming.taskId, tenantId)
    : undefined;
  if (!current && !incoming.taskId && incoming.contextId)
    current = await loadTaskByContext(incoming.contextId, tenantId);
  if (incoming.taskId && !current)
    throw new Error("任务不存在、已过期，或不属于当前租户。");
  const taskId = current?.task_id ?? crypto.randomUUID();
  const contextId = current?.context_id ?? incoming.contextId ?? crypto.randomUUID();
  await hooks.onStart?.({ taskId, contextId });
  const transcript: TranscriptEntry[] = [
    ...(current?.transcript ?? []),
    { role: "user", text: incoming.text, at: isoNow() },
  ];
  const previous =
    current?.intent.kind && current.intent.kind !== "capability"
      ? current.intent
      : undefined;
  const kind = classifyChannelIntent(incoming.text, previous?.kind);
  if (kind === "capability") {
    transcript.push({ role: "agent", text: capabilityAnswer, at: isoNow() });
    await saveTask({
      task_id: taskId,
      context_id: contextId,
      tenant_id: tenantId,
      state: "completed",
      user_message: incoming.text,
      intent: { kind },
      transcript,
      tool_calls: [],
      knowledge_refs: [],
      result: { answer: capabilityAnswer },
    });
    return taskJson({
      taskId,
      contextId,
      state: "TASK_STATE_COMPLETED",
      text: capabilityAnswer,
      metadata: { agent: channelCompassSlug, intent: kind, toolCalls: [] },
    });
  }
  const intent: StoredIntent = {
    kind,
    channels: extractChannels(incoming.text, previous?.channels),
    period: extractPeriod(incoming.text, previous?.period),
  };
  await saveTask({
    task_id: taskId,
    context_id: contextId,
    tenant_id: tenantId,
    state: "collecting",
    user_message: incoming.text,
    intent,
    transcript,
    tool_calls: [],
    knowledge_refs: [],
    result: null,
  });
  try {
    const artifact = await executeChannelAnalysis({
      tenantId,
      taskId,
      contextId,
      query: incoming.text,
      intent,
      previousIntent: previous?.kind,
      signal: hooks.signal,
    });
    transcript.push({ role: "agent", text: artifact.answer, at: isoNow() });
    await saveTask({
      task_id: taskId,
      context_id: contextId,
      tenant_id: tenantId,
      state: "completed",
      user_message: incoming.text,
      intent,
      transcript,
      tool_calls: artifact.toolCalls,
      knowledge_refs: artifact.knowledgeRefs,
      result: artifact,
    });
    return taskJson({
      taskId,
      contextId,
      state: "TASK_STATE_COMPLETED",
      text: artifact.answer,
      artifact,
      metadata: {
        agent: channelCompassSlug,
        intent,
        toolCalls: artifact.toolCalls,
        knowledgeRefs: artifact.knowledgeRefs,
        visualizationUrl: artifact.visualization.url,
      },
    });
  } catch (error) {
    const failure = publicFailure(error);
    const cancelled = hooks.signal?.aborted || failure.code === "CHANNEL_TASK_CANCELLED";
    transcript.push({ role: "agent", text: failure.message, at: isoNow() });
    await saveTask({
      task_id: taskId,
      context_id: contextId,
      tenant_id: tenantId,
      state: cancelled ? "cancelled" : "failed",
      user_message: incoming.text,
      intent,
      transcript,
      tool_calls: [],
      knowledge_refs: [],
      result: { answer: failure.message, errorCode: failure.code },
    });
    return taskJson({
      taskId,
      contextId,
      state: cancelled ? "TASK_STATE_CANCELED" : "TASK_STATE_FAILED",
      text: failure.message,
      messageSource: "protocol",
      metadata: { agent: channelCompassSlug, intent, errorCode: failure.code },
    });
  }
}

export async function getChannelCompassTask(tenantId: string, taskId: string) {
  const task = await loadTask(taskId, tenantId);
  if (!task) return undefined;
  const result = task.result;
  const answer = result?.answer ?? "渠道分析正在执行。";
  const states = {
    collecting: "TASK_STATE_WORKING",
    completed: "TASK_STATE_COMPLETED",
    failed: "TASK_STATE_FAILED",
    cancelled: "TASK_STATE_CANCELED",
  } as const;
  const artifact =
    task.state === "completed" && result && "visualization" in result
      ? (result as ChannelAnalysisArtifact)
      : undefined;
  return taskJson({
    taskId: task.task_id,
    contextId: task.context_id,
    state: states[task.state],
    text: answer,
    artifact,
    messageSource: task.state === "failed" ? "protocol" : "agent-authored",
    metadata: {
      agent: channelCompassSlug,
      intent: task.intent,
      toolCalls: task.tool_calls,
      knowledgeRefs: task.knowledge_refs,
    },
  });
}

export async function cancelChannelCompassTask(tenantId: string, taskId: string) {
  const task = await loadTask(taskId, tenantId);
  if (!task) return undefined;
  const answer = "渠道分析任务已取消。";
  task.state = "cancelled";
  task.transcript = [
    ...task.transcript,
    { role: "agent", text: answer, at: isoNow() },
  ];
  task.result = { answer, errorCode: "CHANNEL_TASK_CANCELLED" };
  await saveTask(task);
  return getChannelCompassTask(tenantId, taskId);
}

export function channelCompassCard() {
  const base = `${config.platformOrigin}/api/builtin/channel-compass`;
  return AgentCard.toJSON(
    AgentCard.fromJSON({
      protocolVersion: "1.0",
      name: "渠道罗盘",
      description:
        "面向电商运营、商品和财务人员的多渠道经营分析 Agent，提供经营总览、归因、异常诊断、智能补货和周报生成。",
      version: "1.0.0",
      provider: { organization: "A2A Platform", url: config.platformOrigin },
      capabilities: {
        streaming: true,
        pushNotifications: false,
        stateTransitionHistory: true,
      },
      supportedInterfaces: [
        {
          url: base,
          protocolBinding: "HTTP+JSON",
          protocolVersion: "1.0",
          tenant: "",
        },
      ],
      skills: [
        {
          id: "channel-overview",
          name: "经营总览",
          description: "查询各渠道 GMV、毛利、ROI、退货率等指标。",
          tags: ["ecommerce", "channel", "analytics"],
          examples: ["对比本周天猫、京东、抖音和拼多多的经营表现。"],
        },
        {
          id: "channel-attribution",
          name: "渠道归因",
          description: "定位 ROI 下降和销量波动的工具证据。",
          tags: ["ecommerce", "attribution"],
          examples: ["抖音 ROI 为什么下降？"],
        },
        {
          id: "channel-anomaly",
          name: "异常诊断",
          description: "识别退货率、库存周转等异常。",
          tags: ["ecommerce", "anomaly"],
          examples: ["检查本周退货和库存周转异常。"],
        },
        {
          id: "channel-replenishment",
          name: "智能补货",
          description: "根据库存与销量预测生成补货优先级。",
          tags: ["ecommerce", "inventory"],
          examples: ["生成未来两周的补货优先级。"],
        },
        {
          id: "channel-report",
          name: "经营报告",
          description: "生成经营周报或汇报话术。",
          tags: ["ecommerce", "report"],
          examples: ["生成本周多渠道经营周报。"],
        },
      ],
      securitySchemes: {},
      securityRequirements: [],
    }),
  );
}
