import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { StreamResponse, Task } from "@a2a-js/sdk";
import { __symbolRouterInternals } from "./symbol-router.js";
import { taskJson } from "./symbol-service.js";

describe("bundled Symbol Agent streaming envelope", () => {
  it("encodes cumulative model text as an A2A working status update", () => {
    const wire = __symbolRouterInternals.streamingStatusEvent({
      taskId: "task-stream-1",
      contextId: "context-stream-1",
      text: "第一段，第二段",
      sequence: 2,
      textHash: crypto.createHash("sha256").update("第一段，第二段").digest("hex"),
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
    expect(event.payload?.$case === "statusUpdate" ? event.payload.value.metadata : undefined).toMatchObject({
      streaming: true,
      messageSource: "agent-authored",
      sequence: 2,
      textLength: "第一段，第二段".length,
    });
  });

  it("does not put fabricated text in the initial working event", () => {
    const wire = __symbolRouterInternals.streamingStatusEvent({
      taskId: "task-stream-2",
      contextId: "context-stream-2",
    });
    const event = StreamResponse.fromJSON(wire);
    const status = event.payload?.$case === "statusUpdate"
      ? event.payload.value.status
      : undefined;
    expect(status?.message).toBeUndefined();
    expect(event.payload?.$case === "statusUpdate" ? event.payload.value.metadata : undefined).toMatchObject({
      streaming: true,
      messageSource: "protocol",
    });
  });

  it("keeps cumulative SSE snapshots ordered and terminal text identical", () => {
    const first = __symbolRouterInternals.streamingStatusEvent({
      taskId: "task-stream-3",
      contextId: "context-stream-3",
      text: "第一段",
      sequence: 1,
      textHash: crypto.createHash("sha256").update("第一段").digest("hex"),
    });
    const secondText = "第一段，第二段";
    const second = __symbolRouterInternals.streamingStatusEvent({
      taskId: "task-stream-3",
      contextId: "context-stream-3",
      text: secondText,
      sequence: 2,
      textHash: crypto.createHash("sha256").update(secondText).digest("hex"),
    });
    const firstEvent = StreamResponse.fromJSON(first);
    const secondEvent = StreamResponse.fromJSON(second);
    const firstMetadata = firstEvent.payload?.$case === "statusUpdate"
      ? firstEvent.payload.value.metadata
      : undefined;
    const secondMetadata = secondEvent.payload?.$case === "statusUpdate"
      ? secondEvent.payload.value.metadata
      : undefined;
    expect(firstMetadata).toMatchObject({ sequence: 1, textLength: 3 });
    expect(secondMetadata).toMatchObject({ sequence: 2, textLength: secondText.length });
    const terminal = Task.fromJSON(
      taskJson({
        taskId: "task-stream-3",
        contextId: "context-stream-3",
        state: "TASK_STATE_COMPLETED",
        text: secondText,
        artifact: { source: "test" },
      }),
    );
    expect(terminal.status?.message?.parts[0]?.content).toMatchObject({
      $case: "text",
      value: secondText,
    });
    expect(terminal.artifacts[0]?.parts[1]?.content).toMatchObject({
      $case: "text",
      value: secondText,
    });
  });
});
