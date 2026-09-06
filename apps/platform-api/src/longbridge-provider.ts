import { Config, QuoteContext } from "longbridge";
import { config } from "./config.js";
import {
  blackScholesGamma,
} from "./option-gamma-service.js";
import {
  isoDate,
  MarketDataError,
  numericValue,
  redactProviderError,
  statusForTradeStatus,
  type MarketDataProvider,
  type OptionQuote,
  type OptionQuoteResult,
  type OptionChainResult,
  type PermissionStatus,
  type ProviderContext,
  type QuoteResult,
} from "./market-data-provider.js";
import {
  resolveLongbridgeCredential,
  type LongbridgeCredential,
} from "./market-data-credentials.js";

type LongbridgeObject = Record<string, unknown>;
type LongbridgeQuoteContext = {
  quote(symbols: string[]): Promise<unknown[]>;
  optionChainExpiryDateList(symbol: string): Promise<unknown[]>;
  optionChainInfoByDate(symbol: string, expiry: unknown): Promise<unknown[]>;
  optionQuote(symbols: string[]): Promise<unknown[]>;
};

export type LongbridgeContextFactory = (
  credential: LongbridgeCredential,
) => LongbridgeQuoteContext;

function sdkContextFactory(
  credential: LongbridgeCredential,
): LongbridgeQuoteContext {
  const sdkConfig = Config.fromApikey(
    credential.appKey,
    credential.appSecret,
    credential.accessToken,
    {
      httpUrl: config.longbridgeHttpUrl,
      enablePrintQuotePackages: false,
    },
  );
  return QuoteContext.new(sdkConfig) as unknown as LongbridgeQuoteContext;
}

function asObject(value: unknown): LongbridgeObject {
  return value && typeof value === "object"
    ? (value as LongbridgeObject)
    : {};
}

function field(value: unknown, key: string): unknown {
  return asObject(value)[key];
}

function textField(value: unknown, key: string): string | undefined {
  const candidate = field(value, key);
  if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  if (
    candidate &&
    typeof candidate === "object" &&
    typeof (candidate as { toString?: unknown }).toString === "function"
  ) {
    const text = String(candidate);
    if (text && text !== "[object Object]") return text;
  }
  return undefined;
}

function dateField(value: unknown, key: string): string | undefined {
  return isoDate(field(value, key)) ?? textField(value, key);
}

function mappedSymbol(symbol: string) {
  const normalized = symbol.trim().toUpperCase();
  if (normalized.includes(".")) return normalized;
  if (/^[A-Z][A-Z0-9.-]{0,17}$/.test(normalized)) return `${normalized}.US`;
  return normalized;
}

function freshness(asOf: string | undefined): "live" | "delayed" | "stale" | "unknown" {
  if (!asOf) return "unknown";
  const ageMs = Date.now() - Date.parse(asOf);
  if (!Number.isFinite(ageMs)) return "unknown";
  if (ageMs <= 120_000) return "live";
  if (ageMs <= 3_600_000) return "delayed";
  return "stale";
}

function permissionFromError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (
    lower.includes("permission") ||
    lower.includes("opra") ||
    lower.includes("unauthorized") ||
    lower.includes("forbidden") ||
    lower.includes("401") ||
    lower.includes("403")
  )
    return { permission: "missing" as const, code: "MARKET_DATA_PERMISSION_DENIED" };
  if (lower.includes("expired") || lower.includes("token"))
    return { permission: "expired" as const, code: "MARKET_DATA_CREDENTIAL_EXPIRED" };
  return { permission: "unknown" as const, code: "MARKET_DATA_PROVIDER_ERROR" };
}

function errorMessage(error: unknown) {
  return redactProviderError(error);
}

function unavailableMeta(reason: string, permission: PermissionStatus = "unknown") {
  return {
    provider: "longbridge" as const,
    status: "unavailable" as const,
    permission,
    fetchedAt: new Date().toISOString(),
    freshness: "unknown" as const,
    degradedReason: reason,
  };
}

function unavailableQuote(symbol: string, reason: string, permission?: PermissionStatus): QuoteResult {
  return {
    meta: unavailableMeta(reason, permission),
    symbol,
    providerSymbol: mappedSymbol(symbol),
  };
}

function unavailableChain(symbol: string, reason: string, permission?: PermissionStatus): OptionChainResult {
  return {
    meta: unavailableMeta(reason, permission),
    underlying: mappedSymbol(symbol),
    expiries: [],
    contracts: [],
  };
}

function optionSide(symbol: string): "call" | "put" | undefined {
  const base = symbol.split(".")[0] ?? symbol;
  const match = base.match(/([CP])(?=\d{3,}$)/i);
  if (!match) return undefined;
  return match[1].toUpperCase() === "C" ? "call" : "put";
}

function optionExpiry(value: unknown): string | undefined {
  const direct = dateField(value, "expiryDate");
  if (direct) {
    const compact = direct.match(/^(\d{4})(\d{2})(\d{2})$/);
    return compact ? `${compact[1]}-${compact[2]}-${compact[3]}` : direct.slice(0, 10);
  }
  const symbol = textField(value, "symbol");
  const match = symbol?.match(/^[A-Z.]+(\d{6})[CP]/i);
  if (!match) return undefined;
  const digits = match[1];
  const year = Number(digits.slice(0, 2)) + 2000;
  const month = digits.slice(2, 4);
  const day = digits.slice(4, 6);
  return `${year}-${month}-${day}`;
}

function optionStrike(value: unknown): number | undefined {
  const direct = numericValue(field(value, "strikePrice"));
  if (direct !== undefined) return direct;
  const symbol = textField(value, "symbol");
  const match = symbol?.match(/[CP](\d{3,})(?:\.[A-Z]+)?$/i);
  if (!match) return undefined;
  const raw = Number(match[1]);
  return Number.isFinite(raw) ? raw / 1000 : undefined;
}

function providerGamma(value: unknown): number | undefined {
  return numericValue(field(value, "gamma"));
}

function commonMeta(asOf: string | undefined) {
  return {
    provider: "longbridge" as const,
    status: "available" as const,
    permission: "available" as const,
    asOf,
    fetchedAt: new Date().toISOString(),
    freshness: freshness(asOf),
  };
}

export class LongbridgeProvider implements MarketDataProvider {
  private readonly makeContext: LongbridgeContextFactory;
  private readonly resolveCredential: typeof resolveLongbridgeCredential;
  private activeCalls = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(options: {
    contextFactory?: LongbridgeContextFactory;
    credentialResolver?: typeof resolveLongbridgeCredential;
  } = {}) {
    this.makeContext = options.contextFactory ?? sdkContextFactory;
    this.resolveCredential = options.credentialResolver ?? resolveLongbridgeCredential;
  }

  private async contextFor(ctx: ProviderContext) {
    if (!config.longbridgeEnabled)
      throw new MarketDataError("Longbridge provider 已关闭。", "unavailable");
    const resolved = await this.resolveCredential(ctx.tenantId);
    if (!resolved.credential) {
      throw new MarketDataError(
        `Longbridge 凭据不可用：${resolved.summary.status}。`,
        "unavailable",
        resolved.summary.status === "expired" ? "expired" : "missing",
        "MARKET_DATA_CREDENTIAL_MISSING",
      );
    }
    return this.makeContext(resolved.credential);
  }

  private async bounded<T>(
    operation: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) throw new Error("请求已取消");
    const release = await this.acquireCallSlot(signal);
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        release();
        callback();
      };
      const timer = setTimeout(
        () =>
          finish(() =>
            reject(
              new MarketDataError(
                `Longbridge 请求超过 ${config.longbridgeTimeoutMs}ms。`,
                "unavailable",
                "unknown",
                "MARKET_DATA_TIMEOUT",
              ),
            ),
          ),
        config.longbridgeTimeoutMs,
      );
      const onAbort = () => finish(() => reject(new Error("请求已取消")));
      signal?.addEventListener("abort", onAbort, { once: true });
      void operation().then(
        (value) => finish(() => resolve(value)),
        (error) => finish(() => reject(error)),
      );
    });
  }

  private async acquireCallSlot(signal?: AbortSignal) {
    const maxConcurrent = Math.max(1, Math.floor(config.longbridgeMaxConcurrent));
    if (this.activeCalls >= maxConcurrent) {
      await new Promise<void>((resolve, reject) => {
        let waiter: (() => void) | undefined;
        const onAbort = () => {
          const index = waiter ? this.waiters.indexOf(waiter) : -1;
          if (index >= 0) this.waiters.splice(index, 1);
          reject(new Error("请求已取消"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        waiter = () => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        };
        this.waiters.push(waiter);
        if (signal?.aborted) onAbort();
      });
    }
    this.activeCalls++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeCalls = Math.max(0, this.activeCalls - 1);
      this.waiters.shift()?.();
    };
  }

  async getQuote(symbol: string, ctx: ProviderContext): Promise<QuoteResult> {
    try {
      const context = await this.contextFor(ctx);
      const rows = await this.bounded(
        () => context.quote([mappedSymbol(symbol)]),
        ctx.signal,
      );
      const value = rows[0];
      if (!value) return unavailableQuote(symbol, "Longbridge 未返回标的行情。");
      const asOf = dateField(value, "timestamp");
      const price = numericValue(field(value, "lastDone"));
      const previousClose = numericValue(field(value, "prevClose"));
      return {
        meta: commonMeta(asOf),
        symbol,
        providerSymbol: textField(value, "symbol") ?? mappedSymbol(symbol),
        price,
        previousClose,
        change:
          price !== undefined && previousClose
            ? (price - previousClose) / previousClose
            : undefined,
        open: numericValue(field(value, "open")),
        high: numericValue(field(value, "high")),
        low: numericValue(field(value, "low")),
        volume: numericValue(field(value, "volume")),
        turnover: numericValue(field(value, "turnover")),
        tradeStatus: textField(field(value, "tradeStatus"), "toString") ?? String(field(value, "tradeStatus") ?? ""),
        session: statusForTradeStatus(field(value, "tradeStatus")),
      };
    } catch (error) {
      if (error instanceof MarketDataError)
        return unavailableQuote(symbol, redactProviderError(error), error.permission);
      const mapped = permissionFromError(error);
      return unavailableQuote(symbol, errorMessage(error), mapped.permission);
    }
  }

  async getOptionChain(symbol: string, ctx: ProviderContext): Promise<OptionChainResult> {
    try {
      const context = await this.contextFor(ctx);
      const providerSymbol = mappedSymbol(symbol);
      const allExpiryDates = await this.bounded(
        () => context.optionChainExpiryDateList(providerSymbol),
        ctx.signal,
      );
      const expiryDates = allExpiryDates.slice(0, 12);
      if (!expiryDates.length) return unavailableChain(symbol, "Longbridge 未返回期权到期日。");
      const expiries: Array<{ expiry: string; strikes: number[] }> = [];
      const contracts: OptionChainResult["contracts"] = [];
      for (const expiryDate of expiryDates) {
        if (ctx.signal?.aborted) throw new Error("请求已取消");
        const rows = await this.bounded(
          () => context.optionChainInfoByDate(providerSymbol, expiryDate),
          ctx.signal,
        );
        const expiry =
          isoDate(expiryDate)?.slice(0, 10) ??
          textField(expiryDate, "toString") ??
          String(expiryDate).slice(0, 10);
        const strikes: number[] = [];
        for (const row of rows) {
          const strike = numericValue(field(row, "price"));
          if (strike === undefined) continue;
          strikes.push(strike);
          const callSymbol = textField(row, "callSymbol");
          const putSymbol = textField(row, "putSymbol");
          if (callSymbol) contracts.push({ symbol: callSymbol, expiry, strike, side: "call" });
          if (putSymbol) contracts.push({ symbol: putSymbol, expiry, strike, side: "put" });
          if (contracts.length >= config.longbridgeMaxOptionContracts) break;
        }
        expiries.push({ expiry, strikes: [...new Set(strikes)] });
        if (contracts.length >= config.longbridgeMaxOptionContracts) break;
      }
      return {
        meta: commonMeta(new Date().toISOString()),
        underlying: providerSymbol,
        expiries,
        contracts: contracts.slice(0, config.longbridgeMaxOptionContracts),
      };
    } catch (error) {
      if (error instanceof MarketDataError)
        return unavailableChain(symbol, redactProviderError(error), error.permission);
      const mapped = permissionFromError(error);
      return unavailableChain(symbol, errorMessage(error), mapped.permission);
    }
  }

  async getOptionQuotes(
    symbols: string[],
    ctx: ProviderContext,
  ): Promise<OptionQuoteResult> {
    if (!symbols.length)
      return {
        meta: unavailableMeta("没有可查询的期权合约。"),
        underlying: "",
        quotes: [] as OptionQuote[],
      };
    try {
      const context = await this.contextFor(ctx);
      const rows = await this.bounded(
        () =>
          context.optionQuote(
            symbols.slice(0, config.longbridgeMaxOptionContracts),
          ),
        ctx.signal,
      );
      const asOf = rows
        .map((row) => dateField(row, "timestamp"))
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1);
      const timestampDeltaMs =
        ctx.asOf && asOf ? Date.parse(asOf) - Date.parse(ctx.asOf) : undefined;
      const meta = {
        ...commonMeta(asOf ?? new Date().toISOString()),
        ...(timestampDeltaMs !== undefined &&
        Number.isFinite(timestampDeltaMs) &&
        Math.abs(timestampDeltaMs) > 120_000
          ? {
              status: "degraded" as const,
              degradedReason: `期权行情时间戳与标的行情相差 ${Math.round(
                Math.abs(timestampDeltaMs) / 1000,
              )} 秒。`,
            }
          : {}),
      };
      const quotes: OptionQuote[] = rows.flatMap((row) => {
        const optionSymbol = textField(row, "symbol");
        const side = optionSymbol ? optionSide(optionSymbol) : undefined;
        const expiry = optionExpiry(row);
        const strike = optionStrike(row);
        if (!optionSymbol || !side || !expiry || strike === undefined) return [];
        const unavailable: string[] = [];
        const impliedVolatility = numericValue(field(row, "impliedVolatility"));
        const openInterest = numericValue(field(row, "openInterest"));
        const contractSize = numericValue(field(row, "contractSize"));
        const contractMultiplier =
          numericValue(field(row, "contractMultiplier")) ?? contractSize;
        let gamma = providerGamma(row);
        let gammaSource: OptionQuote["gammaSource"];
        if (gamma !== undefined) gammaSource = "provider";
        else if (ctx.spot && impliedVolatility !== undefined && ctx.asOf) {
          gamma = blackScholesGamma({
            spot: ctx.spot,
            strike,
            impliedVolatility,
            expiry,
            asOf: ctx.asOf,
          });
          if (gamma !== undefined) gammaSource = "black_scholes_estimate";
        }
        if (openInterest === undefined) unavailable.push("openInterest");
        if (contractMultiplier === undefined) unavailable.push("contractMultiplier");
        if (gamma === undefined) unavailable.push("gamma");
        return [
          {
            symbol: optionSymbol,
            expiry,
            strike,
            side,
            last: numericValue(field(row, "lastDone")),
            bid: numericValue(field(row, "bid")),
            ask: numericValue(field(row, "ask")),
            volume: numericValue(field(row, "volume")),
            openInterest,
            impliedVolatility,
            gamma,
            gammaSource,
            contractMultiplier,
            contractSize,
            quoteAsOf: dateField(row, "timestamp"),
            unavailable,
          },
        ];
      });
      return {
        meta,
        underlying: textField(rows[0], "underlyingSymbol") ?? "",
        quotes,
      };
    } catch (error) {
      const mapped = error instanceof MarketDataError
        ? error
        : permissionFromError(error);
      return {
        meta: unavailableMeta(
          error instanceof MarketDataError
            ? redactProviderError(error)
            : errorMessage(error),
          error instanceof MarketDataError ? error.permission : mapped.permission,
        ),
        underlying: "",
        quotes: [],
      };
    }
  }
}

export const __longbridgeInternals = {
  freshness,
  mappedSymbol,
  optionExpiry,
  optionSide,
  optionStrike,
  permissionFromError,
  textField,
};
