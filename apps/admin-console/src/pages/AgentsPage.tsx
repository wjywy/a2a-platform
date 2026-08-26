import { useEffect, useMemo, useState } from "react";
import {
  App,
  Avatar,
  Button,
  Card,
  Collapse,
  Flex,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  HeartOutlined,
  PlusOutlined,
  ReloadOutlined,
  RightOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { useApp } from "../AppContext";
import {
  platformApi,
  type Agent,
  type CatalogAgent,
  type CardRevision,
  type HealthCheck,
  type AgentInstance,
} from "../api";
import { useAsync, useDisclosure } from "../hooks";
import {
  CodeBlock,
  ConfirmDialog,
  Drawer,
  Field,
  FormActions,
  Modal,
  PageState,
  Pagination,
  SectionHeader,
  StatusBadge,
  formatTime,
  useToast,
} from "../ui";
import styles from "../App.module.css";
const isCatalogAgent = (agent: Agent): agent is CatalogAgent =>
  "access" in agent;
export function AgentsPage({ openRegister }: { openRegister: () => void }) {
  const {
    token,
    user,
    agents,
    agentPage,
    refreshAgents,
    tenants,
    canWrite,
    canAdminister,
  } = useApp();
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const catalogMode = user.platformRole !== "platform_admin";
  const [selected, setSelected] = useState<Agent>();
  const [confirm, setConfirm] = useState<{
    agent: Agent;
    action: "online" | "offline" | "delete";
  }>();
  const edit = useDisclosure();
  const toast = useToast();
  const selectedManageable = Boolean(
    canWrite && selected && (!isCatalogAgent(selected) || selected.manageable),
  );
  const selectedAdministrable = Boolean(
    canAdminister &&
    selected &&
    (!isCatalogAgent(selected) || selected.administrable),
  );
  const visible = useMemo(
    () =>
      catalogMode
        ? agents
        : agents.filter(
            (agent) =>
              (!status || agent.status === status) &&
              `${agent.displayName} ${agent.slug} ${agent.labels.join(" ")}`
                .toLowerCase()
                .includes(search.toLowerCase()),
          ),
    [agents, status, search, catalogMode],
  );
  useEffect(() => {
    if (!catalogMode) return;
    const timer = window.setTimeout(
      () =>
        void refreshAgents({
          page,
          pageSize: 20,
          search: search || undefined,
          status: status || undefined,
        }),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [catalogMode, page, refreshAgents, search, status]);
  useEffect(() => {
    if (!selected && agents.length) setSelected(agents[0]);
    else if (selected)
      setSelected(agents.find((agent) => agent.id === selected.id));
  }, [agents, selected]);
  const action = async () => {
    if (!confirm) return;
    if (confirm.action === "delete")
      await platformApi.removeAgent(token, confirm.agent.slug);
    else
      await platformApi.agentStatus(token, confirm.agent.slug, confirm.action);
    toast.success(
      confirm.action === "delete"
        ? "Agent 已删除"
        : `Agent 已${confirm.action === "online" ? "上线" : "下线"}`,
    );
    await refreshAgents();
    setConfirm(undefined);
  };
  return (
    <>
      <div className={styles.splitWorkspace}>
        <section className={styles.agentListPanel}>
          <SectionHeader
            title="Agent 列表"
            description={`${agents.length} 个${canWrite ? "已注册" : "当前可见"}服务`}
            actions={
              canWrite ? (
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={openRegister}
                >
                  注册 Agent
                </Button>
              ) : undefined
            }
          />
          <div className={styles.toolbar}>
            <Input
              prefix={<SearchOutlined />}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="名称、slug 或标签"
            />
            <Select
              value={status}
              options={[
                { value: "", label: "全部状态" },
                { value: "online", label: "已上线" },
                { value: "degraded", label: "已降级" },
                { value: "offline", label: "已下线" },
              ]}
              onChange={(value) => {
                setStatus(value);
                setPage(1);
              }}
            />
          </div>
          <PageState empty={!visible.length ? "没有匹配的 Agent" : undefined}>
            <div className={styles.agentGrid}>
              {visible.map((agent) => (
                <Card
                  key={agent.id}
                  variant="outlined"
                  className={`${styles.agentCard} ${selected?.id === agent.id ? styles.agentCardActive : ""}`}
                >
                  <Button
                    type="text"
                    block
                    className={styles.agentCardAction}
                    onClick={() => setSelected(agent)}
                  >
                    <span className={styles.agentTileContent}>
                      <header>
                        <b>{agent.displayName.slice(0, 1)}</b>
                        <span>
                          <strong>{agent.displayName}</strong>
                          <small>/{agent.slug}</small>
                        </span>
                        <StatusBadge value={agent.status} />
                      </header>
                      <p title={agent.description ? undefined : agent.cardUrl}>
                        {agent.description || agent.cardUrl}
                      </p>
                      <footer>
                        <span>{agent.selectedInterface.protocolBinding}</span>
                        <StatusBadge value={agent.healthStatus} />
                      </footer>
                    </span>
                  </Button>
                </Card>
              ))}
            </div>
          </PageState>
          {catalogMode && (
            <Pagination
              page={agentPage.page}
              totalPages={agentPage.totalPages}
              total={agentPage.total}
              onChange={setPage}
            />
          )}
        </section>
        <aside className={styles.panel}>
          {selected ? (
            <>
              <SectionHeader
                title={selected.displayName}
                description={`/${selected.slug}`}
                actions={<StatusBadge value={selected.status} />}
              />
              {selectedManageable && (
                <Space wrap className={styles.buttonRow}>
                  {selected.status === "online" ||
                  selected.status === "degraded" ? (
                    <Button
                      onClick={() =>
                        setConfirm({ agent: selected, action: "offline" })
                      }
                    >
                      下线
                    </Button>
                  ) : (
                    <Button
                      type="primary"
                      onClick={() =>
                        setConfirm({ agent: selected, action: "online" })
                      }
                    >
                      上线
                    </Button>
                  )}
                  <Button icon={<EditOutlined />} onClick={edit.show}>
                    编辑
                  </Button>
                  <Button
                    icon={<HeartOutlined />}
                    onClick={() =>
                      void platformApi
                        .healthCheck(token, selected.slug)
                        .then(() => {
                          toast.success("健康检查已完成");
                          return refreshAgents();
                        })
                        .catch((e) => toast.error(e.message))
                    }
                  >
                    健康检查
                  </Button>
                </Space>
              )}
              <AgentDetails agent={selected} />
              {selectedManageable && <AgentOperations agent={selected} />}
              {selectedAdministrable && (
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  disabled={
                    selected.status === "online" ||
                    selected.status === "degraded"
                  }
                  onClick={() =>
                    setConfirm({ agent: selected, action: "delete" })
                  }
                >
                  删除 Agent
                </Button>
              )}
            </>
          ) : (
            <PageState empty="请选择一个 Agent" />
          )}
        </aside>
      </div>
      {confirm && (
        <ConfirmDialog
          title={
            confirm.action === "delete"
              ? "删除 Agent"
              : confirm.action === "online"
                ? "上线 Agent"
                : "下线 Agent"
          }
          danger={confirm.action !== "online"}
          message={
            confirm.action === "online"
              ? "平台会先执行健康检查，检查通过后才开始接收平台代理流量。"
              : confirm.action === "offline"
                ? "只停止平台新流量，不会终止远端 Agent 进程。"
                : `确认删除 ${confirm.agent.displayName}？健康历史、任务关联会按数据保留策略处理。`
          }
          confirmText={confirm.action === "delete" ? "删除" : "确认"}
          onClose={() => setConfirm(undefined)}
          onConfirm={action}
        />
      )}{" "}
      {edit.open && selected && (
        <AgentEditForm
          agent={selected}
          tenants={tenants}
          close={edit.hide}
          saved={async () => {
            edit.hide();
            await refreshAgents();
          }}
        />
      )}
    </>
  );
}
function AgentDetails({ agent }: { agent: Agent }) {
  const { tenants } = useApp();
  const catalogAgent = isCatalogAgent(agent) ? agent : undefined;
  return (
    <dl className={styles.detailList}>
      <div>
        <dt>所属租户</dt>
        <dd>
          {tenants.find((t) => t.id === agent.tenantId)?.displayName ??
            (catalogAgent?.access === "public" ? "公开服务" : "未分配")}
        </dd>
      </div>
      {catalogAgent && (
        <div>
          <dt>访问来源</dt>
          <dd>
            {catalogAgent.access === "public"
              ? "公开可见"
              : catalogAgent.access === "tenant_owner"
                ? "所属租户"
                : catalogAgent.access === "tenant_grant"
                  ? "租户授权"
                  : "平台管理"}
          </dd>
        </div>
      )}
      <div>
        <dt>可见性</dt>
        <dd>{agent.visibility}</dd>
      </div>
      <div>
        <dt>{catalogAgent ? "调用 Card" : "Card URL"}</dt>
        <dd title={agent.cardUrl}>{agent.cardUrl}</dd>
      </div>
      <div>
        <dt>{catalogAgent ? "平台代理接口" : "远端接口"}</dt>
        <dd title={agent.selectedInterface.url}>
          {agent.selectedInterface.protocolBinding} ·{" "}
          {agent.selectedInterface.protocolVersion}
        </dd>
      </div>
      <div>
        <dt>调用策略</dt>
        <dd>
          {agent.invocationPolicy.timeoutMs}ms ·{" "}
          {agent.invocationPolicy.maxRetries} 次重试 ·{" "}
          {agent.invocationPolicy.maxConcurrent} 并发
        </dd>
      </div>
      <div>
        <dt>实例路由</dt>
        <dd>{agent.routingStrategy}</dd>
      </div>
      <div>
        <dt>标签</dt>
        <dd>{agent.labels.join("、") || "—"}</dd>
      </div>
    </dl>
  );
}
function AgentOperations({ agent }: { agent: Agent }) {
  const { token, canWrite, canAdminister } = useApp();
  const toast = useToast();
  const { modal } = App.useApp();
  const [drawer, setDrawer] = useState<"health" | "card" | "instances">();
  const instanceForm = useDisclosure();
  const health = useAsync(
    () =>
      drawer === "health"
        ? platformApi.health(token, agent.slug)
        : Promise.resolve([] as HealthCheck[]),
    [token, agent.slug, drawer],
    { immediate: !!drawer },
  );
  const revisions = useAsync(
    () =>
      drawer === "card"
        ? platformApi.cardRevisions(token, agent.slug)
        : Promise.resolve([] as CardRevision[]),
    [token, agent.slug, drawer],
    { immediate: !!drawer },
  );
  const instances = useAsync(
    () =>
      drawer === "instances"
        ? platformApi.agentInstances(token, agent.slug)
        : Promise.resolve([] as AgentInstance[]),
    [token, agent.slug, drawer],
    { immediate: !!drawer },
  );
  const refresh = async () => {
    try {
      const result = await platformApi.refreshCard(token, agent.slug);
      toast.success(
        result.diff.changed
          ? "Card 已刷新并检测到变化"
          : "Card 已刷新，没有能力变化",
      );
      setDrawer("card");
      await revisions.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Card 刷新失败");
    }
  };
  return (
    <>
      <div className={styles.operationList}>
        <Button type="text" block onClick={() => setDrawer("instances")}>
          <span className={styles.operationRow}>
            <span>
              <b>后端实例</b>
              <small>路由、权重、凭据与实例健康</small>
            </span>
            <RightOutlined />
          </span>
        </Button>
        <Button type="text" block onClick={() => setDrawer("health")}>
          <span className={styles.operationRow}>
            <span>
              <b>健康历史</b>
              <small>最近 30 次检查</small>
            </span>
            <RightOutlined />
          </span>
        </Button>
        {canWrite && (
          <Button type="text" block onClick={() => void refresh()}>
            <span className={styles.operationRow}>
              <span>
                <b>刷新 Agent Card</b>
                <small>校验能力并保存差异版本</small>
              </span>
              <ReloadOutlined />
            </span>
          </Button>
        )}
        <Button type="text" block onClick={() => setDrawer("card")}>
          <span className={styles.operationRow}>
            <span>
              <b>Card 版本</b>
              <small>能力与接口变化记录</small>
            </span>
            <RightOutlined />
          </span>
        </Button>
      </div>
      {drawer && (
        <Drawer
          title={
            drawer === "health"
              ? "健康检查历史"
              : drawer === "card"
                ? "Agent Card 版本"
                : "后端实例"
          }
          subtitle={agent.displayName}
          onClose={() => setDrawer(undefined)}
        >
          <PageState
            loading={
              drawer === "health"
                ? health.loading
                : drawer === "card"
                  ? revisions.loading
                  : instances.loading
            }
            error={
              drawer === "health"
                ? health.error
                : drawer === "card"
                  ? revisions.error
                  : instances.error
            }
          >
            {drawer === "health" ? (
              <div className={styles.historyList}>
                {health.data?.map((item, index) => (
                  <div key={`${item.checkedAt}-${index}`}>
                    <StatusBadge
                      value={item.success ? "healthy" : "unhealthy"}
                    />
                    <span>
                      <b>{item.latencyMs ?? "—"} ms</b>
                      <small>{formatTime(item.checkedAt)}</small>
                      {item.errorMessage && <p>{item.errorMessage}</p>}
                    </span>
                  </div>
                ))}
              </div>
            ) : drawer === "card" ? (
              <Collapse
                className={styles.revisionList}
                size="small"
                items={revisions.data?.map((item) => ({
                  key: item.id,
                  label: `版本 ${item.version}`,
                  extra: (
                    <Space>
                      <Typography.Text type="secondary">
                        {item.fetchedBy} · {formatTime(item.fetchedAt)}
                      </Typography.Text>
                      <Tag
                        color={
                          item.changeSummary.changed ? "warning" : "default"
                        }
                      >
                        {item.changeSummary.changed ? "有变化" : "初始/无变化"}
                      </Tag>
                    </Space>
                  ),
                  children: <CodeBlock value={item.changeSummary} />,
                }))}
              />
            ) : (
              <div>
                {canWrite && (
                  <div className={styles.drawerActions}>
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      onClick={instanceForm.show}
                    >
                      新增实例
                    </Button>
                  </div>
                )}
                <div className={styles.historyList}>
                  {instances.data?.map((instance) => (
                    <div key={instance.id}>
                      <StatusBadge value={instance.healthStatus} />
                      <span>
                        <b>{instance.name}</b>
                        <small>
                          {instance.selectedInterface.protocolBinding} · 权重{" "}
                          {instance.weight} · 优先级 {instance.priority}
                        </small>
                        <p title={instance.selectedInterface.url}>
                          {instance.selectedInterface.url}
                        </p>
                        <small>
                          凭据：
                          {instance.credential.configured
                            ? instance.credential.type
                            : "未配置"}{" "}
                          · 活跃请求 {instance.activeRequests}
                        </small>
                        {instance.lastError && <p>{instance.lastError}</p>}
                      </span>
                      {canWrite && (
                        <div className={styles.inlineActions}>
                          <Button
                            size="small"
                            onClick={() =>
                              void platformApi
                                .checkAgentInstance(
                                  token,
                                  agent.slug,
                                  instance.id,
                                )
                                .then(() => instances.refresh())
                                .catch((error) => toast.error(error.message))
                            }
                          >
                            检查
                          </Button>
                          <Button
                            size="small"
                            onClick={() =>
                              void platformApi
                                .updateAgentInstance(
                                  token,
                                  agent.slug,
                                  instance.id,
                                  {
                                    status:
                                      instance.status === "active"
                                        ? "disabled"
                                        : "active",
                                  },
                                )
                                .then(() => instances.refresh())
                            }
                          >
                            {instance.status === "active" ? "停用" : "启用"}
                          </Button>
                          {canAdminister && (
                            <Button
                              size="small"
                              danger
                              icon={<DeleteOutlined />}
                              onClick={() => {
                                modal.confirm({
                                  title: "删除后端实例",
                                  content: `确认删除实例“${instance.name}”？`,
                                  okText: "删除",
                                  okButtonProps: { danger: true },
                                  cancelText: "取消",
                                  onOk: () =>
                                    platformApi
                                      .deleteAgentInstance(
                                        token,
                                        agent.slug,
                                        instance.id,
                                      )
                                      .then(() => instances.refresh()),
                                });
                              }}
                            >
                              删除
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {!instances.data?.length && (
                  <PageState empty="尚未配置后端实例" />
                )}
              </div>
            )}
          </PageState>
        </Drawer>
      )}
      {instanceForm.open && (
        <InstanceForm
          agent={agent}
          close={instanceForm.hide}
          saved={async () => {
            instanceForm.hide();
            setDrawer("instances");
            await instances.refresh();
          }}
        />
      )}
    </>
  );
}
function AgentEditForm({
  agent,
  tenants,
  close,
  saved,
}: {
  agent: Agent;
  tenants: ReturnType<typeof useApp>["tenants"];
  close: () => void;
  saved: () => Promise<void>;
}) {
  const { token } = useApp();
  const toast = useToast();
  const [form, setForm] = useState({
    ...agent,
    labelsText: agent.labels.join(","),
  });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await platformApi.updateAgent(token, agent.slug, {
        displayName: form.displayName,
        description: form.description,
        labels: form.labelsText
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
        tenantId: form.tenantId || undefined,
        visibility: form.visibility,
        invocationPolicy: form.invocationPolicy,
        routingStrategy: form.routingStrategy,
      });
      toast.success("Agent 配置已更新");
      await saved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="编辑 Agent"
      description="修改平台治理配置不会改写远端 Agent Card"
      onClose={close}
    >
      <Form
        className={styles.formGrid}
        layout="vertical"
        onFinish={() => void submit()}
      >
        <Field label="显示名称">
          <Input
            required
            value={form.displayName}
            onChange={(e) =>
              setForm((v) => ({ ...v, displayName: e.target.value }))
            }
          />
        </Field>
        <Field label="描述">
          <Input.TextArea
            rows={3}
            value={form.description}
            onChange={(e) =>
              setForm((v) => ({ ...v, description: e.target.value }))
            }
          />
        </Field>
        <Field label="所属租户">
          <Select
            value={form.tenantId ?? ""}
            options={[
              { value: "", label: "未分配" },
              ...tenants.map((tenant) => ({
                value: tenant.id,
                label: tenant.displayName,
              })),
            ]}
            onChange={(tenantId) =>
              setForm((value) => ({ ...value, tenantId }))
            }
          />
        </Field>
        <Field label="可见性">
          <Select
            value={form.visibility}
            options={[
              { value: "private", label: "私有（仅所属租户）" },
              { value: "tenant", label: "授权租户" },
              { value: "public", label: "公开（仍需 API Key）" },
            ]}
            onChange={(visibility) =>
              setForm((v) => ({
                ...v,
                visibility: visibility as Agent["visibility"],
              }))
            }
          />
        </Field>
        <Field label="标签" hint="使用英文逗号分隔，最多 8 个">
          <Input
            value={form.labelsText}
            onChange={(e) =>
              setForm((v) => ({ ...v, labelsText: e.target.value }))
            }
          />
        </Field>
        <Field label="实例路由策略">
          <Select
            value={form.routingStrategy}
            options={[
              { value: "weighted_round_robin", label: "按权重分配" },
              { value: "least_connections", label: "最少连接" },
              { value: "priority", label: "优先级故障转移" },
            ]}
            onChange={(routingStrategy) =>
              setForm((value) => ({
                ...value,
                routingStrategy: routingStrategy as Agent["routingStrategy"],
              }))
            }
          />
        </Field>
        <div className={styles.limitGrid}>
          <Field label="超时 ms">
            <InputNumber
              style={{ width: "100%" }}
              min={1000}
              value={form.invocationPolicy.timeoutMs}
              onChange={(number) =>
                setForm((v) => ({
                  ...v,
                  invocationPolicy: {
                    ...v.invocationPolicy,
                    timeoutMs: Number(number),
                  },
                }))
              }
            />
          </Field>
          <Field label="重试次数">
            <InputNumber
              style={{ width: "100%" }}
              min={0}
              max={5}
              value={form.invocationPolicy.maxRetries}
              onChange={(number) =>
                setForm((v) => ({
                  ...v,
                  invocationPolicy: {
                    ...v.invocationPolicy,
                    maxRetries: Number(number),
                  },
                }))
              }
            />
          </Field>
          <Field label="最大并发">
            <InputNumber
              style={{ width: "100%" }}
              min={1}
              value={form.invocationPolicy.maxConcurrent}
              onChange={(number) =>
                setForm((v) => ({
                  ...v,
                  invocationPolicy: {
                    ...v.invocationPolicy,
                    maxConcurrent: Number(number),
                  },
                }))
              }
            />
          </Field>
        </div>
        <FormActions cancel={close} submit="保存配置" busy={busy} />
      </Form>
    </Modal>
  );
}

function InstanceForm({
  agent,
  close,
  saved,
}: {
  agent: Agent;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const { token } = useApp();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    cardUrl: agent.cardUrl,
    weight: 100,
    priority: 100,
    credentialType: "none" as "none" | "bearer" | "api_key",
    bearerToken: "",
    headerName: "X-API-Key",
    apiKeyValue: "",
  });
  const submit = async () => {
    setBusy(true);
    try {
      const credential =
        form.credentialType === "bearer"
          ? { type: "bearer" as const, token: form.bearerToken }
          : form.credentialType === "api_key"
            ? {
                type: "api_key" as const,
                headerName: form.headerName,
                value: form.apiKeyValue,
              }
            : { type: "none" as const };
      await platformApi.createAgentInstance(token, agent.slug, {
        name: form.name,
        cardUrl: form.cardUrl,
        weight: form.weight,
        priority: form.priority,
        status: "disabled",
        credential,
      });
      toast.success("实例已创建；完成健康检查后可启用");
      await saved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "实例创建失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="新增后端实例"
      description="同一个逻辑 Agent 可以绑定多个独立远端进程"
      onClose={close}
    >
      <Form
        className={styles.formGrid}
        layout="vertical"
        onFinish={() => void submit()}
      >
        <Field label="实例名称">
          <Input
            required
            minLength={2}
            value={form.name}
            onChange={(event) =>
              setForm((value) => ({ ...value, name: event.target.value }))
            }
          />
        </Field>
        <Field label="Agent Card URL">
          <Input
            required
            type="url"
            value={form.cardUrl}
            onChange={(event) =>
              setForm((value) => ({ ...value, cardUrl: event.target.value }))
            }
          />
        </Field>
        <div className={styles.limitGrid}>
          <Field label="流量权重">
            <InputNumber
              style={{ width: "100%" }}
              min={1}
              max={10000}
              value={form.weight}
              onChange={(number) =>
                setForm((value) => ({
                  ...value,
                  weight: Number(number),
                }))
              }
            />
          </Field>
          <Field label="故障转移优先级">
            <InputNumber
              style={{ width: "100%" }}
              min={1}
              max={10000}
              value={form.priority}
              onChange={(number) =>
                setForm((value) => ({
                  ...value,
                  priority: Number(number),
                }))
              }
            />
          </Field>
        </div>
        <Field label="上游认证">
          <Select
            value={form.credentialType}
            options={[
              { value: "none", label: "无认证" },
              { value: "bearer", label: "Bearer Token" },
              { value: "api_key", label: "API Key Header" },
            ]}
            onChange={(credentialType) =>
              setForm((value) => ({
                ...value,
                credentialType: credentialType as typeof form.credentialType,
              }))
            }
          />
        </Field>
        {form.credentialType === "bearer" && (
          <Field label="Bearer Token">
            <Input.Password
              required
              value={form.bearerToken}
              onChange={(event) =>
                setForm((value) => ({
                  ...value,
                  bearerToken: event.target.value,
                }))
              }
            />
          </Field>
        )}
        {form.credentialType === "api_key" && (
          <>
            <Field label="Header 名称">
              <Input
                required
                value={form.headerName}
                onChange={(event) =>
                  setForm((value) => ({
                    ...value,
                    headerName: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="API Key">
              <Input.Password
                required
                value={form.apiKeyValue}
                onChange={(event) =>
                  setForm((value) => ({
                    ...value,
                    apiKeyValue: event.target.value,
                  }))
                }
              />
            </Field>
          </>
        )}
        <FormActions cancel={close} submit="创建实例" busy={busy} />
      </Form>
    </Modal>
  );
}

export function RegisterAgentModal({
  close,
  saved,
}: {
  close: () => void;
  saved: () => Promise<void>;
}) {
  const { token, tenants, selectedTenantId } = useApp();
  const toast = useToast();
  const [form, setForm] = useState({
    displayName: "",
    slug: "",
    cardUrl: "",
    description: "",
    tenantId: selectedTenantId || tenants[0]?.id || "",
    visibility: "private" as Agent["visibility"],
    labels: "",
  });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await platformApi.createAgent(token, {
        ...form,
        labels: form.labels
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
        allowedTenantIds: [],
        invocationPolicy: {
          timeoutMs: 60000,
          maxRetries: 0,
          maxConcurrent: 20,
        },
      });
      toast.success("Agent Card 校验通过，已注册为下线状态");
      await saved();
    } catch (error) {
      toast.error(
        error instanceof Error ? `注册失败：${error.message}` : "注册失败",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="注册 A2A Agent"
      description="平台会读取并校验远端 Agent Card，不会启动或修改远端进程"
      onClose={close}
    >
      <Form
        className={styles.formGrid}
        layout="vertical"
        onFinish={() => void submit()}
      >
        <Field label="显示名称">
          <Input
            required
            minLength={2}
            value={form.displayName}
            onChange={(e) =>
              setForm((v) => ({ ...v, displayName: e.target.value }))
            }
          />
        </Field>
        <Field label="Agent slug" hint="用于平台发现 URL，创建后不可修改">
          <Input
            required
            pattern="[a-z0-9-]{3,64}"
            value={form.slug}
            onChange={(e) => setForm((v) => ({ ...v, slug: e.target.value }))}
          />
        </Field>
        <Field label="Agent Card 完整 URL">
          <Input
            required
            type="url"
            placeholder="http://host.docker.internal:41241/.well-known/agent-card.json"
            value={form.cardUrl}
            onChange={(e) =>
              setForm((v) => ({ ...v, cardUrl: e.target.value }))
            }
          />
        </Field>
        <Field label="所属租户">
          <Select
            value={form.tenantId}
            options={tenants.map((tenant) => ({
              value: tenant.id,
              label: tenant.displayName,
            }))}
            onChange={(tenantId) =>
              setForm((value) => ({ ...value, tenantId }))
            }
          />
        </Field>
        <Field label="描述">
          <Input.TextArea
            rows={2}
            value={form.description}
            onChange={(e) =>
              setForm((v) => ({ ...v, description: e.target.value }))
            }
          />
        </Field>
        <Field label="标签">
          <Input
            placeholder="finance, stock"
            value={form.labels}
            onChange={(e) => setForm((v) => ({ ...v, labels: e.target.value }))}
          />
        </Field>
        <FormActions cancel={close} submit="校验并注册" busy={busy} />
      </Form>
    </Modal>
  );
}
