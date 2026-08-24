import { useState } from "react";
import {
  Button,
  Card,
  Checkbox,
  Flex,
  Form,
  Input,
  InputNumber,
  Space,
  Tag,
  Typography,
} from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { useApp } from "../AppContext";
import { platformApi, type ApiKey, type Tenant } from "../api";
import { useAsync, useDisclosure } from "../hooks";
import {
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

const allScopes = ["agent:invoke", "task:read", "task:cancel", "usage:read"];

export function ApiKeysPanel({
  tenant,
  close,
  onKeyCreated,
}: {
  tenant: Tenant;
  close: () => void;
  onKeyCreated?: (key: ApiKey) => void;
}) {
  const { token, canAdminister } = useApp();
  const keys = useAsync(
    () => platformApi.keys(token, tenant.id, true),
    [token, tenant.id],
  );
  const form = useDisclosure();
  const [edit, setEdit] = useState<ApiKey>();
  const [revoke, setRevoke] = useState<ApiKey>();
  const [revealed, setRevealed] = useState<ApiKey>();
  const toast = useToast();
  return (
    <>
      <Drawer title="API Key" subtitle={tenant.displayName} onClose={close}>
        <SectionHeader
          title="外部调用凭据"
          description="数据库只保存 SHA-256 哈希和前缀"
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
                创建 Key
              </Button>
            ) : undefined
          }
        />
        <PageState
          loading={keys.loading}
          error={keys.error}
          empty={!keys.data?.length ? "尚未创建 API Key" : undefined}
          retry={() => void keys.refresh()}
        >
          <div className={styles.keyList}>
            {keys.data?.map((key) => (
              <Card key={key.id} size="small">
                <Flex justify="space-between" align="start">
                  <span>
                    <Typography.Title level={5}>{key.name}</Typography.Title>
                    <Typography.Text code>{key.prefix}••••••••</Typography.Text>
                  </span>
                  <StatusBadge
                    value={
                      key.revokedAt
                        ? "disabled"
                        : key.expiresAt && new Date(key.expiresAt) <= new Date()
                          ? "failed"
                          : "active"
                    }
                  />
                </Flex>
                <Typography.Paragraph type="secondary">
                  {key.description || "未填写说明"}
                </Typography.Paragraph>
                <Space wrap className={styles.tagList}>
                  {key.scopes.map((scope) => (
                    <Tag key={scope}>{scope}</Tag>
                  ))}
                </Space>
                <dl>
                  <div>
                    <dt>最后使用</dt>
                    <dd>{formatTime(key.lastUsedAt)}</dd>
                  </div>
                  <div>
                    <dt>过期时间</dt>
                    <dd>{formatTime(key.expiresAt)}</dd>
                  </div>
                  <div>
                    <dt>分钟 / 日 / 月</dt>
                    <dd>
                      {key.minuteRequestLimit ?? "租户"} /{" "}
                      {key.dailyRequestLimit ?? "租户"} /{" "}
                      {key.monthlyRequestLimit ?? "租户"}
                    </dd>
                  </div>
                </dl>
                {canAdminister && (
                  <Flex gap={8} justify="end">
                    <Button
                      icon={<EditOutlined />}
                      disabled={!!key.revokedAt}
                      onClick={() => {
                        setEdit(key);
                        form.show();
                      }}
                    >
                      编辑
                    </Button>
                    <Button
                      danger
                      icon={<DeleteOutlined />}
                      disabled={!!key.revokedAt}
                      onClick={() => setRevoke(key)}
                    >
                      撤销
                    </Button>
                  </Flex>
                )}
              </Card>
            ))}
          </div>
        </PageState>
      </Drawer>
      {form.open && (
        <ApiKeyForm
          tenant={tenant}
          apiKey={edit}
          close={form.hide}
          saved={async (value) => {
            form.hide();
            if (value.secret) setRevealed(value);
            if (value.secret) onKeyCreated?.(value);
            await keys.refresh();
          }}
        />
      )}
      {revoke && (
        <ConfirmDialog
          title="撤销 API Key"
          danger
          confirmText="永久撤销"
          message={`撤销“${revoke.name}”后，使用该 Key 的所有新请求会立即被拒绝。此操作不能恢复。`}
          onClose={() => setRevoke(undefined)}
          onConfirm={async () => {
            await platformApi.revokeKey(token, tenant.id, revoke.id);
            toast.success("API Key 已撤销");
            await keys.refresh();
          }}
        />
      )}
      {revealed && (
        <ApiKeySecret apiKey={revealed} close={() => setRevealed(undefined)} />
      )}
    </>
  );
}

function ApiKeyForm({
  tenant,
  apiKey,
  close,
  saved,
}: {
  tenant: Tenant;
  apiKey?: ApiKey;
  close: () => void;
  saved: (value: ApiKey) => Promise<void>;
}) {
  const { token, agents } = useApp();
  const toast = useToast();
  const [form, setForm] = useState({
    name: apiKey?.name ?? "",
    description: apiKey?.description ?? "",
    scopes: apiKey?.scopes ?? ["agent:invoke"],
    expiresAt: apiKey?.expiresAt?.slice(0, 16) ?? "",
    minuteRequestLimit: apiKey?.minuteRequestLimit?.toString() ?? "",
    dailyRequestLimit: apiKey?.dailyRequestLimit?.toString() ?? "",
    monthlyRequestLimit: apiKey?.monthlyRequestLimit?.toString() ?? "",
    concurrentRequestLimit: apiKey?.concurrentRequestLimit?.toString() ?? "",
    agentIds: apiKey?.agentIds ?? [],
  });
  const [busy, setBusy] = useState(false);
  const limit = (value: string) => (value ? Number(value) : null);
  const submit = async () => {
    setBusy(true);
    try {
      const payload = {
        name: form.name,
        description: form.description,
        scopes: form.scopes,
        expiresAt: form.expiresAt
          ? new Date(form.expiresAt).toISOString()
          : null,
        minuteRequestLimit: limit(form.minuteRequestLimit),
        dailyRequestLimit: limit(form.dailyRequestLimit),
        monthlyRequestLimit: limit(form.monthlyRequestLimit),
        concurrentRequestLimit: limit(form.concurrentRequestLimit),
        agentIds: form.agentIds,
      };
      const result = apiKey
        ? await platformApi.updateKey(token, tenant.id, apiKey.id, payload)
        : await platformApi.createKey(token, tenant.id, payload);
      toast.success(apiKey ? "API Key 已更新" : "API Key 已创建");
      await saved(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={apiKey ? "编辑 API Key" : "创建 API Key"} onClose={close}>
      <Form
        className={styles.formGrid}
        layout="vertical"
        onFinish={() => void submit()}
      >
        <Field label="名称">
          <Input
            required
            minLength={2}
            value={form.name}
            onChange={(event) =>
              setForm((value) => ({ ...value, name: event.target.value }))
            }
          />
        </Field>
        <Field
          label="Agent 授权"
          hint="不选择表示可调用租户可见范围内的所有 Agent"
        >
          <Checkbox.Group
            className={styles.checkboxList}
            value={form.agentIds}
            options={agents
              .filter(
                (agent) =>
                  !agent.tenantId ||
                  agent.tenantId === tenant.id ||
                  agent.visibility === "public",
              )
              .map((agent) => ({ label: agent.displayName, value: agent.id }))}
            onChange={(values) =>
              setForm((value) => ({ ...value, agentIds: values as string[] }))
            }
          />
        </Field>
        <Field label="说明">
          <Input.TextArea
            rows={2}
            value={form.description}
            onChange={(event) =>
              setForm((value) => ({
                ...value,
                description: event.target.value,
              }))
            }
          />
        </Field>
        <Field label="作用域">
          <Checkbox.Group
            className={styles.checkboxList}
            value={form.scopes}
            options={allScopes}
            onChange={(values) =>
              setForm((value) => ({ ...value, scopes: values as string[] }))
            }
          />
        </Field>
        <Field label="过期时间" hint="留空表示不过期">
          <Input
            type="datetime-local"
            value={form.expiresAt}
            onChange={(event) =>
              setForm((value) => ({ ...value, expiresAt: event.target.value }))
            }
          />
        </Field>
        <div className={styles.limitGrid}>
          {[
            ["分钟上限", "minuteRequestLimit"],
            ["每日上限", "dailyRequestLimit"],
            ["每月上限", "monthlyRequestLimit"],
            ["并发上限", "concurrentRequestLimit"],
          ].map(([label, field]) => (
            <Field key={field} label={label} hint="留空继承租户">
              <InputNumber
                style={{ width: "100%" }}
                min={1}
                value={Number(form[field as keyof typeof form]) || null}
                onChange={(number) =>
                  setForm((value) => ({
                    ...value,
                    [field]: number === null ? "" : String(number),
                  }))
                }
              />
            </Field>
          ))}
        </div>
        <FormActions
          cancel={close}
          submit={apiKey ? "保存修改" : "创建 Key"}
          busy={busy}
        />
      </Form>
    </Modal>
  );
}

function ApiKeySecret({
  apiKey,
  close,
}: {
  apiKey: ApiKey;
  close: () => void;
}) {
  return (
    <Modal title="保存 API Key" description="明文只显示这一次" onClose={close}>
      <div className={styles.secretReveal}>
        <Typography.Paragraph>
          请立即复制到安全的密钥管理工具。平台数据库只保存不可逆哈希，关闭后无法再次查看。
        </Typography.Paragraph>
        <Typography.Text code>{apiKey.secret}</Typography.Text>
        <CopyButton value={apiKey.secret!} label="复制 API Key" />
        <Flex justify="end" className={styles.modalFooter}>
          <Button type="primary" onClick={close}>
            已安全保存
          </Button>
        </Flex>
      </div>
    </Modal>
  );
}
