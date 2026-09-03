import { describe, expect, it, vi } from "vitest";
import { AgentCard, Task } from "@a2a-js/sdk";
import { config } from "./config.js";
import {
  __symbolServiceInternals,
  symbolAgentSlugs,
  symbolCard,
  taskJson,
} from "./symbol-service.js";

vi.mock("./redis.js", () => ({
  getRedis: vi.fn().mockResolvedValue(undefined),
}));

describe("bundled Symbol A2A agents", () => {
  it("publishes seven valid, discoverable A2A cards", () => {
    expect(symbolAgentSlugs).toHaveLength(7);
    for (const slug of symbolAgentSlugs) {
      const card = AgentCard.fromJSON(symbolCard(slug));
      expect(card.name).toContain("Symbol");
      expect(card.supportedInterfaces?.[0]?.protocolBinding).toBe("HTTP+JSON");
      expect(card.skills).toHaveLength(1);
    }
  });

  it("uses A2A INPUT_REQUIRED instead of rejecting natural-language follow-up", () => {
    const json = taskJson({
      taskId: "1d5b571f-a143-4d59-a48d-cd1fe6e10f93",
      contextId: "c076c621-a11d-4ca3-9c37-2efb0d0a87d8",
      state: "TASK_STATE_INPUT_REQUIRED",
      text: "请补充要分析的标的。",
      metadata: { missing: ["symbol"] },
    });
    const task = Task.fromJSON(json);
    expect(task.status?.state.toString()).toBe("6");
    expect(task.status?.message?.parts[0]?.content?.$case).toBe("text");
  });

  it("accepts both A2A text-part wire encodings from REST transports", () => {
    expect(
      __symbolServiceInternals.userText({
        message: {
          taskId: "task-1",
          contextId: "context-1",
          parts: [{ text: "分析 AAPL" }],
        },
      }),
    ).toMatchObject({ text: "分析 AAPL", taskId: "task-1" });
    expect(
      __symbolServiceInternals.userText({
        message: {
          parts: [{ content: { $case: "text", value: "分析 TSLA" } }],
        },
      }).text,
    ).toBe("分析 TSLA");
  });

  it("extracts a natural-language target with a strict tool schema before Yahoo", async () => {
    const originalKey = config.deepseekApiKey;
    const originalModel = config.deepseekModel;
    config.deepseekApiKey = "test-key";
    config.deepseekModel = "test-model";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    function: {
                      name: "extract_symbol_intent",
                      arguments: JSON.stringify({
                        symbol: "",
                        companyName: "苹果",
                        assetType: "stock",
                        market: "NASDAQ",
                        period: "",
                        question: "分析苹果",
                        thesis: "",
                        missing: ["symbol"],
                        confidence: 0.99,
                      }),
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const intent = await __symbolServiceInternals.extractIntent(
        "帮我分析苹果",
        {},
        "symbol-market",
      );
      expect(intent).toMatchObject({
        companyName: "苹果",
        missing: [],
      });
      expect(intent.symbol).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const request = fetchMock.mock.calls[0]?.[1] as { body: string };
      const body = JSON.parse(request.body);
      expect(body.tools[0].function.name).toBe("extract_symbol_intent");
      expect(body.tools[0].function.strict).toBe(true);
      expect(body.tools[0].function.parameters.additionalProperties).toBe(
        false,
      );
      expect(body.tool_choice.function.name).toBe("extract_symbol_intent");
    } finally {
      config.deepseekApiKey = originalKey;
      config.deepseekModel = originalModel;
      vi.unstubAllGlobals();
    }
  });

  it("resolves a company name only after extraction has supplied it", () => {
    expect(
      __symbolServiceInternals.providerSymbolForCompany("apple", {
        quotes: [
          { symbol: "AAPL", shortname: "Apple Inc.", longname: "Apple Inc." },
        ],
      }),
    ).toBe("AAPL");
  });

  it("does not fall back to string parsing when the intent model is unavailable", async () => {
    const originalKey = config.deepseekApiKey;
    config.deepseekApiKey = "";
    try {
      await expect(
        __symbolServiceInternals.extractIntent(
          "帮我分析苹果",
          {},
          "symbol-market",
        ),
      ).rejects.toThrow("AI 意图解析服务未配置");
    } finally {
      config.deepseekApiKey = originalKey;
    }
  });

  it("lets the model write a natural clarification when the target is missing", async () => {
    const originalKey = config.deepseekApiKey;
    const originalModel = config.deepseekModel;
    config.deepseekApiKey = "test-key";
    config.deepseekModel = "test-model";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "你准备分析哪家公司？可以直接说公司名称或股票代码。",
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const answer =
        await __symbolServiceInternals.generateClarificationResponse({
          slug: "symbol-market",
          userMessage: "1",
          transcript: [
            { role: "user", text: "1", at: "2026-09-04T00:00:00.000Z" },
          ],
          intent: { missing: ["symbol"] },
          missing: ["symbol"],
        });
      expect(answer).toContain("哪家公司");
      expect(answer).not.toContain("为了继续Symbol");
    } finally {
      config.deepseekApiKey = originalKey;
      config.deepseekModel = originalModel;
      vi.unstubAllGlobals();
    }
  });

  it("normalizes Nasdaq history into the provider-neutral chart shape", () => {
    const chart = __symbolServiceInternals.nasdaqHistoryToChart({
      data: {
        tradesTable: {
          rows: [
            {
              date: "08/26/2026",
              close: "$313.24",
              high: "$313.94",
              low: "$308.80",
              volume: "11,249,127",
            },
            {
              date: "08/25/2026",
              close: "$309.90",
              high: "$313.59",
              low: "$308.21",
              volume: "25,869,810",
            },
          ],
        },
      },
    }) as {
      chart: {
        result: Array<{
          timestamp: number[];
          indicators: { quote: Array<{ close: number[]; volume: number[] }> };
        }>;
      };
    };
    expect(chart.chart.result[0]?.indicators.quote[0]?.close).toEqual([
      309.9, 313.24,
    ]);
    expect(chart.chart.result[0]?.indicators.quote[0]?.volume).toEqual([
      25_869_810, 11_249_127,
    ]);
    expect(chart.chart.result[0]?.timestamp[0]).toBeLessThan(
      chart.chart.result[0]?.timestamp[1] ?? 0,
    );
  });

  it("normalizes Nasdaq metadata without inventing news", () => {
    const result = __symbolServiceInternals.nasdaqInfoToSearch({
      data: {
        symbol: "AAPL",
        companyName: "Apple Inc. Common Stock",
        exchange: "NASDAQ-GS",
        assetClass: "STOCKS",
        primaryData: {
          lastSalePrice: "$313.24",
          lastTradeTimestamp: "Aug 26, 2026 12:31 PM ET",
        },
      },
    }) as {
      quotes: Array<{ symbol: string; regularMarketPrice: number }>;
      news: unknown[];
    };
    expect(result.quotes[0]).toMatchObject({
      symbol: "AAPL",
      regularMarketPrice: 313.24,
    });
    expect(result.news).toEqual([]);
    expect(__symbolServiceInternals.parseNasdaqNumber("N/A")).toBeNull();
  });

  it("uses a model reply for the latest turn instead of returning a tool template", async () => {
    const originalKey = config.deepseekApiKey;
    const originalModel = config.deepseekModel;
    config.deepseekApiKey = "test-key";
    config.deepseekModel = "test-model";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  "当然。AAPL 近五日上涨 1.37%，但还需要结合成交量和财报预期判断趋势的可持续性。",
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const reply = await __symbolServiceInternals.generateResearchResponse({
        slug: "symbol-market",
        userMessage: "详细一点",
        transcript: [
          { role: "user", text: "分析 AAPL", at: "2026-08-29T00:00:00.000Z" },
        ],
        intent: { symbol: "AAPL", question: "详细一点", missing: [] },
        result: {
          text: "AAPL 最新收盘/报价：314.58；日变动 0.36%，近五日 1.37%。",
          data: { symbol: "AAPL", close: 314.58, fiveDayChange: 0.0137 },
        },
      });
      expect(reply).toContain("成交量和财报预期");
      const request = fetchMock.mock.calls[0]?.[1] as { body: string };
      expect(JSON.parse(request.body).messages.at(-1).content).toContain(
        "详细一点",
      );
    } finally {
      config.deepseekApiKey = originalKey;
      config.deepseekModel = originalModel;
      vi.unstubAllGlobals();
    }
  });

  it("forwards DeepSeek SSE text deltas while retaining the complete reply", async () => {
    const originalKey = config.deepseekApiKey;
    const originalModel = config.deepseekModel;
    config.deepseekApiKey = "test-key";
    config.deepseekModel = "test-model";
    const encoder = new TextEncoder();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                'data: {"choices":[{"delta":{"content":" 第一段"}}]}\n\n',
              ),
            );
            controller.enqueue(
              encoder.encode(
                'data: {"choices":[{"delta":{"content":"，第二段 "}}]}\n\n',
              ),
            );
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const deltas: string[] = [];
    try {
      const reply = await __symbolServiceInternals.generateResearchResponse(
        {
          slug: "symbol-market",
          userMessage: "请简要分析 AAPL",
          transcript: [],
          intent: { symbol: "AAPL", missing: [] },
          result: { text: "AAPL 行情证据", data: { symbol: "AAPL" } },
        },
        {
          onDelta: (delta) => {
            deltas.push(delta);
          },
        },
      );
      expect(deltas).toEqual([" 第一段", "，第二段 "]);
      expect(reply).toBe(" 第一段，第二段 ");
      const request = fetchMock.mock.calls[0]?.[1] as { body: string };
      expect(JSON.parse(request.body).stream).toBe(true);
    } finally {
      config.deepseekApiKey = originalKey;
      config.deepseekModel = originalModel;
      vi.unstubAllGlobals();
    }
  });

  it("fails clearly when no model is configured instead of using a fixed reply", async () => {
    const originalKey = config.deepseekApiKey;
    config.deepseekApiKey = "";
    try {
      await expect(
        __symbolServiceInternals.generateResearchResponse({
          slug: "symbol-market",
          userMessage: "详细一点",
          transcript: [],
          intent: { symbol: "AAPL", missing: [] },
          result: { text: "固定报价", data: { symbol: "AAPL" } },
        }),
      ).rejects.toThrow("不会使用固定文案");
    } finally {
      config.deepseekApiKey = originalKey;
    }
  });
});
