import {
  CheckOutlined,
  CloseOutlined,
  DeleteOutlined,
  ExclamationCircleOutlined,
  LoadingOutlined,
  LockOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import {
  Button,
  Checkbox,
  Drawer,
  Input,
  Popconfirm,
  Select,
  Tooltip,
} from "antd";
import type { StudioLabel } from "../../api";
import { useStudio } from "./StudioContext";
import {
  fullTimeLabel,
  statusLabel,
  statusTone,
  timeLabel,
  trajectorySummary,
} from "./studio-utils";
import styles from "./AgentStudio.module.css";

function PanelHeader({
  title,
  description,
  closeLabel,
  onClose,
}: {
  title: string;
  description: string;
  closeLabel: string;
  onClose: () => void;
}) {
  return (
    <header className={styles.panelHeader}>
      <span>
        <b>{title}</b>
        <small>{description}</small>
      </span>
      <Button
        className={styles.panelCloseButton}
        type="text"
        aria-label={closeLabel}
        icon={<CloseOutlined />}
        onClick={onClose}
      />
    </header>
  );
}

function PanelState({
  kind,
  title,
  description,
  onRetry,
}: {
  kind: "loading" | "empty" | "error";
  title: string;
  description: string;
  onRetry?: () => void;
}) {
  return (
    <div className={styles.panelState} data-state={kind} role="status">
      <span aria-hidden="true">
        {kind === "loading" ? (
          <LoadingOutlined spin />
        ) : kind === "error" ? (
          <ExclamationCircleOutlined />
        ) : (
          <ThunderboltOutlined />
        )}
      </span>
      <b>{title}</b>
      <p>{description}</p>
      {onRetry ? (
        <Button type="text" icon={<ReloadOutlined />} onClick={onRetry}>
          重试
        </Button>
      ) : null}
    </div>
  );
}

export function StudioSettingsPanel() {
  const studio = useStudio();
  const selected = studio.agent.selected;
  const healthy = selected?.healthStatus === "healthy";

  return (
    <Drawer
      aria-label="Agent 调用配置"
      rootClassName={styles.studioDrawer}
      placement="right"
      width={420}
      title={null}
      closable={false}
      open={studio.panels.settingsOpen}
      onClose={() => studio.panels.setSettingsOpen(false)}
    >
      <PanelHeader
        title="调用配置"
        description="选择真实调用所使用的租户与 Agent"
        closeLabel="关闭 Agent 调用配置"
        onClose={() => studio.panels.setSettingsOpen(false)}
      />

      <section className={styles.panelSection}>
        <h2>调用上下文</h2>
        <label className={styles.panelField}>
          <span>租户</span>
          <Select
            aria-label="调用租户"
            value={studio.identity.tenantId || undefined}
            options={studio.identity.activeTenants.map((tenant) => ({
              value: tenant.id,
              label: tenant.displayName,
            }))}
            disabled={studio.stream.busy}
            onChange={studio.identity.setSelectedTenantId}
          />
          <small>只显示当前账号有权访问且处于启用状态的租户。</small>
        </label>

        <label className={styles.panelField}>
          <span>Agent</span>
          <Select
            aria-label="调用 Agent"
            value={studio.agent.slug || undefined}
            options={studio.agent.availableAgents.map((agent) => ({
              value: agent.slug,
              label: agent.displayName,
            }))}
            disabled={studio.stream.busy}
            onChange={studio.agent.setSlug}
          />
          <small>优先列出健康实例，异常 Agent 仍可用于诊断。</small>
        </label>
      </section>

      <section className={styles.panelSection}>
        <h2>当前 Agent</h2>
        <div className={styles.agentSummary}>
          <div className={styles.agentSummaryHeading}>
            <span className={styles.agentMonogram} aria-hidden="true">
              {(selected?.displayName ?? "A").slice(0, 1).toUpperCase()}
            </span>
            <span>
              <b>{selected?.displayName ?? "尚未选择 Agent"}</b>
              <small>{selected?.slug ?? "等待配置"}</small>
            </span>
            <span
              className={`${styles.agentHealth} ${
                healthy ? styles.agentHealthGood : styles.agentHealthWarning
              }`}
            >
              {healthy ? <CheckOutlined /> : <ExclamationCircleOutlined />}
              {healthy ? "可调用" : selected?.healthStatus ?? "未知"}
            </span>
          </div>
          <p>{selected?.description ?? "请选择一个有权访问的 Agent。"}</p>
          {selected ? (
            <dl className={styles.agentMetadata}>
              <div>
                <dt>协议</dt>
                <dd>{selected.selectedInterface.protocolBinding}</dd>
              </div>
              <div>
                <dt>版本</dt>
                <dd>{selected.selectedInterface.protocolVersion}</dd>
              </div>
              <div>
                <dt>路由</dt>
                <dd>{selected.routingStrategy.replaceAll("_", " ")}</dd>
              </div>
            </dl>
          ) : null}
        </div>
      </section>

      <section className={styles.securityNotice}>
        <SafetyCertificateOutlined aria-hidden="true" />
        <span>
          <b>服务端安全代理</b>
          <p>
            登录身份、租户权限和 Agent 可见性会在服务端再次校验。调用凭据不会写入浏览器、会话记录或导出文件。
          </p>
        </span>
        <LockOutlined aria-hidden="true" />
      </section>
    </Drawer>
  );
}

export function StudioTracePanel() {
  const studio = useStudio();
  const trajectory = studio.trajectory.value;
  const summary = trajectorySummary(trajectory);
  const events = studio.trajectory.events;

  return (
    <Drawer
      aria-label="运行轨迹"
      rootClassName={styles.studioDrawer}
      placement="right"
      width={460}
      title={null}
      closable={false}
      open={studio.panels.traceOpen}
      onClose={() => studio.panels.setTraceOpen(false)}
    >
      <PanelHeader
        title="运行轨迹"
        description="A2A 任务、LangGraph 节点与会话事件"
        closeLabel="关闭运行轨迹"
        onClose={() => studio.panels.setTraceOpen(false)}
      />

      {trajectory && summary ? (
        <>
          <section className={styles.traceOverview}>
            <div>
              <span>状态</span>
              <b
                className={
                  styles[`toneText_${statusTone(trajectory.status)}`]
                }
              >
                {statusLabel(trajectory.status)}
              </b>
            </div>
            <div>
              <span>节点</span>
              <b>{summary.total}</b>
            </div>
            <div>
              <span>工具</span>
              <b>{summary.tools}</b>
            </div>
            <div>
              <span>异常</span>
              <b>{summary.errors + summary.interrupts}</b>
            </div>
          </section>

          <section className={styles.panelSection}>
            <div className={styles.panelSectionHeading}>
              <h2>任务节点</h2>
              <small>{fullTimeLabel(trajectory.updatedAt)}</small>
            </div>
            <div className={styles.traceList}>
              {trajectory.events.map((event) => (
                <article
                  className={styles.traceEvent}
                  data-kind={event.kind}
                  key={`${event.sequence}-${event.node}`}
                >
                  <span className={styles.traceRail} aria-hidden="true">
                    <i />
                  </span>
                  <span className={styles.traceEventContent}>
                    <b>{event.node.replaceAll("_", " ")}</b>
                    <small>
                      {event.kind.replaceAll("_", " · ")} · #{event.sequence}
                    </small>
                    {event.kind === "interrupt" ? (
                      <p>
                        等待补充：
                        {Array.isArray(event.payload.missing)
                          ? event.payload.missing.join("、")
                          : "需要更多信息"}
                      </p>
                    ) : null}
                  </span>
                </article>
              ))}
            </div>
          </section>
        </>
      ) : events.loading ? (
        <PanelState
          kind="loading"
          title="正在读取运行轨迹"
          description="首次调用后会显示节点、工具和终止状态。"
        />
      ) : events.error ? (
        <PanelState
          kind="error"
          title="轨迹读取失败"
          description={events.error}
          onRetry={() => void events.refresh()}
        />
      ) : events.data?.length ? (
        <section className={styles.panelSection}>
          <div className={styles.panelSectionHeading}>
            <h2>会话时间线</h2>
            <Tooltip title="刷新会话时间线">
              <Button
                type="text"
                aria-label="刷新会话时间线"
                icon={<ReloadOutlined />}
                onClick={() => void events.refresh()}
              />
            </Tooltip>
          </div>
          <div className={styles.eventTimeline}>
            {events.data.map((event) => (
              <article key={event.id}>
                <i aria-hidden="true" />
                <span>
                  <b>{event.kind.replaceAll("_", " · ")}</b>
                  <small>{timeLabel(event.createdAt)}</small>
                </span>
              </article>
            ))}
          </div>
        </section>
      ) : (
        <PanelState
          kind="empty"
          title="还没有运行轨迹"
          description="发送第一条消息后，这里会展示真实任务节点和会话事件。"
        />
      )}
    </Drawer>
  );
}

const labelColorNames: Record<StudioLabel["color"], string> = {
  blue: "蓝灰",
  cyan: "青灰",
  purple: "紫灰",
  gold: "琥珀",
  green: "绿色",
  red: "红色",
  gray: "灰色",
};

export function StudioLabelPanel() {
  const studio = useStudio();
  const labels = studio.labels.state;

  return (
    <Drawer
      aria-label="会话标签"
      rootClassName={styles.studioDrawer}
      placement="right"
      width={420}
      title={null}
      closable={false}
      open={studio.panels.labelManagerOpen}
      onClose={() => studio.panels.setLabelManagerOpen(false)}
    >
      <PanelHeader
        title="会话标签"
        description="为当前会话添加可检索的组织标签"
        closeLabel="关闭会话标签"
        onClose={() => studio.panels.setLabelManagerOpen(false)}
      />

      <form
        className={styles.labelCreateForm}
        onSubmit={(event) => {
          event.preventDefault();
          void studio.actions.createLabel();
        }}
      >
        <Input
          aria-label="新标签名称"
          placeholder="新标签名称"
          maxLength={32}
          value={studio.labels.newName}
          disabled={studio.operation === "create-label"}
          onChange={(event) => studio.labels.setNewName(event.target.value)}
        />
        <Select
          aria-label="新标签颜色"
          value={studio.labels.newColor}
          disabled={studio.operation === "create-label"}
          options={Object.entries(labelColorNames).map(([value, label]) => ({
            value,
            label,
          }))}
          onChange={studio.labels.setNewColor}
        />
        <Button
          type="primary"
          htmlType="submit"
          loading={studio.operation === "create-label"}
          disabled={!studio.labels.newName.trim() || Boolean(studio.operation)}
        >
          创建标签
        </Button>
      </form>

      {labels.loading ? (
        <PanelState
          kind="loading"
          title="正在读取标签"
          description="稍候即可为会话添加标签。"
        />
      ) : labels.error ? (
        <PanelState
          kind="error"
          title="标签读取失败"
          description={labels.error}
          onRetry={() => void labels.refresh()}
        />
      ) : labels.data?.length ? (
        <div className={styles.labelList}>
          {labels.data.map((label) => {
            const checked = studio.conversation.activeLabels.some(
              (item) => item.id === label.id,
            );
            return (
              <div className={styles.labelRow} key={label.id}>
                <Checkbox
                  checked={checked}
                  disabled={
                    !studio.conversation.id ||
                    studio.stream.busy ||
                    Boolean(studio.operation)
                  }
                  onChange={(event) => {
                    const ids = studio.conversation.activeLabels.map(
                      (item) => item.id,
                    );
                    void studio.actions.updateConversationLabels(
                      event.target.checked
                        ? [...ids, label.id]
                        : ids.filter((id) => id !== label.id),
                    );
                  }}
                >
                  <span
                    className={styles.labelSwatch}
                    data-color={label.color}
                    aria-hidden="true"
                  />
                  <span>{label.name}</span>
                </Checkbox>
                <Popconfirm
                  title={`删除标签“${label.name}”？`}
                  description="标签会从所有会话中移除。"
                  okText="删除"
                  cancelText="取消"
                  onConfirm={() => void studio.actions.deleteLabel(label)}
                >
                  <Button
                    type="text"
                    danger
                    aria-label={`删除标签 ${label.name}`}
                    icon={<DeleteOutlined />}
                    disabled={Boolean(studio.operation)}
                  />
                </Popconfirm>
              </div>
            );
          })}
        </div>
      ) : (
        <PanelState
          kind="empty"
          title="还没有标签"
          description="创建第一个标签后，可以在会话历史中筛选。"
        />
      )}
    </Drawer>
  );
}

export function StudioRevisionPanel() {
  const studio = useStudio();
  const revisions = studio.revisions.state;

  return (
    <Drawer
      aria-label="消息编辑记录"
      rootClassName={styles.studioDrawer}
      placement="right"
      width={420}
      title={null}
      closable={false}
      open={Boolean(studio.revisions.messageId)}
      onClose={() => studio.revisions.setMessageId("")}
    >
      <PanelHeader
        title="消息编辑记录"
        description="查看该用户消息的历史版本"
        closeLabel="关闭消息编辑记录"
        onClose={() => studio.revisions.setMessageId("")}
      />

      {revisions.loading ? (
        <PanelState
          kind="loading"
          title="正在读取编辑记录"
          description="历史版本会按时间倒序显示。"
        />
      ) : revisions.error ? (
        <PanelState
          kind="error"
          title="编辑记录读取失败"
          description={revisions.error}
          onRetry={() => void revisions.refresh()}
        />
      ) : revisions.data?.length ? (
        <div className={styles.revisionList}>
          {revisions.data.map((revision) => (
            <article className={styles.revisionItem} key={revision.id}>
              <header>
                <b>版本 {revision.revision}</b>
                <time dateTime={revision.createdAt}>
                  {fullTimeLabel(revision.createdAt)}
                </time>
              </header>
              <p>{revision.content}</p>
            </article>
          ))}
        </div>
      ) : (
        <PanelState
          kind="empty"
          title="没有编辑记录"
          description="这条消息尚未通过编辑分支修改。"
        />
      )}
    </Drawer>
  );
}

export function StudioPanels() {
  return (
    <>
      <StudioSettingsPanel />
      <StudioTracePanel />
      <StudioLabelPanel />
      <StudioRevisionPanel />
    </>
  );
}
