import { describe, expect, it, vi } from "vitest";
import { config } from "./config.js";
import { LongbridgeProvider, __longbridgeInternals } from "./longbridge-provider.js";

const credential = {
  appKey: "test-app",
  appSecret: "test-secret",
  accessToken: "test-token",
};
const contextInput = {
  tenantId: "00000000-0000-0000-0000-000000000001",
  agentSlug: "symbol-market",
  requestId: "request-1",
};

describe("Longbridge provider adapter", () => {
  it("maps symbols and option contract sides without network access", () => {
    expect(__longbridgeInternals.mappedSymbol("aapl")).toBe("AAPL.US");
    expect(__longbridgeInternals.mappedSymbol("700.hk")).toBe("700.HK");
    expect(__longbridgeInternals.optionSide("AAPL260918P00150000.US")).toBe(
      "put",
    );
    expect(__longbridgeInternals.optionSide("AAPL260918C00150000.US")).toBe(
      "call",
    );
  });

  it("returns timestamped quote evidence from an injected SDK context", async () => {
    const quote = {
      symbol: "AAPL.US",
      lastDone: "200.50",
      prevClose: "199.50",
      open: "199.75",
      high: "201.10",
      low: "198.80",
      volume: 12345,
      turnover: "2500000",
      timestamp: new Date(),
      tradeStatus: 0,
    };
    const context = { quote: vi.fn().mockResolvedValue([quote]) };
    const provider = new LongbridgeProvider({
      credentialResolver: async () => ({
        credential,
        summary: { configured: true, source: "environment", status: "configured" },
      }),
      contextFactory: () => context as never,
    });
    const result = await provider.getQuote("AAPL", contextInput);
    expect(result).toMatchObject({
      providerSymbol: "AAPL.US",
      price: 200.5,
      previousClose: 199.5,
      session: "regular",
      meta: { provider: "longbridge", permission: "available" },
    });
    expect(result.meta.asOf).toBeTruthy();
    expect(context.quote).toHaveBeenCalledWith(["AAPL.US"]);
  });

  it("marks missing credentials as unavailable instead of zero values", async () => {
    const provider = new LongbridgeProvider({
      credentialResolver: async () => ({
        summary: { configured: false, source: "none", status: "missing" },
      }),
      contextFactory: () => {
        throw new Error("must not create SDK context");
      },
    });
    const result = await provider.getQuote("AAPL", contextInput);
    expect(result.meta).toMatchObject({
      status: "unavailable",
      permission: "missing",
    });
    expect(result.price).toBeUndefined();
  });

  it("reads option metadata and computes explicitly marked Gamma estimates when needed", async () => {
    const context = {
      optionQuote: vi.fn().mockResolvedValue([
        {
          symbol: "AAPL260918C00150000.US",
          expiryDate: "2026-09-18",
          strikePrice: "150",
          lastDone: "55",
          volume: 10,
          openInterest: 100,
          impliedVolatility: 0.3,
          contractMultiplier: 100,
          timestamp: "2026-09-05T00:00:00.000Z",
          underlyingSymbol: "AAPL.US",
        },
      ]),
    };
    const provider = new LongbridgeProvider({
      credentialResolver: async () => ({
        credential,
        summary: { configured: true, source: "environment", status: "configured" },
      }),
      contextFactory: () => context as never,
    });
    const result = await provider.getOptionQuotes(["AAPL260918C00150000.US"], {
      ...contextInput,
      spot: 200,
      asOf: "2026-09-05T00:00:00.000Z",
    });
    expect(result.quotes[0]).toMatchObject({
      side: "call",
      expiry: "2026-09-18",
      strike: 150,
      openInterest: 100,
      contractMultiplier: 100,
      gammaSource: "black_scholes_estimate",
    });
    expect(result.quotes[0]?.gamma).toBeGreaterThan(0);
    expect(result.quotes[0]?.unavailable).toEqual([]);
  });

  it("maps option-chain expiries and both call/put contracts", async () => {
    const context = {
      optionChainExpiryDateList: vi.fn().mockResolvedValue(["2026-09-18"]),
      optionChainInfoByDate: vi.fn().mockResolvedValue([
        {
          price: "150",
          callSymbol: "AAPL260918C00150000.US",
          putSymbol: "AAPL260918P00150000.US",
        },
      ]),
    };
    const provider = new LongbridgeProvider({
      credentialResolver: async () => ({
        credential,
        summary: { configured: true, source: "environment", status: "configured" },
      }),
      contextFactory: () => context as never,
    });
    const result = await provider.getOptionChain("AAPL", contextInput);
    expect(result).toMatchObject({
      underlying: "AAPL.US",
      expiries: [{ expiry: "2026-09-18", strikes: [150] }],
    });
    expect(result.contracts).toEqual([
      { symbol: "AAPL260918C00150000.US", expiry: "2026-09-18", strike: 150, side: "call" },
      { symbol: "AAPL260918P00150000.US", expiry: "2026-09-18", strike: 150, side: "put" },
    ]);
  });

  it("maps OPRA permission failures to a transparent unavailable envelope", async () => {
    const provider = new LongbridgeProvider({
      credentialResolver: async () => ({
        credential,
        summary: { configured: true, source: "environment", status: "configured" },
      }),
      contextFactory: () => ({
        optionQuote: vi.fn().mockRejectedValue(new Error("OPRA permission denied (403)")),
      }) as never,
    });
    const result = await provider.getOptionQuotes(["AAPL260918C00150000.US"], contextInput);
    expect(result.meta).toMatchObject({
      status: "unavailable",
      permission: "missing",
    });
    expect(result.quotes).toEqual([]);
  });

  it("maps OAuth token expiry separately from missing OPRA permission", async () => {
    expect(__longbridgeInternals.permissionFromError(new Error("OAuth token expired"))).toEqual({
      permission: "expired",
      code: "MARKET_DATA_CREDENTIAL_EXPIRED",
    });
    const provider = new LongbridgeProvider({
      credentialResolver: async () => ({
        credential,
        summary: { configured: true, source: "environment", status: "configured" },
      }),
      contextFactory: () => ({
        quote: vi.fn().mockRejectedValue(new Error("OAuth token expired")),
      }) as never,
    });
    const result = await provider.getQuote("AAPL", contextInput);
    expect(result.meta).toMatchObject({
      status: "unavailable",
      permission: "expired",
    });
  });

  it("marks option evidence degraded when its timestamp is not aligned with the quote snapshot", async () => {
    const context = {
      optionQuote: vi.fn().mockResolvedValue([
        {
          symbol: "AAPL260918C00150000.US",
          expiryDate: "2026-09-18",
          strikePrice: "150",
          lastDone: "55",
          openInterest: 100,
          impliedVolatility: 0.3,
          contractMultiplier: 100,
          timestamp: "2026-09-05T00:05:00.000Z",
          underlyingSymbol: "AAPL.US",
        },
      ]),
    };
    const provider = new LongbridgeProvider({
      credentialResolver: async () => ({
        credential,
        summary: { configured: true, source: "environment", status: "configured" },
      }),
      contextFactory: () => context as never,
    });
    const result = await provider.getOptionQuotes(["AAPL260918C00150000.US"], {
      ...contextInput,
      spot: 200,
      asOf: "2026-09-05T00:00:00.000Z",
    });
    expect(result.meta).toMatchObject({ status: "degraded" });
    expect(result.meta.degradedReason).toContain("300 秒");
  });

  it("does not expose echoed credentials in provider failure evidence", async () => {
    const leaked = "authorization: Bearer longbridge-secret access_token=token-secret";
    const provider = new LongbridgeProvider({
      credentialResolver: async () => ({
        credential,
        summary: { configured: true, source: "environment", status: "configured" },
      }),
      contextFactory: () => ({
        quote: vi.fn().mockRejectedValue(new Error(leaked)),
      }) as never,
    });
    const result = await provider.getQuote("AAPL", contextInput);
    expect(result.meta.degradedReason).not.toContain("longbridge-secret");
    expect(result.meta.degradedReason).not.toContain("token-secret");
    expect(result.meta.degradedReason).toContain("[已脱敏]");
  });

  it("marks an old provider timestamp as stale instead of calling it live", async () => {
    const context = {
      quote: vi.fn().mockResolvedValue([
        {
          symbol: "AAPL.US",
          lastDone: "200",
          timestamp: "2026-01-01T00:00:00.000Z",
          tradeStatus: 0,
        },
      ]),
    };
    const provider = new LongbridgeProvider({
      credentialResolver: async () => ({
        credential,
        summary: { configured: true, source: "environment", status: "configured" },
      }),
      contextFactory: () => context as never,
    });
    const result = await provider.getQuote("AAPL", contextInput);
    expect(result.meta.freshness).toBe("stale");
  });

  it("bounds a hanging SDK request and reports timeout evidence", async () => {
    const originalTimeout = config.longbridgeTimeoutMs;
    config.longbridgeTimeoutMs = 5;
    try {
      const provider = new LongbridgeProvider({
        credentialResolver: async () => ({
          credential,
          summary: { configured: true, source: "environment", status: "configured" },
        }),
        contextFactory: () => ({
          quote: () => new Promise<unknown[]>(() => undefined),
        }) as never,
      });
      const result = await provider.getQuote("AAPL", contextInput);
      expect(result.meta.degradedReason).toContain("5ms");
    } finally {
      config.longbridgeTimeoutMs = originalTimeout;
    }
  });

  it("respects the provider feature switch", async () => {
    const original = config.longbridgeEnabled;
    config.longbridgeEnabled = false;
    try {
      const provider = new LongbridgeProvider({
        credentialResolver: async () => ({ credential, summary: { configured: true, source: "environment", status: "configured" } }),
      });
      const result = await provider.getQuote("AAPL", contextInput);
      expect(result.meta.status).toBe("unavailable");
    } finally {
      config.longbridgeEnabled = original;
    }
  });

  it("bounds option-chain expansion to the configured contract budget", async () => {
    const originalLimit = config.longbridgeMaxOptionContracts;
    config.longbridgeMaxOptionContracts = 1;
    try {
      const context = {
        optionChainExpiryDateList: vi.fn().mockResolvedValue(["2026-09-18", "2026-10-16"]),
        optionChainInfoByDate: vi.fn().mockResolvedValue([
          {
            price: "150",
            callSymbol: "AAPL260918C00150000.US",
            putSymbol: "AAPL260918P00150000.US",
          },
        ]),
      };
      const provider = new LongbridgeProvider({
        credentialResolver: async () => ({
          credential,
          summary: { configured: true, source: "environment", status: "configured" },
        }),
        contextFactory: () => context as never,
      });
      const result = await provider.getOptionChain("AAPL", contextInput);
      expect(result.contracts).toHaveLength(1);
      expect(result.contracts[0]?.symbol).toBe("AAPL260918C00150000.US");
    } finally {
      config.longbridgeMaxOptionContracts = originalLimit;
    }
  });

  it("limits concurrent upstream SDK calls and releases the slot after completion", async () => {
    const originalLimit = config.longbridgeMaxConcurrent;
    config.longbridgeMaxConcurrent = 1;
    let releaseFirst!: () => void;
    const firstCall = new Promise<unknown[]>((resolve) => {
      releaseFirst = () =>
        resolve([
          {
            symbol: "AAPL.US",
            lastDone: "200",
            prevClose: "199",
            timestamp: new Date(),
            tradeStatus: 0,
          },
        ]);
    });
    try {
      const context = {
        quote: vi
          .fn()
          .mockReturnValueOnce(firstCall)
          .mockResolvedValue([
            {
              symbol: "AAPL.US",
              lastDone: "201",
              prevClose: "200",
              timestamp: new Date(),
              tradeStatus: 0,
            },
          ]),
      };
      const provider = new LongbridgeProvider({
        credentialResolver: async () => ({
          credential,
          summary: { configured: true, source: "environment", status: "configured" },
        }),
        contextFactory: () => context as never,
      });
      const first = provider.getQuote("AAPL", contextInput);
      await new Promise((resolve) => setImmediate(resolve));
      const second = provider.getQuote("AAPL", contextInput);
      await new Promise((resolve) => setImmediate(resolve));
      expect(context.quote).toHaveBeenCalledTimes(1);
      releaseFirst();
      await Promise.all([first, second]);
      expect(context.quote).toHaveBeenCalledTimes(2);
    } finally {
      config.longbridgeMaxConcurrent = originalLimit;
    }
  });
});
