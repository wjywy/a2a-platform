import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import { streamAgent } from "./api";

type Config = () => {
  slug: string;
  apiKey: string;
  taskId?: string;
  onEvent?: (event: unknown) => void;
  onStatus?: (
    status: "connecting" | "receiving" | "completed" | "error",
  ) => void;
};
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
function lastText(message: UIMessage | undefined) {
  return (
    message?.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n") ?? ""
  );
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
    const { slug, apiKey, taskId, onEvent, onStatus } = this.config();
    const prompt = promptForMessages(options.messages, taskId);
    if (!slug || !apiKey) throw new Error("请先选择 Agent 并填写 API Key。");
    return new ReadableStream<UIMessageChunk>({
      start: async (controller) => {
        const id = crypto.randomUUID();
        controller.enqueue({ type: "text-start", id });
        onStatus?.("connecting");
        try {
          let emitted = "";
          for await (const event of streamAgent({
            slug,
            apiKey,
            question: prompt,
            continueTaskId: taskId,
            signal: options.abortSignal,
          })) {
            onEvent?.(event.data);
            onStatus?.("receiving");
            const text = [...new Set(findTexts(event.data))].join("\n");
            // A2A status snapshots often repeat the complete message. Emit only
            // the suffix so the AI SDK transcript remains readable.
            const delta = text.startsWith(emitted)
              ? text.slice(emitted.length)
              : text === emitted
                ? ""
                : text;
            if (delta) controller.enqueue({ type: "text-delta", id, delta });
            emitted = text;
          }
          controller.enqueue({ type: "text-end", id });
          controller.enqueue({ type: "finish", finishReason: "stop" });
          onStatus?.("completed");
          controller.close();
        } catch (error) {
          onStatus?.("error");
          controller.enqueue({
            type: "error",
            errorText: error instanceof Error ? error.message : "A2A 调用失败",
          });
          controller.close();
        }
      },
    });
  }
  async reconnectToStream() {
    return null;
  }
}

export const __a2aTransportInternals = { promptForMessages, findTexts };
