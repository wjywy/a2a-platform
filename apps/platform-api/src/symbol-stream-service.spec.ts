import { describe, expect, it } from "vitest";
import {
  __symbolStreamInternals,
  appendSymbolStreamEvent,
  appendSymbolStreamText,
  bindSymbolStream,
  createSymbolStream,
  findSymbolStream,
  subscribeSymbolStream,
} from "./symbol-stream-service.js";

describe("resumable Symbol stream state", () => {
  it("replays buffered events and then delivers live cumulative snapshots", async () => {
    const taskId = "stream-replay-test";
    const stream = createSymbolStream({
      tenantId: "tenant-a",
      slug: "symbol-market",
    });
    bindSymbolStream(
      stream,
      "tenant-a",
      "symbol-market",
      taskId,
      "context-a",
    );
    appendSymbolStreamEvent(stream, { kind: "started" });
    const first = appendSymbolStreamText(stream, "第一段");
    appendSymbolStreamEvent(stream, {
      kind: "delta",
      text: first.text,
      sequence: first.sequence,
    });

    const received: unknown[] = [];
    const unsubscribe = subscribeSymbolStream(stream, (event) =>
      received.push(event),
    );
    const second = appendSymbolStreamText(stream, "，第二段");
    appendSymbolStreamEvent(stream, {
      kind: "delta",
      text: second.text,
      sequence: second.sequence,
    });

    expect(received).toEqual([
      { kind: "started" },
      { kind: "delta", text: "第一段", sequence: 1 },
      { kind: "delta", text: "第一段，第二段", sequence: 2 },
    ]);
    expect(findSymbolStream("tenant-a", "symbol-market", taskId)).toBe(stream);
    unsubscribe();
    stream.complete();
    await stream.completion;
    __symbolStreamInternals.activeStreams.delete(stream.key);
  });

  it("keeps task streams tenant-scoped and exposes an explicit cancel signal", () => {
    const stream = createSymbolStream({
      tenantId: "tenant-b",
      slug: "symbol-market",
      taskId: "stream-cancel-test",
    });
    expect(findSymbolStream("tenant-a", "symbol-market", "stream-cancel-test")).toBeUndefined();
    expect(stream.controller.signal.aborted).toBe(false);
    stream.controller.abort();
    expect(stream.controller.signal.aborted).toBe(true);
    __symbolStreamInternals.activeStreams.delete(stream.key);
  });
});
