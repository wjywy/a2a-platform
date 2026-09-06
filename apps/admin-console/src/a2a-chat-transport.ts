import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import { streamStudioAgent, streamStudioAgentTask, type SseEnvelope } from "./api";

type Config = () => {
  slug: string;
  token: string;
  tenantId: string;
  taskId?: string;
  onEvent?: (event: unknown) => void;
  onStatus?: (
    status: "connecting" | "receiving" | "completed" | "error",
  ) => void;
};

type StreamStatus = "connecting" | "receiving" | "completed" | "error";

// The gateway imposes a 60-second invocation ceiling.  Keep a small client
// margin so a misbehaving proxy or a remote Agent that never closes its SSE
// connection cannot leave the composer in a permanent loading state.
const STREAM_TERMINAL_TIMEOUT_MS = 70_000;

function findTexts(value: unknown, output: string[] = []): string[] {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    value.forEach((item) => findTexts(item, output));
    return output;
  }
  const row = value as Record<string, unknown>;
  if (typeof row.text === "string" && row.text.trim())
    output.push(row.text.trim());
  Object.values(row).forEach((item) => findTexts(item, output));
  return output;
}

function streamFailure(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const row = value as Record<string, unknown>;
  if (typeof row.error === "string" && row.error.trim()) return row.error;
  if (row.error && typeof row.error === "object") {
    const error = row.error as Record<string, unknown>;
    if (typeof error.message === "string" && error.message.trim())
      return error.message;
  }
  if (typeof row.message === "string" && row.code && row.message.trim())
    return row.message;
  return;
}
function lastText(message: UIMessage | undefined) {
  return (
    message?.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n") ?? ""
  );
}

function toUiMessageStream(input: {
  events: AsyncIterable<SseEnvelope>;
  id: string;
  abortSignal?: AbortSignal;
  onEvent?: (event: unknown) => void;
  onStatus?: (status: StreamStatus) => void;
}) {
  return new ReadableStream<UIMessageChunk>({
    start: async (controller) => {
      controller.enqueue({ type: "text-start", id: input.id });
      input.onStatus?.("connecting");
      try {
        let emitted = "";
        for await (const event of input.events) {
          input.onEvent?.(event.data);
          input.onStatus?.("receiving");
          const failure = streamFailure(event.data);
          if (failure) throw new Error(failure);
          const text = [...new Set(findTexts(event.data))].join("\n");
          const delta = text.startsWith(emitted)
            ? text.slice(emitted.length)
            : text === emitted
              ? ""
              : text;
          if (delta) controller.enqueue({ type: "text-delta", id: input.id, delta });
          emitted = text;
        }
        controller.enqueue({ type: "text-end", id: input.id });
        controller.enqueue({ type: "finish", finishReason: "stop" });
        input.onStatus?.("completed");
        controller.close();
      } catch (error) {
        if (input.abortSignal?.aborted) {
          controller.close();
          return;
        }
        input.onStatus?.("error");
        const errorText =
          error instanceof DOMException && error.name === "TimeoutError"
            ? "Agent 在 70 秒内没有返回终态。请重试，或检查该 Agent 的运行日志。"
            : error instanceof Error
              ? error.message
              : "A2A 调用失败";
        controller.enqueue({ type: "error", errorText });
        controller.close();
      }
    },
  });
}
const MAX_CONTEXT_CHARS = 12_000;
const MAX_CONTEXT_MESSAGES = 14;

function promptForMessages(messages: UIMessage[], continueTaskId?: string) {
  const latest = lastText(messages.at(-1)).trim();
  if (!latest || continueTaskId) return latest;
  const prior = messages
    .slice(-MAX_CONTEXT_MESSAGES, -1)
    .map((message) => {
      const text = lastText(message).trim();
      if (!text) return "";
      return `${message.role === "assistant" ? "Agent" : "用户"}：${text}`;
    })
    .filter(Boolean)
    .join("\n\n");
  if (!prior) return latest;
  const clipped = prior.slice(-MAX_CONTEXT_CHARS);
  return [
    "以下是同一会话中已经发生的对话。请基于它继续，但不要复述整个历史：",
    clipped,
    "\n用户的新消息：",
    latest,
  ].join("\n");
}

/** Adapts the platform's A2A SSE to the Vercel AI SDK UIMessage stream. */
export class A2AChatTransport implements ChatTransport<UIMessage> {
  constructor(private readonly config: Config) {}
  async sendMessages(
    options: Parameters<ChatTransport<UIMessage>["sendMessages"]>[0],
  ) {
    const { slug, token, tenantId, taskId, onEvent, onStatus } = this.config();
    const prompt = promptForMessages(options.messages, taskId);
    if (!slug || !token || !tenantId) throw new Error("请先登录并选择租户与 Agent。");
    return toUiMessageStream({
      events: streamStudioAgent({
        slug,
        token,
        tenantId,
        question: prompt,
        continueTaskId: taskId,
        signal: options.abortSignal
          ? AbortSignal.any([
              options.abortSignal,
              AbortSignal.timeout(STREAM_TERMINAL_TIMEOUT_MS),
            ])
          : AbortSignal.timeout(STREAM_TERMINAL_TIMEOUT_MS),
      }),
      id: crypto.randomUUID(),
      abortSignal: options.abortSignal,
      onEvent,
      onStatus,
    });
  }
  async reconnectToStream(options: {
    chatId: string;
    abortSignal?: AbortSignal;
  }) {
    const { slug, token, tenantId, taskId, onEvent, onStatus } = this.config();
    if (!slug || !token || !tenantId || !taskId) return null;
    return toUiMessageStream({
      events: streamStudioAgentTask({
        slug,
        token,
        tenantId,
        taskId,
        signal: options.abortSignal
          ? AbortSignal.any([
              options.abortSignal,
              AbortSignal.timeout(STREAM_TERMINAL_TIMEOUT_MS),
            ])
          : AbortSignal.timeout(STREAM_TERMINAL_TIMEOUT_MS),
      }),
      id: crypto.randomUUID(),
      abortSignal: options.abortSignal,
      onEvent,
      onStatus,
    });
  }
}

export const __a2aTransportInternals = {
  promptForMessages,
  findTexts,
  streamFailure,
};
