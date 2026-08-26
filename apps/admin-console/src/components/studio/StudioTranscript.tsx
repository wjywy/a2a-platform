import {
  ArrowDownOutlined,
  LoadingOutlined,
  ReloadOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { Button } from "antd";
import { StreamingMarkdown } from "../StreamingMarkdown";
import { StudioMessageActions } from "./StudioMessageActions";
import { useStudio } from "./StudioContext";
import { messageText } from "./studio-utils";
import styles from "./AgentStudio.module.css";

const suggestions = [
  {
    title: "分析市场信号",
    detail: "价格、新闻与风险",
    prompt: "分析 AAPL 的近期走势、关键风险和需要关注的指标",
  },
  {
    title: "验证研究观点",
    detail: "先询问缺失信息",
    prompt: "我想研究一家科技公司，请先告诉我还需要补充哪些信息",
  },
  {
    title: "检查 Agent 能力",
    detail: "列出可调用工具",
    prompt: "请说明你可以完成哪些任务、会使用哪些数据或工具",
  },
] as const;

function EmptyConversation() {
  const studio = useStudio();
  const name = studio.agent.selected?.displayName ?? "Agent";

  return (
    <section className={styles.emptyConversation} aria-label="开始新会话">
      <h1>今天想让 {name} 做什么？</h1>
      <p>
        直接描述目标。需要更多上下文时，Agent
        会继续追问，并保留完整会话与运行轨迹。
      </p>
      <div className={styles.suggestionGrid}>
        {suggestions.map((suggestion) => (
          <button
            type="button"
            key={suggestion.title}
            disabled={studio.stream.busy || !studio.agent.slug}
            onClick={() => {
              studio.draft.setValue(suggestion.prompt, "suggestion");
              requestAnimationFrame(() => studio.draft.ref.current?.focus());
            }}
          >
            <b>{suggestion.title}</b>
            <span>{suggestion.detail}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function ConversationError() {
  const studio = useStudio();
  if (!studio.conversation.error) return null;

  return (
    <div className={styles.conversationError} role="alert">
      <span className={styles.errorIcon} aria-hidden="true">
        <WarningOutlined />
      </span>
      <span className={styles.errorCopy}>
        <b>本次调用未完成</b>
        <small>{studio.conversation.error}</small>
      </span>
      <span className={styles.errorActions}>
        {studio.conversation.lastSubmission && !studio.stream.busy ? (
          <Button
            type="text"
            icon={<ReloadOutlined />}
            onClick={() => void studio.actions.retryLastSubmission()}
          >
            重试
          </Button>
        ) : null}
        <Button type="text" onClick={studio.actions.dismissError}>
          关闭
        </Button>
      </span>
    </div>
  );
}

function ConversationLoading() {
  return (
    <div
      className={styles.conversationLoading}
      role="status"
      aria-live="polite"
      aria-label="正在打开会话"
    >
      <LoadingOutlined spin aria-hidden="true" />
      <span>正在打开会话</span>
    </div>
  );
}

function ThinkingRow() {
  const studio = useStudio();
  if (!studio.stream.busy || studio.chat.messages.at(-1)?.role !== "user") {
    return null;
  }
  return (
    <div className={styles.thinkingRow} role="status" aria-live="polite">
      <span className={styles.thinkingAvatar} aria-hidden="true">
        A
      </span>
      <span className={styles.thinkingDots} aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className={styles.srOnly}>
        {studio.stream.label || "正在准备回复"}
      </span>
    </div>
  );
}

export function StudioTranscript() {
  const studio = useStudio();

  return (
    <div className={styles.transcriptFrame}>
      <ConversationError />
      <div
        ref={studio.transcript.scrollRef}
        className={styles.transcript}
        aria-label="Agent 对话消息"
        aria-busy={studio.stream.busy || studio.conversation.loading}
      >
        {studio.conversation.loading ? <ConversationLoading /> : null}

        {!studio.conversation.loading && !studio.chat.messages.length ? (
          <EmptyConversation />
        ) : null}

        {!studio.conversation.loading &&
          studio.chat.messages.map((message, messageIndex) => {
            const isUser = message.role === "user";
            const isStreamingAssistant =
              studio.stream.busy &&
              message.role === "assistant" &&
              messageIndex === studio.chat.messages.length - 1;
            const content = messageText(message);

            return (
              <article
                className={`${styles.messageRow} ${
                  isUser ? styles.userMessageRow : styles.agentMessageRow
                }`}
                key={message.id}
                data-message-role={message.role}
              >
                <div className={styles.messageContent}>
                  <span className={styles.srOnly}>
                    {isUser
                      ? "你"
                      : (studio.agent.selected?.displayName ?? "Agent")}
                  </span>
                  {content ? (
                    <StreamingMarkdown
                      markdown={content}
                      busy={isStreamingAssistant}
                    />
                  ) : isStreamingAssistant ? (
                    <span className={styles.streamingPlaceholder} role="status">
                      <LoadingOutlined spin /> 正在接收回复
                    </span>
                  ) : null}

                  {!isStreamingAssistant ? (
                    <StudioMessageActions
                      message={message}
                      busy={studio.stream.busy}
                      handlers={{
                        onCopy: studio.actions.copyMessage,
                        onEdit: studio.actions.editMessage,
                        onRetry: studio.actions.retryMessage,
                        onFork: studio.actions.forkFromMessage,
                        onFeedback: studio.actions.rateMessage,
                        onHistory: studio.actions.showMessageHistory,
                      }}
                    />
                  ) : null}
                </div>
              </article>
            );
          })}

        {!studio.conversation.loading ? <ThinkingRow /> : null}
        <div className={styles.transcriptEnd} aria-hidden="true" />
      </div>

      {studio.transcript.hasUnreadBelow ? (
        <Button
          className={styles.jumpToLatest}
          aria-label="跳至最新回复"
          icon={<ArrowDownOutlined />}
          onClick={() => studio.transcript.scrollToLatest()}
        />
      ) : null}
    </div>
  );
}
