import { useState } from "react";
import { Input, Select, Table, Typography } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useApp } from "../AppContext";
import { platformApi, type AuditEntry } from "../api";
import { useAsync, useDebouncedValue } from "../hooks";
import {
  CodeBlock,
  Drawer,
  PageState,
  Pagination,
  SectionHeader,
  StatusBadge,
  formatTime,
} from "../ui";
import styles from "../App.module.css";
export function AuditPage() {
  const { token, selectedTenantId } = useApp();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [outcome, setOutcome] = useState("");
  const query = useDebouncedValue(search);
  const actions = useAsync(() => platformApi.auditActions(token), [token]);
  const audit = useAsync(
    () =>
      platformApi.audit(token, {
        page,
        pageSize: 30,
        tenantId: selectedTenantId || undefined,
        search: query,
        action: action || undefined,
        outcome: outcome || undefined,
      }),
    [token, page, selectedTenantId, query, action, outcome],
  );
  const [selected, setSelected] = useState<AuditEntry>();
  return (
    <>
      <section className={styles.panel}>
        <SectionHeader
          title="操作审计"
          description="所有治理写操作记录操作者、资源、请求 ID、来源和结果"
        />
        <div className={styles.toolbar}>
          <Input
            prefix={<SearchOutlined />}
            placeholder="操作者、动作或详情"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <Select
            value={action}
            options={[
              { value: "", label: "全部动作" },
              ...(actions.data?.map((value) => ({ value, label: value })) ??
                []),
            ]}
            onChange={setAction}
          />
          <Select
            value={outcome}
            options={[
              { value: "", label: "全部结果" },
              { value: "success", label: "成功" },
              { value: "failure", label: "失败" },
            ]}
            onChange={setOutcome}
          />
        </div>
        <PageState
          loading={audit.loading}
          error={audit.error}
          empty={!audit.data?.items.length ? "没有匹配的审计记录" : undefined}
          retry={() => void audit.refresh()}
        >
          <Table<AuditEntry>
            size="small"
            scroll={{ x: "max-content" }}
            rowKey="id"
            pagination={false}
            dataSource={audit.data?.items ?? []}
            onRow={(item) => ({ onClick: () => setSelected(item) })}
            columns={[
              { title: "时间", dataIndex: "createdAt", render: formatTime },
              {
                title: "动作",
                dataIndex: "action",
                render: (value) => (
                  <Typography.Text strong>{value}</Typography.Text>
                ),
              },
              { title: "操作者", dataIndex: "actorId" },
              {
                title: "租户 / 资源",
                render: (_, item) => (
                  <Typography.Text>
                    {item.resourceType ?? "—"}
                    <br />
                    <Typography.Text type="secondary">
                      {item.resourceId ?? item.agentId}
                    </Typography.Text>
                  </Typography.Text>
                ),
              },
              {
                title: "结果",
                dataIndex: "outcome",
                render: (value) => (
                  <StatusBadge
                    value={value === "success" ? "succeeded" : "failed"}
                  />
                ),
              },
              {
                title: "Request ID",
                dataIndex: "requestId",
                render: (value) => (
                  <Typography.Text code>
                    {value?.slice(0, 12) ?? "—"}
                  </Typography.Text>
                ),
              },
              {
                title: "来源",
                render: (_, item) => (
                  <span>
                    {item.ipAddress ?? "—"}
                    <br />
                    <Typography.Text type="secondary">
                      {item.userAgent?.slice(0, 30)}
                    </Typography.Text>
                  </span>
                ),
              },
            ]}
          />
          {audit.data && <Pagination {...audit.data} onChange={setPage} />}
        </PageState>
      </section>
      {selected && (
        <Drawer
          title="审计详情"
          subtitle={selected.action}
          onClose={() => setSelected(undefined)}
        >
          <dl className={styles.detailList}>
            <div>
              <dt>操作者</dt>
              <dd>{selected.actorId}</dd>
            </div>
            <div>
              <dt>动作</dt>
              <dd>{selected.action}</dd>
            </div>
            <div>
              <dt>资源</dt>
              <dd>
                {selected.resourceType} / {selected.resourceId}
              </dd>
            </div>
            <div>
              <dt>请求 ID</dt>
              <dd>{selected.requestId ?? "—"}</dd>
            </div>
            <div>
              <dt>来源 IP</dt>
              <dd>{selected.ipAddress ?? "—"}</dd>
            </div>
            <div>
              <dt>User Agent</dt>
              <dd>{selected.userAgent ?? "—"}</dd>
            </div>
            <div>
              <dt>时间</dt>
              <dd>{formatTime(selected.createdAt)}</dd>
            </div>
          </dl>
          <SectionHeader title="操作详情" />
          <CodeBlock value={selected.detail} />
        </Drawer>
      )}
    </>
  );
}
