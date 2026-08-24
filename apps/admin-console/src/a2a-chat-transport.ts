import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import { streamAgent } from "./api";

type Config = () => { slug: string; apiKey: string };
function findTexts(value: unknown, output: string[] = []): string[] {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) { value.forEach((item) => findTexts(item, output)); return output; }
  const row = value as Record<string, unknown>;
  if (typeof row.text === "string") output.push(row.text);
  Object.values(row).forEach((item) => findTexts(item, output));
  return output;
}
function lastText(message: UIMessage | undefined) {
  return message?.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n") ?? "";
}

/** Adapts the platform's A2A SSE to the Vercel AI SDK UIMessage stream. */
export class A2AChatTransport implements ChatTransport<UIMessage> {
  constructor(private readonly config: Config) {}
  async sendMessages(options: Parameters<ChatTransport<UIMessage>["sendMessages"]>[0]) {
    const { slug, apiKey } = this.config();
    const prompt = lastText(options.messages.at(-1));
    if (!slug || !apiKey) throw new Error("请先选择 Agent 并填写 API Key。");
    return new ReadableStream<UIMessageChunk>({
      start: async (controller) => {
        const id = crypto.randomUUID();
        controller.enqueue({ type: "text-start", id });
        try {
          for await (const event of streamAgent({ slug, apiKey, question: prompt, signal: options.abortSignal })) {
            const text = [...new Set(findTexts(event.data))].join("\n");
            if (text) controller.enqueue({ type: "text-delta", id, delta: text });
          }
          controller.enqueue({ type: "text-end", id });
          controller.enqueue({ type: "finish", finishReason: "stop" });
          controller.close();
        } catch (error) { controller.enqueue({ type: "error", errorText: error instanceof Error ? error.message : "A2A 调用失败" }); controller.close(); }
      },
    });
  }
  async reconnectToStream() { return null; }
}
