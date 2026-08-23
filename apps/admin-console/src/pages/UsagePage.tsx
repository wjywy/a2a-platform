import { useState } from "react";
import { Button, Input, Select, Table, Tag, Typography } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import { useApp } from "../AppContext";
import { authorizedDownload, platformApi, type UsageRecord } from "../api";
import { useAsync } from "../hooks";
import {
  MetricCard,
  PageState,
  Pagination,
  SectionHeader,
  formatBytes,
  formatDuration,
  formatNumber,
  formatTime,
  useToast,
} from "../ui";
import styles from "../App.module.css";
export function UsagePage() {
  const { token, agents, selectedTenantId, realtimeVersion } = useApp();
  const [page, setPage] = useState(1);
  const [agentId, setAgentId] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState(() =>
    new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
  );
  const filters = {
    tenantId: selectedTenantId || undefined,
    agentId: agentId || undefined,
    status: status || undefined,
    from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
  };
  const summary = useAsync(
    () => platformApi.usageSummary(token, filters),
    [token, selectedTenantId, agentId, status, from, realtimeVersion],
  );
  const records = useAsync(
    () => platformApi.usage(token, { ...filters, page, pageSize: 20 }),
    [token, selectedTenantId, agentId, status, from, page, realtimeVersion],
  );
  const toast = useToast();
  const download = async () => {
    try {
      await authorizedDownload(
        platformApi.usageExportUrl(filters),
        token,
        `a2a-usage-${new Date().toISOString().slice(0, 10)}.csv`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导出失败");
    }
  };
  const value = summary.data;
  return (
    <>
      <div className={styles.metricGrid}>
        <MetricCard
          label="总请求"
          value={formatNumber(value?.totalRequests ?? 0)}
          detail={`${value?.successfulRequests ?? 0} 次成功`}
        />
        <MetricCard
          label="失败率"
          value={`${((value?.failureRate ?? 0) * 100).toFixed(2)}%`}
          detail={`${value?.failedRequests ?? 0} 次失败`}
          tone={(value?.failureRate ?? 0) > 0.05 ? "bad" : "good"}
        />
        <MetricCard
          label="平均延迟"
          value={formatDuration(value?.averageLatencyMs ?? 0)}
          detail={`P95 ${formatDuration(value?.p95LatencyMs ?? 0)}`}
        />
        <MetricCard
          label="传输数据"
          value={formatBytes(
            (value?.inputBytes ?? 0) + (value?.outputBytes ?? 0),
          )}
          detail={`入 ${formatBytes(value?.inputBytes ?? 0)} · 出 ${formatBytes(value?.outputBytes ?? 0)}`}
        />
      </div>
      <section className={styles.panel}>
        <SectionHeader
          title="用量趋势"
          description="小时粒度的请求、失败和平均延迟"
          actions={
            <Button icon={<DownloadOutlined />} onClick={() => void download()}>
              导出 CSV
            </Button>
          }
        />
        <div className={styles.toolbar}>
          <Input
            type="date"
            style={{ width: 160 }}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
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
            value={status}
            options={[
              { value: "", label: "全部结果" },
              { value: "success", label: "成功" },
              { value: "error", label: "失败" },
            ]}
            onChange={setStatus}
          />
        </div>
        <PageState loading={summary.loading} error={summary.error}>
          <div className={styles.usageChart}>
            {value?.trend.map((point) => {
              const max = Math.max(
                1,
                ...value.trend.map((item) => item.requests),
              );
              return (
                <div key={point.bucket}>
                  <div>
                    <span
                      style={{
                        height: `${Math.max(3, (point.requests / max) * 100)}%`,
                      }}
                    />
                    <i style={{ height: `${(point.failures / max) * 100}%` }} />
                  </div>
                  <small>{new Date(point.bucket).getHours()}:00</small>
                </div>
              );
            })}
            {!value?.trend.length && <p>当前范围没有调用记录</p>}
          </div>
        </PageState>
      </section>
      <section className={styles.panel}>
        <SectionHeader
          title="调用记录"
          description="记录调用方、Agent、状态码、耗时和事件大小"
        />
        <PageState
          loading={records.loading}
          error={records.error}
          empty={!records.data?.items.length ? "暂无调用记录" : undefined}
          retry={() => void records.refresh()}
        >
          <Table<UsageRecord>
            size="small"
            scroll={{ x: "max-content" }}
            rowKey="id"
            pagination={false}
            dataSource={records.data?.items ?? []}
            columns={[
              { title: "时间", dataIndex: "createdAt", render: formatTime },
              {
                title: "租户 / API Key",
                render: (_, item) => (
                  <>
                    <Typography.Text strong>{item.tenantName}</Typography.Text>
                    <br />
                    <Typography.Text type="secondary">
                      {item.apiKeyName ?? item.callerId ?? "—"}
                    </Typography.Text>
                  </>
                ),
              },
              {
                title: "Agent / 操作",
                render: (_, item) => (
                  <>
                    <Typography.Text strong>
                      {item.agentName ?? "—"}
                    </Typography.Text>
                    <br />
                    <Typography.Text type="secondary">
                      {item.agentInstanceName
                        ? `${item.agentInstanceName} · `
                        : ""}
                      {item.operation}
                    </Typography.Text>
                  </>
                ),
              },
              {
                title: "结果",
                render: (_, item) => (
                  <>
                    <Tag color={item.statusCode < 400 ? "success" : "error"}>
                      {item.statusCode}
                    </Tag>
                    {item.errorMessage && (
                      <Typography.Text type="danger">
                        {item.errorCode} · {item.errorMessage}
                      </Typography.Text>
                    )}
                  </>
                ),
              },
              { title: "耗时", dataIndex: "latencyMs", render: formatDuration },
              { title: "事件", dataIndex: "eventCount" },
              {
                title: "数据量",
                render: (_, item) =>
                  formatBytes(item.inputBytes + item.outputBytes),
              },
              {
                title: "Request ID",
                dataIndex: "requestId",
                render: (value) => (
                  <Typography.Text code>{value.slice(0, 8)}</Typography.Text>
                ),
              },
            ]}
          />
          {records.data && <Pagination {...records.data} onChange={setPage} />}
        </PageState>
      </section>
    </>
  );
}
