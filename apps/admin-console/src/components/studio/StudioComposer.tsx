import { useRef } from "react";
import {
  ArrowUpOutlined,
  LoadingOutlined,
  PlusOutlined,
  ReloadOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { Button, Input, Tooltip } from "antd";
import { useStudio } from "./StudioContext";
import styles from "./AgentStudio.module.css";

export function StudioComposer() {
  const studio = useStudio();
  const composing = useRef(false);
  const busy = studio.stream.busy;
  const conversationLoading = studio.conversation.loading;
  const unavailable =
    !studio.identity.token || !studio.agent.slug || !studio.identity.tenantId;
  const disabled = unavailable || busy || conversationLoading;

  return (
    <div className={styles.composerDock}>
      <form
        className={`${styles.composer} ${
          busy ? styles.composerBusy : ""
        } ${unavailable ? styles.composerDisabled : ""}`}
        aria-label="消息输入区"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || conversationLoading) return;
          void studio.actions.send();
        }}
      >
        <Input.TextArea
          ref={studio.draft.ref}
          className={styles.composerInput}
          value={studio.draft.value}
          aria-label="给 Agent 发送消息"
          placeholder={studio.draft.placeholder}
          autoSize={{ minRows: 1, maxRows: 10 }}
          disabled={disabled}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onChange={(event) => studio.draft.setValue(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !composing.current &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              if (!conversationLoading && studio.draft.canSend) {
                void studio.actions.send();
              }
            }
          }}
        />

        <div className={styles.composerToolbar}>
          <div className={styles.composerTools}>
            <Tooltip title="Agent 与租户配置">
              <Button
                className={styles.composerToolButton}
                type="text"
                aria-label="打开 Agent 调用配置"
                icon={<PlusOutlined />}
                disabled={busy || conversationLoading}
                onClick={() => studio.panels.setSettingsOpen(true)}
              />
            </Tooltip>

            {studio.persistence.pendingCount ? (
              <button
                className={styles.pendingSyncButton}
                type="button"
                disabled={studio.persistence.flushing}
                onClick={() => void studio.persistence.flush()}
              >
                {studio.persistence.flushing ? (
                  <LoadingOutlined spin />
                ) : (
                  <ReloadOutlined />
                )}
                待同步 {studio.persistence.pendingCount}
              </button>
            ) : (
              <span className={styles.composerMode}>
                {studio.agent.selected?.displayName ?? "未选择 Agent"}
              </span>
            )}
          </div>

          <div className={styles.composerSubmitArea}>
            {studio.draft.restored ? (
              <span className={styles.draftRestored} role="status">
                已恢复草稿
              </span>
            ) : null}
            {busy ? (
              <Tooltip title="停止生成（Esc）">
                <Button
                  className={`${styles.composerSubmit} ${styles.composerStop}`}
                  type="primary"
                  htmlType="button"
                  aria-label="停止生成"
                  icon={<StopOutlined />}
                  onClick={() => void studio.actions.stopGeneration()}
                />
              </Tooltip>
            ) : (
              <Tooltip title="发送（Enter）">
                <Button
                  className={styles.composerSubmit}
                  type="primary"
                  htmlType="submit"
                  aria-label="发送"
                  icon={<ArrowUpOutlined />}
                  disabled={conversationLoading || !studio.draft.canSend}
                />
              </Tooltip>
            )}
          </div>
        </div>
      </form>

      <p className={styles.composerHint}>
        Enter 发送 · Shift + Enter 换行 · Esc 停止
      </p>
    </div>
  );
}
