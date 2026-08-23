import { describe, expect, it } from "vitest";
import { readLimitedResponseText } from "./secure-fetch.js";

const responseOf = (text: string) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    }),
  );

describe("bounded outbound responses", () => {
  it("cancels and rejects an oversized strict response", async () => {
    await expect(
      readLimitedResponseText(responseOf("x".repeat(100)), 16),
    ).rejects.toThrow("超过 16 字节");
  });

  it("stores only the allowed prefix for a bounded Webhook summary", async () => {
    const result = await readLimitedResponseText(
      responseOf("abcdefghijklmnop"),
      8,
      false,
    );
    expect(result).toBe("abcdefgh");
  });
});
