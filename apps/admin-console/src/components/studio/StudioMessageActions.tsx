import { useState } from "react";
import {
  BranchesOutlined,
  CheckOutlined,
  CopyOutlined,
  EditOutlined,
  HistoryOutlined,
  LikeOutlined,
  DislikeOutlined,
  RedoOutlined,
} from "@ant-design/icons";
import { Button, Input, Tooltip } from "antd";
import type { UIMessage } from "ai";
import { messageText } from "./studio-utils";
import styles from "./AgentStudio.module.css";

export type StudioMessageActionHandlers = {
  onCopy: (text: string) => Promise<void> | void;
  onEdit: (message: UIMessage, text: string) => Promise<void> | void;
  onRetry: (message: UIMessage) => Promise<void> | void;
  onFork: (message: UIMessage) => Promise<void> | void;
  onFeedback: (message: UIMessage, rating: -1 | 1) => Promise<void> | void;
  onHistory: (message: UIMessage) => Promise<void> | void;
};

/**
 * GPT-style actions deliberately operate on UIMessage ids. The persistence
 * layer maps these to durable messages when a loaded conversation is open;
 * transient streaming messages are kept action-free until completion.
 */
export function StudioMessageActions({
  message,
  busy,
  handlers,
}: {
  message: UIMessage;
  busy: boolean;
  handlers: StudioMessageActionHandlers;
}) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => messageText(message));
  const [action, setAction] = useState<string>();
  const text = messageText(message);
  const isUser = message.role === "user";

  const run = async (name: string, task: () => Promise<void> | void) => {
    if (busy || action) return;
    setAction(name);
    try {
      await task();
    } finally {
      setAction(undefined);
    }
  };

  const copy = async () => {
    await run("copy", () => handlers.onCopy(text));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_600);
  };
  const saveEdit = async () => {
    if (!draft.trim() || draft.trim() === text) {
      setEditing(false);
      return;
    }
    await run("edit", () => handlers.onEdit(message, draft.trim()));
    setEditing(false);
  };
  if (editing) {
    return (
      <form
        className={styles.studioMessageEditor}
        onSubmit={(event) => {
          event.preventDefault();
          void saveEdit();
        }}
      >
        <Input.TextArea
          value={draft}
          autoSize={{ minRows: 2, maxRows: 8 }}
          onChange={(event) => setDraft(event.target.value)}
          autoFocus
          disabled={busy}
        />
        <div>
          <Button
            size="small"
            htmlType="button"
            onClick={() => setEditing(false)}
            disabled={Boolean(action)}
          >
            取消
          </Button>
          <Button
            size="small"
            type="primary"
            htmlType="submit"
            loading={action === "edit"}
            disabled={!draft.trim() || busy || Boolean(action)}
          >
            保存并重新发送
          </Button>
        </div>
      </form>
    );
  }
  return (
    <div className={styles.studioMessageActions} aria-label="消息操作">
      <Tooltip title={copied ? "已复制" : "复制"}>
        <Button
          type="text"
          size="small"
          aria-label="复制消息"
          loading={action === "copy"}
          disabled={!text || busy || Boolean(action)}
          icon={copied ? <CheckOutlined /> : <CopyOutlined />}
          onClick={() => void copy()}
        />
      </Tooltip>
      {isUser ? (
        <>
          <Tooltip title="编辑并重新发送">
            <Button
              type="text"
              size="small"
              aria-label="编辑并重新发送"
              disabled={busy || Boolean(action)}
              icon={<EditOutlined />}
              onClick={() => {
                setDraft(text);
                setEditing(true);
              }}
            />
          </Tooltip>
          <Tooltip title="从这里分支">
            <Button
              type="text"
              size="small"
              aria-label="从这里分支"
              loading={action === "fork"}
              disabled={busy || Boolean(action)}
              icon={<BranchesOutlined />}
              onClick={() => void run("fork", () => handlers.onFork(message))}
            />
          </Tooltip>
          <Tooltip title="查看编辑记录">
            <Button
              type="text"
              size="small"
              aria-label="查看编辑记录"
              loading={action === "history"}
              disabled={busy || Boolean(action)}
              icon={<HistoryOutlined />}
              onClick={() => void run("history", () => handlers.onHistory(message))}
            />
          </Tooltip>
        </>
      ) : (
        <>
          <Tooltip title="重新生成">
            <Button
              type="text"
              size="small"
              aria-label="重新生成"
              loading={action === "retry"}
              disabled={busy || Boolean(action)}
              icon={<RedoOutlined />}
              onClick={() => void run("retry", () => handlers.onRetry(message))}
            />
          </Tooltip>
          <Tooltip title="有帮助">
            <Button
              type="text"
              size="small"
              aria-label="有帮助"
              loading={action === "like"}
              disabled={busy || Boolean(action)}
              icon={<LikeOutlined />}
              onClick={() => void run("like", () => handlers.onFeedback(message, 1))}
            />
          </Tooltip>
          <Tooltip title="需要改进">
            <Button
              type="text"
              size="small"
              aria-label="需要改进"
              loading={action === "dislike"}
              disabled={busy || Boolean(action)}
              icon={<DislikeOutlined />}
              onClick={() => void run("dislike", () => handlers.onFeedback(message, -1))}
            />
          </Tooltip>
        </>
      )}
    </div>
  );
}

export { messageText };
