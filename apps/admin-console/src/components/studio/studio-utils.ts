import type { UIMessage } from "ai";
import type {
  Agent,
  AgentRunTrajectory,
  StudioConversation,
  StudioMessage,
} from "../../api";

export type StudioStreamPhase =
  | "idle"
  | "connecting"
  | "receiving"
  | "error";

export type StudioOperation =
  | ""
  | "export"
  | "create-label"
  | "update-labels"
  | `rename:${string}`
  | `archive:${string}`
  | `delete:${string}`
  | `feedback:${string}`;

export type ConversationPeriod =
  | "今天"
  | "昨天"
  | "过去 7 天"
  | "过去 30 天"
  | "更早";

export type ConversationGroup = {
  label: ConversationPeriod;
  items: StudioConversation[];
};

const periodOrder: ConversationPeriod[] = [
  "今天",
  "昨天",
  "过去 7 天",
  "过去 30 天",
  "更早",
];

export function findTaskId(
  value: unknown,
  insideTask = false,
): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findTaskId(child, insideTask);
      if (found) return found;
    }
    return undefined;
  }

  const item = value as Record<string, unknown>;
  if (typeof item.taskId === "string" && item.taskId) return item.taskId;

  // A2A task status updates use `{ task: { id, status } }`. A generic nested
  // id can belong to an artifact or message and must not become continuation
  // state for the next turn.
  if (
    typeof item.id === "string" &&
    item.id &&
    (insideTask || "contextId" in item || "history" in item) &&
    ("status" in item || "history" in item || "artifacts" in item)
  ) {
    return item.id;
  }

  for (const [key, child] of Object.entries(item)) {
    const found = findTaskId(
      child,
      insideTask || key === "task" || key === "taskStatus" || key === "result",
    );
    if (found) return found;
  }
  return undefined;
}

export function statusLabel(status: string) {
  return (
    {
      running: "运行中",
      input_required: "等待补充",
      completed: "已完成",
      failed: "失败",
      cancelled: "已停止",
      queued: "排队中",
    }[status] ?? status
  );
}

export function statusTone(
  status?: string,
): "neutral" | "progress" | "success" | "warning" | "danger" {
  if (!status) return "neutral";
  if (["completed", "healthy", "online"].includes(status)) return "success";
  if (["failed", "unhealthy", "offline", "error"].includes(status)) {
    return "danger";
  }
  if (["input_required", "degraded", "warning"].includes(status)) {
    return "warning";
  }
  if (["running", "queued", "connecting", "receiving"].includes(status)) {
    return "progress";
  }
  return "neutral";
}

export function transcriptToMessages(
  messages: Array<{
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
  }>,
): UIMessage[] {
  return messages
    .filter((item) => item.role !== "system")
    .map(
      (item) =>
        ({
          id: item.id,
          role: item.role,
          parts: [{ type: "text", text: item.content }],
        }) as UIMessage,
    );
}

export function messageText(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

export function timeLabel(value: string, now = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  return date.toLocaleDateString("zh-CN", {
    month: "numeric",
    day: "numeric",
  });
}

export function fullTimeLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知时间";
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function dayDistance(value: Date, now: Date) {
  const milliseconds = startOfDay(now).getTime() - startOfDay(value).getTime();
  return Math.floor(milliseconds / 86_400_000);
}

export function conversationPeriod(
  value: string,
  now = new Date(),
): ConversationPeriod {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "更早";
  const days = dayDistance(date, now);
  if (days <= 0) return "今天";
  if (days === 1) return "昨天";
  if (days <= 7) return "过去 7 天";
  if (days <= 30) return "过去 30 天";
  return "更早";
}

export function groupConversations(
  conversations: StudioConversation[],
  now = new Date(),
): ConversationGroup[] {
  const groups = new Map<ConversationPeriod, StudioConversation[]>();
  for (const conversation of conversations) {
    const key = conversationPeriod(conversation.updatedAt, now);
    const items = groups.get(key) ?? [];
    items.push(conversation);
    groups.set(key, items);
  }
  return periodOrder
    .filter((label) => groups.has(label))
    .map((label) => ({
      label,
      items: (groups.get(label) ?? []).sort(
        (left, right) =>
          new Date(right.updatedAt).getTime() -
          new Date(left.updatedAt).getTime(),
      ),
    }));
}

export function selectAvailableAgents(agents: Agent[], tenantId: string) {
  return [...agents]
    .filter(
      (agent) =>
        ["online", "degraded"].includes(agent.status) &&
        (!tenantId ||
          agent.tenantId === tenantId ||
          agent.visibility === "public" ||
          agent.allowedTenantIds.includes(tenantId)),
    )
    .sort((left, right) => {
      const health =
        Number(right.healthStatus === "healthy") -
        Number(left.healthStatus === "healthy");
      const availability =
        Number(right.status === "online") - Number(left.status === "online");
      return health || availability || left.displayName.localeCompare(right.displayName);
    });
}

export function phaseLabel(phase: StudioStreamPhase) {
  if (phase === "connecting") return "正在连接 Agent";
  if (phase === "receiving") return "正在生成回复";
  if (phase === "error") return "生成中断";
  return "";
}

export function composerPlaceholder(input: {
  authenticated: boolean;
  hasAgent: boolean;
  busy: boolean;
  agentName?: string;
}) {
  if (!input.authenticated) return "请先登录后使用在线调试";
  if (!input.hasAgent) return "当前没有可调用的 Agent";
  if (input.busy) return "Agent 正在回应，可停止当前生成";
  return input.agentName ? `给 ${input.agentName} 发送消息` : "给 Agent 发送消息";
}

export function canSubmitMessage(input: {
  text: string;
  busy: boolean;
  token: string;
  slug: string;
  tenantId: string;
}) {
  return Boolean(
    input.text.trim() &&
      !input.busy &&
      input.token &&
      input.slug &&
      input.tenantId,
  );
}

export function visibleMessageStatus(
  message: StudioMessage | undefined,
): "saved" | "saving" | "failed" | "cancelled" | undefined {
  if (!message) return undefined;
  if (message.status === "pending" || message.status === "streaming") {
    return "saving";
  }
  if (message.status === "failed") return "failed";
  if (message.status === "cancelled") return "cancelled";
  return "saved";
}

export function trajectorySummary(trajectory?: AgentRunTrajectory | null) {
  if (!trajectory) return undefined;
  const completed = trajectory.events.filter(
    (event) => event.kind === "node_completed" || event.kind === "final",
  ).length;
  const tools = trajectory.events.filter((event) => event.kind === "tool").length;
  const interrupts = trajectory.events.filter(
    (event) => event.kind === "interrupt",
  ).length;
  const errors = trajectory.events.filter((event) => event.kind === "error").length;
  return {
    completed,
    tools,
    interrupts,
    errors,
    total: trajectory.events.length,
  };
}

export function conciseTaskId(taskId: string) {
  if (!taskId) return "";
  return taskId.length <= 12 ? taskId : `${taskId.slice(0, 8)}…${taskId.slice(-4)}`;
}

export function safeConversationTitle(title?: string) {
  const value = title?.trim();
  return value || "未命名会话";
}
