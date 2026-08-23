import { useState } from "react";
import {
  Button,
  Collapse,
  Flex,
  Input,
  Select,
  Space,
  Table,
  Typography,
} from "antd";
import {
  DownloadOutlined,
  EyeOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { useApp } from "../AppContext";
import {
  authorizedDownload,
  platformApi,
  type TaskDetail,
  type TaskSummary,
} from "../api";
import { useAsync, useDebouncedValue } from "../hooks";
import {
  CodeBlock,
  Drawer,
  PageState,
  Pagination,
  SectionHeader,
  StatusBadge,
  formatBytes,
  formatDuration,
  formatTime,
  useToast,
} from "../ui";
import styles from "../App.module.css";
const stateTone = (value?: string) => {
  const state = String(value ?? "").toLowerCase();
  const numericStates: Record<string, string> = {
    "1": "pending",
    "2": "working",
    "3": "completed",
    "4": "failed",
    "5": "cancelled",
    "6": "failed",
    "7": "pending",
  };
  if (numericStates[state]) return numericStates[state];
  if (state.includes("completed")) return "completed";
  if (state.includes("failed")) return "failed";
  if (state.includes("cancel")) return "cancelled";
  if (state.includes("working")) return "working";
  return value ?? "unknown";
};
export function TasksPage() {
  const { token, agents, tenants, selectedTenantId, realtimeVersion } =
    useApp();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [agentId, setAgentId] = useState("");
  const query = useDebouncedValue(search);
  const tasks = useAsync(
    () =>
      platformApi.tasks(token, {
        page,
        pageSize: 20,
        tenantId: selectedTenantId || undefined,
        agentId: agentId || undefined,
        state: stateFilter || undefined,
        search: query,
      }),
    [
      token,
      page,
      selectedTenantId,
      agentId,
      stateFilter,
      query,
      realtimeVersion,
    ],
  );
  const [selected, setSelected] = useState<TaskSummary>();
  const detail = useAsync(
    () =>
      selected
        ? platformApi.task(token, selected.id)
        : Promise.resolve(undefined),
    [token, selected?.id, realtimeVersion],
    { immediate: !!selected },
  );
  const toast = useToast();
  const download = async (task: TaskSummary) => {
    try {
      await authorizedDownload(
        platformApi.taskEventsUrl(task.id),
        token,
        `task-${task.remoteTaskId}-events.json`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "下载失败");
    }
  };
  return (
    <>
      <section className={styles.panel}>
        <SectionHeader
          title="任务列表"
          description="平台保存流式事件时间线、状态变化和远端 Task ID"
        />
        <div className={styles.toolbar}>
          <Input
            prefix={<SearchOutlined />}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Task ID、Request ID 或失败原因"
          />
          <Select
            value={agentId}
            options={[
              { value: "", label: "全部 Agent" },
              ...agents.map((agent) => ({
                value: agent.id,
                label: agent.displayName,
              })),
            ]}
            onChange={setAgentId}
          />
          <Select
            value={stateFilter}
            options={[
              { value: "", label: "全部状态" },
              { value: "TASK_STATE_WORKING", label: "处理中" },
              { value: "TASK_STATE_COMPLETED", label: "已完成" },
              { value: "TASK_STATE_FAILED", label: "失败" },
              { value: "TASK_STATE_CANCELED", label: "已取消" },
            ]}
            onChange={setStateFilter}
          />
        </div>
        <PageState
          loading={tasks.loading}
          error={tasks.error}
          empty={!tasks.data?.items.length ? "没有匹配任务" : undefined}
          retry={() => void tasks.refresh()}
        >
          <Table<TaskSummary>
            size="small"
            scroll={{ x: "max-content" }}
            rowKey="id"
            pagination={false}
            dataSource={tasks.data?.items ?? []}
            columns={[
              {
                title: "远端 Task ID",
                render: (_, task) => (
                  <Button
                    type="link"
                    className={styles.taskLink}
                    onClick={() => setSelected(task)}
                  >
                    {task.remoteTaskId}
                    <Typography.Text type="secondary">
                      {task.requestId}
                    </Typography.Text>
                  </Button>
                ),
              },
              {
                title: "状态",
                render: (_, task) => (
                  <>
                    <StatusBadge value={stateTone(task.state)} />
                    {task.errorMessage && (
                      <Typography.Text type="danger">
                        {task.errorMessage}
                      </Typography.Text>
                    )}
                  </>
                ),
              },
              {
                title: "Agent / 租户",
                render: (_, task) => (
                  <>
                    <Typography.Text strong>{task.agentName}</Typography.Text>
                    <br />
                    <Typography.Text type="secondary">
                      {task.agentInstanceName
                        ? `${task.agentInstanceName} · `
                        : ""}
                      {task.tenantName ??
                        tenants.find((tenant) => tenant.id === task.tenantId)
                          ?.displayName ??
                        "—"}
                    </Typography.Text>
                  </>
                ),
              },
              {
                title: "调用方",
                render: (_, task) => (
                  <>
                    {task.apiKeyName ?? "未知"}
                    <br />
                    <Typography.Text type="secondary">
                      {task.operation}
                    </Typography.Text>
                  </>
                ),
              },
              {
                title: "耗时",
                dataIndex: "durationMs",
                render: formatDuration,
              },
              { title: "开始时间", dataIndex: "startedAt", render: formatTime },
              {
                title: "操作",
                render: (_, task) => (
                  <Space>
                    <Button
                      size="small"
                      icon={<EyeOutlined />}
                      onClick={() => setSelected(task)}
                    >
                      详情
                    </Button>
                    <Button
                      size="small"
                      icon={<DownloadOutlined />}
                      onClick={() => void download(task)}
                    >
                      下载 JSON
                    </Button>
                  </Space>
                ),
              },
            ]}
          />
          {tasks.data && <Pagination {...tasks.data} onChange={setPage} />}
        </PageState>
      </section>
      {selected && (
        <Drawer
          title="任务详情"
          subtitle={selected.remoteTaskId}
          onClose={() => setSelected(undefined)}
        >
          <PageState loading={detail.loading} error={detail.error}>
            {detail.data && (
              <TaskDetailView
                task={detail.data}
                download={() => void download(selected)}
              />
            )}
          </PageState>
        </Drawer>
      )}
    </>
  );
}
function TaskDetailView({
  task,
  download,
}: {
  task: TaskDetail;
  download: () => void;
}) {
  return (
    <div className={styles.taskDetail}>
      <Flex justify="space-between" className={styles.taskDetailHead}>
        <StatusBadge value={stateTone(task.state)} />
        <Button icon={<DownloadOutlined />} onClick={download}>
          下载事件 JSON
        </Button>
      </Flex>
      <dl className={styles.detailList}>
        <div>
          <dt>远端 Task ID</dt>
          <dd>{task.remoteTaskId}</dd>
        </div>
        <div>
          <dt>Context ID</dt>
          <dd>{task.contextId ?? "—"}</dd>
        </div>
        <div>
          <dt>Request ID</dt>
          <dd>{task.requestId ?? "—"}</dd>
        </div>
        <div>
          <dt>Agent</dt>
          <dd>
            {task.agentName} / {task.agentSlug}
          </dd>
        </div>
        <div>
          <dt>后端实例</dt>
          <dd>{task.agentInstanceName ?? task.agentInstanceId ?? "—"}</dd>
        </div>
        <div>
          <dt>调用方</dt>
          <dd>{task.apiKeyName ?? "—"}</dd>
        </div>
        <div>
          <dt>重试 / 耗时</dt>
          <dd>
            {task.retryCount} 次 / {formatDuration(task.durationMs)}
          </dd>
        </div>
        {task.errorMessage && (
          <div>
            <dt>失败原因</dt>
            <dd className={styles.dangerText}>
              {task.errorCode} · {task.errorMessage}
            </dd>
          </div>
        )}
      </dl>
      <SectionHeader
        title="原始请求"
        description="首次发送到远端 Agent 的协议请求"
      />
      <CodeBlock value={task.requestPayload} />
      <SectionHeader
        title="任务产物"
        description={`${task.artifacts.length} 个由流式事件合并的产物`}
      />
      {task.artifacts.length ? (
        <Collapse
          className={styles.revisionList}
          size="small"
          items={task.artifacts.map((artifact, index) => ({
            key: String(artifact.artifactId ?? artifact.id ?? index),
            label: `产物 ${String(artifact.name ?? artifact.artifactId ?? index + 1)}`,
            extra: (
              <Typography.Text type="secondary">
                {String(artifact.description ?? "A2A Artifact")}
              </Typography.Text>
            ),
            children: <CodeBlock value={artifact} />,
          }))}
        />
      ) : (
        <PageState empty="该任务没有产物" />
      )}
      <SectionHeader
        title="事件时间线"
        description={`${task.events.length} 条持久化事件`}
      />
      <Collapse
        className={styles.eventTimeline}
        size="small"
        items={task.events.map((event) => ({
          key: event.id,
          label: `${event.sequence}. ${event.eventType}`,
          extra: (
            <Space>
              <Typography.Text type="secondary">
                {formatTime(event.occurredAt)} ·{" "}
                {formatBytes(event.payloadBytes)}
              </Typography.Text>
              <StatusBadge value={stateTone(event.state)} />
            </Space>
          ),
          children: <CodeBlock value={event.payload} />,
        }))}
      />
      <SectionHeader title="最新快照" />
      <CodeBlock value={task.latestEvent} />
    </div>
  );
}
