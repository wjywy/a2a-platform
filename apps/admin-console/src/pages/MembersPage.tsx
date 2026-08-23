import { useState } from "react";
import {
  Avatar,
  Button,
  Checkbox,
  Flex,
  Form,
  Input,
  Select,
  Space,
  Table,
  Typography,
} from "antd";
import {
  DeleteOutlined,
  PlusOutlined,
  UserAddOutlined,
} from "@ant-design/icons";
import { useApp } from "../AppContext";
import {
  platformApi,
  type Invitation,
  type PlatformUser,
  type TenantMember,
} from "../api";
import { useAsync, useDisclosure } from "../hooks";
import {
  ConfirmDialog,
  CopyButton,
  Field,
  FormActions,
  Modal,
  PageState,
  SectionHeader,
  StatusBadge,
  useToast,
} from "../ui";
import styles from "../App.module.css";
export function MembersPage() {
  const {
    token,
    user,
    canAdminister,
    tenants,
    selectedTenantId,
    setSelectedTenantId,
  } = useApp();
  const tenantId = selectedTenantId || tenants[0]?.id || "";
  const state = useAsync(
    () =>
      tenantId ? platformApi.members(token, tenantId) : Promise.resolve([]),
    [token, tenantId],
  );
  const invite = useDisclosure();
  const createUser = useDisclosure();
  const invitations = useAsync(
    () =>
      tenantId && canAdminister
        ? platformApi.invitations(token, tenantId)
        : Promise.resolve([] as Invitation[]),
    [token, tenantId, canAdminister],
  );
  const users = useAsync(
    () =>
      user.platformRole === "platform_admin"
        ? platformApi.users(token)
        : Promise.resolve([] as PlatformUser[]),
    [token, user.platformRole],
  );
  const [remove, setRemove] = useState<TenantMember>();
  const toast = useToast();
  const role = async (member: TenantMember, next: TenantMember["role"]) => {
    try {
      await platformApi.updateMember(token, tenantId, member.id, {
        role: next,
      });
      toast.success("成员角色已更新");
      await state.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "角色更新失败");
    }
  };
  return (
    <>
      <section className={styles.panel}>
        <SectionHeader
          title="成员与角色"
          description="平台管理员、租户管理员、开发者和只读成员拥有不同权限"
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
              {canAdminister && (
                <Button
                  type="primary"
                  icon={<UserAddOutlined />}
                  disabled={!tenantId}
                  onClick={invite.show}
                >
                  邀请成员
                </Button>
              )}
            </>
          }
        />
        <div className={styles.roleLegend}>
          <div>
            <b>租户管理员</b>
            <span>成员、Key、配额和全部租户资源</span>
          </div>
          <div>
            <b>开发者</b>
            <span>Agent、调试、Webhook 和任务</span>
          </div>
          <div>
            <b>只读成员</b>
            <span>查看运行状态、用量和审计</span>
          </div>
        </div>
        <PageState
          loading={state.loading}
          error={state.error}
          empty={!state.data?.length ? "当前租户还没有成员" : undefined}
          retry={() => void state.refresh()}
        >
          <Table<TenantMember>
            size="small"
            scroll={{ x: "max-content" }}
            rowKey="id"
            pagination={false}
            dataSource={state.data ?? []}
            columns={[
              {
                title: "成员",
                render: (_, member) => (
                  <Space>
                    <Avatar>
                      {(member.displayName || member.email)
                        .slice(0, 1)
                        .toUpperCase()}
                    </Avatar>
                    <span>
                      <Typography.Text strong>
                        {member.displayName || "未设置名称"}
                      </Typography.Text>
                      <br />
                      <Typography.Text type="secondary">
                        {member.email}
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
                title: "角色",
                render: (_, member) => (
                  <Select
                    size="small"
                    value={member.role}
                    disabled={!canAdminister || member.status === "disabled"}
                    options={[
                      { value: "tenant_admin", label: "租户管理员" },
                      { value: "developer", label: "开发者" },
                      { value: "viewer", label: "只读成员" },
                    ]}
                    onChange={(value) =>
                      void role(member, value as TenantMember["role"])
                    }
                  />
                ),
              },
              {
                title: "加入时间",
                render: (_, member) =>
                  new Date(
                    member.acceptedAt ?? member.createdAt,
                  ).toLocaleDateString("zh-CN"),
              },
              {
                title: "操作",
                render: (_, member) =>
                  canAdminister ? (
                    <Button
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      disabled={member.status === "disabled"}
                      onClick={() => setRemove(member)}
                    >
                      移除
                    </Button>
                  ) : null,
              },
            ]}
          />
        </PageState>
      </section>
      {canAdminister && (
        <section className={styles.panel}>
          <SectionHeader
            title="待处理邀请"
            description="邀请链接可用于首次激活账号；撤销后立即失效"
          />
          <PageState
            loading={invitations.loading}
            error={invitations.error}
            empty={!invitations.data?.length ? "没有邀请记录" : undefined}
          >
            <Table<Invitation>
              size="small"
              scroll={{ x: "max-content" }}
              rowKey="id"
              pagination={false}
              dataSource={invitations.data ?? []}
              columns={[
                { title: "邮箱", dataIndex: "email" },
                { title: "角色", dataIndex: "role" },
                {
                  title: "状态",
                  render: (_, item) => (
                    <StatusBadge
                      value={
                        item.acceptedAt
                          ? "accepted"
                          : item.revokedAt
                            ? "revoked"
                            : "pending"
                      }
                    />
                  ),
                },
                {
                  title: "到期时间",
                  dataIndex: "expiresAt",
                  render: (value) => new Date(value).toLocaleString("zh-CN"),
                },
                {
                  title: "操作",
                  render: (_, item) =>
                    !item.acceptedAt && !item.revokedAt ? (
                      <Button
                        size="small"
                        danger
                        onClick={() =>
                          void platformApi
                            .revokeInvitation(token, tenantId, item.id!)
                            .then(() => invitations.refresh())
                            .catch((error) => toast.error(error.message))
                        }
                      >
                        撤销
                      </Button>
                    ) : null,
                },
              ]}
            />
          </PageState>
        </section>
      )}
      {user.platformRole === "platform_admin" && (
        <section className={styles.panel}>
          <SectionHeader
            title="平台用户"
            description="平台管理员账号与登录状态"
            actions={
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={createUser.show}
              >
                创建用户
              </Button>
            }
          />
          <PageState
            loading={users.loading}
            error={users.error}
            empty={!users.data?.length ? "没有平台用户" : undefined}
          >
            <Table<PlatformUser>
              size="small"
              scroll={{ x: "max-content" }}
              rowKey="id"
              pagination={false}
              dataSource={users.data ?? []}
              columns={[
                {
                  title: "用户",
                  render: (_, item) => (
                    <Space>
                      <Avatar>{item.displayName.slice(0, 1)}</Avatar>
                      <span>
                        <Typography.Text strong>
                          {item.displayName}
                        </Typography.Text>
                        <br />
                        <Typography.Text type="secondary">
                          {item.email}
                        </Typography.Text>
                      </span>
                    </Space>
                  ),
                },
                {
                  title: "平台角色",
                  dataIndex: "platformRole",
                  render: (value) => value ?? "租户用户",
                },
                {
                  title: "状态",
                  dataIndex: "status",
                  render: (value) => <StatusBadge value={value} />,
                },
                {
                  title: "最后登录",
                  dataIndex: "lastLoginAt",
                  render: (value) =>
                    value ? new Date(value).toLocaleString("zh-CN") : "—",
                },
                {
                  title: "操作",
                  render: (_, item) => (
                    <Button
                      size="small"
                      disabled={item.id === user.id}
                      onClick={() =>
                        void platformApi
                          .userStatus(
                            token,
                            item.id,
                            item.status === "active" ? "disabled" : "active",
                          )
                          .then(() => users.refresh())
                      }
                    >
                      {item.status === "active" ? "停用" : "启用"}
                    </Button>
                  ),
                },
              ]}
            />
          </PageState>
        </section>
      )}
      {invite.open && (
        <InviteForm
          tenantId={tenantId}
          close={invite.hide}
          saved={async () => {
            await state.refresh();
            await invitations.refresh();
          }}
        />
      )}
      {createUser.open && (
        <UserForm
          close={createUser.hide}
          saved={async () => {
            createUser.hide();
            await users.refresh();
          }}
        />
      )}
      {remove && (
        <ConfirmDialog
          title="移除成员"
          danger
          confirmText="移除"
          message={`确认从租户中移除 ${remove.displayName || remove.email}？其现有登录令牌不会再获得租户权限。`}
          onClose={() => setRemove(undefined)}
          onConfirm={async () => {
            await platformApi.removeMember(token, tenantId, remove.id);
            toast.success("成员已移除");
            await state.refresh();
          }}
        />
      )}
    </>
  );
}
function InviteForm({
  tenantId,
  close,
  saved,
}: {
  tenantId: string;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const { token } = useApp();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<TenantMember["role"]>("developer");
  const [result, setResult] = useState<{ token: string; expiresAt: string }>();
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const value = await platformApi.inviteMember(token, tenantId, {
        email,
        displayName: name,
        role,
      });
      setResult({ token: value.invitationToken, expiresAt: value.expiresAt });
      toast.success("邀请已创建");
      await saved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "邀请失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="邀请租户成员"
      description="邀请令牌只在创建后显示一次"
      onClose={close}
    >
      {result ? (
        <div className={styles.secretReveal}>
          <Typography.Text strong>邀请已创建</Typography.Text>
          <Typography.Paragraph>
            请通过安全渠道把令牌发送给受邀用户，有效期至{" "}
            {new Date(result.expiresAt).toLocaleString("zh-CN")}。
          </Typography.Paragraph>
          <Typography.Text
            code
          >{`${location.origin}/invite/${result.token}`}</Typography.Text>
          <CopyButton value={`${location.origin}/invite/${result.token}`} />
          <Flex justify="end" className={styles.modalFooter}>
            <Button type="primary" onClick={close}>
              完成
            </Button>
          </Flex>
        </div>
      ) : (
        <Form
          className={styles.formGrid}
          layout="vertical"
          onFinish={() => void submit()}
        >
          <Field label="邮箱">
            <Input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="显示名称">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="角色">
            <Select
              value={role}
              options={[
                { value: "tenant_admin", label: "租户管理员" },
                { value: "developer", label: "开发者" },
                { value: "viewer", label: "只读成员" },
              ]}
              onChange={(value) => setRole(value as TenantMember["role"])}
            />
          </Field>
          <FormActions cancel={close} submit="创建邀请" busy={busy} />
        </Form>
      )}
    </Modal>
  );
}

function UserForm({
  close,
  saved,
}: {
  close: () => void;
  saved: () => Promise<void>;
}) {
  const { token } = useApp();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    email: "",
    displayName: "",
    password: "",
    platformAdmin: false,
  });
  return (
    <Modal
      title="创建平台用户"
      description="普通租户用户通常由邀请链接自行激活"
      onClose={close}
    >
      <Form
        className={styles.formGrid}
        layout="vertical"
        onFinish={() => {
          setBusy(true);
          void platformApi
            .createUser(token, {
              email: form.email,
              displayName: form.displayName,
              password: form.password || undefined,
              platformRole: form.platformAdmin ? "platform_admin" : null,
            })
            .then(async () => {
              toast.success("用户已创建");
              await saved();
            })
            .catch((error) => toast.error(error.message))
            .finally(() => setBusy(false));
        }}
      >
        <Field label="邮箱">
          <Input
            required
            type="email"
            value={form.email}
            onChange={(event) =>
              setForm((value) => ({ ...value, email: event.target.value }))
            }
          />
        </Field>
        <Field label="显示名称">
          <Input
            required
            value={form.displayName}
            onChange={(event) =>
              setForm((value) => ({
                ...value,
                displayName: event.target.value,
              }))
            }
          />
        </Field>
        <Field label="初始密码" hint="留空时用户只能通过企业身份登录">
          <Input.Password
            minLength={12}
            value={form.password}
            onChange={(event) =>
              setForm((value) => ({ ...value, password: event.target.value }))
            }
          />
        </Field>
        <Checkbox
          checked={form.platformAdmin}
          onChange={(event) =>
            setForm((value) => ({
              ...value,
              platformAdmin: event.target.checked,
            }))
          }
        >
          平台管理员
        </Checkbox>
        <FormActions cancel={close} submit="创建用户" busy={busy} />
      </Form>
    </Modal>
  );
}
