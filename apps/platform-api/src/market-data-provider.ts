export type ProviderStatus = "available" | "degraded" | "unavailable";
export type PermissionStatus = "available" | "missing" | "expired" | "unknown";
export type Freshness = "live" | "delayed" | "stale" | "unknown";
export type Session = "regular" | "pre" | "post" | "closed" | "unknown";

export type ProviderContext = {
  tenantId: string;
  agentSlug: string;
  requestId: string;
  signal?: AbortSignal;
  spot?: number;
  asOf?: string;
};

export type EvidenceMeta = {
  provider: "longbridge" | "fallback";
  status: ProviderStatus;
  permission: PermissionStatus;
  asOf?: string;
  fetchedAt: string;
  freshness: Freshness;
  degradedReason?: string;
};

export type QuoteResult = {
  meta: EvidenceMeta;
  symbol: string;
  providerSymbol: string;
  price?: number;
  previousClose?: number;
  change?: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  turnover?: number;
  tradeStatus?: string;
  session?: Session;
};

export type OptionContract = {
  symbol: string;
  expiry: string;
  strike: number;
  side: "call" | "put";
};

export type OptionChainResult = {
  meta: EvidenceMeta;
  underlying: string;
  expiries: Array<{ expiry: string; strikes: number[] }>;
  contracts: OptionContract[];
};

export type OptionQuote = OptionContract & {
  last?: number;
  bid?: number;
  ask?: number;
  volume?: number;
  openInterest?: number;
  impliedVolatility?: number;
  gamma?: number;
  gammaSource?: "provider" | "black_scholes_estimate";
  contractMultiplier?: number;
  contractSize?: number;
  quoteAsOf?: string;
  unavailable: string[];
};

export type OptionQuoteResult = {
  meta: EvidenceMeta;
  underlying: string;
  quotes: OptionQuote[];
};

export type GammaExposureAnalysis = {
  formula: string;
  spot: number;
  grossGammaExposure: number;
  modeledSignedGammaExposure: number;
  perContract: Array<{
    symbol: string;
    expiry: string;
    strike: number;
    side: "call" | "put";
    gamma: number;
    gammaSource?: "provider" | "black_scholes_estimate";
    exposure: number;
  }>;
  scope: Record<string, unknown>;
  assumptions: string[];
  grossByLevel: Array<{
    expiry?: string;
    strike: number;
    value: number;
    contractCount: number;
  }>;
  modeledSignedByLevel: Array<{
    expiry?: string;
    strike: number;
    value: number;
    contractCount: number;
  }>;
  scenarios: Array<{ range: string; interpretation: string }>;
  excludedContracts: Array<{ symbol: string; reasons: string[] }>;
  limitations: string[];
  asOf: string;
};

export interface MarketDataProvider {
  getQuote(symbol: string, ctx: ProviderContext): Promise<QuoteResult>;
  getOptionChain(symbol: string, ctx: ProviderContext): Promise<OptionChainResult>;
  getOptionQuotes(symbols: string[], ctx: ProviderContext): Promise<OptionQuoteResult>;
}

export class MarketDataError extends Error {
  constructor(
    message: string,
    readonly status: ProviderStatus,
    readonly permission: PermissionStatus = "unknown",
    readonly code = "MARKET_DATA_UNAVAILABLE",
  ) {
    super(message);
    this.name = "MarketDataError";
  }
}

/**
 * Provider failures can contain SDK request metadata or echoed credentials.
 * Keep enough diagnostic context for a degraded evidence envelope without
 * allowing secrets to cross the provider boundary.
 */
export function redactProviderError(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "未知错误";
  return raw
    .replace(/(bearer\s+)[^\s,;]+/giu, "$1[已脱敏]")
    .replace(
      /((?:access[_-]?token|api[_-]?key|app[_-]?secret|client[_-]?secret|password|secret|token)\s*[=:]\s*)(["']?)[^\s,"'}]+\2/giu,
      "$1$2[已脱敏]$2",
    )
    .replace(
      /([?&](?:access_token|api_key|app_secret|client_secret|token|secret)=)[^&\s]+/giu,
      "$1[已脱敏]",
    )
    .slice(0, 500);
}

export function numericValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Number(value.replace(/[$,%\s,]/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function isoDate(value: unknown): string | undefined {
  if (value instanceof Date && Number.isFinite(value.getTime()))
    return value.toISOString();
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  return undefined;
}

export function statusForTradeStatus(value: unknown): "regular" | "closed" | "unknown" {
  if (value === 0 || value === "Normal" || value === "NORMAL") return "regular";
  if (value === undefined || value === null) return "unknown";
  return "closed";
}

export const __marketDataInternals = {
  isoDate,
  numericValue,
  redactProviderError,
  statusForTradeStatus,
};
