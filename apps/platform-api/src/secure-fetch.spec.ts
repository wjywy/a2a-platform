import { once } from "node:events";
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { readLimitedResponseText, secureFetchWithPolicy } from "./secure-fetch.js";

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

  it("permits an explicitly trusted private target under production policy", async () => {
    const server = createServer((_req, res) => res.end("ok"));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("测试服务未监听 TCP 端口。");
    const url = `http://127.0.0.1:${address.port}/card`;
    const previousNodeEnv = process.env.NODE_ENV;
    const previousPrivateTargets = process.env.ALLOW_PRIVATE_OUTBOUND_TARGETS;
    process.env.NODE_ENV = "production";
    process.env.ALLOW_PRIVATE_OUTBOUND_TARGETS = "false";
    try {
      await expect(
        secureFetchWithPolicy(url, undefined, { allowPrivate: true }),
      ).resolves.toMatchObject({ ok: true });
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousPrivateTargets === undefined)
        delete process.env.ALLOW_PRIVATE_OUTBOUND_TARGETS;
      else process.env.ALLOW_PRIVATE_OUTBOUND_TARGETS = previousPrivateTargets;
      server.close();
      await once(server, "close");
    }
  });
});
