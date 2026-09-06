import type {
  GammaExposureAnalysis,
  OptionQuote,
} from "./market-data-provider.js";

export const gammaExposureFormula =
  "gamma * openInterest * contractMultiplier * spot^2 * 0.01";

type GammaInput = {
  spot: number;
  quotes: OptionQuote[];
  asOf: string;
  scope?: {
    expiries?: string[];
    minStrike?: number;
    maxStrike?: number;
  };
};

function normalPdf(value: number) {
  return Math.exp(-0.5 * value * value) / Math.sqrt(2 * Math.PI);
}

/**
 * Estimates option gamma when the provider gives IV but not a Greek. The
 * result is deliberately marked as an estimate by the Longbridge adapter.
 */
export function blackScholesGamma(input: {
  spot: number;
  strike: number;
  impliedVolatility: number;
  expiry: string;
  asOf: string;
  riskFreeRate?: number;
}): number | undefined {
  const { spot, strike, impliedVolatility } = input;
  const time = (Date.parse(input.expiry) - Date.parse(input.asOf)) / (365 * 86_400_000);
  if (
    !Number.isFinite(spot) ||
    spot <= 0 ||
    !Number.isFinite(strike) ||
    strike <= 0 ||
    !Number.isFinite(impliedVolatility) ||
    impliedVolatility <= 0 ||
    !Number.isFinite(time) ||
    time <= 0
  )
    return undefined;
  const rate = input.riskFreeRate ?? 0.05;
  const sigmaSqrtT = impliedVolatility * Math.sqrt(time);
  const d1 =
    (Math.log(spot / strike) + (rate + 0.5 * impliedVolatility ** 2) * time) /
    sigmaSqrtT;
  const gamma = normalPdf(d1) / (spot * sigmaSqrtT);
  return Number.isFinite(gamma) && gamma >= 0 ? gamma : undefined;
}

function excludedReason(quote: OptionQuote, spot: number, scope: GammaInput["scope"]): string[] {
  const reasons = [...quote.unavailable];
  if (!Number.isFinite(spot) || spot <= 0) reasons.push("spot_invalid");
  if (!Number.isFinite(quote.strike) || quote.strike <= 0) reasons.push("strike_invalid");
  if (scope?.expiries?.length && !scope.expiries.includes(quote.expiry))
    reasons.push("outside_expiry_scope");
  if (scope?.minStrike !== undefined && quote.strike < scope.minStrike)
    reasons.push("below_strike_scope");
  if (scope?.maxStrike !== undefined && quote.strike > scope.maxStrike)
    reasons.push("above_strike_scope");
  if (quote.gamma === undefined || !Number.isFinite(quote.gamma)) reasons.push("gamma_unavailable");
  if (quote.openInterest === undefined || !Number.isFinite(quote.openInterest))
    reasons.push("open_interest_unavailable");
  if (
    quote.contractMultiplier === undefined ||
    !Number.isFinite(quote.contractMultiplier) ||
    quote.contractMultiplier <= 0
  )
    reasons.push("contract_multiplier_unavailable");
  return [...new Set(reasons)];
}

export function analyzeGamma(input: GammaInput): GammaExposureAnalysis {
  const scope = input.scope ?? {};
  const gross = new Map<string, { expiry: string; strike: number; value: number; contractCount: number }>();
  const signed = new Map<string, { expiry: string; strike: number; value: number; contractCount: number }>();
  const perContract: GammaExposureAnalysis["perContract"] = [];
  const excludedContracts: Array<{ symbol: string; reasons: string[] }> = [];
  for (const quote of input.quotes) {
    const reasons = excludedReason(quote, input.spot, scope);
    if (reasons.length) {
      excludedContracts.push({ symbol: quote.symbol, reasons });
      continue;
    }
    const exposure =
      Math.abs(quote.gamma!) *
      quote.openInterest! *
      quote.contractMultiplier! *
      input.spot ** 2 *
      0.01;
    if (!Number.isFinite(exposure)) {
      excludedContracts.push({ symbol: quote.symbol, reasons: ["exposure_not_finite"] });
      continue;
    }
    perContract.push({
      symbol: quote.symbol,
      expiry: quote.expiry,
      strike: quote.strike,
      side: quote.side,
      gamma: quote.gamma!,
      gammaSource: quote.gammaSource,
      exposure,
    });
    const key = `${quote.expiry}|${quote.strike}`;
    const level = gross.get(key) ?? {
      expiry: quote.expiry,
      strike: quote.strike,
      value: 0,
      contractCount: 0,
    };
    level.value += exposure;
    level.contractCount++;
    gross.set(key, level);
    const signedLevel = signed.get(key) ?? {
      expiry: quote.expiry,
      strike: quote.strike,
      value: 0,
      contractCount: 0,
    };
    signedLevel.value += quote.side === "call" ? exposure : -exposure;
    signedLevel.contractCount++;
    signed.set(key, signedLevel);
  }
  const grossByLevel = [...gross.values()].sort((a, b) => b.value - a.value);
  const modeledSignedByLevel = [...signed.values()].sort(
    (a, b) => Math.abs(b.value) - Math.abs(a.value),
  );
  const grossGammaExposure = grossByLevel.reduce((total, level) => total + level.value, 0);
  const modeledSignedGammaExposure = modeledSignedByLevel.reduce(
    (total, level) => total + level.value,
    0,
  );
  const scenarios = modeledSignedByLevel.slice(0, 8).map((level) => ({
    range: `strike:${level.strike}`,
    interpretation:
      level.value > 0
        ? "positive_modeled_gamma_concentration"
        : level.value < 0
          ? "negative_modeled_gamma_concentration"
          : "near_zero_modeled_gamma",
  }));
  return {
    formula: gammaExposureFormula,
    spot: input.spot,
    grossGammaExposure,
    modeledSignedGammaExposure,
    perContract,
    scope,
    assumptions: [
      "gross exposure uses absolute Gamma and does not identify dealer position.",
      "modeled signed exposure uses call=positive and put=negative as an explicit scenario convention.",
      "exposure is normalized to a 1% underlying-price move.",
      "contractMultiplier is used as the effective contract size; when the provider omits it, contractSize may be used as its fallback.",
      "Gamma is local sensitivity and does not guarantee future price direction.",
    ],
    grossByLevel,
    modeledSignedByLevel,
    scenarios,
    excludedContracts,
    limitations: [
      "Open interest does not reveal the actual holder or dealer position.",
      "Provider timestamps and missing fields limit cross-contract comparability.",
    ],
    asOf: input.asOf,
  };
}

export const __gammaInternals = {
  excludedReason,
  normalPdf,
};
