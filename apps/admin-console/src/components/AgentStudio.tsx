import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import type { TextAreaRef } from "antd/es/input/TextArea";
import {
  Button,
  Checkbox,
  Drawer,
  Input,
  Popconfirm,
  Select,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  EditOutlined,
  DeleteOutlined,
  DownloadOutlined,
  InboxOutlined,
  LeftOutlined,
  LoadingOutlined,
  MessageOutlined,
  PauseCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  RightOutlined,
  SendOutlined,
  SettingOutlined,
  StopOutlined,
  TagsOutlined,
} from "@ant-design/icons";
import { useApp } from "../AppContext";
import {
  platformApi,
  downloadStudioConversation,
  type AgentRunTrajectory,
  type StudioConversation,
  type StudioMessage,
  type StudioConversationEvent,
  type StudioMessageRevision,
  type StudioLabel,
} from "../api";
import { useAsync } from "../hooks";
import { StreamingMarkdown } from "./StreamingMarkdown";
import { StudioMessageActions } from "./studio/StudioMessageActions";
import { useStudioDraft } from "./studio/useStudioDraft";
import { useTranscriptScroll } from "./studio/useTranscriptScroll";
import { useStudioPersistenceQueue } from "./studio/useStudioPersistenceQueue";
import { A2AChatTransport } from "../a2a-chat-transport";
import styles from "../App.module.css";

function findTaskId(value: unknown, insideTask = false): string | undefined {
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
  // A2A task status updates use `{ task: { id, status } }`. Do not accept a
  // generic nested `id`: artifact and message ids are not continuation ids.
  if (
    typeof item.id === "string" &&
    item.id &&
    (insideTask || "contextId" in item || "history" in item) &&
    ("status" in item || "history" in item || "artifacts" in item)
  )
    return item.id;
  for (const [key, child] of Object.entries(item)) {
    const found = findTaskId(
      child,
      insideTask || key === "task" || key === "taskStatus" || key === "result",
    );
    if (found) return found;
  }
  return undefined;
}
function statusLabel(status: string) {
  return (
    (
      {
        running: "运行中",
        input_required: "等待补充",
        completed: "已完成",
        failed: "失败",
        cancelled: "已取消",
      } as Record<string, string>
    )[status] ?? status
  );
}
function transcriptToMessages(
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
function timeLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

export function AgentStudio() {
  const { token, agents, tenants, selectedTenantId, setSelectedTenantId } =
    useApp();
  const tenantId = selectedTenantId || tenants[0]?.id || "";
  const [slug, setSlug] = useState("");
  const [taskId, setTaskId] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [persistedMessages, setPersistedMessages] = useState<StudioMessage[]>(
    [],
  );
  const [trajectory, setTrajectory] = useState<AgentRunTrajectory | null>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [traceOpen, setTraceOpen] = useState(false);
  const [leftWidth, setLeftWidth] = useState(288);
  const [rightWidth, setRightWidth] = useState(280);
  const [dragging, setDragging] = useState<"left" | "right" | null>(null);
  const [streamPhase, setStreamPhase] = useState<
    "idle" | "connecting" | "receiving" | "error"
  >("idle");
  const [conversationLoading, setConversationLoading] = useState(false);
  const [conversationError, setConversationError] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [conversationSearch, setConversationSearch] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const [renamingTaskId, setRenamingTaskId] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [revisionMessageId, setRevisionMessageId] = useState("");
  const [labelFilter, setLabelFilter] = useState("");
  const [labelManagerOpen, setLabelManagerOpen] = useState(false);
  const [activeLabels, setActiveLabels] = useState<StudioLabel[]>([]);
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] =
    useState<StudioLabel["color"]>("blue");
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false);
  const draft = useStudioDraft(tenantId, slug, conversationId);
  const prompt = draft.value;
  const studioRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<TextAreaRef>(null);
  const pendingAssistantPersistence = useRef<string | undefined>(undefined);
  const pendingAssistantClientRequestId = useRef<string | undefined>(undefined);
  const generationCancelled = useRef(false);
  const pendingUserIdentity = useRef<
    { content: string; persistentId: string } | undefined
  >(undefined);
  const config = useRef({
    slug: "",
    token: "",
    tenantId: "",
    taskId: "",
    onEvent: undefined as undefined | ((event: unknown) => void),
    onStatus: undefined as
      | undefined
      | ((status: "connecting" | "receiving" | "completed" | "error") => void),
  });
  const deliverQueuedMessage = useCallback(
    async (operation: {
      conversationId: string;
      payload: Parameters<typeof platformApi.appendStudioMessage>[2];
    }) => {
      await platformApi.appendStudioMessage(
        token,
        operation.conversationId,
        operation.payload,
      );
    },
    [token],
  );
  const persistenceQueue = useStudioPersistenceQueue(deliverQueuedMessage);
  const conversations = useAsync(
    () =>
      tenantId && slug
        ? platformApi.studioConversations(token, {
            tenantId,
            agentSlug: slug,
            status: showArchived ? "archived" : "active",
            search: conversationSearch || undefined,
            labelId: labelFilter || undefined,
            page: historyPage,
            pageSize: 100,
          })
        : Promise.resolve(undefined),
    [
      token,
      tenantId,
      slug,
      showArchived,
      conversationSearch,
      labelFilter,
      historyPage,
    ],
  );
  const labels = useAsync(
    () =>
      tenantId
        ? platformApi.studioLabels(token, tenantId)
        : Promise.resolve([]),
    [token, tenantId],
  );
  const conversationEvents = useAsync<StudioConversationEvent[]>(
    () =>
      tenantId && conversationId
        ? platformApi.studioConversationEvents(token, tenantId, conversationId)
        : Promise.resolve([]),
    [token, tenantId, conversationId],
  );
  const revisions = useAsync<StudioMessageRevision[]>(
    () =>
      tenantId && conversationId && revisionMessageId
        ? platformApi.studioMessageRevisions(
            token,
            tenantId,
            conversationId,
            revisionMessageId,
          )
        : Promise.resolve([]),
    [token, tenantId, conversationId, revisionMessageId],
  );
  config.current = {
    slug,
    token,
    tenantId,
    taskId,
    onEvent: (event) => {
      const next = findTaskId(event);
      if (next) setTaskId(next);
    },
    onStatus: (status) =>
      setStreamPhase(status === "completed" ? "idle" : status),
  };
  const transport = useMemo(
    () => new A2AChatTransport(() => config.current),
    [],
  );
  const chat = useChat({ transport, throttle: 30 });
  const isBusy = chat.status === "submitted" || chat.status === "streaming";
  const transcriptScroll = useTranscriptScroll(chat.messages, isBusy);
  const availableAgents = useMemo(
    () =>
      agents.filter(
        (agent) =>
          ["online", "degraded"].includes(agent.status) &&
          (!tenantId ||
            agent.tenantId === tenantId ||
            agent.visibility === "public" ||
            agent.allowedTenantIds.includes(tenantId)),
      ),
    [agents, tenantId],
  );
  const selected = availableAgents.find((agent) => agent.slug === slug);
  const activeConversation = conversations.data?.items.find(
    (item) => item.id === conversationId,
  );
  const persistedMessageIds = useMemo(
    () => new Set(persistedMessages.map((item) => item.id)),
    [persistedMessages],
  );
  const layoutStyle = {
    "--studio-left": `${leftWidth}px`,
    "--studio-right": `${rightWidth}px`,
  } as CSSProperties;
  useEffect(() => {
    if (!slug && availableAgents[0]) setSlug(availableAgents[0].slug);
  }, [availableAgents, slug]);
  useEffect(
    () => setHistoryPage(1),
    [slug, tenantId, showArchived, conversationSearch, labelFilter],
  );
  useEffect(() => {
    setTaskId("");
    setConversationId("");
    chat.setMessages([]);
    setConversationError("");
  }, [slug, tenantId]);
  useEffect(() => {
    if (!taskId || !tenantId || !slug) {
      setTrajectory(null);
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const run = await platformApi.agentRun(token, tenantId, slug, taskId);
        if (alive) setTrajectory(run);
      } catch {
        if (alive) setTrajectory(null);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), isBusy ? 1200 : 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [isBusy, slug, taskId, tenantId, token]);
  useEffect(() => {
    if (conversationId && !isBusy) {
      void conversations.refresh();
      void conversationEvents.refresh();
    }
  }, [
    conversationEvents.refresh,
    conversationId,
    conversations.refresh,
    isBusy,
  ]);
  useEffect(() => {
    const pendingConversationId = pendingAssistantPersistence.current;
    const last = chat.messages.at(-1);
    if (
      !pendingConversationId ||
      isBusy ||
      !tenantId ||
      !last ||
      last.role !== "assistant"
    )
      return;
    const content = last.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim();
    if (!content && !chat.error && !generationCancelled.current) return;
    pendingAssistantPersistence.current = undefined;
    const clientRequestId = pendingAssistantClientRequestId.current;
    void platformApi
      .appendStudioMessage(token, pendingConversationId, {
        tenantId,
        role: "assistant",
        content:
          content ||
          (generationCancelled.current
            ? "本次生成已停止。"
            : "本次 Agent 调用未返回可展示的回复，请重试或检查运行轨迹。"),
        status: generationCancelled.current
          ? "cancelled"
          : chat.error
            ? "failed"
            : "completed",
        taskId: taskId || undefined,
        errorCode: chat.error
          ? "REMOTE_STREAM_ERROR"
          : generationCancelled.current
            ? "USER_CANCELLED"
            : undefined,
        clientRequestId,
      })
      .then((persisted) => {
        generationCancelled.current = false;
        pendingAssistantClientRequestId.current = undefined;
        setPersistedMessages((current) => [...current, persisted]);
        chat.setMessages((current) =>
          current.map((item, index) =>
            index === current.length - 1 && item.role === "assistant"
              ? { ...item, id: persisted.id }
              : item,
          ),
        );
        return conversations.refresh();
      })
      .catch((error) => {
        generationCancelled.current = false;
        persistenceQueue.enqueue({
          type: "append-message",
          tenantId,
          conversationId: pendingConversationId,
          payload: {
            tenantId,
            role: "assistant",
            content:
              content ||
              "本次 Agent 调用未返回可展示的回复，请重试或检查运行轨迹。",
            status: chat.error ? "failed" : "completed",
            taskId: taskId || undefined,
            errorCode: chat.error ? "REMOTE_STREAM_ERROR" : undefined,
            clientRequestId,
          },
        });
        pendingAssistantClientRequestId.current = undefined;
        setConversationError(
          error instanceof Error ? error.message : "保存 Agent 回复失败。",
        );
      });
  }, [
    chat,
    chat.error,
    chat.messages,
    conversations.refresh,
    isBusy,
    taskId,
    tenantId,
    token,
    persistenceQueue,
  ]);
  useEffect(() => {
    const pending = pendingUserIdentity.current;
    if (!pending) return;
    const user = [...chat.messages].reverse().find(
      (item) =>
        item.role === "user" &&
        item.parts
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n")
          .trim() === pending.content,
    );
    if (!user || user.id === pending.persistentId) return;
    pendingUserIdentity.current = undefined;
    chat.setMessages((current) =>
      current.map((item) =>
        item.id === user.id ? { ...item, id: pending.persistentId } : item,
      ),
    );
  }, [chat, chat.messages]);
  const startNewConversation = () => {
    if (isBusy) chat.stop();
    chat.clearError();
    chat.setMessages([]);
    setTaskId("");
    setConversationId("");
    setPersistedMessages([]);
    setActiveLabels([]);
    pendingAssistantPersistence.current = undefined;
    pendingAssistantClientRequestId.current = undefined;
    setTrajectory(null);
    setConversationError("");
    setStreamPhase("idle");
    transcriptScroll.markConversationChanged();
    requestAnimationFrame(() => composerRef.current?.focus());
  };
  const openConversation = async (conversation: StudioConversation) => {
    if (isBusy || !tenantId) return;
    setConversationLoading(true);
    setConversationError("");
    try {
      const detail = await platformApi.studioConversation(
        token,
        tenantId,
        conversation.id,
      );
      setConversationId(detail.id);
      setTaskId(detail.lastTaskId ?? "");
      setPersistedMessages(detail.messages);
      setActiveLabels(detail.labels ?? []);
      chat.clearError();
      chat.setMessages(transcriptToMessages(detail.messages));
      transcriptScroll.markConversationChanged();
    } catch (error) {
      setConversationError(
        error instanceof Error ? error.message : "读取会话失败。",
      );
    } finally {
      setConversationLoading(false);
    }
  };
  const renameConversation = async (conversation: StudioConversation) => {
    if (!tenantId || !renameValue.trim()) return;
    await platformApi.updateStudioConversation(token, conversation.id, {
      tenantId,
      title: renameValue.trim(),
    });
    setRenamingTaskId("");
    await conversations.refresh();
  };
  const archiveConversation = async (conversation: StudioConversation) => {
    if (!tenantId) return;
    await platformApi.updateStudioConversation(token, conversation.id, {
      tenantId,
      status: conversation.status === "archived" ? "active" : "archived",
    });
    if (
      conversationId === conversation.id &&
      conversation.status !== "archived"
    )
      startNewConversation();
    await conversations.refresh();
  };
  const deleteConversation = async (conversation: StudioConversation) => {
    if (!tenantId) return;
    try {
      await platformApi.updateStudioConversation(token, conversation.id, {
        tenantId,
        status: "deleted",
      });
      if (conversationId === conversation.id) startNewConversation();
      await conversations.refresh();
    } catch (error) {
      setConversationError(
        error instanceof Error ? error.message : "删除会话失败。",
      );
    }
  };
  const send = async (overrideMessage?: string) => {
    const message = (overrideMessage ?? prompt).trim();
    if (!message || isBusy || !slug || !token || !tenantId) return;
    generationCancelled.current = false;
    draft.clear();
    setConversationError("");
    setStreamPhase("connecting");
    try {
      const current = conversationId
        ? { id: conversationId }
        : await platformApi.createStudioConversation(token, {
            tenantId,
            agentSlug: slug,
            title: message,
          });
      if (!conversationId) setConversationId(current.id);
      const persistedUser = await platformApi.appendStudioMessage(
        token,
        current.id,
        {
          tenantId,
          role: "user",
          content: message,
          status: "completed",
          clientRequestId: crypto.randomUUID(),
        },
      );
      setPersistedMessages((items) => [...items, persistedUser]);
      pendingUserIdentity.current = {
        content: message,
        persistentId: persistedUser.id,
      };
      pendingAssistantPersistence.current = current.id;
      pendingAssistantClientRequestId.current = crypto.randomUUID();
      await chat.sendMessage({ text: message });
    } catch (error) {
      setConversationError(
        error instanceof Error ? error.message : "发送失败，请稍后重试。",
      );
      setStreamPhase("error");
    }
  };
  const stopGeneration = async () => {
    generationCancelled.current = true;
    if (chat.messages.at(-1)?.role !== "assistant") {
      pendingAssistantPersistence.current = undefined;
      pendingAssistantClientRequestId.current = undefined;
    }
    chat.stop();
    setStreamPhase("idle");
    // The stream is aborted client-side. Cancellation remains available from
    // the task center, where it follows the same authenticated proxy policy.
    if (conversationId && tenantId) {
      try {
        const message = await platformApi.appendStudioMessage(
          token,
          conversationId,
          {
            tenantId,
            role: "system",
            content: "用户停止了本次生成。",
            status: "cancelled",
            taskId: taskId || undefined,
          },
        );
        setPersistedMessages((current) => [...current, message]);
      } catch {
        // A cancelled stream remains usable even if its optional timeline note failed.
      }
    }
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isBusy) {
        event.preventDefault();
        void stopGeneration();
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "o"
      ) {
        event.preventDefault();
        composerRef.current?.focus();
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "n"
      ) {
        event.preventDefault();
        startNewConversation();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isBusy, startNewConversation, stopGeneration]);
  const copyMessage = async (text: string) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  };
  const forkFromMessage = async (message: UIMessage) => {
    if (!conversationId || !tenantId) return;
    const source = persistedMessages.find((item) => item.id === message.id);
    if (!source) {
      setConversationError("该消息仍在保存，请稍后再创建分支。");
      return;
    }
    try {
      const fork = await platformApi.forkStudioConversation(
        token,
        conversationId,
        {
          tenantId,
          throughSequence: source.sequence,
        },
      );
      setConversationId(fork.id);
      // A fork preserves the visible transcript, not the remote A2A task. The
      // transport replays bounded context for its first turn.
      setTaskId("");
      setPersistedMessages(fork.messages);
      chat.setMessages(transcriptToMessages(fork.messages));
      await conversations.refresh();
    } catch (error) {
      setConversationError(
        error instanceof Error ? error.message : "创建对话分支失败。",
      );
    }
  };
  const editMessage = async (message: UIMessage, content: string) => {
    if (!conversationId || !tenantId) return;
    const source = persistedMessages.find((item) => item.id === message.id);
    if (!source) {
      setConversationError("该消息仍在保存，请稍后再编辑。");
      return;
    }
    try {
      const fork = await platformApi.forkStudioConversation(
        token,
        conversationId,
        {
          tenantId,
          throughSequence: Math.max(0, source.sequence - 1),
        },
      );
      setConversationId(fork.id);
      setTaskId("");
      setPersistedMessages(fork.messages);
      chat.setMessages(transcriptToMessages(fork.messages));
      draft.setValue(content, "recovery");
      await conversations.refresh();
      requestAnimationFrame(() => composerRef.current?.focus());
    } catch (error) {
      setConversationError(
        error instanceof Error ? error.message : "创建编辑分支失败。",
      );
    }
  };
  const retryMessage = async (message: UIMessage) => {
    const index = chat.messages.findIndex((item) => item.id === message.id);
    const user = [...chat.messages.slice(0, index)]
      .reverse()
      .find((item) => item.role === "user");
    const content = user?.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim();
    if (!content) {
      setConversationError("没有找到可重新生成的上一条用户问题。");
      return;
    }
    await send(content);
  };
  const rateMessage = async (message: UIMessage, rating: -1 | 1) => {
    if (!conversationId || !tenantId || !persistedMessageIds.has(message.id)) {
      setConversationError("消息仍在保存，请稍后再提交反馈。");
      return;
    }
    try {
      await platformApi.studioMessageFeedback(
        token,
        conversationId,
        message.id,
        {
          tenantId,
          rating,
        },
      );
    } catch (error) {
      setConversationError(
        error instanceof Error ? error.message : "保存反馈失败。",
      );
    }
  };
  const showMessageHistory = async (message: UIMessage) => {
    if (!persistedMessageIds.has(message.id)) {
      setConversationError("该消息仍在保存，请稍后再查看编辑记录。");
      return;
    }
    setRevisionMessageId(message.id);
  };
  const exportConversation = async () => {
    if (!conversationId || !tenantId) return;
    try {
      const { blob, filename } = await downloadStudioConversation(
        token,
        tenantId,
        conversationId,
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (error) {
      setConversationError(
        error instanceof Error ? error.message : "导出会话失败。",
      );
    }
  };
  const updateConversationLabels = async (labelIds: string[]) => {
    if (!conversationId || !tenantId) return;
    try {
      const next = await platformApi.replaceStudioConversationLabels(
        token,
        conversationId,
        { tenantId, labelIds },
      );
      setActiveLabels(next);
      await conversations.refresh();
    } catch (error) {
      setConversationError(
        error instanceof Error ? error.message : "保存标签失败。",
      );
    }
  };
  const createLabel = async () => {
    if (!tenantId || !newLabelName.trim()) return;
    try {
      const label = await platformApi.createStudioLabel(token, {
        tenantId,
        name: newLabelName.trim(),
        color: newLabelColor,
      });
      setNewLabelName("");
      await labels.refresh();
      if (conversationId)
        await updateConversationLabels([
          ...activeLabels.map((item) => item.id),
          label.id,
        ]);
    } catch (error) {
      setConversationError(
        error instanceof Error ? error.message : "创建标签失败。",
      );
    }
  };
  const deleteLabel = async (label: StudioLabel) => {
    if (!tenantId) return;
    try {
      await platformApi.deleteStudioLabel(token, tenantId, label.id);
      setActiveLabels((current) =>
        current.filter((item) => item.id !== label.id),
      );
      if (labelFilter === label.id) setLabelFilter("");
      await labels.refresh();
      await conversations.refresh();
    } catch (error) {
      setConversationError(
        error instanceof Error ? error.message : "删除标签失败。",
      );
    }
  };
  const adjustWidth = (edge: "left" | "right", amount: number) =>
    edge === "left"
      ? setLeftWidth((value) => Math.max(248, Math.min(420, value + amount)))
      : setRightWidth((value) => Math.max(228, Math.min(420, value + amount)));
  const beginResize =
    (edge: "left" | "right") => (event: PointerEvent<HTMLDivElement>) => {
      if (window.matchMedia("(max-width: 1100px)").matches) return;
      const container = studioRef.current;
      if (!container) return;
      event.preventDefault();
      const startX = event.clientX;
      const initial = edge === "left" ? leftWidth : rightWidth;
      const rect = container.getBoundingClientRect();
      setDragging(edge);
      const move = (pointer: globalThis.PointerEvent) => {
        const max =
          edge === "left"
            ? Math.max(248, rect.width - rightWidth - 540)
            : Math.max(228, rect.width - leftWidth - 540);
        const next =
          edge === "left"
            ? initial + pointer.clientX - startX
            : initial - pointer.clientX + startX;
        (edge === "left" ? setLeftWidth : setRightWidth)(
          Math.max(edge === "left" ? 248 : 228, Math.min(max, next)),
        );
      };
      const stop = () => {
        setDragging(null);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", stop);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", stop, { once: true });
    };
  const phaseLabel =
    streamPhase === "connecting"
      ? "正在连接 Agent"
      : streamPhase === "receiving"
        ? "正在生成回复"
        : "";
  return (
    <>
      <div ref={studioRef} className={styles.agentStudio} style={layoutStyle}>
        <aside
          className={`${styles.studioSidebar} ${settingsOpen ? styles.studioSidebarOpen : ""}`}
          aria-label="Agent 调用配置"
        >
          <div className={styles.studioBrand}>
            <span>Agent Studio</span>
            <Tag color="blue">A2A + LangGraph</Tag>
          </div>
          <Typography.Text type="secondary">
            使用登录身份安全代理真实 A2A 调用；调用凭据不会进入浏览器。
          </Typography.Text>
          <label>
            租户
            <Select
              value={tenantId || undefined}
              options={tenants.map((tenant) => ({
                value: tenant.id,
                label: tenant.displayName,
              }))}
              onChange={setSelectedTenantId}
            />
          </label>
          <label>
            Agent
            <Select
              value={slug || undefined}
              options={availableAgents.map((agent) => ({
                value: agent.slug,
                label: agent.displayName,
              }))}
              onChange={setSlug}
            />
          </label>
          <div className={styles.studioAgentCard}>
            <b>{selected?.displayName ?? "尚未选择 Agent"}</b>
            <span>
              {selected?.description ?? "请选择具备健康实例的 Agent。"}
            </span>
            <Tag color={selected?.healthStatus === "healthy" ? "blue" : "gold"}>
              {selected?.healthStatus === "healthy"
                ? "可调用"
                : (selected?.healthStatus ?? "unknown")}
            </Tag>
          </div>
          <Button
            type="text"
            icon={<SettingOutlined />}
            aria-label="关闭 Agent 调用配置"
            onClick={() => setSettingsOpen(false)}
          >
            关闭配置
          </Button>
          {settingsOpen && (
            <div className={styles.studioSettings}>
              <div className={styles.studioSettingsHeading}>
                <b>服务端安全代理</b>
              </div>
              <Typography.Text type="secondary">
                你的登录身份会校验租户与 Agent 权限；平台调用凭据仅保存在服务器环境变量中。
              </Typography.Text>
            </div>
          )}
        </aside>
        <div
          className={`${styles.studioResizer} ${dragging === "left" ? styles.studioResizerActive : ""}`}
          role="separator"
          aria-orientation="vertical"
          aria-label="调整调用配置面板宽度"
          tabIndex={0}
          onPointerDown={beginResize("left")}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") adjustWidth("left", -16);
            if (event.key === "ArrowRight") adjustWidth("left", 16);
          }}
        />
        <main className={styles.studioConversation}>
          <header className={styles.studioHeader}>
            <div>
              <b>
                {activeConversation?.title ??
                  selected?.displayName ??
                  "选择 Agent 开始对话"}
              </b>
              <span>
                {taskId
                  ? `任务 ${taskId.slice(0, 8)}…`
                  : "新对话 · 首次发送后创建上下文"}
              </span>
            </div>
            <div className={styles.studioHeaderActions}>
              <Button
                className={styles.studioMobileHistoryToggle}
                size="small"
                aria-label="打开会话历史"
                icon={<MessageOutlined />}
                onClick={() => setMobileHistoryOpen(true)}
              >
                会话
              </Button>
              <Button
                size="small"
                type="text"
                icon={<SettingOutlined />}
                aria-label="打开 Agent 调用配置"
                onClick={() => setSettingsOpen(true)}
              >
                配置
              </Button>
              <Button
                size="small"
                type="text"
                icon={<PauseCircleOutlined />}
                aria-label="打开运行轨迹"
                onClick={() => setTraceOpen(true)}
              >
                轨迹
              </Button>
              {persistenceQueue.pendingCount ? (
                <Tooltip title="部分消息正在等待网络恢复后保存">
                  <Button
                    size="small"
                    loading={persistenceQueue.flushing}
                    icon={<ReloadOutlined />}
                    onClick={() => void persistenceQueue.flush()}
                  >
                    待同步 {persistenceQueue.pendingCount}
                  </Button>
                </Tooltip>
              ) : null}
              {activeLabels.map((label) => (
                <Tag color={label.color} key={label.id}>
                  {label.name}
                </Tag>
              ))}
              <Button
                size="small"
                icon={<TagsOutlined />}
                onClick={() => setLabelManagerOpen(true)}
                disabled={!conversationId || isBusy}
              >
                标签
              </Button>
              <Tooltip title="导出会话 Markdown">
                <Button
                  size="small"
                  aria-label="导出会话"
                  icon={<DownloadOutlined />}
                  onClick={() => void exportConversation()}
                  disabled={!conversationId || isBusy}
                />
              </Tooltip>
              {phaseLabel && (
                <span className={styles.studioLiveStatus}>
                  <LoadingOutlined spin /> {phaseLabel}
                </span>
              )}
              {trajectory && (
                <Tag
                  color={
                    trajectory.status === "completed"
                      ? "green"
                      : trajectory.status === "failed"
                        ? "red"
                        : "blue"
                  }
                >
                  {statusLabel(trajectory.status)}
                </Tag>
              )}
              {isBusy ? (
                <Button
                  size="small"
                  icon={<StopOutlined />}
                  onClick={() => void stopGeneration()}
                >
                  停止
                </Button>
              ) : (
                <Button
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={startNewConversation}
                >
                  新对话
                </Button>
              )}
            </div>
          </header>
          <div className={styles.studioChatShell}>
            <aside
              className={`${styles.studioHistory} ${mobileHistoryOpen ? styles.studioHistoryMobileOpen : ""}`}
              aria-label="会话管理"
            >
              <div className={styles.studioHistoryHeader}>
                <div className={styles.studioHistoryBrand}>
                  <b>A2A Hub</b>
                  <span>在线调试</span>
                </div>
                <div>
                  <Tooltip title="新建对话">
                    <Button
                      aria-label="新建对话"
                      type="text"
                      icon={<PlusOutlined />}
                      onClick={() => {
                        startNewConversation();
                        setMobileHistoryOpen(false);
                      }}
                      disabled={isBusy}
                    />
                  </Tooltip>
                  <Button
                    className={styles.studioMobileHistoryClose}
                    aria-label="关闭会话历史"
                    type="text"
                    onClick={() => setMobileHistoryOpen(false)}
                  >
                    关闭
                  </Button>
                </div>
              </div>
              <button
                className={`${styles.studioHistoryToggle} ${showArchived ? styles.studioHistoryToggleActive : ""}`}
                type="button"
                onClick={() => setShowArchived((value) => !value)}
              >
                {showArchived ? "显示进行中的会话" : "显示已归档会话"}
              </button>
              <Input
                aria-label="搜索会话"
                className={styles.studioHistorySearch}
                size="small"
                allowClear
                placeholder="搜索会话"
                value={conversationSearch}
                onChange={(event) => setConversationSearch(event.target.value)}
              />
              <Select
                aria-label="按标签筛选会话"
                className={styles.studioHistoryLabelFilter}
                size="small"
                allowClear
                placeholder="按标签筛选"
                value={labelFilter || undefined}
                options={labels.data?.map((label) => ({
                  value: label.id,
                  label: label.name,
                }))}
                onChange={(value) => setLabelFilter(value ?? "")}
              />
              <div className={styles.studioHistoryList}>
                {conversations.loading || conversationLoading ? (
                  <div className={styles.studioHistoryLoading}>
                    <LoadingOutlined spin /> 读取会话
                  </div>
                ) : conversations.data?.items.length ? (
                  conversations.data.items.map((conversation) => (
                    <div
                      className={`${styles.studioHistoryItem} ${conversation.id === conversationId ? styles.studioHistoryItemActive : ""}`}
                      key={conversation.id}
                    >
                      {renamingTaskId === conversation.id ? (
                        <form
                          onSubmit={(event) => {
                            event.preventDefault();
                            void renameConversation(conversation);
                          }}
                        >
                          <Input
                            size="small"
                            autoFocus
                            value={renameValue}
                            onChange={(event) =>
                              setRenameValue(event.target.value)
                            }
                            onBlur={() => setRenamingTaskId("")}
                          />
                        </form>
                      ) : (
                        <button
                          type="button"
                          className={styles.studioHistorySelect}
                          onClick={() => {
                            void openConversation(conversation);
                            setMobileHistoryOpen(false);
                          }}
                          disabled={isBusy}
                        >
                          <b>{conversation.title}</b>
                          <span>{conversation.preview}</span>
                          <small>{timeLabel(conversation.updatedAt)}</small>
                        </button>
                      )}
                      <div className={styles.studioHistoryActions}>
                        <Tooltip title="重命名">
                          <Button
                            aria-label={`重命名 ${conversation.title}`}
                            type="text"
                            size="small"
                            icon={<EditOutlined />}
                            onClick={() => {
                              setRenamingTaskId(conversation.id);
                              setRenameValue(conversation.title);
                            }}
                          />
                        </Tooltip>
                        <Tooltip
                          title={
                            conversation.status === "archived"
                              ? "恢复会话"
                              : "归档会话"
                          }
                        >
                          <Button
                            aria-label={`${conversation.status === "archived" ? "恢复" : "归档"} ${conversation.title}`}
                            type="text"
                            size="small"
                            icon={
                              conversation.status === "archived" ? (
                                <ReloadOutlined />
                              ) : (
                                <InboxOutlined />
                              )
                            }
                            onClick={() =>
                              void archiveConversation(conversation)
                            }
                          />
                        </Tooltip>
                        <Popconfirm
                          title="删除这个会话？"
                          description="删除后不会在普通会话列表显示。"
                          okText="删除"
                          cancelText="取消"
                          onConfirm={() =>
                            void deleteConversation(conversation)
                          }
                        >
                          <Button
                            aria-label={`删除 ${conversation.title}`}
                            type="text"
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                          />
                        </Popconfirm>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className={styles.studioHistoryEmpty}>
                    还没有可恢复的会话。发送第一条消息后会自动保存。
                  </div>
                )}
              </div>
              {conversations.data && conversations.data.totalPages > 1 && (
                <div className={styles.studioHistoryPagination}>
                  <Button
                    type="text"
                    size="small"
                    aria-label="上一页会话"
                    icon={<LeftOutlined />}
                    disabled={conversations.data.page <= 1 || isBusy}
                    onClick={() =>
                      setHistoryPage((page) => Math.max(1, page - 1))
                    }
                  />
                  <span>
                    {conversations.data.page} / {conversations.data.totalPages}
                  </span>
                  <Button
                    type="text"
                    size="small"
                    aria-label="下一页会话"
                    icon={<RightOutlined />}
                    disabled={
                      conversations.data.page >=
                        conversations.data.totalPages || isBusy
                    }
                    onClick={() => setHistoryPage((page) => page + 1)}
                  />
                </div>
              )}
            </aside>
            {mobileHistoryOpen && (
              <button
                className={styles.studioHistoryBackdrop}
                type="button"
                aria-label="关闭会话历史"
                onClick={() => setMobileHistoryOpen(false)}
              />
            )}
            <section className={styles.studioDialogue} aria-label="Agent 对话">
              {(chat.error || conversationError) && (
                <div className={styles.studioError} role="alert">
                  <b>本次调用未完成</b>
                  <span>
                    {conversationError ||
                      chat.error?.message ||
                      "请检查 Agent、API Key 或网络后重试。"}
                  </span>
                  <Button
                    size="small"
                    type="link"
                    onClick={() => {
                      setConversationError("");
                      chat.clearError();
                    }}
                  >
                    关闭提示
                  </Button>
                </div>
              )}
              <div
                ref={transcriptScroll.scrollRef}
                className={styles.studioMessages}
              >
                {!chat.messages.length && (
                  <div className={styles.studioEmpty}>
                    <span className={styles.studioEmptyMark}>
                      <MessageOutlined />
                    </span>
                    <h2>从一个研究问题开始</h2>
                    <p>
                      例如：分析 AAPL
                      近期走势、新闻风险，并说明我还需要验证什么。缺少标的或观点时，Agent
                      会继续追问而不是猜测。
                    </p>
                    <div className={styles.studioSuggestions}>
                      <button
                        type="button"
                        onClick={() =>
                          draft.setValue(
                            "分析 AAPL 的近期走势、关键风险和需要关注的指标",
                            "suggestion",
                          )
                        }
                      >
                        分析 AAPL 近期走势
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          draft.setValue(
                            "我想研究一家科技公司，你还需要我补充什么？",
                            "suggestion",
                          )
                        }
                      >
                        从自然语言开始
                      </button>
                    </div>
                  </div>
                )}
                {chat.messages.map((message) => (
                  <article
                    className={
                      message.role === "user"
                        ? styles.studioUserMessage
                        : styles.studioAgentMessage
                    }
                    key={message.id}
                  >
                    <div className={styles.messageRole}>
                      {message.role === "user"
                        ? "你"
                        : (selected?.displayName ?? "Agent")}
                      {message.role === "assistant" &&
                      isBusy &&
                      message === chat.messages.at(-1) ? (
                        <LoadingOutlined spin />
                      ) : null}
                    </div>
                    {message.parts
                      .filter((part) => part.type === "text")
                      .map((part, index) => (
                        <StreamingMarkdown
                          key={index}
                          markdown={part.text}
                          busy={
                            isBusy &&
                            message.role === "assistant" &&
                            message === chat.messages.at(-1)
                          }
                        />
                      ))}
                    {message.role !== "assistant" ||
                    !isBusy ||
                    message !== chat.messages.at(-1) ? (
                      <StudioMessageActions
                        message={message}
                        busy={isBusy}
                        handlers={{
                          onCopy: copyMessage,
                          onEdit: editMessage,
                          onRetry: retryMessage,
                          onFork: forkFromMessage,
                          onFeedback: rateMessage,
                          onHistory: showMessageHistory,
                        }}
                      />
                    ) : null}
                  </article>
                ))}
                {isBusy && chat.messages.at(-1)?.role === "user" && (
                  <article className={styles.studioThinking}>
                    <LoadingOutlined spin />
                    <span>{phaseLabel || "正在准备回复"}</span>
                  </article>
                )}
                {transcriptScroll.hasUnreadBelow && (
                  <Button
                    className={styles.studioJumpToLatest}
                    size="small"
                    onClick={() => transcriptScroll.scrollToLatest()}
                  >
                    跳至最新回复
                  </Button>
                )}
              </div>
              <form
                className={styles.studioComposer}
                onSubmit={(event) => {
                  event.preventDefault();
                  void send();
                }}
              >
                <Input.TextArea
                  ref={composerRef}
                  value={prompt}
                  onChange={(event) => draft.setValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                  placeholder={
                    !token
                      ? "请先登录后使用在线调试"
                      : isBusy
                        ? "Agent 正在回应，可停止当前生成"
                        : "给 Agent 发送消息…"
                  }
                  autoSize={{ minRows: 1, maxRows: 7 }}
                  disabled={!token || !slug || isBusy}
                />
                {isBusy ? (
                  <Button
                    type="default"
                    htmlType="button"
                    icon={<StopOutlined />}
                    onClick={() => void stopGeneration()}
                  >
                    停止
                  </Button>
                ) : (
                  <Button
                    type="primary"
                    htmlType="submit"
                    icon={<SendOutlined />}
                    disabled={!prompt.trim() || !token || !slug}
                  >
                    发送
                  </Button>
                )}
                <span className={styles.studioComposerHint}>
                  {draft.restored
                    ? "已恢复本会话草稿 · Enter 发送"
                    : "Enter 发送 · Shift + Enter 换行 · Esc 停止"}
                </span>
              </form>
            </section>
          </div>
        </main>
        <div
          className={`${styles.studioResizer} ${dragging === "right" ? styles.studioResizerActive : ""}`}
          role="separator"
          aria-orientation="vertical"
          aria-label="调整运行轨迹面板宽度"
          tabIndex={0}
          onPointerDown={beginResize("right")}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") adjustWidth("right", 16);
            if (event.key === "ArrowRight") adjustWidth("right", -16);
          }}
        />
        <aside
          className={`${styles.studioTrace} ${traceOpen ? styles.studioTraceOpen : ""}`}
          aria-label="运行轨迹"
        >
          <div className={styles.traceTitle}>
            <div>
              <b>运行轨迹</b>
              <span>显示 LangGraph 节点与工具状态</span>
            </div>
            <Button
              size="small"
              type="text"
              aria-label="关闭运行轨迹"
              onClick={() => setTraceOpen(false)}
            >
              关闭
            </Button>
          </div>
          {!trajectory && (
            <div className={styles.traceEmpty}>
              <PauseCircleOutlined />
              <p>
                {conversationId
                  ? "此会话暂无运行节点；下方保留了会话操作时间线。"
                  : "首次调用后会在这里展示安全的执行轨迹。"}
              </p>
            </div>
          )}
          {trajectory?.events.map((event) => (
            <div className={styles.traceEvent} key={event.sequence}>
              <span
                className={`${styles.traceDot} ${styles[`trace_${event.kind}`] ?? ""}`}
              />
              <div>
                <b>{event.node.replaceAll("_", " ")}</b>
                <small>{event.kind.replaceAll("_", " · ")}</small>
                {event.kind === "interrupt" && (
                  <p>
                    等待补充：
                    {Array.isArray(event.payload.missing)
                      ? event.payload.missing.join("、")
                      : "需要更多信息"}
                  </p>
                )}
              </div>
            </div>
          ))}
          {!trajectory && conversationEvents.data?.length ? (
            <div className={styles.studioEventTimeline}>
              <b>会话时间线</b>
              {conversationEvents.data.slice(0, 12).map((event) => (
                <div className={styles.studioEventTimelineItem} key={event.id}>
                  <span />
                  <div>
                    <strong>{event.kind.replaceAll("_", " · ")}</strong>
                    <small>{timeLabel(event.createdAt)}</small>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </aside>
      </div>
      <Drawer
        title="消息编辑记录"
        placement="right"
        width={380}
        open={Boolean(revisionMessageId)}
        onClose={() => setRevisionMessageId("")}
      >
        {revisions.loading ? (
          <div className={styles.studioRevisionEmpty}>
            <LoadingOutlined spin /> 正在读取编辑记录
          </div>
        ) : revisions.data?.length ? (
          <div className={styles.studioRevisionList}>
            {revisions.data.map((revision) => (
              <article key={revision.id} className={styles.studioRevisionItem}>
                <header>
                  <b>版本 {revision.revision}</b>
                  <time>{timeLabel(revision.createdAt)}</time>
                </header>
                <p>{revision.content}</p>
              </article>
            ))}
          </div>
        ) : (
          <div className={styles.studioRevisionEmpty}>
            这条消息还没有编辑记录。
          </div>
        )}
      </Drawer>
      <Drawer
        title="会话标签"
        placement="right"
        width={380}
        open={labelManagerOpen}
        onClose={() => setLabelManagerOpen(false)}
      >
        <form
          className={styles.studioLabelCreate}
          onSubmit={(event) => {
            event.preventDefault();
            void createLabel();
          }}
        >
          <Input
            value={newLabelName}
            placeholder="新标签名称"
            onChange={(event) => setNewLabelName(event.target.value)}
          />
          <Select
            aria-label="新标签颜色"
            value={newLabelColor}
            options={[
              "blue",
              "cyan",
              "purple",
              "gold",
              "green",
              "red",
              "gray",
            ].map((color) => ({ value: color, label: color }))}
            onChange={setNewLabelColor}
          />
          <Button
            htmlType="submit"
            type="primary"
            disabled={!newLabelName.trim()}
          >
            新建
          </Button>
        </form>
        <div className={styles.studioLabelList}>
          {labels.data?.map((label) => (
            <div className={styles.studioLabelRow} key={label.id}>
              <Checkbox
                checked={activeLabels.some((item) => item.id === label.id)}
                onChange={(event) => {
                  const selected = activeLabels.map((item) => item.id);
                  void updateConversationLabels(
                    event.target.checked
                      ? [...selected, label.id]
                      : selected.filter((id) => id !== label.id),
                  );
                }}
              >
                <Tag color={label.color}>{label.name}</Tag>
              </Checkbox>
              <Popconfirm
                title={`删除标签“${label.name}”？`}
                description="标签会从所有会话移除。"
                okText="删除"
                cancelText="取消"
                onConfirm={() => void deleteLabel(label)}
              >
                <Button
                  type="text"
                  danger
                  size="small"
                  aria-label={`删除标签 ${label.name}`}
                  icon={<DeleteOutlined />}
                />
              </Popconfirm>
            </div>
          ))}
          {!labels.loading && !labels.data?.length && (
            <div className={styles.studioRevisionEmpty}>还没有标签。</div>
          )}
        </div>
      </Drawer>
    </>
  );
}
