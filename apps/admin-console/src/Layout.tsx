import type { ReactNode } from "react";
import { Avatar, Badge, Button, Select, Tooltip, Typography } from "antd";
import {
  AlertOutlined,
  ApiOutlined,
  AppstoreOutlined,
  AuditOutlined,
  BarChartOutlined,
  BellOutlined,
  BugOutlined,
  LogoutOutlined,
  PlusOutlined,
  RobotOutlined,
  SettingOutlined,
  TeamOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import styles from "./App.module.css";
import { useApp } from "./AppContext";

export type PageKey =
  | "overview"
  | "tenants"
  | "members"
  | "agents"
  | "debug"
  | "tasks"
  | "usage"
  | "webhooks"
  | "alerts"
  | "audit"
  | "settings";
const navigation: Array<{
  key: PageKey;
  label: string;
  icon: ReactNode;
  group: "operate" | "govern";
}> = [
  {
    key: "overview",
    label: "概览",
    icon: <AppstoreOutlined />,
    group: "operate",
  },
  {
    key: "agents",
    label: "Agent 管理",
    icon: <RobotOutlined />,
    group: "operate",
  },
  { key: "debug", label: "在线调试", icon: <BugOutlined />, group: "operate" },
  {
    key: "tasks",
    label: "任务中心",
    icon: <UnorderedListOutlined />,
    group: "operate",
  },
  {
    key: "usage",
    label: "用量分析",
    icon: <BarChartOutlined />,
    group: "operate",
  },
  { key: "tenants", label: "租户管理", icon: <ApiOutlined />, group: "govern" },
  {
    key: "members",
    label: "成员与角色",
    icon: <TeamOutlined />,
    group: "govern",
  },
  {
    key: "webhooks",
    label: "Webhook",
    icon: <BellOutlined />,
    group: "govern",
  },
  {
    key: "alerts",
    label: "告警中心",
    icon: <AlertOutlined />,
    group: "govern",
  },
  { key: "audit", label: "审计中心", icon: <AuditOutlined />, group: "govern" },
  {
    key: "settings",
    label: "平台设置",
    icon: <SettingOutlined />,
    group: "govern",
  },
];
const titles: Record<PageKey, { title: string; description: string }> = {
  overview: { title: "运行概览", description: "平台代理服务与治理状态" },
  tenants: { title: "租户管理", description: "客户空间、状态与配额" },
  members: { title: "成员与角色", description: "邀请、角色和访问边界" },
  agents: { title: "Agent 管理", description: "注册、Card、健康与调用策略" },
  debug: {
    title: "在线调试",
    description: "登录后通过安全代理发起 A2A 流式调用",
  },
  tasks: { title: "任务中心", description: "请求、事件时间线与远端任务" },
  usage: { title: "用量分析", description: "调用趋势、失败率与延迟" },
  webhooks: { title: "Webhook", description: "事件订阅、签名与投递记录" },
  alerts: { title: "告警中心", description: "规则、触发、确认和静默" },
  audit: { title: "审计中心", description: "治理操作与权限变更记录" },
  settings: { title: "平台设置", description: "网关、健康检查与投递参数" },
};

export function Layout({
  page,
  onPage,
  children,
  onRegister,
}: {
  page: PageKey;
  onPage: (page: PageKey) => void;
  children: ReactNode;
  onRegister: () => void;
}) {
  const {
    user,
    selectedRole,
    canWrite,
    tenants,
    selectedTenantId,
    setSelectedTenantId,
    logout,
  } = useApp();
  const title =
    page === "agents" && !canWrite
      ? { title: "Agent 目录", description: "你当前有权查看的 Agent 服务" }
      : titles[page];
  const visibleNavigation = navigation.filter((item) => {
    if (user.platformRole === "platform_admin") return true;
    if (item.key === "settings") return false;
    if (!selectedTenantId && item.key !== "agents") return false;
    return true;
  });
  return (
    <div
      className={`${styles.shell} ${page === "debug" ? styles.debugShell : ""}`}
    >
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>A</span>
          <span>
            A2A Hub<small>AGENT OPERATIONS</small>
          </span>
        </div>
        {canWrite && (
          <Button
            type="primary"
            block
            icon={<PlusOutlined />}
            className={styles.sidebarPrimary}
            onClick={onRegister}
          >
            注册 Agent
          </Button>
        )}
        <nav>
          {(["operate", "govern"] as const).map((group) => (
            <div className={styles.navGroup} key={group}>
              <span>{group === "operate" ? "运营" : "治理"}</span>
              {visibleNavigation
                .filter((item) => item.group === group)
                .map((item) => (
                  <Button
                    type="text"
                    block
                    icon={item.icon}
                    key={item.key}
                    aria-label={
                      item.key === "agents" && !canWrite
                        ? "Agent 目录"
                        : item.label
                    }
                    className={page === item.key ? styles.navActive : ""}
                    onClick={() => onPage(item.key)}
                  >
                    {item.key === "agents" && !canWrite
                      ? "Agent 目录"
                      : item.label}
                  </Button>
                ))}
            </div>
          ))}
        </nav>
        <div className={styles.sidebarFooter}>
          {user.platformRole === "platform_admin" || tenants.length ? (
            <div className={styles.tenantSelector}>
              <Typography.Text type="secondary">当前租户</Typography.Text>
              <Select
                size="small"
                value={selectedTenantId}
                options={[
                  ...(user.platformRole === "platform_admin"
                    ? [{ value: "", label: "全部租户" }]
                    : []),
                  ...tenants.map((tenant) => ({
                    value: tenant.id,
                    label: tenant.displayName,
                  })),
                ]}
                onChange={setSelectedTenantId}
              />
            </div>
          ) : (
            <div className={styles.catalogScope}>
              <span>当前权限</span>
              <b>公开 Agent 目录</b>
            </div>
          )}
          <div className={styles.account}>
            <Avatar size={29}>
              {user.displayName.slice(0, 1).toUpperCase()}
            </Avatar>
            <span>
              {user.displayName}
              <small>{user.platformRole ?? selectedRole ?? "未选择租户"}</small>
            </span>
            <Tooltip title="退出登录">
              <Button
                type="text"
                size="small"
                icon={<LogoutOutlined />}
                title="退出登录"
                aria-label="退出登录"
                onClick={() => void logout()}
              />
            </Tooltip>
          </div>
        </div>
      </aside>
      <main className={styles.main}>
        <header className={styles.topbar}>
          <div>
            <p>控制中心 / {title.title}</p>
            <h1>{title.title}</h1>
            <span>{title.description}</span>
          </div>
          <div className={styles.topbarActions}>
            <Badge status="success" text="平台服务正常" />
            {user.platformRole === "platform_admin" && (
              <Tooltip title="打开平台设置与运行信息">
                <Button
                  aria-label="快速进入平台设置"
                  icon={<SettingOutlined />}
                  onClick={() => onPage("settings")}
                />
              </Tooltip>
            )}
          </div>
        </header>
        <div className={styles.pageBody}>{children}</div>
      </main>
      <nav className={styles.mobileNav}>
        {visibleNavigation.map((item) => (
          <Button
            type="text"
            key={item.key}
            aria-label={
              item.key === "agents" && !canWrite ? "Agent 目录" : item.label
            }
            className={page === item.key ? styles.mobileActive : ""}
            onClick={() => onPage(item.key)}
          >
            {item.icon}
            <span>
              {(item.key === "agents" && !canWrite ? "Agent 目录" : item.label)
                .replace("管理", "")
                .replace("中心", "")}
            </span>
          </Button>
        ))}
      </nav>
    </div>
  );
}
