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
import styles from "../../App.module.css";

export type StudioMessageActionHandlers = {
  onCopy: (text: string) => Promise<void> | void;
  onEdit: (message: UIMessage, text: string) => Promise<void> | void;
  onRetry: (message: UIMessage) => Promise<void> | void;
  onFork: (message: UIMessage) => Promise<void> | void;
  onFeedback: (message: UIMessage, rating: -1 | 1) => Promise<void> | void;
  onHistory: (message: UIMessage) => Promise<void> | void;
};

function messageText(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

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
  const text = messageText(message);
  const isUser = message.role === "user";

  const copy = async () => {
    await handlers.onCopy(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_600);
  };
  if (editing) {
    return (
      <form
        className={styles.studioMessageEditor}
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.trim() && draft.trim() !== text) {
            void handlers.onEdit(message, draft.trim());
          }
          setEditing(false);
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
          >
            取消
          </Button>
          <Button
            size="small"
            type="primary"
            htmlType="submit"
            disabled={!draft.trim() || busy}
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
          disabled={!text}
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
              disabled={busy}
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
              disabled={busy}
              icon={<BranchesOutlined />}
              onClick={() => void handlers.onFork(message)}
            />
          </Tooltip>
          <Tooltip title="查看编辑记录">
            <Button
              type="text"
              size="small"
              aria-label="查看编辑记录"
              disabled={busy}
              icon={<HistoryOutlined />}
              onClick={() => void handlers.onHistory(message)}
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
              disabled={busy}
              icon={<RedoOutlined />}
              onClick={() => void handlers.onRetry(message)}
            />
          </Tooltip>
          <Tooltip title="有帮助">
            <Button
              type="text"
              size="small"
              aria-label="有帮助"
              disabled={busy}
              icon={<LikeOutlined />}
              onClick={() => void handlers.onFeedback(message, 1)}
            />
          </Tooltip>
          <Tooltip title="需要改进">
            <Button
              type="text"
              size="small"
              aria-label="需要改进"
              disabled={busy}
              icon={<DislikeOutlined />}
              onClick={() => void handlers.onFeedback(message, -1)}
            />
          </Tooltip>
        </>
      )}
    </div>
  );
}

export { messageText };
