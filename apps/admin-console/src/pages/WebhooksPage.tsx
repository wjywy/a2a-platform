import { useState } from "react";
import {
  Button,
  Card,
  Checkbox,
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
  PlusOutlined,
  ReloadOutlined,
  SendOutlined,
} from "@ant-design/icons";
import { useApp } from "../AppContext";
import { platformApi, type Webhook, type WebhookDelivery } from "../api";
import { useAsync, useDisclosure } from "../hooks";
import {
  CodeBlock,
  ConfirmDialog,
  CopyButton,
  Drawer,
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
const events = [
  "task.created",
  "task.working",
  "task.completed",
  "task.failed",
  "agent.degraded",
  "agent.recovered",
];
export function WebhooksPage() {
  const {
    token,
    canWrite,
    canAdminister,
    tenants,
    selectedTenantId,
    setSelectedTenantId,
  } = useApp();
  const tenantId = selectedTenantId || tenants[0]?.id || "";
  const hooks = useAsync(
    () =>
      tenantId ? platformApi.webhooks(token, tenantId) : Promise.resolve([]),
    [token, tenantId],
  );
  const form = useDisclosure();
  const [edit, setEdit] = useState<Webhook>();
  const [remove, setRemove] = useState<Webhook>();
  const [selected, setSelected] = useState<Webhook>();
  const [secret, setSecret] = useState("");
  const toast = useToast();
  const toggle = async (hook: Webhook) => {
    try {
      await platformApi.updateWebhook(token, tenantId, hook.id, {
        enabled: !hook.enabled,
      });
      toast.success(`Webhook 已${hook.enabled ? "停用" : "启用"}`);
      await hooks.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    }
  };
  const test = async (hook: Webhook) => {
    try {
      await platformApi.testWebhook(token, tenantId, hook.id);
      toast.success("测试事件已进入投递队列");
      setSelected(hook);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "测试失败");
    }
  };
  return (
    <>
      <section className={styles.panel}>
        <SectionHeader
          title="Webhook 端点"
          description="平台使用 HMAC-SHA256 签名，失败后指数退避并进入死信"
          actions={
            <>
              <Select
                style={{ minWidth: 170 }}
                value={tenantId}
                options={tenants.map((tenant) => ({
                  value: tenant.id,
                  label: tenant.displayName,
                }))}
                onChange={setSelectedTenantId}
              />
              {canWrite && (
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  disabled={!tenantId}
                  onClick={() => {
                    setEdit(undefined);
                    form.show();
                  }}
                >
                  创建 Webhook
                </Button>
              )}
            </>
          }
        />
        <PageState
          loading={hooks.loading}
          error={hooks.error}
          empty={!hooks.data?.length ? "尚未创建 Webhook" : undefined}
          retry={() => void hooks.refresh()}
        >
          <div className={styles.webhookGrid}>
            {hooks.data?.map((hook) => (
              <Card key={hook.id} size="small" className={styles.webhookCard}>
                <Flex justify="space-between" align="start">
                  <div>
                    <Typography.Title level={5}>{hook.name}</Typography.Title>
                    <Typography.Paragraph type="secondary">
                      {hook.description || hook.targetUrl}
                    </Typography.Paragraph>
                  </div>
                  <StatusBadge value={hook.enabled ? "active" : "disabled"} />
                </Flex>
                <Typography.Text code>{hook.targetUrl}</Typography.Text>
                <Space wrap className={styles.tagList}>
                  {hook.events.map((event) => (
                    <Tag key={event}>{event}</Tag>
                  ))}
                </Space>
                <dl>
                  <div>
                    <dt>超时</dt>
                    <dd>{hook.timeoutMs} ms</dd>
                  </div>
                  <div>
                    <dt>最大尝试</dt>
                    <dd>{hook.maxAttempts} 次</dd>
                  </div>
                  <div>
                    <dt>最近投递</dt>
                    <dd>{formatTime(hook.lastDeliveryAt)}</dd>
                  </div>
                </dl>
                <Space wrap>
                  <Button size="small" onClick={() => setSelected(hook)}>
                    投递记录
                  </Button>
                  {canWrite && (
                    <Button
                      size="small"
                      icon={<SendOutlined />}
                      onClick={() => void test(hook)}
                    >
                      发送测试
                    </Button>
                  )}
                  {canWrite && (
                    <Button
                      size="small"
                      icon={<EditOutlined />}
                      onClick={() => {
                        setEdit(hook);
                        form.show();
                      }}
                    >
                      编辑
                    </Button>
                  )}
                  {canWrite && (
                    <Button size="small" onClick={() => void toggle(hook)}>
                      {hook.enabled ? "停用" : "启用"}
                    </Button>
                  )}
                  {canAdminister && (
                    <Button
                      size="small"
                      onClick={() =>
                        void platformApi
                          .rotateWebhookSecret(token, tenantId, hook.id)
                          .then(({ signingSecret }) => setSecret(signingSecret))
                          .catch((error) => toast.error(error.message))
                      }
                    >
                      轮换密钥
                    </Button>
                  )}
                  {canWrite && (
                    <Button
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => setRemove(hook)}
                    >
                      删除
                    </Button>
                  )}
                </Space>
              </Card>
            ))}
          </div>
        </PageState>
      </section>
      {form.open && (
        <WebhookForm
          tenantId={tenantId}
          webhook={edit}
          close={form.hide}
          saved={async (value) => {
            form.hide();
            if (value.signingSecret) setSecret(value.signingSecret);
            await hooks.refresh();
          }}
        />
      )}
      {remove && (
        <ConfirmDialog
          title="删除 Webhook"
          danger
          confirmText="删除"
          message={`删除“${remove.name}”后不会再创建新投递，历史记录仍保留。`}
          onClose={() => setRemove(undefined)}
          onConfirm={async () => {
            await platformApi.deleteWebhook(token, tenantId, remove.id);
            toast.success("Webhook 已删除");
            await hooks.refresh();
          }}
        />
      )}
      {selected && (
        <DeliveryDrawer
          tenantId={tenantId}
          webhook={selected}
          close={() => setSelected(undefined)}
        />
      )}{" "}
      {secret && <SecretModal secret={secret} close={() => setSecret("")} />}
    </>
  );
}
function WebhookForm({
  tenantId,
  webhook,
  close,
  saved,
}: {
  tenantId: string;
  webhook?: Webhook;
  close: () => void;
  saved: (value: Webhook) => Promise<void>;
}) {
  const { token } = useApp();
  const toast = useToast();
  const [form, setForm] = useState({
    name: webhook?.name ?? "",
    description: webhook?.description ?? "",
    targetUrl: webhook?.targetUrl ?? "",
    events: webhook?.events ?? ["task.completed", "task.failed"],
    enabled: webhook?.enabled ?? true,
    timeoutMs: webhook?.timeoutMs ?? 5000,
    maxAttempts: webhook?.maxAttempts ?? 5,
  });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const value = webhook
        ? await platformApi.updateWebhook(token, tenantId, webhook.id, form)
        : await platformApi.createWebhook(token, tenantId, form);
      toast.success(webhook ? "Webhook 已更新" : "Webhook 已创建");
      await saved(value);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={webhook ? "编辑 Webhook" : "创建 Webhook"} onClose={close}>
      <Form
        className={styles.formGrid}
        layout="vertical"
        onFinish={() => void submit()}
      >
        <Field label="名称">
          <Input
            required
            value={form.name}
            onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))}
          />
        </Field>
        <Field label="目标 URL">
          <Input
            required
            type="url"
            value={form.targetUrl}
            onChange={(e) =>
              setForm((v) => ({ ...v, targetUrl: e.target.value }))
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
        <Field label="订阅事件">
          <Checkbox.Group
            className={styles.checkboxList}
            value={form.events}
            options={events}
            onChange={(values) =>
              setForm((value) => ({ ...value, events: values as string[] }))
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
                setForm((v) => ({ ...v, timeoutMs: Number(number) }))
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
                setForm((v) => ({ ...v, maxAttempts: Number(number) }))
              }
            />
          </Field>
        </div>
        <FormActions
          cancel={close}
          submit={webhook ? "保存" : "创建 Webhook"}
          busy={busy}
        />
      </Form>
    </Modal>
  );
}
function SecretModal({ secret, close }: { secret: string; close: () => void }) {
  return (
    <Modal
      title="保存签名密钥"
      description="签名密钥只展示一次"
      onClose={close}
    >
      <div className={styles.secretReveal}>
        <Typography.Paragraph>
          接收方使用此密钥验证 X-A2A-Signature。轮换后旧密钥立即失效。
        </Typography.Paragraph>
        <Typography.Text code>{secret}</Typography.Text>
        <CopyButton value={secret} />
        <Flex justify="end" className={styles.modalFooter}>
          <Button type="primary" onClick={close}>
            已安全保存
          </Button>
        </Flex>
      </div>
    </Modal>
  );
}
function DeliveryDrawer({
  tenantId,
  webhook,
  close,
}: {
  tenantId: string;
  webhook: Webhook;
  close: () => void;
}) {
  const { token, canWrite } = useApp();
  const [status, setStatus] = useState("");
  const deliveries = useAsync(
    () =>
      platformApi.deliveries(token, tenantId, webhook.id, {
        page: 1,
        pageSize: 50,
        status,
      }),
    [token, tenantId, webhook.id, status],
  );
  const [selected, setSelected] = useState<WebhookDelivery>();
  const toast = useToast();
  const replay = async (item: WebhookDelivery) => {
    try {
      await platformApi.replayDelivery(token, tenantId, item.id);
      toast.success("投递已重新排队");
      await deliveries.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "重放失败");
    }
  };
  return (
    <Drawer title="Webhook 投递" subtitle={webhook.name} onClose={close}>
      <Flex gap={8} className={styles.drawerToolbar}>
        <Select
          value={status}
          options={[
            { value: "", label: "全部状态" },
            { value: "succeeded", label: "成功" },
            { value: "retrying", label: "重试中" },
            { value: "dead_letter", label: "死信" },
          ]}
          onChange={setStatus}
        />
        <Button
          icon={<ReloadOutlined />}
          onClick={() => void deliveries.refresh()}
        >
          刷新
        </Button>
      </Flex>
      <PageState
        loading={deliveries.loading}
        error={deliveries.error}
        empty={!deliveries.data?.items.length ? "暂无投递记录" : undefined}
      >
        <div className={styles.deliveryList}>
          {deliveries.data?.items.map((item) => (
            <Card key={item.id} size="small">
              <header>
                <StatusBadge value={item.status} />
                <span>{item.eventType}</span>
                <time>{formatTime(item.createdAt)}</time>
              </header>
              <Typography.Paragraph>
                尝试 {item.attempt} 次 · HTTP {item.responseStatus ?? "—"}
                {item.errorMessage && ` · ${item.errorMessage}`}
              </Typography.Paragraph>
              <Space>
                <Button size="small" onClick={() => setSelected(item)}>
                  查看载荷
                </Button>
                {canWrite &&
                  ["dead_letter", "succeeded"].includes(item.status) && (
                    <Button size="small" onClick={() => void replay(item)}>
                      重放
                    </Button>
                  )}
              </Space>
              {selected?.id === item.id && <CodeBlock value={item.payload} />}
            </Card>
          ))}
        </div>
      </PageState>
    </Drawer>
  );
}
