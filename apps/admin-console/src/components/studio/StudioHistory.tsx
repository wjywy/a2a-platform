import { useState } from "react";
import {
  CloseOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EllipsisOutlined,
  InboxOutlined,
  LoadingOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SettingOutlined,
  TagsOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import {
  Button,
  Dropdown,
  Input,
  Modal,
  Select,
  Tooltip,
  type MenuProps,
} from "antd";
import type { StudioConversation } from "../../api";
import { useStudio } from "./StudioContext";
import { safeConversationTitle, timeLabel } from "./studio-utils";
import styles from "./AgentStudio.module.css";

function HistoryItem({ conversation }: { conversation: StudioConversation }) {
  const studio = useStudio();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const active = conversation.id === studio.conversation.id;
  const renaming = studio.history.renamingConversationId === conversation.id;
  const restoring = conversation.status === "archived";
  const operation = studio.operation;
  const disabled = Boolean(operation) || studio.stream.busy;

  const menu: MenuProps["items"] = [
    {
      key: "rename",
      icon: <EditOutlined />,
      label: "重命名",
      disabled,
      onClick: () => studio.history.beginRename(conversation),
    },
    {
      key: "archive",
      icon: restoring ? <ReloadOutlined /> : <InboxOutlined />,
      label: restoring ? "恢复会话" : "归档会话",
      disabled,
      onClick: () => void studio.actions.archiveConversation(conversation),
    },
    { type: "divider" },
    {
      key: "delete",
      icon: <DeleteOutlined />,
      label: "删除",
      danger: true,
      disabled,
      onClick: () => setDeleteOpen(true),
    },
  ];

  return (
    <article
      className={`${styles.historyItem} ${
        active ? styles.historyItemActive : ""
      }`}
      data-conversation-id={conversation.id}
    >
      {renaming ? (
        <form
          className={styles.historyRenameForm}
          onSubmit={(event) => {
            event.preventDefault();
            void studio.actions.renameConversation(conversation);
          }}
        >
          <Input
            aria-label={`重命名 ${conversation.title}`}
            autoFocus
            value={studio.history.renameValue}
            maxLength={160}
            disabled={operation === `rename:${conversation.id}`}
            onChange={(event) =>
              studio.history.setRenameValue(event.target.value)
            }
            onBlur={studio.history.cancelRename}
            onKeyDown={(event) => {
              if (event.key === "Escape") studio.history.cancelRename();
            }}
          />
          {operation === `rename:${conversation.id}` ? (
            <LoadingOutlined className={styles.inlineSpinner} spin />
          ) : null}
        </form>
      ) : (
        <button
          className={styles.historySelect}
          type="button"
          disabled={studio.stream.busy}
          onClick={() => void studio.actions.openConversation(conversation)}
        >
          <span className={styles.historyItemTitle}>
            {safeConversationTitle(conversation.title)}
          </span>
          <span className={styles.historyItemPreview}>
            {conversation.preview || "暂无消息"}
          </span>
          <time dateTime={conversation.updatedAt}>
            {timeLabel(conversation.updatedAt)}
          </time>
        </button>
      )}

      {!renaming ? (
        <Dropdown
          menu={{ items: menu }}
          placement="bottomRight"
          trigger={["click"]}
        >
          <Button
            className={styles.historyItemMenu}
            type="text"
            aria-label={`打开“${conversation.title}”的会话操作`}
            icon={<EllipsisOutlined />}
            disabled={disabled}
            loading={
              operation === `archive:${conversation.id}` ||
              operation === `delete:${conversation.id}`
            }
          />
        </Dropdown>
      ) : null}

      <Modal
        className={styles.dangerDialog}
        title="删除这个会话？"
        open={deleteOpen}
        okText="删除"
        cancelText="取消"
        okButtonProps={{
          danger: true,
          loading: operation === `delete:${conversation.id}`,
        }}
        cancelButtonProps={{
          disabled: operation === `delete:${conversation.id}`,
        }}
        closable={!operation}
        maskClosable={!operation}
        onCancel={() => setDeleteOpen(false)}
        onOk={async () => {
          await studio.actions.deleteConversation(conversation);
          setDeleteOpen(false);
        }}
      >
        <p>
          “{safeConversationTitle(conversation.title)}”将从会话历史中移除。
          此操作不会取消已经完成的远端任务。
        </p>
      </Modal>
    </article>
  );
}

function HistoryEmpty() {
  const studio = useStudio();
  const filtered = Boolean(studio.history.search || studio.history.labelFilter);
  return (
    <div className={styles.historyEmpty} role="status">
      <span className={styles.historyEmptyIcon} aria-hidden="true">
        {studio.history.showArchived ? <InboxOutlined /> : <SearchOutlined />}
      </span>
      <b>
        {filtered
          ? "没有匹配的会话"
          : studio.history.showArchived
            ? "没有已归档会话"
            : "还没有会话"}
      </b>
      <p>
        {filtered
          ? "调整关键词或标签后重试。"
          : studio.history.showArchived
            ? "归档后的会话会出现在这里。"
            : "发送第一条消息后，会话会自动保存。"}
      </p>
    </div>
  );
}

export function StudioHistory() {
  const studio = useStudio();
  const data = studio.history.state.data;
  const totalPages = data?.totalPages ?? 1;
  const hasLoadedHistory = data !== undefined;

  return (
    <>
      <aside
        className={`${styles.historyPanel} ${
          studio.panels.historyOpen ? styles.historyPanelOpen : ""
        }`}
        aria-label="会话管理"
      >
        <header className={styles.historyHeader}>
          <div className={styles.historyBrand}>
            <span className={styles.historyBrandMark} aria-hidden="true">
              A
            </span>
            <span>
              <b>A2A Studio</b>
              <small>在线调试</small>
            </span>
          </div>
          <Tooltip title="关闭会话历史">
            <Button
              className={styles.historyCloseButton}
              type="text"
              aria-label="关闭会话历史"
              icon={<CloseOutlined />}
              onClick={() => studio.panels.setHistoryOpen(false)}
            />
          </Tooltip>
        </header>

        <div className={styles.historyPrimaryActions}>
          <button
            className={styles.newConversationButton}
            type="button"
            disabled={studio.stream.busy}
            onClick={studio.actions.startNewConversation}
          >
            <PlusOutlined aria-hidden="true" />
            <span>新建会话</span>
            <kbd>Ctrl ⇧ N</kbd>
          </button>
        </div>

        <div className={styles.historyUtilityActions} aria-label="会话工具">
          <button
            type="button"
            onClick={() => {
              studio.panels.setSettingsOpen(true);
              studio.panels.setHistoryOpen(false);
            }}
          >
            <SettingOutlined aria-hidden="true" />
            <span>配置</span>
          </button>
          <button
            type="button"
            onClick={() => {
              studio.panels.setTraceOpen(true);
              studio.panels.setHistoryOpen(false);
            }}
          >
            <ThunderboltOutlined aria-hidden="true" />
            <span>轨迹</span>
          </button>
          <button
            type="button"
            disabled={!studio.conversation.id || studio.stream.busy}
            onClick={() => {
              studio.panels.setLabelManagerOpen(true);
              studio.panels.setHistoryOpen(false);
            }}
          >
            <TagsOutlined aria-hidden="true" />
            <span>标签</span>
          </button>
          <button
            type="button"
            disabled={
              !studio.conversation.id ||
              studio.stream.busy ||
              Boolean(studio.operation)
            }
            onClick={() => void studio.actions.exportConversation()}
          >
            {studio.operation === "export" ? (
              <LoadingOutlined spin aria-hidden="true" />
            ) : (
              <DownloadOutlined aria-hidden="true" />
            )}
            <span>导出</span>
          </button>
        </div>

        <div className={styles.historyFilters}>
          <Input
            className={styles.historySearch}
            aria-label="搜索会话"
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索会话"
            value={studio.history.search}
            onChange={(event) => studio.history.setSearch(event.target.value)}
          />
          <div className={styles.historyFilterRow}>
            <button
              className={`${styles.archiveToggle} ${
                studio.history.showArchived ? styles.archiveToggleActive : ""
              }`}
              type="button"
              aria-pressed={studio.history.showArchived}
              onClick={() =>
                studio.history.setShowArchived(!studio.history.showArchived)
              }
            >
              <InboxOutlined aria-hidden="true" />
              {studio.history.showArchived ? "已归档" : "当前会话"}
            </button>
            <Select
              className={styles.historyLabelFilter}
              aria-label="按标签筛选会话"
              allowClear
              suffixIcon={<TagsOutlined />}
              placeholder="标签"
              value={studio.history.labelFilter || undefined}
              options={studio.labels.state.data?.map((label) => ({
                value: label.id,
                label: label.name,
              }))}
              onChange={(value) => studio.history.setLabelFilter(value ?? "")}
            />
          </div>
        </div>

        <div className={styles.historyList} aria-busy={false}>
          {studio.history.groups.length ? (
            studio.history.groups.map((group) => (
              <section className={styles.historyGroup} key={group.label}>
                <h2>{group.label}</h2>
                <div>
                  {group.items.map((conversation) => (
                    <HistoryItem
                      conversation={conversation}
                      key={conversation.id}
                    />
                  ))}
                </div>
              </section>
            ))
          ) : hasLoadedHistory ? (
            <HistoryEmpty />
          ) : null}
        </div>

        {data && totalPages > 1 ? (
          <footer className={styles.historyPagination}>
            <Button
              type="text"
              disabled={data.page <= 1 || studio.stream.busy}
              onClick={() =>
                studio.history.setPage(Math.max(1, studio.history.page - 1))
              }
            >
              上一页
            </Button>
            <span>
              {data.page} / {totalPages}
            </span>
            <Button
              type="text"
              disabled={data.page >= totalPages || studio.stream.busy}
              onClick={() => studio.history.setPage(studio.history.page + 1)}
            >
              下一页
            </Button>
          </footer>
        ) : null}
      </aside>

      <button
        className={`${styles.historyBackdrop} ${
          studio.panels.historyOpen ? styles.historyBackdropVisible : ""
        }`}
        type="button"
        tabIndex={studio.panels.historyOpen ? 0 : -1}
        aria-label="关闭会话历史"
        onClick={() => studio.panels.setHistoryOpen(false)}
      />
    </>
  );
}
