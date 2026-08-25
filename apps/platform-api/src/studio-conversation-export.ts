import {
  getStudioConversation,
  type StudioConversationDetail,
} from "./studio-conversation-service.js";

export type StudioConversationExportFormat = "markdown" | "json" | "text";

function escapeMarkdown(value: string) {
  return value.replace(/([\\`*_{}[\]<>()#+.!|])/g, "\\$1");
}

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function plainTranscript(conversation: StudioConversationDetail) {
  return conversation.messages
    .filter((message) => message.role !== "system")
    .map((message) => {
      const speaker = message.role === "assistant" ? "Agent" : "用户";
      const status =
        message.status === "completed" ? "" : ` [${message.status}]`;
      return `[${dateLabel(message.createdAt)}] ${speaker}${status}\n${message.content}`;
    })
    .join("\n\n");
}

export function conversationToMarkdown(conversation: StudioConversationDetail) {
  const header = [
    `# ${escapeMarkdown(conversation.title)}`,
    "",
    `- Agent: \`${conversation.agentSlug}\``,
    `- 会话 ID: \`${conversation.id}\``,
    `- 导出时间: ${new Date().toISOString()}`,
    ...(conversation.labels?.length
      ? [
          `- 标签: ${conversation.labels.map((label) => `\`${label.name}\``).join("、")}`,
        ]
      : []),
    "",
    "---",
    "",
  ];
  const turns = conversation.messages
    .filter((message) => message.role !== "system")
    .map((message) => {
      const title = message.role === "assistant" ? "## Agent" : "## 用户";
      const state =
        message.status === "completed" ? "" : ` · ${message.status}`;
      return [
        `${title}${state}`,
        "",
        message.content,
        "",
        `<sub>${dateLabel(message.createdAt)}</sub>`,
        "",
      ].join("\n");
    });
  return [...header, ...turns].join("\n").trimEnd() + "\n";
}

export function conversationToText(conversation: StudioConversationDetail) {
  return (
    [
      conversation.title,
      `Agent: ${conversation.agentSlug}`,
      `会话 ID: ${conversation.id}`,
      "",
      plainTranscript(conversation),
    ]
      .join("\n")
      .trimEnd() + "\n"
  );
}

/**
 * Omits database-only and actor metadata from JSON export. A user can download
 * their conversation without receiving internal audit identifiers or API-key data.
 */
export function conversationToJson(conversation: StudioConversationDetail) {
  return (
    JSON.stringify(
      {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        conversation: {
          id: conversation.id,
          agentSlug: conversation.agentSlug,
          title: conversation.title,
          status: conversation.status,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
          labels:
            conversation.labels?.map(({ id, name, color }) => ({
              id,
              name,
              color,
            })) ?? [],
        },
        messages: conversation.messages.map((message) => ({
          id: message.id,
          sequence: message.sequence,
          role: message.role,
          content: message.content,
          status: message.status,
          createdAt: message.createdAt,
          updatedAt: message.updatedAt,
        })),
      },
      null,
      2,
    ) + "\n"
  );
}

export async function exportStudioConversation(
  conversationId: string,
  tenantId: string,
  format: StudioConversationExportFormat,
) {
  const conversation = await getStudioConversation(conversationId, tenantId);
  switch (format) {
    case "markdown":
      return {
        content: conversationToMarkdown(conversation),
        contentType: "text/markdown; charset=utf-8",
        extension: "md",
      };
    case "text":
      return {
        content: conversationToText(conversation),
        contentType: "text/plain; charset=utf-8",
        extension: "txt",
      };
    case "json":
      return {
        content: conversationToJson(conversation),
        contentType: "application/json; charset=utf-8",
        extension: "json",
      };
  }
}

export const __studioConversationExportInternals = {
  escapeMarkdown,
  plainTranscript,
};
