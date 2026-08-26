import { describe, expect, it } from "vitest";
import { AgentCard, Task } from "@a2a-js/sdk";
import {
  __symbolServiceInternals,
  symbolAgentSlugs,
  symbolCard,
  taskJson,
} from "./symbol-service.js";

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
});
