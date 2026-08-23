import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { SseEnvelope } from "../api";
import styles from "../App.module.css";

type DebugEvent = SseEnvelope & { index: number; receivedAt: string };
type JsonRecord = Record<string, unknown>;
type TextContribution = {
  key: string;
  text: string;
  append: boolean;
};

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" ? (value as JsonRecord) : undefined;
}

function textFromParts(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      const item = record(part);
      if (!item) return "";
      if (typeof item.text === "string") return item.text;
      const content = record(item.content);
      return content?.$case === "text" && typeof content.value === "string"
        ? content.value
        : "";
    })
    .join("");
}

function isAgentMessage(message: JsonRecord): boolean {
  const role = message.role;
  return !(
    role === 1 ||
    (typeof role === "string" &&
      ["user", "role_user"].includes(role.toLowerCase()))
  );
}

function messageContribution(
  value: unknown,
  fallbackKey: string,
): TextContribution | undefined {
  const message = record(value);
  if (!message || !isAgentMessage(message)) return;
  const text = textFromParts(message.parts);
  if (!text) return;
  return {
    key: `message:${String(message.messageId ?? message.message_id ?? fallbackKey)}`,
    text,
    append: false,
  };
}

function artifactContribution(
  value: unknown,
  fallbackKey: string,
  append: boolean,
): TextContribution | undefined {
  const artifact = record(value);
  if (!artifact) return;
  const text = textFromParts(artifact.parts);
  if (!text) return;
  return {
    key: `artifact:${String(artifact.artifactId ?? artifact.artifact_id ?? artifact.id ?? fallbackKey)}`,
    text,
    append,
  };
}

function unwrapResult(value: unknown): JsonRecord | undefined {
  const item = record(value);
  if (!item) return;
  return record(item.result) ?? item;
}

function contributionsFromEvent(event: DebugEvent): TextContribution[] {
  const data = unwrapResult(event.data);
  if (!data) return [];
  const result: TextContribution[] = [];
  const directMessage = messageContribution(
    data.message,
    `${event.index}:direct`,
  );
  if (directMessage) result.push(directMessage);

  const statusUpdate = record(data.statusUpdate ?? data.status_update);
  const status = record(statusUpdate?.status);
  const statusMessage = messageContribution(
    status?.message,
    `${event.index}:status`,
  );
  if (statusMessage) result.push(statusMessage);

  const artifactUpdate = record(data.artifactUpdate ?? data.artifact_update);
  const updatedArtifact = artifactContribution(
    artifactUpdate?.artifact,
    `${event.index}:artifact`,
    artifactUpdate?.append === true,
  );
  if (updatedArtifact) result.push(updatedArtifact);

  const task = record(data.task);
  if (Array.isArray(task?.artifacts)) {
    task.artifacts.forEach((artifact, index) => {
      const contribution = artifactContribution(
        artifact,
        `${event.index}:task-artifact:${index}`,
        false,
      );
      if (contribution) result.push(contribution);
    });
  }
  return result;
}

export function aggregateMarkdown(events: DebugEvent[]): {
  markdown: string;
  blockCount: number;
} {
  const blocks = new Map<string, string>();
  for (const event of events) {
    for (const contribution of contributionsFromEvent(event)) {
      const previous = blocks.get(contribution.key) ?? "";
      blocks.set(
        contribution.key,
        contribution.append ? previous + contribution.text : contribution.text,
      );
    }
  }
  return {
    markdown: [...blocks.values()].filter(Boolean).join("\n\n").trim(),
    blockCount: blocks.size,
  };
}

export function StreamingMarkdown({
  markdown,
  busy,
}: {
  markdown: string;
  busy: boolean;
}) {
  return (
    <article className={styles.markdownDocument} aria-live="polite">
      {busy && (
        <div className={styles.markdownStreamingStatus} role="status">
          <i aria-hidden="true" />
          正在接收并解析 Markdown
        </div>
      )}
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          img: ({ src, alt }) => (
            <span
              className={styles.markdownBlockedImage}
              role="note"
              title={src}
            >
              外部图片已拦截{alt ? `：${alt}` : ""}
            </span>
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </article>
  );
}
