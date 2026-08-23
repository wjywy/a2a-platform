import { useEffect, useState } from "react";
import { Alert, Button, Divider, Form, Input, Typography } from "antd";
import { LoginOutlined } from "@ant-design/icons";
import {
  ApiError,
  platformApi,
  type AuthConfig,
  type Invitation,
} from "../api";
import styles from "./AuthPage.module.css";

export function AuthPage({
  invitationToken,
  onAuthenticated,
}: {
  invitationToken?: string;
  onAuthenticated: (
    accessToken: string,
    acceptInvitation: boolean,
    destination?: "overview" | "agents",
  ) => Promise<void>;
}) {
  const [config, setConfig] = useState<AuthConfig>();
  const [invitation, setInvitation] = useState<Invitation>();
  const [mode, setMode] = useState<"login" | "activate" | "register">(
    invitationToken ? "activate" : "login",
  );
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void platformApi
      .authConfig()
      .then(setConfig)
      .catch((reason) =>
        setError(
          reason instanceof Error ? reason.message : "无法读取登录配置。",
        ),
      );
  }, []);
  useEffect(() => {
    if (!invitationToken) return;
    void platformApi
      .invitation(invitationToken)
      .then((value) => {
        setInvitation(value);
        setEmail(value.email);
      })
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : "邀请链接无效。"),
      );
  }, [invitationToken]);

  const submit = async () => {
    setError("");
    if (mode !== "login" && password !== confirmPassword) {
      setError("两次输入的密码不一致。");
      return;
    }
    setLoading(true);
    try {
      if (mode === "activate" && invitationToken) {
        const result = await platformApi.activateInvitation(
          invitationToken,
          displayName,
          password,
        );
        await onAuthenticated(result.accessToken, false);
      } else if (mode === "register") {
        const result = await platformApi.register(email, displayName, password);
        await onAuthenticated(result.accessToken, false, "agents");
      } else {
        const result = await platformApi.login(email, password);
        await onAuthenticated(result.accessToken, Boolean(invitationToken));
      }
    } catch (reason) {
      setError(
        reason instanceof ApiError || reason instanceof Error
          ? reason.message
          : "登录失败，请稍后重试。",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className={styles.shell}>
      <section className={styles.brandPanel}>
        <div className={styles.logo}>A</div>
        <p className={styles.eyebrow}>A2A AGENT OPERATIONS</p>
        <h1>让每一个 Agent 都有清晰的运行边界。</h1>
        <p>
          统一管理租户、实例、API
          Key、任务、配额、告警与事件投递，面向团队和外部客户提供稳定的 A2A
          调用入口。
        </p>
        <dl>
          <div>
            <dt>协议网关</dt>
            <dd>平台代理 Card 与流式任务</dd>
          </div>
          <div>
            <dt>租户隔离</dt>
            <dd>角色、密钥、配额和审计</dd>
          </div>
          <div>
            <dt>运行治理</dt>
            <dd>多实例、健康、告警和通知</dd>
          </div>
        </dl>
      </section>
      <section className={styles.formPanel}>
        <div className={styles.card}>
          <header>
            <span>{invitation ? "客户空间邀请" : "A2A Hub 控制台"}</span>
            <h2>
              {mode === "activate"
                ? "激活你的账号"
                : mode === "register"
                  ? "创建平台账号"
                  : "登录控制台"}
            </h2>
            <p>
              {invitation
                ? `${invitation.tenantName ?? "租户"} 邀请你以 ${invitation.role} 身份加入。`
                : mode === "register"
                  ? "注册后立即进入 Agent 目录，只展示你有权查看的服务。"
                  : "使用平台账号或企业身份继续。"}
            </p>
          </header>
          <Form layout="vertical" onFinish={() => void submit()}>
            {mode !== "login" && (
              <Form.Item label="显示名称" htmlFor="auth-display-name" required>
                <Input
                  id="auth-display-name"
                  autoComplete="name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  required
                  autoFocus
                />
              </Form.Item>
            )}
            <Form.Item label="邮箱" htmlFor="auth-email" required>
              <Input
                id="auth-email"
                autoComplete="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={mode === "activate"}
                required
              />
            </Form.Item>
            <Form.Item
              label={mode === "login" ? "密码" : "设置密码（至少 12 位）"}
              htmlFor="auth-password"
              required
            >
              <Input.Password
                id="auth-password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                minLength={mode === "login" ? 1 : 12}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </Form.Item>
            {mode !== "login" && (
              <Form.Item
                label="确认密码"
                htmlFor="auth-confirm-password"
                required
              >
                <Input.Password
                  id="auth-confirm-password"
                  autoComplete="new-password"
                  minLength={12}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                />
              </Form.Item>
            )}
            {mode === "register" && (
              <Typography.Paragraph
                type="secondary"
                className={styles.scopeNote}
              >
                新账号不会自动获得租户管理权限。未加入租户时只能查看公开 Agent。
              </Typography.Paragraph>
            )}
            {error && (
              <Alert
                type="error"
                showIcon
                title={error}
                className={styles.error}
              />
            )}
            <Button
              block
              type="primary"
              htmlType="submit"
              icon={<LoginOutlined />}
              loading={loading}
              disabled={!config}
              className={styles.primary}
            >
              {mode === "activate"
                ? "激活并加入"
                : mode === "register"
                  ? "注册并登录"
                  : "登录"}
            </Button>
          </Form>
          {config?.oidcEnabled && (
            <Button
              block
              className={styles.secondary}
              onClick={() =>
                void platformApi.oidcStart().then(({ authorizationUrl }) => {
                  location.href = authorizationUrl;
                })
              }
            >
              使用企业身份登录
            </Button>
          )}
          {(invitationToken || config?.selfRegistrationEnabled) && (
            <Divider plain>或</Divider>
          )}
          {invitationToken && config?.localLoginEnabled && (
            <Button
              type="link"
              block
              className={styles.switch}
              onClick={() => {
                setMode(mode === "activate" ? "login" : "activate");
                setError("");
              }}
            >
              {mode === "activate"
                ? "已有账号？先登录再接受邀请"
                : "没有账号？返回激活"}
            </Button>
          )}
          {!invitationToken &&
            config?.localLoginEnabled &&
            config.selfRegistrationEnabled && (
              <Button
                type="link"
                block
                className={styles.switch}
                onClick={() => {
                  setMode(mode === "register" ? "login" : "register");
                  setError("");
                  setPassword("");
                  setConfirmPassword("");
                }}
              >
                {mode === "register"
                  ? "已有账号？返回登录"
                  : "没有账号？立即注册"}
              </Button>
            )}
          {!config?.localLoginEnabled && !config?.oidcEnabled && (
            <Alert
              type="warning"
              showIcon
              title="管理员尚未配置可用的登录方式。"
            />
          )}
        </div>
      </section>
    </main>
  );
}
