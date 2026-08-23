import { useState } from "react";
import {
  App,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Typography,
} from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SendOutlined,
} from "@ant-design/icons";
import { useApp } from "../AppContext";
import {
  platformApi,
  type AlertEvent,
  type AlertRule,
  type NotificationChannel,
} from "../api";
import { useAsync, useDisclosure } from "../hooks";
import {
  ConfirmDialog,
  Field,
  FormActions,
  Modal,
  PageState,
  SectionHeader,
  StatusBadge,
  formatTime,
  useToast,
} from "../ui";
import styles from "../App.module.css";
export function AlertsPage() {
  const { token, selectedTenantId, canWrite, canAdminister, realtimeVersion } =
    useApp();
  const rules = useAsync(
    () => platformApi.alertRules(token, selectedTenantId || undefined),
    [token, selectedTenantId, realtimeVersion],
  );
  const channels = useAsync(
    () =>
      selectedTenantId
        ? platformApi.notificationChannels(token, selectedTenantId)
        : Promise.resolve([]),
    [token, selectedTenantId],
  );
  const notifications = useAsync(
    () =>
      platformApi.notifications(token, {
        tenantId: selectedTenantId || undefined,
        page: 1,
        pageSize: 30,
      }),
    [token, selectedTenantId, realtimeVersion],
  );
  const channelForm = useDisclosure();
  const events = useAsync(
    () =>
      platformApi.alertEvents(token, {
        tenantId: selectedTenantId || undefined,
        page: 1,
        pageSize: 50,
      }),
    [token, selectedTenantId],
  );
  const form = useDisclosure();
  const [edit, setEdit] = useState<AlertRule>();
  const [remove, setRemove] = useState<AlertRule>();
  const toast = useToast();
  const { modal } = App.useApp();
  const acknowledge = async (item: AlertEvent) => {
    try {
      await platformApi.acknowledgeAlert(token, item.id);
      toast.success("告警已确认");
      await events.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "确认失败");
    }
  };
  const silence = (item: AlertEvent) => {
    let minutes = 60;
    modal.confirm({
      title: "静默告警",
      content: (
        <InputNumber
          min={1}
          max={10080}
          defaultValue={60}
          addonAfter="分钟"
          onChange={(value) => {
            minutes = Number(value) || 60;
          }}
        />
      ),
      okText: "确认静默",
      cancelText: "取消",
      onOk: async () => {
        await platformApi.silenceAlert(token, item.id, minutes);
        toast.success(`告警已静默 ${minutes} 分钟`);
        await events.refresh();
      },
    });
  };
  return (
    <>
      <div className={styles.alertLayout}>
        <section className={styles.panel}>
          <SectionHeader
            title="活动告警"
            description="触发、确认、静默和恢复状态"
          />
          <PageState
            loading={events.loading}
            error={events.error}
            empty={!events.data?.items.length ? "当前没有告警事件" : undefined}
          >
            <div className={styles.alertList}>
              {events.data?.items.map((item) => (
                <Card
                  size="small"
                  key={item.id}
                  className={styles[`severity_${item.severity}`]}
                >
                  <header>
                    <StatusBadge value={item.status} />
                    <span>{item.severity}</span>
                    <time>{formatTime(item.openedAt)}</time>
                  </header>
                  <h3>{item.ruleName}</h3>
                  <p>{item.message}</p>
                  <dl>
                    <div>
                      <dt>当前值</dt>
                      <dd>{item.value.toFixed(2)}</dd>
                    </div>
                    <div>
                      <dt>指纹</dt>
                      <dd>{item.fingerprint.slice(0, 12)}</dd>
                    </div>
                  </dl>
                  {canAdminister && item.status !== "resolved" && (
                    <footer>
                      <Button
                        size="small"
                        onClick={() => void acknowledge(item)}
                      >
                        确认
                      </Button>
                      <Button size="small" onClick={() => silence(item)}>
                        静默
                      </Button>
                    </footer>
                  )}
                </Card>
              ))}
            </div>
          </PageState>
        </section>
        <section className={styles.panel}>
          <SectionHeader
            title="告警规则"
            description="Worker 每个健康检查周期计算规则"
            actions={
              canAdminister ? (
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => {
                    setEdit(undefined);
                    form.show();
                  }}
                >
                  创建规则
                </Button>
              ) : undefined
            }
          />
          <PageState
            loading={rules.loading}
            error={rules.error}
            empty={!rules.data?.length ? "尚未创建告警规则" : undefined}
          >
            <div className={styles.ruleList}>
              {rules.data?.map((rule) => (
                <Card key={rule.id} size="small">
                  <header>
                    <span>
                      <h3>{rule.name}</h3>
                      <small>{rule.metric}</small>
                    </span>
                    <StatusBadge value={rule.enabled ? "active" : "disabled"} />
                  </header>
                  <p>
                    {rule.windowMinutes} 分钟窗口 ·{" "}
                    {rule.operator === "gt" ? "大于" : "小于"} {rule.threshold}{" "}
                    · {rule.severity}
                  </p>
                  {canAdminister && (
                    <footer>
                      <Button
                        size="small"
                        icon={<EditOutlined />}
                        onClick={() => {
                          setEdit(rule);
                          form.show();
                        }}
                      >
                        编辑
                      </Button>
                      <Button
                        size="small"
                        onClick={() =>
                          void platformApi
                            .updateAlertRule(token, rule.id, {
                              enabled: !rule.enabled,
                            })
                            .then(() => rules.refresh())
                        }
                      >
                        {rule.enabled ? "停用" : "启用"}
                      </Button>
                      <Button
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => setRemove(rule)}
                      >
                        删除
                      </Button>
                    </footer>
                  )}
                </Card>
              ))}
            </div>
          </PageState>
        </section>
      </div>
      <div className={styles.alertLayout}>
        <section className={styles.panel}>
          <SectionHeader
            title="通知渠道"
            description="告警触发与恢复会进入持久投递队列"
            actions={
              canAdminister && selectedTenantId ? (
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={channelForm.show}
                >
                  新增渠道
                </Button>
              ) : undefined
            }
          />
          {!selectedTenantId ? (
            <PageState empty="请选择具体租户以管理通知渠道" />
          ) : (
            <PageState
              loading={channels.loading}
              error={channels.error}
              empty={!channels.data?.length ? "尚未配置通知渠道" : undefined}
            >
              <div className={styles.ruleList}>
                {channels.data?.map((channel) => (
                  <Card key={channel.id} size="small">
                    <header>
                      <span>
                        <h3>{channel.name}</h3>
                        <small>
                          {channel.type} · {channel.destination}
                        </small>
                      </span>
                      <StatusBadge
                        value={channel.enabled ? "active" : "disabled"}
                      />
                    </header>
                    <p>
                      最多 {channel.config.maxAttempts} 次 · 超时{" "}
                      {channel.config.timeoutMs}ms ·{" "}
                      {channel.signingConfigured ? "签名已配置" : "无签名"}
                    </p>
                    {canWrite && (
                      <footer>
                        <Button
                          size="small"
                          icon={<SendOutlined />}
                          onClick={() =>
                            void platformApi
                              .testNotificationChannel(
                                token,
                                selectedTenantId,
                                channel.id,
                              )
                              .then(() => {
                                toast.success("测试通知已入队");
                                return notifications.refresh();
                              })
                              .catch((error) => toast.error(error.message))
                          }
                        >
                          测试
                        </Button>
                        {canAdminister && (
                          <>
                            <Button
                              size="small"
                              onClick={() =>
                                void platformApi
                                  .updateNotificationChannel(
                                    token,
                                    selectedTenantId,
                                    channel.id,
                                    { enabled: !channel.enabled },
                                  )
                                  .then(() => channels.refresh())
                              }
                            >
                              {channel.enabled ? "停用" : "启用"}
                            </Button>
                            {channel.type === "webhook" && (
                              <Button
                                size="small"
                                onClick={() =>
                                  void platformApi
                                    .rotateNotificationSecret(
                                      token,
                                      selectedTenantId,
                                      channel.id,
                                    )
                                    .then(({ signingSecret }) => {
                                      void navigator.clipboard.writeText(
                                        signingSecret,
                                      );
                                      toast.success(
                                        "新签名密钥已复制；旧密钥立即失效",
                                      );
                                    })
                                }
                              >
                                轮换密钥
                              </Button>
                            )}
                            <Button
                              size="small"
                              danger
                              icon={<DeleteOutlined />}
                              onClick={() => {
                                modal.confirm({
                                  title: "删除通知渠道",
                                  content: `确认删除“${channel.name}”？`,
                                  okText: "删除",
                                  okButtonProps: { danger: true },
                                  cancelText: "取消",
                                  onOk: () =>
                                    platformApi
                                      .deleteNotificationChannel(
                                        token,
                                        selectedTenantId,
                                        channel.id,
                                      )
                                      .then(() => channels.refresh()),
                                });
                              }}
                            >
                              删除
                            </Button>
                          </>
                        )}
                      </footer>
                    )}
                  </Card>
                ))}
              </div>
            </PageState>
          )}
        </section>
        <section className={styles.panel}>
          <SectionHeader
            title="通知记录"
            description="控制台、Webhook 与邮件的发送状态"
          />
          <PageState
            loading={notifications.loading}
            error={notifications.error}
            empty={
              !notifications.data?.items.length ? "暂无通知记录" : undefined
            }
          >
            <div className={styles.historyList}>
              {notifications.data?.items.map((record) => (
                <div key={record.id}>
                  <StatusBadge value={record.status} />
                  <span>
                    <b>
                      {record.eventType ?? "平台通知"} ·{" "}
                      {record.channelName ?? record.channel}
                    </b>
                    <small>
                      {formatTime(record.createdAt)} · 尝试 {record.attempt}/
                      {record.maxAttempts}
                    </small>
                    {record.errorMessage && <p>{record.errorMessage}</p>}
                  </span>
                  {canWrite &&
                    record.channelId &&
                    ["failed", "suppressed"].includes(record.status) && (
                      <Button
                        size="small"
                        onClick={() =>
                          void platformApi
                            .replayNotification(token, record.id)
                            .then(() => notifications.refresh())
                        }
                      >
                        重放
                      </Button>
                    )}
                </div>
              ))}
            </div>
          </PageState>
        </section>
      </div>
      {form.open && (
        <AlertRuleForm
          rule={edit}
          close={form.hide}
          saved={async () => {
            form.hide();
            await rules.refresh();
          }}
        />
      )}
      {remove && (
        <ConfirmDialog
          title="删除告警规则"
          danger
          confirmText="删除"
          message={`删除规则“${remove.name}”？历史告警事件会随规则删除。`}
          onClose={() => setRemove(undefined)}
          onConfirm={async () => {
            await platformApi.deleteAlertRule(token, remove.id);
            toast.success("告警规则已删除");
            await rules.refresh();
          }}
        />
      )}
      {channelForm.open && selectedTenantId && (
        <NotificationChannelForm
          tenantId={selectedTenantId}
          close={channelForm.hide}
          saved={async (secret) => {
            channelForm.hide();
            await channels.refresh();
            if (secret) {
              await navigator.clipboard.writeText(secret);
              toast.success("渠道已创建，签名密钥已复制且仅显示一次");
            }
          }}
        />
      )}
    </>
  );
}

function NotificationChannelForm({
  tenantId,
  close,
  saved,
}: {
  tenantId: string;
  close: () => void;
  saved: (secret?: string) => Promise<void>;
}) {
  const { token } = useApp();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    type: "webhook" as NotificationChannel["type"],
    destination: "",
    timeoutMs: 5000,
    maxAttempts: 5,
    subjectPrefix: "[A2A Platform]",
  });
  const submit = async () => {
    setBusy(true);
    try {
      const channel = await platformApi.createNotificationChannel(
        token,
        tenantId,
        {
          name: form.name,
          type: form.type,
          destination: form.destination,
          enabled: true,
          config: {
            timeoutMs: form.timeoutMs,
            maxAttempts: form.maxAttempts,
            subjectPrefix: form.subjectPrefix,
          },
        },
      );
      await saved(channel.signingSecret);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "渠道创建失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="新增通知渠道"
      description="Webhook 签名密钥只会展示一次"
      onClose={close}
    >
      <Form
        className={styles.formGrid}
        layout="vertical"
        onFinish={() => void submit()}
      >
        <Field label="渠道名称">
          <Input
            required
            minLength={2}
            value={form.name}
            onChange={(event) =>
              setForm((value) => ({ ...value, name: event.target.value }))
            }
          />
        </Field>
        <Field label="渠道类型">
          <Select
            value={form.type}
            options={[
              { value: "webhook", label: "签名 Webhook" },
              { value: "email", label: "邮件" },
            ]}
            onChange={(type) =>
              setForm((value) => ({
                ...value,
                type: type as NotificationChannel["type"],
                destination: "",
              }))
            }
          />
        </Field>
        <Field label={form.type === "webhook" ? "目标 URL" : "收件邮箱"}>
          <Input
            required
            type={form.type === "webhook" ? "url" : "email"}
            value={form.destination}
            onChange={(event) =>
              setForm((value) => ({
                ...value,
                destination: event.target.value,
              }))
            }
          />
        </Field>
        <div className={styles.limitGrid}>
          <Field label="超时 ms">
            <InputNumber
              style={{ width: "100%" }}
              min={500}
              max={30000}
              value={form.timeoutMs}
              onChange={(number) =>
                setForm((value) => ({
                  ...value,
                  timeoutMs: Number(number),
                }))
              }
            />
          </Field>
          <Field label="最大尝试">
            <InputNumber
              style={{ width: "100%" }}
              min={1}
              max={12}
              value={form.maxAttempts}
              onChange={(number) =>
                setForm((value) => ({
                  ...value,
                  maxAttempts: Number(number),
                }))
              }
            />
          </Field>
        </div>
        {form.type === "email" && (
          <Field label="邮件主题前缀">
            <Input
              value={form.subjectPrefix}
              onChange={(event) =>
                setForm((value) => ({
                  ...value,
                  subjectPrefix: event.target.value,
                }))
              }
            />
          </Field>
        )}
        <FormActions cancel={close} submit="创建渠道" busy={busy} />
      </Form>
    </Modal>
  );
}
function AlertRuleForm({
  rule,
  close,
  saved,
}: {
  rule?: AlertRule;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const { token, selectedTenantId } = useApp();
  const toast = useToast();
  const [form, setForm] = useState({
    tenantId: rule?.tenantId ?? (selectedTenantId || undefined),
    name: rule?.name ?? "",
    metric: rule?.metric ?? "agent_unhealthy",
    operator: rule?.operator ?? "gt",
    threshold: rule?.threshold ?? 1,
    windowMinutes: rule?.windowMinutes ?? 5,
    severity: rule?.severity ?? "warning",
    cooldownMinutes: rule?.cooldownMinutes ?? 15,
    enabled: rule?.enabled ?? true,
  });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      if (rule)
        await platformApi.updateAlertRule(
          token,
          rule.id,
          form as Partial<AlertRule>,
        );
      else
        await platformApi.createAlertRule(
          token,
          form as Partial<AlertRule> & {
            name: string;
            metric: string;
            operator: "gt" | "lt";
            threshold: number;
          },
        );
      toast.success(rule ? "规则已更新" : "规则已创建");
      await saved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={rule ? "编辑告警规则" : "创建告警规则"} onClose={close}>
      <Form
        className={styles.formGrid}
        layout="vertical"
        onFinish={() => void submit()}
      >
        <Field label="规则名称">
          <Input
            required
            value={form.name}
            onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))}
          />
        </Field>
        <Field label="指标">
          <Select
            value={form.metric}
            options={[
              { value: "agent_unhealthy", label: "Agent 不健康数量" },
              { value: "request_error_rate", label: "请求错误率 %" },
              { value: "latency_ms", label: "平均延迟 ms" },
              { value: "quota_usage_percent", label: "月配额使用率 %" },
            ]}
            onChange={(metric) => setForm((value) => ({ ...value, metric }))}
          />
        </Field>
        <div className={styles.limitGrid}>
          <Field label="比较">
            <Select
              value={form.operator}
              options={[
                { value: "gt", label: "大于" },
                { value: "lt", label: "小于" },
              ]}
              onChange={(operator) =>
                setForm((v) => ({
                  ...v,
                  operator: operator as "gt" | "lt",
                }))
              }
            />
          </Field>
          <Field label="阈值">
            <InputNumber
              style={{ width: "100%" }}
              min={0}
              value={form.threshold}
              onChange={(number) =>
                setForm((v) => ({ ...v, threshold: Number(number) }))
              }
            />
          </Field>
          <Field label="窗口（分钟）">
            <InputNumber
              style={{ width: "100%" }}
              min={1}
              max={1440}
              value={form.windowMinutes}
              onChange={(number) =>
                setForm((v) => ({
                  ...v,
                  windowMinutes: Number(number),
                }))
              }
            />
          </Field>
          <Field label="冷却（分钟）">
            <InputNumber
              style={{ width: "100%" }}
              min={1}
              value={form.cooldownMinutes}
              onChange={(number) =>
                setForm((v) => ({
                  ...v,
                  cooldownMinutes: Number(number),
                }))
              }
            />
          </Field>
        </div>
        <Field label="严重级别">
          <Select
            value={form.severity}
            options={[
              { value: "info", label: "提示" },
              { value: "warning", label: "警告" },
              { value: "critical", label: "严重" },
            ]}
            onChange={(severity) =>
              setForm((v) => ({
                ...v,
                severity: severity as AlertRule["severity"],
              }))
            }
          />
        </Field>
        <FormActions cancel={close} submit="保存规则" busy={busy} />
      </Form>
    </Modal>
  );
}
