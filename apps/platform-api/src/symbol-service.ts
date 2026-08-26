import crypto from "node:crypto";
import { z } from "zod";
import { config } from "./config.js";
import { query } from "./db.js";
import { getRedis } from "./redis.js";
import { recordSymbolInterrupt, runSymbolGraph } from "./symbol-graph.js";

export const symbolAgentSlugs = [
  "symbol-market",
  "symbol-company",
  "symbol-technical-options",
  "symbol-news",
  "symbol-risk",
  "symbol-critic",
  "symbol-supervisor",
] as const;
export type SymbolAgentSlug = (typeof symbolAgentSlugs)[number];

type Json = Record<string, unknown>;
export type SymbolTranscriptEntry = {
  role: "user" | "agent";
  text: string;
  at: string;
};
type Conversation = {
  task_id: string;
  context_id: string;
  tenant_id: string;
  agent_slug: SymbolAgentSlug;
  state: "collecting" | "completed" | "failed" | "cancelled";
  user_message: string;
  title?: string;
  archived_at?: Date | null;
  created_at?: Date;
  updated_at?: Date;
  intent: Intent;
  transcript: SymbolTranscriptEntry[];
  result: Json | null;
};
export type SymbolConversationSummary = {
  taskId: string;
  contextId: string;
  agentSlug: SymbolAgentSlug;
  state: Conversation["state"];
  title: string;
  preview: string;
  updatedAt: string;
  archivedAt?: string;
};
export type SymbolConversationDetail = SymbolConversationSummary & {
  intent: Intent;
  transcript: SymbolTranscriptEntry[];
  result: Json | null;
};
export type Intent = {
  symbol?: string;
  assetType?: "stock" | "etf" | "index" | "crypto";
  market?: string;
  period?: string;
  question?: string;
  thesis?: string;
  missing?: string[];
  confidence?: number;
};

const intentSchema = z
  .object({
    symbol: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9.^-]{1,18}$/)
      .optional(),
    assetType: z.enum(["stock", "etf", "index", "crypto"]).optional(),
    market: z.string().trim().max(40).optional(),
    period: z.string().trim().max(80).optional(),
    question: z.string().trim().max(1000).optional(),
    thesis: z.string().trim().max(2000).optional(),
    missing: z
      .array(z.enum(["symbol", "period", "thesis", "question"]))
      .max(4)
      .default([]),
    confidence: z.number().min(0).max(1).default(0),
  })
  .strict();

const definitions: Record<
  SymbolAgentSlug,
  { name: string; description: string; skill: string; needs: string[] }
> = {
  "symbol-market": {
    name: "Symbol 市场行情 Agent",
    description:
      "查询股票、ETF、指数或加密资产的实时/近期行情并解释价格、成交量与区间表现。",
    skill: "market-quote",
    needs: ["symbol"],
  },
  "symbol-company": {
    name: "Symbol 公司研究 Agent",
    description: "生成公司概览、关键指标、业务与近期价格表现的中文研究摘要。",
    skill: "company-research",
    needs: ["symbol"],
  },
  "symbol-technical-options": {
    name: "Symbol 技术与期权 Agent",
    description:
      "计算均线、动量、波动率并在可用时概览期权到期日和隐含波动信息。",
    skill: "technical-options",
    needs: ["symbol"],
  },
  "symbol-news": {
    name: "Symbol 新闻 Agent",
    description: "聚合标的直接相关的新闻，按时间与潜在影响给出中文摘要。",
    skill: "symbol-news",
    needs: ["symbol"],
  },
  "symbol-risk": {
    name: "Symbol 风险 Agent",
    description: "从价格波动、回撤和事件风险角度生成非投资建议的风险检查。",
    skill: "risk-review",
    needs: ["symbol"],
  },
  "symbol-critic": {
    name: "Symbol 观点审查 Agent",
    description:
      "审查用户投资观点中的假设、证据缺口和可证伪条件，不替用户做交易决定。",
    skill: "thesis-critic",
    needs: ["symbol", "thesis"],
  },
  "symbol-supervisor": {
    name: "Symbol 研究编排 Agent",
    description: "将行情、公司、技术、新闻和风险信息组合成结构化研究简报。",
    skill: "research-orchestration",
    needs: ["symbol"],
  },
};

function now() {
  return new Date().toISOString();
}
function conversationTitle(text: string) {
  return text.trim().replace(/\s+/g, " ").slice(0, 96) || "新对话";
}
function mapConversation(
  conversation: Conversation,
): SymbolConversationSummary {
  const last =
    conversation.transcript.at(-1)?.text ?? conversation.user_message;
  return {
    taskId: conversation.task_id,
    contextId: conversation.context_id,
    agentSlug: conversation.agent_slug,
    state: conversation.state,
    title: conversation.title ?? conversationTitle(conversation.user_message),
    preview: last.replace(/\s+/g, " ").slice(0, 150),
    updatedAt: (conversation.updated_at ?? new Date()).toISOString(),
    archivedAt: conversation.archived_at?.toISOString(),
  };
}
function textMessage(text: string, taskId: string, contextId: string) {
  return {
    messageId: crypto.randomUUID(),
    taskId,
    contextId,
    role: "ROLE_AGENT",
    parts: [{ text }],
    metadata: {},
    extensions: [],
    referenceTaskIds: [],
  };
}
export function taskJson(input: {
  taskId: string;
  contextId: string;
  state: string;
  text: string;
  artifact?: Json;
  metadata?: Json;
}) {
  const message = textMessage(input.text, input.taskId, input.contextId);
  return {
    id: input.taskId,
    contextId: input.contextId,
    status: { state: input.state, message, timestamp: now() },
    artifacts: input.artifact
      ? [
          {
            artifactId: "symbol-report",
            name: "研究结果",
            description: "Symbol 内置 Agent 输出",
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

function missingQuestion(slug: SymbolAgentSlug, missing: string[]) {
  const labels: Record<string, string> = {
    symbol: "要分析的标的（代码或公司名称）",
    period: "分析周期",
    thesis: "你的投资观点或假设",
    question: "你想回答的问题",
  };
  return `为了继续${definitions[slug].name}，请补充：${missing.map((key) => labels[key] ?? key).join("、")}。你可以直接用自然语言回答。`;
}

function userText(body: unknown): {
  text: string;
  taskId?: string;
  contextId?: string;
} {
  const textFromPart = (part: unknown): string => {
    if (!part || typeof part !== "object") return "";
    const value = part as {
      text?: unknown;
      content?: unknown;
    };
    if (typeof value.text === "string") return value.text;
    if (typeof value.content === "string") return value.content;
    if (!value.content || typeof value.content !== "object") return "";
    const content = value.content as {
      $case?: unknown;
      value?: unknown;
      text?: unknown;
    };
    if (content.$case === "text" && typeof content.value === "string")
      return content.value;
    if (typeof content.text === "string") return content.text;
    return "";
  };
  const value = body as {
    message?: {
      parts?: Array<{ text?: unknown }>;
      taskId?: unknown;
      contextId?: unknown;
    };
  };
  const message = value?.message;
  const text = (message?.parts ?? []).map(textFromPart).join("\n").trim();
  return {
    text,
    taskId: typeof message?.taskId === "string" ? message.taskId : undefined,
    contextId:
      typeof message?.contextId === "string" ? message.contextId : undefined,
  };
}

export const __symbolServiceInternals = {
  userText,
  nasdaqHistoryToChart,
  nasdaqInfoToSearch,
  parseNasdaqNumber,
};

async function extractIntent(
  text: string,
  prior: Intent,
  slug: SymbolAgentSlug,
): Promise<Intent> {
  if (!config.deepseekApiKey) {
    // This is deliberately not a company-name mapping. It only accepts a
    // ticker the user explicitly typed, so offline/dev mode never guesses a
    // security from natural language.
    const explicitTicker = text
      .match(
        /(?:^|\s|[（(])([A-Za-z]{1,10}(?:[.-][A-Za-z]{1,6})?)(?=$|\s|[）),，。！？!?])/u,
      )?.[1]
      ?.toUpperCase();
    const merged = {
      ...prior,
      ...(explicitTicker ? { symbol: explicitTicker } : {}),
      question: text,
    };
    return {
      ...merged,
      missing: definitions[slug].needs.filter(
        (key) => !merged[key as keyof Intent],
      ),
      confidence: 0,
    };
  }
  const prompt = `你是金融研究 Agent 的意图解析器。只返回 JSON，不要解释。不得猜测或把公司名称映射为代码；没有确定代码时 symbol 留空。\n用户消息：${text}\n已有上下文：${JSON.stringify(prior)}\n任务：${definitions[slug].description}\nJSON字段：symbol(交易代码), assetType(stock|etf|index|crypto), market, period, question, thesis, missing(string数组，仅 symbol/period/thesis/question), confidence(0-1)。`;
  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.deepseekApiKey}`,
      },
      body: JSON.stringify({
        model: config.deepseekModel,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "你是严格的 JSON 信息抽取器。" },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`DeepSeek HTTP ${response.status}`);
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const parsed = intentSchema.parse(
      JSON.parse(payload.choices?.[0]?.message?.content ?? "{}"),
    );
    const merged: Intent = {
      ...prior,
      ...Object.fromEntries(
        Object.entries(parsed).filter(
          ([, value]) => value !== undefined && value !== "",
        ),
      ),
    };
    merged.missing = definitions[slug].needs.filter(
      (key) => !merged[key as keyof Intent],
    );
    return merged;
  } catch (error) {
    console.warn(
      "Symbol intent extraction failed:",
      error instanceof Error ? error.message : error,
    );
    return {
      ...prior,
      question: text,
      missing: definitions[slug].needs.filter(
        (key) => !prior[key as keyof Intent],
      ),
      confidence: 0,
    };
  }
}

async function saveConversation(conversation: Conversation): Promise<void> {
  await query(
    `INSERT INTO symbol_conversations(task_id,context_id,tenant_id,agent_slug,state,user_message,title,intent,transcript,result)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT(task_id) DO UPDATE SET state=EXCLUDED.state,user_message=EXCLUDED.user_message,intent=EXCLUDED.intent,transcript=EXCLUDED.transcript,result=EXCLUDED.result,updated_at=now()`,
    [
      conversation.task_id,
      conversation.context_id,
      conversation.tenant_id,
      conversation.agent_slug,
      conversation.state,
      conversation.user_message,
      conversation.title ?? conversationTitle(conversation.user_message),
      JSON.stringify(conversation.intent),
      JSON.stringify(conversation.transcript),
      conversation.result ? JSON.stringify(conversation.result) : null,
    ],
  );
  const redis = await getRedis();
  if (redis)
    await redis.set(
      `symbol:task:${conversation.task_id}`,
      JSON.stringify(conversation),
      { EX: 900 },
    );
}
async function loadConversation(
  taskId: string,
  tenantId: string,
  slug: SymbolAgentSlug,
): Promise<Conversation | undefined> {
  const redis = await getRedis();
  const cached = await redis?.get(`symbol:task:${taskId}`);
  if (cached) {
    const parsed = JSON.parse(cached) as Conversation;
    if (parsed.tenant_id === tenantId && parsed.agent_slug === slug)
      return parsed;
  }
  const rows = await query<Conversation>(
    `SELECT * FROM symbol_conversations WHERE task_id=$1 AND tenant_id=$2 AND agent_slug=$3 AND expires_at>now()`,
    [taskId, tenantId, slug],
  );
  return rows[0];
}

export async function listSymbolConversations(
  tenantId: string,
  slug: SymbolAgentSlug,
  includeArchived = false,
): Promise<SymbolConversationSummary[]> {
  const rows = await query<Conversation>(
    `SELECT * FROM symbol_conversations WHERE tenant_id=$1 AND agent_slug=$2 ${includeArchived ? "" : "AND archived_at IS NULL"} ORDER BY updated_at DESC LIMIT 100`,
    [tenantId, slug],
  );
  return rows.map(mapConversation);
}

export async function getSymbolConversation(
  tenantId: string,
  taskId: string,
): Promise<SymbolConversationDetail | undefined> {
  const rows = await query<Conversation>(
    "SELECT * FROM symbol_conversations WHERE tenant_id=$1 AND task_id=$2",
    [tenantId, taskId],
  );
  const conversation = rows[0];
  if (!conversation) return undefined;
  return {
    ...mapConversation(conversation),
    intent: conversation.intent,
    transcript: conversation.transcript,
    result: conversation.result,
  };
}

export async function renameSymbolConversation(
  tenantId: string,
  taskId: string,
  title: string,
): Promise<SymbolConversationSummary | undefined> {
  const rows = await query<Conversation>(
    "UPDATE symbol_conversations SET title=$3,updated_at=now() WHERE tenant_id=$1 AND task_id=$2 RETURNING *",
    [tenantId, taskId, conversationTitle(title)],
  );
  return rows[0] ? mapConversation(rows[0]) : undefined;
}

export async function archiveSymbolConversation(
  tenantId: string,
  taskId: string,
  archived: boolean,
): Promise<SymbolConversationSummary | undefined> {
  const rows = await query<Conversation>(
    "UPDATE symbol_conversations SET archived_at=CASE WHEN $3 THEN now() ELSE NULL END,updated_at=now() WHERE tenant_id=$1 AND task_id=$2 RETURNING *",
    [tenantId, taskId, archived],
  );
  return rows[0] ? mapConversation(rows[0]) : undefined;
}

async function cachedJson<T>(
  key: string,
  ttl: number,
  load: () => Promise<T>,
): Promise<T> {
  const redis = await getRedis();
  const old = await redis?.get(key);
  if (old) return JSON.parse(old) as T;
  const fresh = await load();
  if (redis) await redis.set(key, JSON.stringify(fresh), { EX: ttl });
  return fresh;
}
async function yahoo(path: string): Promise<Json> {
  const response = await fetch(`https://query1.finance.yahoo.com${path}`, {
    headers: {
      accept: "application/json,text/plain,*/*",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`行情数据源返回 HTTP ${response.status}`);
  return (await response.json()) as Json;
}

type NasdaqHistoryRow = {
  date?: string;
  close?: string;
  volume?: string;
  high?: string;
  low?: string;
};

function providerError(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}

function parseNasdaqNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[$,%+\s]/g, "").replace(/,/g, "");
  if (!normalized || normalized === "N/A" || normalized === "--") return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function nasdaqTimestamp(value: string | undefined): number | null {
  const match = value?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const timestamp = Date.UTC(
    Number(match[3]),
    Number(match[1]) - 1,
    Number(match[2]),
  );
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : null;
}

function nasdaqHistoryToChart(payload: Json): Json {
  const data = payload.data as
    | {
        tradesTable?: { rows?: NasdaqHistoryRow[] };
      }
    | undefined;
  const points = (data?.tradesTable?.rows ?? [])
    .map((row) => ({
      timestamp: nasdaqTimestamp(row.date),
      close: parseNasdaqNumber(row.close),
      high: parseNasdaqNumber(row.high),
      low: parseNasdaqNumber(row.low),
      volume: parseNasdaqNumber(row.volume),
    }))
    .filter(
      (point): point is {
        timestamp: number;
        close: number;
        high: number | null;
        low: number | null;
        volume: number | null;
      } => point.timestamp !== null && point.close !== null,
    )
    .sort((left, right) => left.timestamp - right.timestamp);
  if (!points.length) throw new Error("Nasdaq 未返回可用历史行情");
  return {
    chart: {
      result: [
        {
          timestamp: points.map((point) => point.timestamp),
          indicators: {
            quote: [
              {
                close: points.map((point) => point.close),
                high: points.map((point) => point.high),
                low: points.map((point) => point.low),
                volume: points.map((point) => point.volume),
              },
            ],
          },
        },
      ],
      error: null,
    },
  };
}

function nasdaqInfoToSearch(payload: Json): Json {
  const data = payload.data as
    | {
        symbol?: string;
        companyName?: string;
        exchange?: string;
        stockType?: string;
        assetClass?: string;
        primaryData?: {
          lastSalePrice?: string;
          lastTradeTimestamp?: string;
        };
      }
    | undefined;
  if (!data?.symbol) throw new Error("Nasdaq 未返回标的信息");
  return {
    quotes: [
      {
        symbol: data.symbol,
        shortname: data.companyName,
        longname: data.companyName,
        exchange: data.exchange,
        quoteType: data.assetClass ?? data.stockType,
        regularMarketPrice: parseNasdaqNumber(data.primaryData?.lastSalePrice),
        regularMarketTime: data.primaryData?.lastTradeTimestamp,
      },
    ],
    news: [],
  };
}

function nasdaqStartDate(range: string) {
  const days = range === "1y" ? 380 : range === "6mo" ? 190 : 14;
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

async function nasdaq(path: string): Promise<Json> {
  const response = await fetch(`https://api.nasdaq.com${path}`, {
    headers: {
      accept: "application/json,text/plain,*/*",
      origin: "https://www.nasdaq.com",
      referer: "https://www.nasdaq.com/",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok)
    throw new Error(`Nasdaq 行情数据源返回 HTTP ${response.status}`);
  const payload = (await response.json()) as Json;
  if (!payload.data) throw new Error("Nasdaq 行情数据源未返回数据");
  return payload;
}

async function nasdaqChart(symbol: string, range: string): Promise<Json> {
  const payload = await nasdaq(
    `/api/quote/${encodeURIComponent(symbol)}/historical?assetclass=stocks&fromdate=${nasdaqStartDate(range)}&limit=400`,
  );
  return nasdaqHistoryToChart(payload);
}

async function withMarketFallback(
  yahooLoad: () => Promise<Json>,
  nasdaqLoad: () => Promise<Json>,
) {
  try {
    return await yahooLoad();
  } catch (yahooError) {
    try {
      return await nasdaqLoad();
    } catch (nasdaqError) {
      throw new Error(
        `可用行情数据源均失败（Yahoo：${providerError(yahooError)}；Nasdaq：${providerError(nasdaqError)}）`,
      );
    }
  }
}
async function quote(symbol: string) {
  return cachedJson(`symbol:quote:${symbol}`, 30, async () =>
    withMarketFallback(
      () =>
        yahoo(
          `/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`,
        ),
      () => nasdaqChart(symbol, "5d"),
    ),
  );
}
async function chart(symbol: string, range = "6mo") {
  return cachedJson(`symbol:chart:${symbol}:${range}`, 300, async () =>
    withMarketFallback(
      () =>
        yahoo(
          `/v8/finance/chart/${encodeURIComponent(symbol)}?range=${encodeURIComponent(range)}&interval=1d`,
        ),
      () => nasdaqChart(symbol, range),
    ),
  );
}
async function search(symbol: string) {
  return cachedJson(`symbol:search:${symbol}`, 600, async () =>
    withMarketFallback(
      () =>
        yahoo(
          `/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=1&newsCount=12`,
        ),
      async () =>
        nasdaqInfoToSearch(
          await nasdaq(
            `/api/quote/${encodeURIComponent(symbol)}/info?assetclass=stocks`,
          ),
        ),
    ),
  );
}
function chartPoints(data: Json) {
  const root = data.chart as {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          close?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
    }>;
  };
  const result = root?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  return (result?.timestamp ?? [])
    .map((timestamp, i) => ({
      timestamp,
      close: quote?.close?.[i] ?? null,
      high: quote?.high?.[i] ?? null,
      low: quote?.low?.[i] ?? null,
      volume: quote?.volume?.[i] ?? null,
    }))
    .filter((point) => typeof point.close === "number");
}
function average(values: number[]) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}
function pct(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}
function quoteSummary(symbol: string, raw: Json) {
  const points = chartPoints(raw);
  const first = points[0]?.close ?? 0;
  const last = points.at(-1)?.close ?? 0;
  const previous = points.at(-2)?.close ?? last;
  return {
    symbol,
    close: last,
    change: last && previous ? (last - previous) / previous : 0,
    fiveDayChange: first && last ? (last - first) / first : 0,
    volume: points.at(-1)?.volume ?? null,
    observedAt: points.at(-1)?.timestamp
      ? new Date(points.at(-1)!.timestamp * 1000).toISOString()
      : now(),
  };
}
function technicalSummary(symbol: string, raw: Json) {
  const closes = chartPoints(raw).map((point) => point.close as number);
  const latest = closes.at(-1) ?? 0;
  const returns = closes
    .slice(1)
    .map((value, i) => (value - closes[i]) / closes[i]);
  const sma20 = average(closes.slice(-20));
  const sma60 = average(closes.slice(-60));
  const volatility =
    Math.sqrt(average(returns.map((r) => r * r))) * Math.sqrt(252);
  const peak = Math.max(...closes, latest);
  const drawdown = peak ? (latest - peak) / peak : 0;
  return {
    symbol,
    latest,
    sma20,
    sma60,
    annualizedVolatility: volatility,
    drawdown,
    trend:
      latest >= sma20 && sma20 >= sma60
        ? "上行"
        : latest <= sma20 && sma20 <= sma60
          ? "下行"
          : "震荡",
  };
}
async function newsSummary(symbol: string) {
  const data = await search(symbol);
  const rows = ((data.news ?? []) as Array<Json>).slice(0, 8).map((item) => ({
    title: String(item.title ?? ""),
    publisher: String(item.publisher ?? ""),
    link: String(item.link ?? ""),
    publishedAt: item.providerPublishTime
      ? new Date(Number(item.providerPublishTime) * 1000).toISOString()
      : undefined,
    summary: String(item.summary ?? ""),
  }));
  return { symbol, items: rows };
}
async function runAnalysis(
  slug: SymbolAgentSlug,
  intent: Intent,
): Promise<{ text: string; data: Json }> {
  const symbol = intent.symbol!;
  if (slug === "symbol-market") {
    const data = quoteSummary(symbol, await quote(symbol));
    return {
      data,
      text: `${symbol} 最新收盘/报价：${data.close}；日变动 ${pct(data.change)}，近五日 ${pct(data.fiveDayChange)}。数据时间：${data.observedAt}。`,
    };
  }
  if (slug === "symbol-technical-options") {
    const data = technicalSummary(symbol, await chart(symbol));
    return {
      data,
      text: `${symbol} 技术面：趋势${data.trend}，最新价 ${data.latest.toFixed(2)}，20日均线 ${data.sma20.toFixed(2)}，60日均线 ${data.sma60.toFixed(2)}，年化波动率约 ${pct(data.annualizedVolatility)}，区间回撤 ${pct(data.drawdown)}。`,
    };
  }
  if (slug === "symbol-news") {
    const data = await newsSummary(symbol);
    return {
      data,
      text: data.items.length
        ? `${symbol} 近期直接相关资讯（${data.items.length} 条）已整理；请在结果卡片查看来源和摘要。`
        : `${symbol} 暂未从当前数据源取得近期新闻。`,
    };
  }
  if (slug === "symbol-company") {
    const [market, info] = await Promise.all([quote(symbol), search(symbol)]);
    const data = {
      quote: quoteSummary(symbol, market),
      matches: (info.quotes as Json[] | undefined)?.slice(0, 3) ?? [],
    };
    return {
      data,
      text: `${symbol} 公司研究摘要已生成：最新价 ${data.quote.close}，近五日 ${pct(data.quote.fiveDayChange)}。请核对结果中的交易所和名称，避免同名标的误判。`,
    };
  }
  if (slug === "symbol-risk") {
    const data = technicalSummary(symbol, await chart(symbol, "1y"));
    const level =
      data.annualizedVolatility > 0.55 || data.drawdown < -0.3
        ? "较高"
        : data.annualizedVolatility > 0.3 || data.drawdown < -0.15
          ? "中等"
          : "较低";
    return {
      data: { ...data, riskLevel: level },
      text: `${symbol} 风险概览：价格波动风险${level}；年化波动率约 ${pct(data.annualizedVolatility)}，一年区间最大回撤约 ${pct(data.drawdown)}。这不是投资建议。`,
    };
  }
  if (slug === "symbol-critic") {
    const tech = technicalSummary(symbol, await chart(symbol));
    const data = {
      symbol,
      thesis: intent.thesis,
      technical: tech,
      checks: [
        "观点是否区分事实、预测与估值判断",
        "是否给出可证伪条件和持有期限",
        "是否考虑波动、流动性及单一标的集中度",
      ],
    };
    return {
      data,
      text: `${symbol} 观点审查：我已记录你的假设，并建议用可证伪条件检验。当前技术趋势为${tech.trend}，年化波动率约 ${pct(tech.annualizedVolatility)}；请不要将单一技术信号当作结论。`,
    };
  }
  const [market, technical, news] = await Promise.all([
    quote(symbol),
    chart(symbol),
    newsSummary(symbol),
  ]);
  const marketData = quoteSummary(symbol, market);
  const tech = technicalSummary(symbol, technical);
  const data = { market: marketData, technical: tech, news };
  return {
    data,
    text: `${symbol} 研究编排简报：最新价 ${marketData.close}，近五日 ${pct(marketData.fiveDayChange)}；技术趋势${tech.trend}，年化波动率约 ${pct(tech.annualizedVolatility)}；已收集 ${news.items.length} 条近期新闻。内容仅作研究参考，不构成投资建议。`,
  };
}

export function symbolCard(slug: SymbolAgentSlug) {
  const spec = definitions[slug];
  const base = `${config.platformOrigin}/api/builtin/symbol/${slug}`;
  return {
    protocolVersion: "1.0",
    name: spec.name,
    description: spec.description,
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
        id: spec.skill,
        name: spec.name,
        description: spec.description,
        tags: ["symbol", "finance", "built-in"],
        examples: ["用自然语言描述你想研究的标的和问题。"],
      },
    ],
    securitySchemes: {},
    securityRequirements: [],
  };
}

export async function handleSymbolMessage(
  slug: SymbolAgentSlug,
  tenantId: string,
  body: unknown,
) {
  const incoming = userText(body);
  if (!incoming.text)
    throw new Error("A2A message.parts 中必须包含非空 text。");
  let current = incoming.taskId
    ? await loadConversation(incoming.taskId, tenantId, slug)
    : undefined;
  if (incoming.taskId && !current)
    throw new Error("任务不存在、已过期，或不属于当前租户。");
  const taskId = current?.task_id ?? crypto.randomUUID();
  const contextId =
    current?.context_id ?? incoming.contextId ?? crypto.randomUUID();
  const intent = await extractIntent(
    incoming.text,
    current?.intent ?? {},
    slug,
  );
  const transcript: SymbolTranscriptEntry[] = [
    ...(current?.transcript ?? []),
    { role: "user", text: incoming.text, at: now() },
  ];
  if ((intent.missing ?? []).length) {
    const answer = missingQuestion(slug, intent.missing ?? []);
    transcript.push({ role: "agent", text: answer, at: now() });
    await saveConversation({
      task_id: taskId,
      context_id: contextId,
      tenant_id: tenantId,
      agent_slug: slug,
      state: "collecting",
      user_message: incoming.text,
      intent,
      transcript,
      result: null,
    });
    await recordSymbolInterrupt(
      {
        tenantId,
        taskId,
        agentSlug: slug,
        intent: intent as Record<string, unknown>,
      },
      intent.missing ?? [],
    );
    return taskJson({
      taskId,
      contextId,
      state: "TASK_STATE_INPUT_REQUIRED",
      text: answer,
      metadata: { missing: intent.missing, agent: slug },
    });
  }
  try {
    const result = await runSymbolGraph(
      {
        tenantId,
        taskId,
        agentSlug: slug,
        intent: intent as Record<string, unknown>,
      },
      (nodeSlug) => runAnalysis(nodeSlug as SymbolAgentSlug, intent),
    );
    transcript.push({ role: "agent", text: result.text, at: now() });
    await saveConversation({
      task_id: taskId,
      context_id: contextId,
      tenant_id: tenantId,
      agent_slug: slug,
      state: "completed",
      user_message: incoming.text,
      intent,
      transcript,
      result: result.data,
    });
    return taskJson({
      taskId,
      contextId,
      state: "TASK_STATE_COMPLETED",
      text: result.text,
      artifact: result.data,
      metadata: { agent: slug, intent },
    });
  } catch (error) {
    const message = `暂时无法完成 ${definitions[slug].name}：${error instanceof Error ? error.message : "未知错误"}。请稍后重试。`;
    transcript.push({ role: "agent", text: message, at: now() });
    await saveConversation({
      task_id: taskId,
      context_id: contextId,
      tenant_id: tenantId,
      agent_slug: slug,
      state: "failed",
      user_message: incoming.text,
      intent,
      transcript,
      result: null,
    });
    return taskJson({
      taskId,
      contextId,
      state: "TASK_STATE_FAILED",
      text: message,
      metadata: { agent: slug },
    });
  }
}

export async function getSymbolTask(
  slug: SymbolAgentSlug,
  tenantId: string,
  taskId: string,
) {
  const current = await loadConversation(taskId, tenantId, slug);
  if (!current) return undefined;
  const lastAgentText =
    [...current.transcript].reverse().find((item) => item.role === "agent")
      ?.text ?? "任务已保存。";
  const state =
    current.state === "collecting"
      ? "TASK_STATE_INPUT_REQUIRED"
      : current.state === "completed"
        ? "TASK_STATE_COMPLETED"
        : current.state === "cancelled"
          ? "TASK_STATE_CANCELED"
          : "TASK_STATE_FAILED";
  return taskJson({
    taskId: current.task_id,
    contextId: current.context_id,
    state,
    text: lastAgentText,
    artifact: current.result ?? undefined,
    metadata: { agent: slug, intent: current.intent },
  });
}

export async function cancelSymbolTask(
  slug: SymbolAgentSlug,
  tenantId: string,
  taskId: string,
) {
  const current = await loadConversation(taskId, tenantId, slug);
  if (!current) return undefined;
  current.state = "cancelled";
  current.transcript.push({ role: "agent", text: "任务已取消。", at: now() });
  await saveConversation(current);
  return taskJson({
    taskId: current.task_id,
    contextId: current.context_id,
    state: "TASK_STATE_CANCELED",
    text: "任务已取消。",
    metadata: { agent: slug },
  });
}

export function isSymbolAgentSlug(value: string): value is SymbolAgentSlug {
  return (symbolAgentSlugs as readonly string[]).includes(value);
}
