import { z } from "zod";
import { config } from "./config.js";
import {
  readLimitedResponseText,
  secureFetchWithPolicy,
} from "./secure-fetch.js";
import {
  allowPrivateOutboundTargets,
  assertSafeOutboundUrl,
} from "./url-policy.js";

export const channelIntentSchema = z.enum([
  "overview",
  "attribution",
  "anomaly",
  "replenishment",
  "weekly_report",
  "capability",
]);
export type ChannelIntent = z.infer<typeof channelIntentSchema>;

export const channelToolNameSchema = z.enum([
  "get_channel_overview",
  "get_channel_attribution",
  "detect_channel_anomalies",
  "get_replenishment_priority",
]);
export type ChannelToolName = z.infer<typeof channelToolNameSchema>;

const chartSeriesSchema = z.object({
  name: z.string().trim().min(1).max(80),
  data: z.array(z.number().finite()).min(1).max(24),
  unit: z.string().trim().max(24).optional(),
});

export const channelChartSpecSchema = z
  .object({
    type: z.enum(["bar", "line"]),
    title: z.string().trim().min(1).max(160),
    categories: z.array(z.string().trim().min(1).max(80)).min(1).max(24),
    series: z.array(chartSeriesSchema).min(1).max(6),
  })
  .superRefine((value, context) => {
    for (const [index, series] of value.series.entries()) {
      if (series.data.length !== value.categories.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["series", index, "data"],
          message: "序列数据量必须与横轴类目数量一致。",
        });
      }
    }
  });
export type ChannelChartSpec = z.infer<typeof channelChartSpecSchema>;

export const channelToolResultSchema = z.object({
  mode: z.enum(["live", "mock"]).default("live"),
  source: z.string().trim().min(1).max(160),
  asOf: z.string().datetime({ offset: true }),
  title: z.string().trim().min(1).max(160),
  conclusion: z.string().trim().min(1).max(2_000),
  facts: z
    .array(
      z.object({
        channel: z.string().trim().min(1).max(80).optional(),
        metric: z.string().trim().min(1).max(120),
        value: z.union([z.number().finite(), z.string().trim().max(240)]),
        unit: z.string().trim().max(32).optional(),
        period: z.string().trim().max(80).optional(),
        change: z.number().finite().optional(),
        changeUnit: z.string().trim().max(32).optional(),
      }),
    )
    .min(1)
    .max(120),
  reasons: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        detail: z.string().trim().min(1).max(1_500),
        evidence: z.array(z.string().trim().min(1).max(300)).min(1).max(12),
      }),
    )
    .max(20)
    .default([]),
  actions: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  knowledgeKeys: z
    .array(z.string().trim().min(1).max(120))
    .max(20)
    .default([]),
  chart: channelChartSpecSchema,
});
export type ChannelToolResult = z.infer<typeof channelToolResultSchema>;

export type ChannelToolInput = {
  tenantId: string;
  query: string;
  channels: string[];
  period: { raw: string; start?: string; end?: string };
  timezone: "Asia/Shanghai";
  taskId: string;
  contextId: string;
  previousIntent?: Exclude<ChannelIntent, "capability">;
};

export interface ChannelToolInvoker {
  invoke(
    tool: ChannelToolName,
    input: ChannelToolInput,
    signal?: AbortSignal,
  ): Promise<ChannelToolResult>;
}

export class ChannelDataApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "ChannelDataApiError";
  }
}

function combinedSignal(signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(config.channelDataApiTimeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export class HttpChannelToolInvoker implements ChannelToolInvoker {
  async invoke(
    tool: ChannelToolName,
    input: ChannelToolInput,
    signal?: AbortSignal,
  ): Promise<ChannelToolResult> {
    if (!config.channelDataApiBaseUrl) {
      throw new ChannelDataApiError(
        "渠道数据 API 未配置（缺少 CHANNEL_DATA_API_BASE_URL），不会使用模拟经营数据代替。",
        "CHANNEL_DATA_API_NOT_CONFIGURED",
      );
    }
    const toolName = channelToolNameSchema.parse(tool);
    const endpoint = new URL(
      `tools/${encodeURIComponent(toolName)}`,
      `${config.channelDataApiBaseUrl}/`,
    );
    await assertSafeOutboundUrl(endpoint.toString(), {
      purpose: "agent_card",
      allowPrivate: allowPrivateOutboundTargets(),
    });
    const response = await secureFetchWithPolicy(
      endpoint,
      {
        method: "POST",
        redirect: "error",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "x-tenant-id": input.tenantId,
          ...(config.channelDataApiToken
            ? { authorization: `Bearer ${config.channelDataApiToken}` }
            : {}),
        },
        body: JSON.stringify(input),
        signal: combinedSignal(signal),
      },
      { allowPrivate: allowPrivateOutboundTargets() },
    );
    const raw = await readLimitedResponseText(response, 1_048_576);
    if (!response.ok) {
      throw new ChannelDataApiError(
        `渠道数据工具 ${toolName} 返回 HTTP ${response.status}。`,
        "CHANNEL_DATA_API_HTTP_ERROR",
      );
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      throw new ChannelDataApiError(
        `渠道数据工具 ${toolName} 返回了无效 JSON。`,
        "CHANNEL_DATA_API_INVALID_JSON",
      );
    }
    const candidate =
      decoded && typeof decoded === "object" && "result" in decoded
        ? (decoded as { result: unknown }).result
        : decoded;
    const parsed = channelToolResultSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new ChannelDataApiError(
        `渠道数据工具 ${toolName} 的返回结构不符合契约：${parsed.error.issues[0]?.message ?? "未知校验错误"}`,
        "CHANNEL_DATA_API_SCHEMA_MISMATCH",
      );
    }
    return parsed.data;
  }
}

type MockMetric = {
  gmv: number;
  grossMarginRate: number;
  roi: number;
  returnRate: number;
  gmvChange: number;
  roiChange: number;
};

const mockMetrics: Record<string, MockMetric> = {
  天猫: {
    gmv: 1_286_000,
    grossMarginRate: 32.4,
    roi: 3.6,
    returnRate: 7.2,
    gmvChange: 8.4,
    roiChange: 0.2,
  },
  京东: {
    gmv: 1_108_000,
    grossMarginRate: 30.8,
    roi: 3.2,
    returnRate: 8.1,
    gmvChange: 3.6,
    roiChange: 0.1,
  },
  抖音: {
    gmv: 982_000,
    grossMarginRate: 27.6,
    roi: 2.3,
    returnRate: 12.1,
    gmvChange: -5.8,
    roiChange: -0.4,
  },
  拼多多: {
    gmv: 715_000,
    grossMarginRate: 21.9,
    roi: 2.8,
    returnRate: 13.8,
    gmvChange: 4.1,
    roiChange: -0.1,
  },
};

const mockAsOf = "2026-10-01T18:00:00+08:00";
const mockSource = "渠道罗盘内置演示数据（Mock，非真实经营数据）";

function selectedChannels(input: ChannelToolInput) {
  return input.channels.length
    ? input.channels.filter((channel) => mockMetrics[channel])
    : Object.keys(mockMetrics);
}

function overviewMock(input: ChannelToolInput): ChannelToolResult {
  const channels = selectedChannels(input);
  return channelToolResultSchema.parse({
    mode: "mock",
    source: mockSource,
    asOf: mockAsOf,
    title: "多渠道经营总览（演示）",
    conclusion:
      "演示数据中，天猫贡献最高 GMV 与毛利率；抖音 GMV 和 ROI 同时回落；拼多多退货率最高。",
    facts: channels.flatMap((channel) => {
      const metric = mockMetrics[channel];
      return [
        {
          channel,
          metric: "GMV",
          value: metric.gmv,
          unit: "元",
          period: "演示周期 2026-W39",
          change: metric.gmvChange,
          changeUnit: "%",
        },
        {
          channel,
          metric: "毛利率",
          value: metric.grossMarginRate,
          unit: "%",
          period: "演示周期 2026-W39",
        },
        {
          channel,
          metric: "ROI",
          value: metric.roi,
          period: "演示周期 2026-W39",
          change: metric.roiChange,
        },
        {
          channel,
          metric: "退货率",
          value: metric.returnRate,
          unit: "%",
          period: "演示周期 2026-W39",
        },
      ];
    }),
    reasons: [
      {
        title: "渠道结构分化",
        detail: "演示数据中高毛利渠道与高退货渠道表现分化。",
        evidence: ["天猫毛利率 32.4%", "拼多多退货率 13.8%"],
      },
    ],
    actions: [
      "优先复核抖音投放结构与高退货商品。",
      "对拼多多高退货 SKU 建立限投和质量复核清单。",
    ],
    knowledgeKeys: ["metrics.gmv", "metrics.gross_margin", "metrics.roi", "metrics.return_rate"],
    chart: {
      type: "bar",
      title: "各渠道 GMV（Mock 演示）",
      categories: channels,
      series: [
        {
          name: "GMV",
          data: channels.map((channel) => mockMetrics[channel].gmv),
          unit: "元",
        },
      ],
    },
  });
}

function attributionMock(input: ChannelToolInput): ChannelToolResult {
  const channel = selectedChannels(input)[0] ?? "抖音";
  const metric = mockMetrics[channel];
  const declining = metric.roiChange < 0;
  return channelToolResultSchema.parse({
    mode: "mock",
    source: mockSource,
    asOf: mockAsOf,
    title: `${channel} ROI 归因（演示）`,
    conclusion: declining
      ? `演示数据中，${channel} ROI 较对比期下降 ${Math.abs(metric.roiChange)}，主要由转化率下降与退款回冲增加共同造成。`
      : `演示数据中，${channel} ROI 较对比期提升 ${metric.roiChange}，没有出现下降。`,
    facts: [
      {
        channel,
        metric: "ROI",
        value: metric.roi,
        period: "演示周期 2026-W39",
        change: metric.roiChange,
      },
      {
        channel,
        metric: "投放消耗",
        value: declining ? 286_000 : 218_000,
        unit: "元",
        period: "演示周期 2026-W39",
        change: declining ? 14.2 : 5.1,
        changeUnit: "%",
      },
      {
        channel,
        metric: "支付转化率",
        value: declining ? 3.4 : 4.7,
        unit: "%",
        period: "演示周期 2026-W39",
        change: declining ? -13.7 : 6.2,
        changeUnit: "%",
      },
      {
        channel,
        metric: "退款回冲金额",
        value: declining ? 96_000 : 51_000,
        unit: "元",
        period: "演示周期 2026-W39",
        change: declining ? 18.6 : -2.3,
        changeUnit: "%",
      },
    ],
    reasons: declining
      ? [
          {
            title: "流量转化效率下降",
            detail: "演示数据中的投放消耗增长，但支付转化率下降。",
            evidence: ["投放消耗 +14.2%", "支付转化率 -13.7%"],
          },
          {
            title: "退款回冲增加",
            detail: "演示数据中的退款回冲金额高于对比期，压低归因成交金额。",
            evidence: ["退款回冲金额 +18.6%"],
          },
        ]
      : [
          {
            title: "转化效率改善",
            detail: "演示数据中的支付转化率提升快于投放消耗。",
            evidence: ["支付转化率 +6.2%", "投放消耗 +5.1%"],
          },
        ],
    actions: declining
      ? ["暂停高消耗低转化广告组并复核素材与人群包。", "拆分高退款 SKU 的投放和成交贡献。"]
      : ["保留当前高转化投放组合，并继续监控退款成熟度。"],
    knowledgeKeys: ["metrics.roi", "diagnosis.roi"],
    chart: {
      type: "line",
      title: `${channel} ROI 趋势（Mock 演示）`,
      categories: ["W36", "W37", "W38", "W39"],
      series: [
        {
          name: "ROI",
          data: [metric.roi + 0.5, metric.roi + 0.4, metric.roi + 0.2, metric.roi],
        },
      ],
    },
  });
}

function anomalyMock(input: ChannelToolInput): ChannelToolResult {
  const channels = selectedChannels(input);
  return channelToolResultSchema.parse({
    mode: "mock",
    source: mockSource,
    asOf: mockAsOf,
    title: "渠道异常诊断（演示）",
    conclusion: "演示数据识别出拼多多退货率高位、抖音库存周转变慢两项主要异常。",
    facts: [
      {
        channel: "拼多多",
        metric: "退货率",
        value: 13.8,
        unit: "%",
        period: "演示周期 2026-W39",
        change: 2.4,
        changeUnit: "百分点",
      },
      {
        channel: "抖音",
        metric: "库存周转天数",
        value: 47,
        unit: "天",
        period: "演示周期 2026-W39",
        change: 9,
        changeUnit: "天",
      },
      {
        channel: "天猫",
        metric: "缺货损失 GMV",
        value: 86_000,
        unit: "元",
        period: "演示周期 2026-W39",
        change: 31,
        changeUnit: "%",
      },
    ],
    reasons: [
      {
        title: "拼多多退货集中于低价组合装",
        detail: "Mock 原因码中“与描述不符”和“规格选择错误”占比上升。",
        evidence: ["退货率 13.8%", "较对比期 +2.4 个百分点"],
      },
      {
        title: "抖音动销放缓",
        detail: "Mock 库存中两款直播专供 SKU 的可售天数明显上升。",
        evidence: ["库存周转 47 天", "较对比期增加 9 天"],
      },
    ],
    actions: ["复核拼多多组合装商品页与规格映射。", "下调抖音慢销 SKU 的补货上限并安排清货。"],
    knowledgeKeys: ["metrics.return_rate", "metrics.inventory_turnover", "diagnosis.return", "diagnosis.inventory"],
    chart: {
      type: "bar",
      title: "渠道退货率（Mock 演示）",
      categories: channels,
      series: [
        {
          name: "退货率",
          data: channels.map((channel) => mockMetrics[channel].returnRate),
          unit: "%",
        },
      ],
    },
  });
}

function replenishmentMock(): ChannelToolResult {
  return channelToolResultSchema.parse({
    mode: "mock",
    source: mockSource,
    asOf: mockAsOf,
    title: "智能补货优先级（演示）",
    conclusion: "演示数据建议优先补充 SKU-CC-001 和 SKU-CC-017，两者预计缺货时间早于补货到货日。",
    facts: [
      { channel: "天猫 / SKU-CC-001", metric: "补货优先级", value: 96, period: "演示预测未来 14 天" },
      { channel: "天猫 / SKU-CC-001", metric: "建议补货量", value: 680, unit: "件", period: "演示预测未来 14 天" },
      { channel: "京东 / SKU-CC-017", metric: "补货优先级", value: 88, period: "演示预测未来 14 天" },
      { channel: "京东 / SKU-CC-017", metric: "建议补货量", value: 420, unit: "件", period: "演示预测未来 14 天" },
      { channel: "抖音 / SKU-CC-032", metric: "补货优先级", value: 74, period: "演示预测未来 14 天" },
      { channel: "拼多多 / SKU-CC-044", metric: "补货优先级", value: 61, period: "演示预测未来 14 天" },
    ],
    reasons: [
      {
        title: "预计缺货早于到货",
        detail: "前两项 Mock SKU 的当前可售天数低于采购提前期与安全库存之和。",
        evidence: ["SKU-CC-001 可售 4 天、提前期 7 天", "SKU-CC-017 可售 6 天、提前期 8 天"],
      },
    ],
    actions: ["今日确认 SKU-CC-001 的 680 件采购单。", "复核 SKU-CC-017 在途 120 件后再下单 420 件。", "SKU-CC-032 因退货率偏高需人工复核后补货。"],
    knowledgeKeys: ["replenishment.priority", "replenishment.quantity", "replenishment.guardrail", "replenishment.execution"],
    chart: {
      type: "bar",
      title: "SKU 补货优先级（Mock 演示）",
      categories: ["SKU-CC-001", "SKU-CC-017", "SKU-CC-032", "SKU-CC-044"],
      series: [{ name: "优先级", data: [96, 88, 74, 61] }],
    },
  });
}

export class MockChannelToolInvoker implements ChannelToolInvoker {
  async invoke(tool: ChannelToolName, input: ChannelToolInput) {
    if (tool === "get_channel_attribution") return attributionMock(input);
    if (tool === "detect_channel_anomalies") return anomalyMock(input);
    if (tool === "get_replenishment_priority") return replenishmentMock();
    return overviewMock(input);
  }
}

export class ConfiguredChannelToolInvoker implements ChannelToolInvoker {
  private readonly http = new HttpChannelToolInvoker();
  private readonly mock = new MockChannelToolInvoker();

  invoke(tool: ChannelToolName, input: ChannelToolInput, signal?: AbortSignal) {
    if (config.channelDataMode === "mock")
      return this.mock.invoke(tool, input);
    return this.http.invoke(tool, input, signal);
  }
}

export const channelToolInvoker = new ConfiguredChannelToolInvoker();
