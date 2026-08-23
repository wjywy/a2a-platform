import { useApp } from "../AppContext";
import { Button } from "antd";
import { ArrowRightOutlined } from "@ant-design/icons";
import { platformApi } from "../api";
import { useAsync } from "../hooks";
import {
  formatDuration,
  formatNumber,
  formatTime,
  MetricCard,
  PageState,
  SectionHeader,
  StatusBadge,
} from "../ui";
import styles from "../App.module.css";
export function OverviewPage({
  openAgents,
  openTasks,
  openAlerts,
}: {
  openAgents: () => void;
  openTasks: () => void;
  openAlerts: () => void;
}) {
  const { token, selectedTenantId, agents } = useApp();
  const state = useAsync(
    () => platformApi.dashboard(token, selectedTenantId || undefined),
    [token, selectedTenantId],
  );
  const value = state.data;
  return (
    <PageState
      loading={state.loading}
      error={state.error}
      retry={() => void state.refresh()}
    >
      <div className={styles.metricGrid}>
        <MetricCard
          label="已注册 Agent"
          value={formatNumber(value?.summary.totalAgents ?? 0)}
          detail={`${value?.summary.onlineAgents ?? 0} 个在线`}
          tone="neutral"
        />
        <MetricCard
          label="累计任务"
          value={formatNumber(value?.taskStats.total ?? 0)}
          detail={`${value?.taskStats.working ?? 0} 个处理中`}
          tone="neutral"
        />
        <MetricCard
          label="请求成功率"
          value={`${((1 - (value?.usage.failureRate ?? 0)) * 100).toFixed(1)}%`}
          detail={`${value?.usage.failedRequests ?? 0} 次失败`}
          tone={(value?.usage.failureRate ?? 0) > 0.05 ? "warn" : "good"}
        />
        <MetricCard
          label="P95 延迟"
          value={formatDuration(value?.usage.p95LatencyMs ?? 0)}
          detail={`平均 ${formatDuration(value?.usage.averageLatencyMs ?? 0)}`}
          tone={(value?.usage.p95LatencyMs ?? 0) > 3000 ? "warn" : "neutral"}
        />
      </div>
      <div className={styles.dashboardGrid}>
        <section className={styles.panel}>
          <SectionHeader
            title="Agent 运行状态"
            description="平台当前可见实例"
            actions={
              <Button type="link" size="small" onClick={openAgents}>
                查看全部
              </Button>
            }
          />
          <div className={styles.compactList}>
            {agents.slice(0, 7).map((agent) => (
              <Button
                type="text"
                block
                className={styles.compactAgent}
                key={agent.id}
                onClick={openAgents}
              >
                <span className={styles.compactAgentContent}>
                  <b>{agent.displayName.slice(0, 1)}</b>
                  <span>
                    <strong>{agent.displayName}</strong>
                    <small>
                      /{agent.slug} · {agent.selectedInterface.protocolBinding}
                    </small>
                  </span>
                  <StatusBadge value={agent.status} />
                  <StatusBadge value={agent.healthStatus} />
                </span>
              </Button>
            ))}
            {!agents.length && <p className={styles.inlineEmpty}>暂无 Agent</p>}
          </div>
        </section>
        <section className={styles.panel}>
          <SectionHeader
            title="任务状态"
            description="最近处理结果"
            actions={
              <Button type="link" size="small" onClick={openTasks}>
                进入任务中心
              </Button>
            }
          />
          <div className={styles.taskDistribution}>
            {[
              ["处理中", value?.taskStats.working ?? 0, "working"],
              ["已完成", value?.taskStats.completed ?? 0, "completed"],
              ["失败", value?.taskStats.failed ?? 0, "failed"],
            ].map(([label, count, tone]) => (
              <div key={String(label)}>
                <span>
                  <i className={styles[String(tone)]} />
                  {label}
                </span>
                <b>{count}</b>
              </div>
            ))}
          </div>
          <div className={styles.infoRows}>
            <div>
              <span>平均任务耗时</span>
              <b>{formatDuration(value?.taskStats.averageDurationMs ?? 0)}</b>
            </div>
            <div>
              <span>异常 Agent</span>
              <Button
                type="link"
                size="small"
                icon={<ArrowRightOutlined />}
                onClick={openAlerts}
              >
                {value?.summary.unhealthyAgents ?? 0} 个
              </Button>
            </div>
          </div>
        </section>
        <section className={`${styles.panel} ${styles.widePanel}`}>
          <SectionHeader
            title="调用趋势"
            description="按小时聚合的请求和失败次数"
          />
          <div className={styles.barChart}>
            {(value?.usage.trend ?? []).slice(-24).map((point) => {
              const max = Math.max(
                1,
                ...(value?.usage.trend ?? []).map((item) => item.requests),
              );
              return (
                <div
                  key={point.bucket}
                  title={`${formatTime(point.bucket)} · ${point.requests} 请求`}
                >
                  <span
                    style={{
                      height: `${Math.max(4, (point.requests / max) * 100)}%`,
                    }}
                  />
                  <i
                    style={{
                      height: `${Math.max(0, (point.failures / max) * 100)}%`,
                    }}
                  />
                </div>
              );
            })}
            {!value?.usage.trend.length && <p>暂无调用数据</p>}
          </div>
        </section>
        <section className={styles.panel}>
          <SectionHeader title="最近治理操作" />
          <div className={styles.timeline}>
            {value?.summary.recentAudit.slice(0, 6).map((item) => (
              <div key={item.id}>
                <i />
                <span>
                  <b>{item.action}</b>
                  <small>
                    {item.actorId} · {formatTime(item.createdAt)}
                  </small>
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </PageState>
  );
}
