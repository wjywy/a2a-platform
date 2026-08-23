import { useState } from "react";
import {
  Avatar,
  Button,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Table,
  Typography,
} from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  KeyOutlined,
  PlusOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { useApp } from "../AppContext";
import { platformApi, type Tenant } from "../api";
import { useAsync, useDebouncedValue, useDisclosure } from "../hooks";
import {
  ConfirmDialog,
  Field,
  FormActions,
  Modal,
  PageState,
  Pagination,
  SectionHeader,
  StatusBadge,
  useToast,
} from "../ui";
import styles from "../App.module.css";
import { ApiKeysPanel } from "./ApiKeysPanel";
const defaults = {
  slug: "",
  displayName: "",
  description: "",
  minuteRequestLimit: 120,
  dailyRequestLimit: 5000,
  monthlyRequestLimit: 10000,
  concurrentRequestLimit: 20,
  warningThresholdPercent: 80,
};
export function TenantsPage() {
  const { token, user, tenants, canAdminister, refreshTenants } = useApp();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const query = useDebouncedValue(search);
  const state = useAsync(async () => {
    if (user.platformRole === "platform_admin")
      return platformApi.tenants(token, {
        page,
        pageSize: 12,
        search: query,
        status,
      });
    const filtered = tenants.filter(
      (tenant) =>
        (!status || tenant.status === status) &&
        `${tenant.displayName} ${tenant.slug}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    );
    const pageSize = 12;
    return {
      items: filtered.slice((page - 1) * pageSize, page * pageSize),
      page,
      pageSize,
      total: filtered.length,
      totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
    };
  }, [token, user.platformRole, tenants, page, query, status]);
  const modal = useDisclosure();
  const [edit, setEdit] = useState<Tenant>();
  const [confirm, setConfirm] = useState<{
    tenant: Tenant;
    action: "suspend" | "activate" | "delete";
  }>();
  const [keysTenant, setKeysTenant] = useState<Tenant>();
  const toast = useToast();
  const reload = async () => {
    await Promise.all([state.refresh(), refreshTenants()]);
  };
  return (
    <>
      <section className={styles.panel}>
        <SectionHeader
          title="租户列表"
          description="每个租户拥有独立 Agent、密钥、配额和调用记录"
          actions={
            user.platformRole === "platform_admin" ? (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => {
                  setEdit(undefined);
                  modal.show();
                }}
              >
                创建租户
              </Button>
            ) : undefined
          }
        />
        <div className={styles.toolbar}>
          <Input
            prefix={<SearchOutlined />}
            placeholder="搜索租户名称或标识"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <Select
            value={status}
            options={[
              { value: "", label: "全部状态" },
              { value: "active", label: "已启用" },
              { value: "suspended", label: "已停用" },
            ]}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
          />
        </div>
        <PageState
          loading={state.loading}
          error={state.error}
          empty={!state.data?.items.length ? "尚未创建租户" : undefined}
          retry={() => void state.refresh()}
        >
          <Table<Tenant>
            size="small"
            scroll={{ x: "max-content" }}
            rowKey="id"
            pagination={false}
            dataSource={state.data?.items ?? []}
            columns={[
              {
                title: "租户",
                render: (_, tenant) => (
                  <Space>
                    <Avatar>{tenant.displayName.slice(0, 1)}</Avatar>
                    <span>
                      <Typography.Text strong>
                        {tenant.displayName}
                      </Typography.Text>
                      <br />
                      <Typography.Text type="secondary">
                        {tenant.slug}
                      </Typography.Text>
                    </span>
                  </Space>
                ),
              },
              {
                title: "状态",
                dataIndex: "status",
                render: (value) => <StatusBadge value={value} />,
              },
              {
                title: "资源",
                render: (_, tenant) =>
                  `${tenant.agentCount} Agent · ${tenant.memberCount} 成员`,
              },
              {
                title: "分钟 / 日 / 月",
                render: (_, tenant) =>
                  `${tenant.minuteRequestLimit} / ${tenant.dailyRequestLimit} / ${tenant.monthlyRequestLimit}`,
              },
              { title: "并发", dataIndex: "concurrentRequestLimit" },
              {
                title: "更新时间",
                dataIndex: "updatedAt",
                render: (value) => new Date(value).toLocaleDateString("zh-CN"),
              },
              {
                title: "操作",
                render: (_, tenant) => (
                  <Space wrap>
                    <Button
                      size="small"
                      icon={<KeyOutlined />}
                      onClick={() => setKeysTenant(tenant)}
                    >
                      API Key
                    </Button>
                    {canAdminister && (
                      <Button
                        size="small"
                        icon={<EditOutlined />}
                        onClick={() => {
                          setEdit(tenant);
                          modal.show();
                        }}
                      >
                        编辑
                      </Button>
                    )}
                    {user.platformRole === "platform_admin" && (
                      <Button
                        size="small"
                        onClick={() =>
                          setConfirm({
                            tenant,
                            action:
                              tenant.status === "active"
                                ? "suspend"
                                : "activate",
                          })
                        }
                      >
                        {tenant.status === "active" ? "停用" : "启用"}
                      </Button>
                    )}
                    {user.platformRole === "platform_admin" && (
                      <Button
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => setConfirm({ tenant, action: "delete" })}
                      >
                        删除
                      </Button>
                    )}
                  </Space>
                ),
              },
            ]}
          />
          {state.data && <Pagination {...state.data} onChange={setPage} />}
        </PageState>
      </section>
      {modal.open && (
        <TenantForm
          tenant={edit}
          onClose={modal.hide}
          onSaved={async () => {
            modal.hide();
            await reload();
          }}
        />
      )}
      {confirm && (
        <ConfirmDialog
          title={confirm.action === "delete" ? "删除租户" : "变更租户状态"}
          danger={confirm.action !== "activate"}
          confirmText={confirm.action === "delete" ? "删除" : "确认"}
          message={
            confirm.action === "delete"
              ? `将删除租户“${confirm.tenant.displayName}”。租户必须已停用且没有 Agent、有效 Key 或 Webhook。`
              : `确认${confirm.action === "suspend" ? "停用" : "启用"}“${confirm.tenant.displayName}”？停用后所有网关调用会立即被拒绝。`
          }
          onClose={() => setConfirm(undefined)}
          onConfirm={async () => {
            if (confirm.action === "delete")
              await platformApi.deleteTenant(token, confirm.tenant.id);
            else
              await platformApi.tenantStatus(
                token,
                confirm.tenant.id,
                confirm.action === "suspend" ? "suspended" : "active",
              );
            toast.success("租户状态已更新");
            await reload();
          }}
        />
      )}
      {keysTenant && (
        <ApiKeysPanel
          tenant={keysTenant}
          close={() => setKeysTenant(undefined)}
        />
      )}
    </>
  );
}
function TenantForm({
  tenant,
  onClose,
  onSaved,
}: {
  tenant?: Tenant;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { token } = useApp();
  const toast = useToast();
  const [form, setForm] = useState({ ...defaults, ...tenant });
  const [busy, setBusy] = useState(false);
  const change = (key: string, value: string | number) =>
    setForm((old) => ({ ...old, [key]: value }));
  const submit = async () => {
    setBusy(true);
    try {
      if (tenant) await platformApi.updateTenant(token, tenant.id, form);
      else await platformApi.createTenant(token, form);
      toast.success(tenant ? "租户已更新" : "租户已创建");
      await onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={tenant ? "编辑租户" : "创建租户"}
      description="租户标识创建后不可修改"
      onClose={onClose}
    >
      <Form
        onFinish={() => void submit()}
        className={styles.formGrid}
        layout="vertical"
      >
        <Field label="显示名称">
          <Input
            required
            minLength={2}
            value={form.displayName}
            onChange={(e) => change("displayName", e.target.value)}
          />
        </Field>
        <Field label="租户标识" hint="小写字母、数字和连字符">
          <Input
            required
            disabled={!!tenant}
            pattern="[a-z0-9][a-z0-9-]{1,62}"
            value={form.slug}
            onChange={(e) => change("slug", e.target.value)}
          />
        </Field>
        <Field label="描述">
          <Input.TextArea
            rows={3}
            value={form.description}
            onChange={(e) => change("description", e.target.value)}
          />
        </Field>
        <div className={styles.limitGrid}>
          {[
            ["每分钟上限", "minuteRequestLimit"],
            ["每日上限", "dailyRequestLimit"],
            ["每月上限", "monthlyRequestLimit"],
            ["并发上限", "concurrentRequestLimit"],
            ["预警阈值 %", "warningThresholdPercent"],
          ].map(([label, key]) => (
            <Field key={key} label={label}>
              <InputNumber
                style={{ width: "100%" }}
                min={1}
                value={form[key as keyof typeof form] as number}
                onChange={(value) => change(key, Number(value))}
              />
            </Field>
          ))}
        </div>
        <FormActions
          cancel={onClose}
          submit={tenant ? "保存修改" : "创建租户"}
          busy={busy}
        />
      </Form>
    </Modal>
  );
}
