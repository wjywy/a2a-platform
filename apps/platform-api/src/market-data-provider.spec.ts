import { describe, expect, it } from "vitest";
import {
  __marketDataInternals,
  isoDate,
  numericValue,
  statusForTradeStatus,
} from "./market-data-provider.js";

describe("market data evidence helpers", () => {
  it("normalizes numeric provider values without inventing missing data", () => {
    expect(numericValue("$1,234.50")).toBe(1234.5);
    expect(numericValue("N/A")).toBeUndefined();
    expect(numericValue(undefined)).toBeUndefined();
  });

  it("normalizes provider timestamps and trade statuses", () => {
    expect(isoDate("2026-09-05T01:02:03.000Z")).toBe(
      "2026-09-05T01:02:03.000Z",
    );
    expect(statusForTradeStatus(0)).toBe("regular");
    expect(statusForTradeStatus(1)).toBe("closed");
    expect(statusForTradeStatus(undefined)).toBe("unknown");
    expect(__marketDataInternals.statusForTradeStatus("Normal")).toBe(
      "regular",
    );
  });

  it("redacts credentials from provider diagnostics while keeping the error useful", () => {
    const message = __marketDataInternals.redactProviderError(
      new Error(
        "authorization: Bearer super-secret access_token=token-value url=https://example.test?q=1&api_key=query-secret",
      ),
    );
    expect(message).toContain("authorization: Bearer [已脱敏]");
    expect(message).toContain("access_token=[已脱敏]");
    expect(message).toContain("api_key=[已脱敏]");
    expect(message).not.toContain("super-secret");
    expect(message).not.toContain("token-value");
    expect(message).not.toContain("query-secret");
  });
});
