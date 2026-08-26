import {
  ArrowLeftOutlined,
  CheckCircleFilled,
  DownloadOutlined,
  DownOutlined,
  EllipsisOutlined,
  HistoryOutlined,
  MenuOutlined,
  PlusOutlined,
  SettingOutlined,
  TagsOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { Button, Dropdown, Tooltip, type MenuProps } from "antd";
import { useStudio } from "./StudioContext";
import {
  conciseTaskId,
  statusLabel,
  statusTone,
} from "./studio-utils";
import styles from "./AgentStudio.module.css";

function AgentStatus() {
  const studio = useStudio();
  const selected = studio.agent.selected;
  const healthy = selected?.healthStatus === "healthy";

  return (
    <button
      className={styles.agentSelector}
      type="button"
      aria-label="打开 Agent 调用配置"
      aria-haspopup="dialog"
      onClick={() => studio.panels.setSettingsOpen(true)}
    >
      <span
        className={`${styles.agentStatusDot} ${
          healthy ? styles.agentStatusHealthy : styles.agentStatusWarning
        }`}
        aria-hidden="true"
      />
      <span className={styles.agentSelectorText}>
        <b>{selected?.displayName ?? "选择 Agent"}</b>
        <small>
          {selected
            ? healthy
              ? "可调用"
              : "需要检查"
            : "未配置"}
        </small>
      </span>
      <DownOutlined className={styles.agentSelectorChevron} />
    </button>
  );
}

export function StudioHeader({ onExitStudio }: { onExitStudio?: () => void }) {
  const studio = useStudio();
  const trajectory = studio.trajectory.value;
  const active = studio.conversation.active;
  const busy = studio.stream.busy;
  const taskId = conciseTaskId(studio.conversation.taskId);
  const labelCount = studio.conversation.activeLabels.length;

  const menu: MenuProps["items"] = [
    {
      key: "new",
      icon: <PlusOutlined />,
      label: "新建会话",
      disabled: busy,
      onClick: studio.actions.startNewConversation,
    },
    {
      key: "labels",
      icon: <TagsOutlined />,
      label: labelCount ? `管理标签（${labelCount}）` : "管理标签",
      disabled: !studio.conversation.id || busy,
      onClick: () => studio.panels.setLabelManagerOpen(true),
    },
    {
      key: "export",
      icon: <DownloadOutlined />,
      label: studio.operation === "export" ? "正在导出…" : "导出会话",
      disabled:
        !studio.conversation.id || Boolean(studio.operation) || studio.stream.busy,
      onClick: studio.actions.exportConversation,
    },
    {
      key: "trace",
      icon: <ThunderboltOutlined />,
      label: "查看运行轨迹",
      onClick: () => studio.panels.setTraceOpen(true),
    },
    {
      key: "settings",
      icon: <SettingOutlined />,
      label: "调用配置",
      onClick: () => studio.panels.setSettingsOpen(true),
    },
  ];

  return (
    <header className={styles.studioHeader}>
      <div className={styles.headerLeading}>
        <Tooltip title="返回控制台">
          <Button
            className={styles.returnButton}
            type="text"
            aria-label="返回控制台"
            icon={<ArrowLeftOutlined />}
            onClick={onExitStudio}
          >
            <span>控制台</span>
          </Button>
        </Tooltip>
        <Tooltip title="打开会话历史">
          <Button
            className={styles.mobileHistoryButton}
            type="text"
            aria-label="打开会话历史"
            icon={<MenuOutlined />}
            onClick={() => studio.panels.setHistoryOpen(true)}
          />
        </Tooltip>
      </div>

      <div className={styles.headerCenter}>
        <AgentStatus />
      </div>

      <div className={styles.headerTrailing}>
        {studio.stream.label ? (
          <span className={styles.headerStreamState} role="status">
            <i aria-hidden="true" />
            <span>{studio.stream.label}</span>
          </span>
        ) : trajectory ? (
          <button
            className={`${styles.headerRunState} ${
              styles[`tone_${statusTone(trajectory.status)}`]
            }`}
            type="button"
            onClick={() => studio.panels.setTraceOpen(true)}
            title={taskId ? `任务 ${taskId}` : "查看运行轨迹"}
          >
            <CheckCircleFilled aria-hidden="true" />
            <span>{statusLabel(trajectory.status)}</span>
          </button>
        ) : null}

        <Tooltip title="运行轨迹">
          <Button
            className={styles.desktopTraceButton}
            type="text"
            aria-label="打开运行轨迹"
            icon={<HistoryOutlined />}
            onClick={() => studio.panels.setTraceOpen(true)}
          />
        </Tooltip>

        <Dropdown
          menu={{ items: menu }}
          trigger={["click"]}
          placement="bottomRight"
          open={studio.panels.conversationMenuOpen}
          onOpenChange={studio.panels.setConversationMenuOpen}
        >
          <Button
            className={styles.headerMenuButton}
            type="text"
            aria-label="打开会话菜单"
            icon={<EllipsisOutlined />}
          />
        </Dropdown>
      </div>

      <div className={styles.mobileConversationTitle} aria-hidden="true">
        <b>{active?.title ?? studio.agent.selected?.displayName ?? "新会话"}</b>
      </div>
    </header>
  );
}
