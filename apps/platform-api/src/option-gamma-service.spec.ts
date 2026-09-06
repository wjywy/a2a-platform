import { describe, expect, it } from "vitest";
import { analyzeGamma, blackScholesGamma, gammaExposureFormula } from "./option-gamma-service.js";

describe("option Gamma evidence", () => {
  it("uses the 1% GEX formula and explicit call/put scenario convention", () => {
    const result = analyzeGamma({
      spot: 100,
      asOf: "2026-09-01T00:00:00.000Z",
      quotes: [
        {
          symbol: "TESTC",
          expiry: "2026-10-01",
          strike: 100,
          side: "call",
          gamma: 0.02,
          openInterest: 10,
          contractMultiplier: 100,
          unavailable: [],
        },
        {
          symbol: "TESTP",
          expiry: "2026-10-01",
          strike: 100,
          side: "put",
          gamma: 0.01,
          openInterest: 10,
          contractMultiplier: 100,
          unavailable: [],
        },
      ],
    });
    expect(result.formula).toBe(gammaExposureFormula);
    expect(result.grossGammaExposure).toBe(3000);
    expect(result.modeledSignedGammaExposure).toBe(1000);
    expect(result.perContract).toHaveLength(2);
    expect(result.grossByLevel[0]).toMatchObject({ value: 3000, contractCount: 2 });
    expect(result.modeledSignedByLevel[0]).toMatchObject({ value: 1000, contractCount: 2 });
    expect(result.assumptions.join(" ")).toContain("call=positive");
  });

  it("excludes missing fields instead of treating them as zero", () => {
    const result = analyzeGamma({
      spot: 100,
      asOf: "2026-09-01T00:00:00.000Z",
      quotes: [
        {
          symbol: "MISSING",
          expiry: "2026-10-01",
          strike: 100,
          side: "call",
          gamma: 0,
          openInterest: undefined,
          contractMultiplier: 100,
          unavailable: ["openInterest"],
        },
      ],
    });
    expect(result.grossByLevel).toEqual([]);
    expect(result.excludedContracts[0]?.reasons).toContain("openInterest");
    expect(result.excludedContracts[0]?.reasons).toContain("open_interest_unavailable");
  });

  it("can estimate positive Black-Scholes Gamma when the provider omits the Greek", () => {
    const gamma = blackScholesGamma({
      spot: 100,
      strike: 100,
      impliedVolatility: 0.3,
      expiry: "2026-12-01",
      asOf: "2026-09-01T00:00:00.000Z",
    });
    expect(gamma).toBeGreaterThan(0);
  });

  it("keeps expiry and strike as separate aggregation levels", () => {
    const result = analyzeGamma({
      spot: 100,
      asOf: "2026-09-01T00:00:00.000Z",
      quotes: [
        {
          symbol: "SEP",
          expiry: "2026-09-18",
          strike: 100,
          side: "call",
          gamma: 0.01,
          openInterest: 10,
          contractMultiplier: 100,
          unavailable: [],
        },
        {
          symbol: "OCT",
          expiry: "2026-10-16",
          strike: 105,
          side: "put",
          gamma: 0.01,
          openInterest: 10,
          contractMultiplier: 100,
          unavailable: [],
        },
      ],
    });
    expect(result.grossByLevel).toHaveLength(2);
    expect(result.grossByLevel.map((level) => level.expiry)).toEqual([
      "2026-09-18",
      "2026-10-16",
    ]);
  });
});
