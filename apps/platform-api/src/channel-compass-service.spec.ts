import { describe, expect, it, vi } from "vitest";
import {
  classifyChannelIntent,
  executeChannelAnalysis,
} from "./channel-compass-service.js";
import {
  channelToolResultSchema,
  type ChannelToolName,
  type ChannelToolResult,
} from "./channel-compass-tools.js";
import { renderChannelChartSvg } from "./channel-compass-visualization.js";

function result(tool: ChannelToolName, overrides: Partial<ChannelToolResult> = {}) {
  return channelToolResultSchema.parse({
    source: "commerce-warehouse",
    asOf: "2026-10-01T12:00:00+08:00",
    title: tool,
    conclusion: "抖音 ROI 较对比期下降，主要证据来自转化率变化。",
    facts: [
      {
        channel: "抖音",
        metric: "ROI",
        value: 2.3,
        period: "本周",
        change: -0.4,
      },
    ],
    reasons: [
      {
        title: "转化率下降",
        detail: "数据工具返回的转化率低于对比期。",
        evidence: ["转化率环比 -12%"],
      },
    ],
    actions: ["复核高消耗低转化广告组。"],
    knowledgeKeys: ["metrics.roi", "diagnosis.roi"],
    chart: {
      type: "line",
      title: "抖音 ROI 趋势",
      categories: ["上周", "本周"],
      series: [{ name: "ROI", data: [2.7, 2.3] }],
    },
    ...overrides,
  });
}

const knowledge = {
  entries: [
    {
      key: "metrics.roi",
      title: "投放 ROI",
      content: "归因成交金额除以投放消耗。",
      sourceId: "metrics",
      sourceTitle: "指标口径",
    },
    {
      key: "diagnosis.roi",
      title: "ROI 下滑拆解",
      content: "按消耗、转化率和客单价拆解。",
      sourceId: "diagnosis",
      sourceTitle: "诊断方法",
    },
  ],
  refs: [
    { id: "metrics", title: "指标口径", path: "knowledge/metrics.json" },
  ],
};

describe("Channel Compass", () => {
  it("classifies core commerce intents", () => {
    expect(classifyChannelIntent("抖音ROI为什么降？")).toBe("attribution");
    expect(classifyChannelIntent("哪些SKU要优先补货")).toBe("replenishment");
    expect(classifyChannelIntent("退货率突然飙升")).toBe("anomaly");
    expect(classifyChannelIntent("生成本周经营周报")).toBe("weekly_report");
  });

  it("calls attribution data, knowledge and visualization tools before reporting", async () => {
    const invoke = vi.fn(async (tool: ChannelToolName) => result(tool));
    const createVisualization = vi.fn(async () => ({
      id: "4d497ab9-edbe-4f5d-843d-21b9dd1466bd",
      title: "抖音 ROI 趋势",
      url: "https://example.com/chart.svg?signature=signed",
      expiresAt: "2026-10-08T12:00:00.000Z",
    }));
    const artifact = await executeChannelAnalysis(
      {
        tenantId: "tenant-a",
        taskId: "a503d58d-e8d2-45e3-8ea9-902af0f60da8",
        contextId: "2bbb7165-3067-40d2-aa47-4ca70d26aee3",
        query: "抖音ROI为什么降？",
        intent: {
          kind: "attribution",
          channels: ["抖音"],
          period: { raw: "本周" },
        },
      },
      {
        toolInvoker: { invoke },
        loadKnowledge: vi.fn(async () => knowledge),
        createVisualization,
      },
    );
    expect(invoke).toHaveBeenCalledWith(
      "get_channel_attribution",
      expect.objectContaining({ channels: ["抖音"] }),
      undefined,
    );
    expect(createVisualization).toHaveBeenCalledOnce();
    expect(artifact.answer).toMatch(
      /## 结论[\s\S]*## 数据依据[\s\S]*## 原因分析[\s\S]*## 行动建议/,
    );
    expect(artifact.answer).toContain("![抖音 ROI 趋势]");
    expect(artifact.toolCalls.map((call) => call.name)).toEqual([
      "get_channel_attribution",
      "create_channel_visualization",
    ]);
  });

  it("uses three real data tools for a weekly report", async () => {
    const invoke = vi.fn(async (tool: ChannelToolName) => result(tool));
    await executeChannelAnalysis(
      {
        tenantId: "tenant-a",
        taskId: "7687b15e-e313-4514-a6d2-076b286610fd",
        contextId: "9e769c48-2df1-45ec-8e79-58c5f06018fa",
        query: "生成经营周报",
        intent: {
          kind: "weekly_report",
          channels: [],
          period: { raw: "本周" },
        },
      },
      {
        toolInvoker: { invoke },
        loadKnowledge: vi.fn(async () => knowledge),
        createVisualization: vi.fn(async () => ({
          id: "4d497ab9-edbe-4f5d-843d-21b9dd1466bd",
          title: "经营趋势",
          url: "https://example.com/chart.svg?signature=signed",
          expiresAt: "2026-10-08T12:00:00.000Z",
        })),
      },
    );
    expect(invoke.mock.calls.map(([tool]) => tool)).toEqual([
      "get_channel_overview",
      "detect_channel_anomalies",
      "get_replenishment_priority",
    ]);
  });

  it("rejects education identity data instead of emitting it", async () => {
    await expect(
      executeChannelAnalysis(
        {
          tenantId: "tenant-a",
          taskId: "7687b15e-e313-4514-a6d2-076b286610fd",
          contextId: "9e769c48-2df1-45ec-8e79-58c5f06018fa",
          query: "经营总览",
          intent: { kind: "overview", channels: [], period: { raw: "本周" } },
        },
        {
          toolInvoker: {
            invoke: vi.fn(async (tool: ChannelToolName) =>
              result(tool, { conclusion: "包含学生姓名的错误数据" }),
            ),
          },
          loadKnowledge: vi.fn(async () => knowledge),
          createVisualization: vi.fn(),
        },
      ),
    ).rejects.toMatchObject({ code: "CHANNEL_DATA_SENSITIVE_CONTENT" });
  });

  it("escapes tool-provided labels in generated SVG", () => {
    const svg = renderChannelChartSvg({
      type: "bar",
      title: "渠道 <script>alert(1)</script>",
      categories: ["抖音&天猫"],
      series: [{ name: "GMV", data: [100], unit: "元" }],
    });
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("抖音&amp;天猫");
  });
});
