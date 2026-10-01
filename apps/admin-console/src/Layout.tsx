import { useState, type ReactNode } from "react";
import {
  Avatar,
  Badge,
  Button,
  Drawer,
  Select,
  Tooltip,
  Typography,
} from "antd";
import {
  AlertOutlined,
  ApiOutlined,
  AppstoreOutlined,
  AuditOutlined,
  BarChartOutlined,
  BellOutlined,
  BugOutlined,
  LogoutOutlined,
  MoreOutlined,
  PlusOutlined,
  RobotOutlined,
  SettingOutlined,
  TeamOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import styles from "./ConsoleShell.module.css";
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

const mobilePrimaryKeys: PageKey[] = [
  "overview",
  "agents",
  "debug",
  "tasks",
];

const titles: Record<PageKey, { title: string; description: string }> = {
  overview: { title: "运行概览", description: "平台代理服务与治理状态" },
  tenants: { title: "租户管理", description: "客户空间、状态与配额" },
  members: { title: "成员与角色", description: "邀请、账号状态和审计标签" },
  agents: { title: "Agent 管理", description: "注册、Card、健康与调用策略" },
  debug: {
    title: "在线调试",
    description: "登录后通过安全代理发起 A2A 流式调用",
  },
  tasks: { title: "任务中心", description: "请求、事件时间线与远端任务" },
  usage: { title: "用量分析", description: "调用趋势、失败率与延迟" },
  webhooks: { title: "Webhook", description: "事件订阅、签名与投递记录" },
  alerts: { title: "告警中心", description: "规则、触发、确认和静默" },
  audit: { title: "审计中心", description: "治理操作与角色标签变更记录" },
  settings: { title: "平台设置", description: "网关、健康检查与投递参数" },
};

export function Layout({
  page,
  onPage,
  children,
  onRegister,
  onWarmPage,
}: {
  page: PageKey;
  onPage: (page: PageKey) => void;
  children: ReactNode;
  onRegister: () => void;
  onWarmPage: (page: PageKey) => void;
}) {
  const {
    user,
    selectedRole,
    tenants,
    selectedTenantId,
    setSelectedTenantId,
    logout,
  } = useApp();
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const title = titles[page];
  const mobilePrimary = navigation.filter((item) =>
    mobilePrimaryKeys.includes(item.key),
  );
  const mobileSecondary = navigation.filter(
    (item) => !mobilePrimaryKeys.includes(item.key),
  );
  const mobileSecondaryActive = mobileSecondary.some(
    (item) => item.key === page,
  );
  const accountRoleLabel =
    user.platformRole === "platform_admin"
      ? "平台管理员标签"
      : selectedRole === "tenant_admin"
        ? "租户管理员标签"
        : selectedRole === "developer"
          ? "开发者标签"
          : selectedRole === "viewer"
            ? "只读成员标签"
            : "已登录";
  const tenantOptions = [
    { value: "", label: "全部租户" },
    ...tenants.map((tenant) => ({
      value: tenant.id,
      label: tenant.displayName,
    })),
  ];
  const openRegister = () => {
    setMobileMoreOpen(false);
    onRegister();
  };
  const navigateFromMore = (next: PageKey) => {
    setMobileMoreOpen(false);
    onPage(next);
  };

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
        <Button
          type="text"
          block
          icon={<PlusOutlined />}
          className={styles.sidebarPrimary}
          onClick={onRegister}
        >
          注册 Agent
        </Button>
        <nav aria-label="控制台主导航">
          {(["operate", "govern"] as const).map((group) => (
            <div className={styles.navGroup} key={group}>
              <span>{group === "operate" ? "运营" : "治理"}</span>
              {navigation
                .filter((item) => item.group === group)
                .map((item) => (
                  <Button
                    type="text"
                    block
                    icon={item.icon}
                    key={item.key}
                    aria-current={page === item.key ? "page" : undefined}
                    className={page === item.key ? styles.navActive : ""}
                    onMouseEnter={() => onWarmPage(item.key)}
                    onFocus={() => onWarmPage(item.key)}
                    onPointerDown={() => onWarmPage(item.key)}
                    onClick={() => onPage(item.key)}
                  >
                    {item.label}
                  </Button>
                ))}
            </div>
          ))}
        </nav>
        <div className={styles.sidebarFooter}>
          <div className={styles.tenantSelector}>
            <Typography.Text type="secondary">当前租户</Typography.Text>
            <Select
              size="small"
              value={selectedTenantId}
              options={tenantOptions}
              onChange={setSelectedTenantId}
            />
          </div>
          <div className={styles.account}>
            <Avatar size={29}>
              {user.displayName.slice(0, 1).toUpperCase()}
            </Avatar>
            <span>
              {user.displayName}
              <small>{accountRoleLabel} · 全部功能可用</small>
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
            <h1>{title.title}</h1>
            <span>{title.description}</span>
          </div>
          <div className={styles.topbarActions}>
            <Badge status="success" text="平台服务正常" />
            <Tooltip title="打开平台设置与运行信息">
              <Button
                aria-label="快速进入平台设置"
                icon={<SettingOutlined />}
                onMouseEnter={() => onWarmPage("settings")}
                onFocus={() => onWarmPage("settings")}
                onClick={() => onPage("settings")}
              />
            </Tooltip>
          </div>
        </header>
        <div className={styles.pageBody}>{children}</div>
      </main>
      <nav className={styles.mobileNav} aria-label="移动端主导航">
        {mobilePrimary.map((item) => (
          <Button
            type="text"
            key={item.key}
            aria-label={item.label}
            aria-current={page === item.key ? "page" : undefined}
            className={page === item.key ? styles.mobileActive : ""}
            onPointerDown={() => onWarmPage(item.key)}
            onFocus={() => onWarmPage(item.key)}
            onClick={() => onPage(item.key)}
          >
            {item.icon}
            <span>{item.label.replace("管理", "").replace("中心", "")}</span>
          </Button>
        ))}
        <Button
          type="text"
          aria-label="更多功能"
          aria-current={mobileSecondaryActive ? "page" : undefined}
          aria-expanded={mobileMoreOpen}
          aria-haspopup="dialog"
          className={mobileSecondaryActive ? styles.mobileActive : ""}
          onClick={() => setMobileMoreOpen(true)}
        >
          <MoreOutlined />
          <span>更多</span>
        </Button>
      </nav>
      <Drawer
        title="更多功能"
        placement="bottom"
        open={mobileMoreOpen}
        onClose={() => setMobileMoreOpen(false)}
        rootClassName={styles.mobileMoreDrawer}
        height="min(78dvh, 620px)"
      >
        <div className={styles.mobileMoreContent}>
          <div className={styles.mobileMoreGroup}>
            <span className={styles.mobileMoreLabel}>治理与分析</span>
            {mobileSecondary.map((item) => (
              <Button
                type="text"
                key={item.key}
                icon={item.icon}
                aria-current={page === item.key ? "page" : undefined}
                className={page === item.key ? styles.mobileMoreActive : ""}
                onClick={() => navigateFromMore(item.key)}
              >
                {item.label}
              </Button>
            ))}
          </div>
          <div className={styles.mobileMoreGroup}>
            <span className={styles.mobileMoreLabel}>当前工作范围</span>
            <Select
              value={selectedTenantId}
              options={tenantOptions}
              onChange={setSelectedTenantId}
              aria-label="切换当前租户"
            />
          </div>
          <div className={styles.mobileMoreGroup}>
            <span className={styles.mobileMoreLabel}>账户与操作</span>
            <Button type="text" icon={<PlusOutlined />} onClick={openRegister}>
              注册 Agent
            </Button>
            <div className={styles.mobileMoreAccount}>
              <Avatar size={32}>
                {user.displayName.slice(0, 1).toUpperCase()}
              </Avatar>
              <span>
                {user.displayName}
                <small>{user.email}</small>
              </span>
            </div>
            <Button
              type="text"
              danger
              icon={<LogoutOutlined />}
              onClick={() => void logout()}
            >
              退出登录
            </Button>
          </div>
        </div>
      </Drawer>
    </div>
  );
}
