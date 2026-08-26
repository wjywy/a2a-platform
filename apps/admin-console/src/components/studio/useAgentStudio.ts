import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import type { TextAreaRef } from "antd/es/input/TextArea";
import { useApp } from "../../AppContext";
import {
  downloadStudioConversation,
  platformApi,
  type AgentRunTrajectory,
  type StudioConversation,
  type StudioConversationEvent,
  type StudioLabel,
  type StudioMessage,
  type StudioMessageRevision,
} from "../../api";
import { A2AChatTransport } from "../../a2a-chat-transport";
import { useAsync } from "../../hooks";
import { useToast } from "../../ui";
import { useStudioDraft } from "./useStudioDraft";
import { useStudioPersistenceQueue } from "./useStudioPersistenceQueue";
import { useTranscriptScroll } from "./useTranscriptScroll";
import {
  canSubmitMessage,
  composerPlaceholder,
  findTaskId,
  groupConversations,
  messageText,
  phaseLabel,
  selectAvailableAgents,
  transcriptToMessages,
  type StudioOperation,
  type StudioStreamPhase,
} from "./studio-utils";

type PendingAssistant = {
  conversationId: string;
  clientRequestId: string;
};

type PendingUserIdentity = {
  content: string;
  persistentId: string;
};

type StreamConfig = {
  slug: string;
  token: string;
  tenantId: string;
  taskId: string;
  onEvent?: (event: unknown) => void;
  onStatus?: (
    status: "connecting" | "receiving" | "completed" | "error",
  ) => void;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function requestAnimationFocus(ref: RefObject<TextAreaRef | null>) {
  requestAnimationFrame(() => ref.current?.focus());
}

export function useAgentStudio() {
  const { token, agents, tenants, selectedTenantId, setSelectedTenantId } =
    useApp();
  const toast = useToast();

  const activeTenants = useMemo(
    () => tenants.filter((tenant) => tenant.status === "active"),
    [tenants],
  );
  const preferredTenant =
    activeTenants.find((tenant) => tenant.slug === "default") ??
    activeTenants[0];
  const tenantId =
    (selectedTenantId &&
      activeTenants.some((tenant) => tenant.id === selectedTenantId) &&
      selectedTenantId) ||
    preferredTenant?.id ||
    "";

  const [slug, setSlug] = useState("");
  const [taskId, setTaskId] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [persistedMessages, setPersistedMessages] = useState<StudioMessage[]>(
    [],
  );
  const [trajectory, setTrajectory] = useState<AgentRunTrajectory | null>();
  const [streamPhase, setStreamPhase] = useState<StudioStreamPhase>("idle");
  const [conversationLoading, setConversationLoading] = useState(false);
  const [conversationError, setConversationError] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [conversationSearch, setConversationSearch] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const [renamingConversationId, setRenamingConversationId] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [revisionMessageId, setRevisionMessageId] = useState("");
  const [labelFilter, setLabelFilter] = useState("");
  const [activeLabels, setActiveLabels] = useState<StudioLabel[]>([]);
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] =
    useState<StudioLabel["color"]>("gray");
  const [operation, setOperation] = useState<StudioOperation>("");
  const [lastSubmission, setLastSubmission] = useState("");

  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [traceOpen, setTraceOpen] = useState(false);
  const [labelManagerOpen, setLabelManagerOpen] = useState(false);
  const [conversationMenuOpen, setConversationMenuOpen] = useState(false);

  const composerRef = useRef<TextAreaRef>(null);
  const pendingAssistant = useRef<PendingAssistant | undefined>(undefined);
  const pendingUserIdentity = useRef<PendingUserIdentity | undefined>(
    undefined,
  );
  const generationCancelled = useRef(false);
  const streamConfig = useRef<StreamConfig>({
    slug: "",
    token: "",
    tenantId: "",
    taskId: "",
  });

  const draft = useStudioDraft(tenantId, slug, conversationId);

  const deliverQueuedMessage = useCallback(
    async (queued: {
      conversationId: string;
      payload: Parameters<typeof platformApi.appendStudioMessage>[2];
    }) => {
      await platformApi.appendStudioMessage(
        token,
        queued.conversationId,
        queued.payload,
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

  streamConfig.current = {
    slug,
    token,
    tenantId,
    taskId,
    onEvent: (event) => {
      const next = findTaskId(event);
      if (next) setTaskId(next);
    },
    onStatus: (status) => {
      setStreamPhase(status === "completed" ? "idle" : status);
    },
  };

  const transport = useMemo(
    () => new A2AChatTransport(() => streamConfig.current),
    [],
  );
  const chat = useChat({ transport, throttle: 30 });
  const isBusy = chat.status === "submitted" || chat.status === "streaming";
  const transcriptScroll = useTranscriptScroll(chat.messages, isBusy);

  const availableAgents = useMemo(
    () => selectAvailableAgents(agents, tenantId),
    [agents, tenantId],
  );
  const selectedAgent = availableAgents.find((agent) => agent.slug === slug);
  const activeConversation = conversations.data?.items.find(
    (item) => item.id === conversationId,
  );
  const historyGroups = useMemo(
    () => groupConversations(conversations.data?.items ?? []),
    [conversations.data?.items],
  );
  const persistedMessageIds = useMemo(
    () => new Set(persistedMessages.map((item) => item.id)),
    [persistedMessages],
  );

  useEffect(() => {
    if (!slug && availableAgents[0]) setSlug(availableAgents[0].slug);
  }, [availableAgents, slug]);

  useEffect(() => {
    setHistoryPage(1);
  }, [slug, tenantId, showArchived, conversationSearch, labelFilter]);

  useEffect(() => {
    setTaskId("");
    setConversationId("");
    setPersistedMessages([]);
    setActiveLabels([]);
    chat.setMessages([]);
    chat.clearError();
    setConversationError("");
    setStreamPhase("idle");
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
    const timer = window.setInterval(() => void load(), isBusy ? 1_200 : 5_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [isBusy, slug, taskId, tenantId, token]);

  useEffect(() => {
    if (!conversationId || isBusy) return;
    void conversationEvents.refresh();
  }, [conversationId, isBusy]);

  useEffect(() => {
    const pending = pendingAssistant.current;
    const last = chat.messages.at(-1);
    if (!pending || isBusy || !tenantId || !last || last.role !== "assistant") {
      return;
    }

    const content = messageText(last);
    if (!content && !chat.error && !generationCancelled.current) return;

    pendingAssistant.current = undefined;
    const status = generationCancelled.current
      ? "cancelled"
      : chat.error
        ? "failed"
        : "completed";
    const persistedContent =
      content ||
      (generationCancelled.current
        ? "本次生成已停止。"
        : "本次 Agent 调用未返回可展示的回复，请重试或检查运行轨迹。");

    void platformApi
      .appendStudioMessage(token, pending.conversationId, {
        tenantId,
        role: "assistant",
        content: persistedContent,
        status,
        taskId: taskId || undefined,
        errorCode: chat.error
          ? "REMOTE_STREAM_ERROR"
          : generationCancelled.current
            ? "USER_CANCELLED"
            : undefined,
        clientRequestId: pending.clientRequestId,
      })
      .then((persisted) => {
        generationCancelled.current = false;
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
          conversationId: pending.conversationId,
          payload: {
            tenantId,
            role: "assistant",
            content: persistedContent,
            status: chat.error ? "failed" : "completed",
            taskId: taskId || undefined,
            errorCode: chat.error ? "REMOTE_STREAM_ERROR" : undefined,
            clientRequestId: pending.clientRequestId,
          },
        });
        setConversationError(errorMessage(error, "保存 Agent 回复失败。"));
      });
  }, [
    chat.error,
    chat.messages,
    isBusy,
    taskId,
    tenantId,
    token,
    conversations.refresh,
    persistenceQueue,
  ]);

  useEffect(() => {
    const pending = pendingUserIdentity.current;
    if (!pending) return;
    const user = [...chat.messages]
      .reverse()
      .find(
        (item) => item.role === "user" && messageText(item) === pending.content,
      );
    if (!user || user.id === pending.persistentId) return;
    pendingUserIdentity.current = undefined;
    chat.setMessages((current) =>
      current.map((item) =>
        item.id === user.id ? { ...item, id: pending.persistentId } : item,
      ),
    );
  }, [chat.messages]);

  const closeTransientPanels = () => {
    setHistoryOpen(false);
    setConversationMenuOpen(false);
  };

  const startNewConversation = useCallback(() => {
    if (isBusy) chat.stop();
    chat.clearError();
    chat.setMessages([]);
    setTaskId("");
    setConversationId("");
    setPersistedMessages([]);
    setActiveLabels([]);
    pendingAssistant.current = undefined;
    pendingUserIdentity.current = undefined;
    setTrajectory(null);
    setConversationError("");
    setStreamPhase("idle");
    transcriptScroll.markConversationChanged();
    closeTransientPanels();
    requestAnimationFocus(composerRef);
  }, [chat, isBusy, transcriptScroll]);

  const openConversation = async (conversation: StudioConversation) => {
    if (isBusy || !tenantId || conversationLoading) return;
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
      closeTransientPanels();
    } catch (error) {
      setConversationError(errorMessage(error, "读取会话失败。"));
    } finally {
      setConversationLoading(false);
    }
  };

  const beginRename = (conversation: StudioConversation) => {
    if (isBusy || operation) return;
    setRenamingConversationId(conversation.id);
    setRenameValue(conversation.title);
  };

  const cancelRename = () => {
    if (operation.startsWith("rename:")) return;
    setRenamingConversationId("");
    setRenameValue("");
  };

  const renameConversation = async (conversation: StudioConversation) => {
    if (!tenantId || !renameValue.trim() || operation) return;
    const nextTitle = renameValue.trim();
    setOperation(`rename:${conversation.id}`);
    try {
      await platformApi.updateStudioConversation(token, conversation.id, {
        tenantId,
        title: nextTitle,
      });
      setRenamingConversationId("");
      setRenameValue("");
      if (conversationSearch) {
        // Keep a renamed row in view when the previous title itself was the
        // active search term. The dependency-driven query refresh uses the
        // replacement title and avoids a disorienting empty-history flash.
        setConversationSearch(nextTitle);
      } else {
        await conversations.refresh();
      }
      toast.success("会话已重命名");
    } catch (error) {
      setConversationError(errorMessage(error, "重命名会话失败，请重试。"));
    } finally {
      setOperation("");
    }
  };

  const archiveConversation = async (conversation: StudioConversation) => {
    if (!tenantId || operation || isBusy) return;
    setOperation(`archive:${conversation.id}`);
    try {
      const restoring = conversation.status === "archived";
      await platformApi.updateStudioConversation(token, conversation.id, {
        tenantId,
        status: restoring ? "active" : "archived",
      });
      if (conversationId === conversation.id && !restoring) {
        startNewConversation();
      }
      await conversations.refresh();
      toast.success(restoring ? "会话已恢复" : "会话已归档");
    } catch (error) {
      setConversationError(errorMessage(error, "更新会话状态失败，请重试。"));
    } finally {
      setOperation("");
    }
  };

  const deleteConversation = async (conversation: StudioConversation) => {
    if (!tenantId || operation || isBusy) return;
    setOperation(`delete:${conversation.id}`);
    try {
      await platformApi.updateStudioConversation(token, conversation.id, {
        tenantId,
        status: "deleted",
      });
      if (conversationId === conversation.id) startNewConversation();
      await conversations.refresh();
      toast.success("会话已删除");
    } catch (error) {
      setConversationError(errorMessage(error, "删除会话失败。"));
    } finally {
      setOperation("");
    }
  };

  const send = async (overrideMessage?: string) => {
    const content = (overrideMessage ?? draft.value).trim();
    if (
      conversationLoading ||
      !canSubmitMessage({
        text: content,
        busy: isBusy,
        token,
        slug,
        tenantId,
      })
    ) {
      return;
    }

    generationCancelled.current = false;
    setLastSubmission(content);
    draft.clear();
    setConversationError("");
    chat.clearError();
    setStreamPhase("connecting");

    try {
      const current = conversationId
        ? { id: conversationId }
        : await platformApi.createStudioConversation(token, {
            tenantId,
            agentSlug: slug,
            title: content,
          });
      if (!conversationId) setConversationId(current.id);

      const persistedUser = await platformApi.appendStudioMessage(
        token,
        current.id,
        {
          tenantId,
          role: "user",
          content,
          status: "completed",
          clientRequestId: crypto.randomUUID(),
        },
      );

      setPersistedMessages((items) => [...items, persistedUser]);
      pendingUserIdentity.current = {
        content,
        persistentId: persistedUser.id,
      };
      pendingAssistant.current = {
        conversationId: current.id,
        clientRequestId: crypto.randomUUID(),
      };
      await chat.sendMessage({ text: content });
    } catch (error) {
      setConversationError(errorMessage(error, "发送失败，请稍后重试。"));
      setStreamPhase("error");
    }
  };

  const stopGeneration = useCallback(async () => {
    if (!isBusy) return;
    generationCancelled.current = true;
    if (chat.messages.at(-1)?.role !== "assistant") {
      pendingAssistant.current = undefined;
    }
    chat.stop();
    setStreamPhase("idle");

    // The client aborts the SSE immediately. A timeline note is persisted
    // separately so the conversation remains explainable and can continue.
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
        // Stopping must restore the composer even if this optional note fails.
      }
    }
  }, [chat, conversationId, isBusy, taskId, tenantId, token]);

  const copyMessage = async (text: string) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      toast.success("已复制到剪贴板");
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
    toast.success("已复制到剪贴板");
  };

  const forkFromMessage = async (message: UIMessage) => {
    if (!conversationId || !tenantId || isBusy) return;
    const source = persistedMessages.find((item) => item.id === message.id);
    if (!source) {
      setConversationError("该消息仍在保存，请稍后再创建分支。");
      return;
    }
    try {
      const fork = await platformApi.forkStudioConversation(
        token,
        conversationId,
        { tenantId, throughSequence: source.sequence },
      );
      setConversationId(fork.id);
      setTaskId("");
      setPersistedMessages(fork.messages);
      chat.setMessages(transcriptToMessages(fork.messages));
      transcriptScroll.markConversationChanged();
      await conversations.refresh();
      toast.success("已创建会话分支");
    } catch (error) {
      setConversationError(errorMessage(error, "创建对话分支失败。"));
    }
  };

  const regenerateInBranch = async (input: {
    throughSequence: number;
    prompt: string;
    title?: string;
    successMessage: string;
  }) => {
    if (!conversationId || !tenantId || isBusy) return;
    const fork = await platformApi.forkStudioConversation(
      token,
      conversationId,
      {
        tenantId,
        throughSequence: input.throughSequence,
        title: input.title,
      },
    );
    const branchMessages = transcriptToMessages(fork.messages);
    const lastUser = [...branchMessages]
      .reverse()
      .find((item) => item.role === "user");
    if (!lastUser) throw new Error("分支中没有可重新生成的用户消息。");

    generationCancelled.current = false;
    setLastSubmission(input.prompt);
    setConversationError("");
    setConversationId(fork.id);
    setTaskId("");
    setPersistedMessages(fork.messages);
    setActiveLabels([]);
    chat.clearError();
    chat.setMessages(branchMessages);
    transcriptScroll.markConversationChanged();
    closeTransientPanels();
    streamConfig.current = { ...streamConfig.current, taskId: "" };
    pendingAssistant.current = {
      conversationId: fork.id,
      clientRequestId: crypto.randomUUID(),
    };
    setStreamPhase("connecting");
    toast.success(input.successMessage);
    await conversations.refresh();

    // Allow useChat to observe the branch transcript before regeneration so
    // the transport sends the correct bounded context instead of the source
    // conversation's trailing assistant message.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    await chat.regenerate({ messageId: lastUser.id });
  };

  const editMessage = async (message: UIMessage, content: string) => {
    if (!conversationId || !tenantId || isBusy) return;
    const source = persistedMessages.find((item) => item.id === message.id);
    if (!source) {
      setConversationError("该消息仍在保存，请稍后再编辑。");
      return;
    }
    try {
      await platformApi.updateStudioMessage(token, conversationId, source.id, {
        tenantId,
        content,
      });
      await regenerateInBranch({
        throughSequence: source.sequence,
        prompt: content,
        title: `${activeConversation?.title ?? "会话"}（编辑分支）`,
        successMessage: "已保存编辑并创建分支",
      });
    } catch (error) {
      pendingAssistant.current = undefined;
      setStreamPhase("error");
      setConversationError(errorMessage(error, "编辑并重新生成失败。"));
    }
  };

  const retryMessage = async (message: UIMessage) => {
    if (isBusy) return;
    const index = chat.messages.findIndex((item) => item.id === message.id);
    const user = [...chat.messages.slice(0, index)]
      .reverse()
      .find((item) => item.role === "user");
    const content = user ? messageText(user) : "";
    if (!content) {
      setConversationError("没有找到可重新生成的上一条用户问题。");
      return;
    }
    const source = user
      ? persistedMessages.find((item) => item.id === user.id)
      : undefined;
    if (!source) {
      setConversationError("上一条用户消息仍在保存，请稍后重试。");
      return;
    }
    try {
      await regenerateInBranch({
        throughSequence: source.sequence,
        prompt: content,
        title: `${activeConversation?.title ?? "会话"}（重试分支）`,
        successMessage: "已创建重试分支",
      });
    } catch (error) {
      pendingAssistant.current = undefined;
      setStreamPhase("error");
      setConversationError(errorMessage(error, "重新生成失败。"));
    }
  };

  const rateMessage = async (message: UIMessage, rating: -1 | 1) => {
    if (!conversationId || !tenantId || !persistedMessageIds.has(message.id)) {
      setConversationError("消息仍在保存，请稍后再提交反馈。");
      return;
    }
    const key: StudioOperation = `feedback:${message.id}`;
    if (operation) return;
    setOperation(key);
    try {
      await platformApi.studioMessageFeedback(
        token,
        conversationId,
        message.id,
        { tenantId, rating },
      );
      toast.success(rating > 0 ? "感谢你的反馈" : "已记录改进反馈");
    } catch (error) {
      setConversationError(errorMessage(error, "保存反馈失败。"));
    } finally {
      setOperation("");
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
    if (!conversationId || !tenantId || operation || isBusy) return;
    setOperation("export");
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
      toast.success("会话导出已开始");
    } catch (error) {
      setConversationError(errorMessage(error, "导出会话失败。"));
    } finally {
      setOperation("");
    }
  };

  const updateConversationLabels = async (labelIds: string[]) => {
    if (!conversationId || !tenantId || operation) return;
    setOperation("update-labels");
    try {
      const next = await platformApi.replaceStudioConversationLabels(
        token,
        conversationId,
        { tenantId, labelIds },
      );
      setActiveLabels(next);
      await conversations.refresh();
      toast.success("会话标签已更新");
    } catch (error) {
      setConversationError(errorMessage(error, "保存标签失败。"));
    } finally {
      setOperation("");
    }
  };

  const createLabel = async () => {
    if (!tenantId || !newLabelName.trim() || operation) return;
    setOperation("create-label");
    try {
      const label = await platformApi.createStudioLabel(token, {
        tenantId,
        name: newLabelName.trim(),
        color: newLabelColor,
      });
      setNewLabelName("");
      await labels.refresh();
      if (conversationId) {
        await platformApi.replaceStudioConversationLabels(
          token,
          conversationId,
          {
            tenantId,
            labelIds: [...activeLabels.map((item) => item.id), label.id],
          },
        );
        setActiveLabels((current) => [...current, label]);
        await conversations.refresh();
      }
      toast.success("标签已创建");
    } catch (error) {
      setConversationError(errorMessage(error, "创建标签失败。"));
    } finally {
      setOperation("");
    }
  };

  const deleteLabel = async (label: StudioLabel) => {
    if (!tenantId || operation) return;
    try {
      await platformApi.deleteStudioLabel(token, tenantId, label.id);
      setActiveLabels((current) =>
        current.filter((item) => item.id !== label.id),
      );
      if (labelFilter === label.id) setLabelFilter("");
      await labels.refresh();
      await conversations.refresh();
      toast.success("标签已删除");
    } catch (error) {
      setConversationError(errorMessage(error, "删除标签失败。"));
    }
  };

  const dismissError = () => {
    setConversationError("");
    chat.clearError();
    if (streamPhase === "error") setStreamPhase("idle");
  };

  const retryLastSubmission = async () => {
    if (!lastSubmission || isBusy) return;
    dismissError();
    await send(lastSubmission);
  };

  const placeholder = composerPlaceholder({
    authenticated: Boolean(token),
    hasAgent: Boolean(slug),
    busy: isBusy,
    agentName: selectedAgent?.displayName,
  });
  const canSend = canSubmitMessage({
    text: draft.value,
    busy: isBusy,
    token,
    slug,
    tenantId,
  });

  return {
    identity: {
      token,
      tenantId,
      activeTenants,
      selectedTenantId,
      setSelectedTenantId,
    },
    agent: {
      slug,
      setSlug,
      availableAgents,
      selected: selectedAgent,
    },
    conversation: {
      id: conversationId,
      taskId,
      active: activeConversation,
      persistedMessages,
      activeLabels,
      loading: conversationLoading,
      error: conversationError || chat.error?.message || "",
      lastSubmission,
    },
    history: {
      state: conversations,
      groups: historyGroups,
      search: conversationSearch,
      setSearch: setConversationSearch,
      showArchived,
      setShowArchived,
      page: historyPage,
      setPage: setHistoryPage,
      labelFilter,
      setLabelFilter,
      renamingConversationId,
      renameValue,
      setRenameValue,
      beginRename,
      cancelRename,
    },
    labels: {
      state: labels,
      newName: newLabelName,
      setNewName: setNewLabelName,
      newColor: newLabelColor,
      setNewColor: setNewLabelColor,
    },
    revisions: {
      state: revisions,
      messageId: revisionMessageId,
      setMessageId: setRevisionMessageId,
    },
    trajectory: {
      value: trajectory,
      events: conversationEvents,
    },
    stream: {
      phase: streamPhase,
      label: phaseLabel(streamPhase),
      busy: isBusy,
      status: chat.status,
    },
    chat: {
      messages: chat.messages,
      error: chat.error,
      clearError: chat.clearError,
    },
    draft: {
      value: draft.value,
      restored: draft.restored,
      setValue: draft.setValue,
      clear: draft.clear,
      placeholder,
      canSend,
      ref: composerRef,
    },
    transcript: transcriptScroll,
    persistence: persistenceQueue,
    panels: {
      historyOpen,
      setHistoryOpen,
      settingsOpen,
      setSettingsOpen,
      traceOpen,
      setTraceOpen,
      labelManagerOpen,
      setLabelManagerOpen,
      conversationMenuOpen,
      setConversationMenuOpen,
    },
    operation,
    actions: {
      startNewConversation,
      openConversation,
      renameConversation,
      archiveConversation,
      deleteConversation,
      send,
      stopGeneration,
      copyMessage,
      forkFromMessage,
      editMessage,
      retryMessage,
      rateMessage,
      showMessageHistory,
      exportConversation,
      updateConversationLabels,
      createLabel,
      deleteLabel,
      dismissError,
      retryLastSubmission,
    },
  };
}

export type AgentStudioController = ReturnType<typeof useAgentStudio>;
