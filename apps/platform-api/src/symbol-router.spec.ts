import { describe, expect, it } from "vitest";
import { StreamResponse } from "@a2a-js/sdk";
import { __symbolRouterInternals } from "./symbol-router.js";

describe("bundled Symbol Agent streaming envelope", () => {
  it("encodes cumulative model text as an A2A working status update", () => {
    const wire = __symbolRouterInternals.streamingStatusEvent({
      taskId: "task-stream-1",
      contextId: "context-stream-1",
      text: "第一段，第二段",
    });
    const event = StreamResponse.fromJSON(wire);
    expect(event.payload?.$case).toBe("statusUpdate");
    const status = event.payload?.$case === "statusUpdate"
      ? event.payload.value.status
      : undefined;
    expect(status?.state.toString()).toBe("2");
    expect(status?.message?.parts[0]?.content).toMatchObject({
      $case: "text",
      value: "第一段，第二段",
    });
  });
});
