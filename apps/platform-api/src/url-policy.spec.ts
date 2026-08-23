import { describe, expect, it } from "vitest";
import { assertSafeOutboundUrl } from "./url-policy.js";

describe("outbound URL policy", () => {
  it.each([
    "http://127.0.0.1/card",
    "http://[::1]/card",
    "http://[::ffff:127.0.0.1]/card",
    "http://169.254.169.254/latest/meta-data",
    "http://100.64.0.1/internal",
  ])("rejects private and special-use destination %s", async (target) => {
    await expect(
      assertSafeOutboundUrl(target, {
        purpose: "agent_card",
        allowPrivate: false,
      }),
    ).rejects.toMatchObject({ code: "OUTBOUND_PRIVATE_ADDRESS_DENIED" });
  });

  it("rejects credentials embedded in an outbound URL", async () => {
    await expect(
      assertSafeOutboundUrl("https://user:secret@example.com/hook", {
        purpose: "webhook",
        allowPrivate: false,
      }),
    ).rejects.toMatchObject({ code: "OUTBOUND_CREDENTIALS_DENIED" });
  });
});
