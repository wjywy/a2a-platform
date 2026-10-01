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

export const httpChannelToolInvoker = new HttpChannelToolInvoker();
