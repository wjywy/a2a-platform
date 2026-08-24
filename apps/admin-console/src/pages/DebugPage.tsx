import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import {
  Button,
  Checkbox,
  Collapse,
  Flex,
  Form,
  Input,
  Segmented,
  Select,
  Space,
  Tabs,
  Tag,
  Typography,
} from "antd";
import {
  ApiOutlined,
  DisconnectOutlined,
  KeyOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { useApp } from "../AppContext";
import {
  cancelRemoteTask,
  platformApi,
  streamAgent,
  type ApiKey,
  type SseEnvelope,
} from "../api";
import { useAsync, useDisclosure } from "../hooks";
import {
  CodeBlock,
  CopyButton,
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
import {
  aggregateMarkdown,
  StreamingMarkdown,
} from "../components/StreamingMarkdown";
import { A2AChatTransport } from "../a2a-chat-transport";
type DebugEvent = SseEnvelope & { index: number; receivedAt: string };
const MAX_RETAINED_EVENTS = 500;
function findTaskId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return;
  const item = value as Record<string, unknown>;
  for (const key of ["taskId", "id"])
    if (typeof item[key] === "string" && item[key]) return item[key] as string;
  for (const nested of Object.values(item)) {
    const result = findTaskId(nested);
    if (result) return result;
  }
}
export function DebugPage() {
  const { token, agents, tenants, selectedTenantId, setSelectedTenantId } =
    useApp();
  const tenantId = selectedTenantId || tenants[0]?.id || "";
  const keys = useAsync(
    () =>
      tenantId ? platformApi.keys(token, tenantId, false) : Promise.resolve([]),
    [token, tenantId],
  );
  const [keyId, setKeyId] = useState("");
  const [secret, setSecret] = useState("");
  const [slug, setSlug] = useState("");
  const [question, setQuestion] = useState(
    "请分析 AAPL 的近期走势、关键风险和需要关注的指标。",
  );
  const [events, setEvents] = useState<DebugEvent[]>([]);
  const [responseView, setResponseView] = useState<"events" | "markdown">(
    "events",
  );
  const [busy, setBusy] = useState(false);
  const [taskId, setTaskId] = useState("");
  const [mode, setMode] = useState<"new" | "subscribe">("new");
  const controller = useRef<AbortController | undefined>(undefined);
  const chatConfig = useRef({ slug: "", apiKey: "" });
  chatConfig.current = { slug, apiKey: secret };
  const chatTransport = useMemo(
    () => new A2AChatTransport(() => chatConfig.current),
    [],
  );
  const chat = useChat({ transport: chatTransport });
  const create = useDisclosure();
  const toast = useToast();
  const markdownResult = useMemo(() => aggregateMarkdown(events), [events]);
  const availableAgents = useMemo(
    () =>
      agents.filter(
        (a) =>
          ["online", "degraded"].includes(a.status) &&
          (!tenantId ||
            a.tenantId === tenantId ||
            a.visibility === "public" ||
            a.allowedTenantIds.includes(tenantId)),
      ),
    [agents, tenantId],
  );
  useEffect(() => {
    if (!slug && availableAgents[0]) setSlug(availableAgents[0].slug);
  }, [availableAgents, slug]);
  useEffect(() => {
    if (!keyId && keys.data?.[0]) setKeyId(keys.data[0].id);
  }, [keys.data, keyId]);
  useEffect(() => {
    const saved = keyId ? sessionStorage.getItem(`a2a-secret:${keyId}`) : "";
    setSecret(saved ?? "");
  }, [keyId]);
  const run = async () => {
    if (!slug || !secret) return;
    controller.current?.abort();
    controller.current = new AbortController();
    setEvents([]);
    setBusy(true);
    if (mode === "new") setTaskId("");
    try {
      if (mode === "new") {
        await chat.sendMessage({ text: question });
        toast.success("对话响应已结束");
        return;
      }
      let index = 0;
      for await (const event of streamAgent({
        slug,
        apiKey: secret,
        question,
        taskId: mode === "subscribe" ? taskId : undefined,
        signal: controller.current.signal,
      })) {
        const row = {
          ...event,
          index: ++index,
          receivedAt: new Date().toISOString(),
        };
        setEvents((value) =>
          value.length >= MAX_RETAINED_EVENTS
            ? [...value.slice(-(MAX_RETAINED_EVENTS - 1)), row]
            : [...value, row],
        );
        const found = findTaskId(event.data);
        if (found) setTaskId(found);
      }
      toast.success("流式响应已结束");
    } catch (error) {
      if ((error as Error).name !== "AbortError")
        toast.error(error instanceof Error ? error.message : "调用失败");
    } finally {
      setBusy(false);
    }
  };
  const stop = () => {
    controller.current?.abort();
    setBusy(false);
    toast.info("已断开本地 SSE 连接");
  };
  const cancel = async () => {
    try {
      await cancelRemoteTask(slug, taskId, secret);
      toast.success("取消请求已发送到远端 Agent");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "取消失败");
    }
  };
  return (
    <>
      <div className={styles.debugGrid}>
        <section className={styles.panel}>
          <SectionHeader
            title="请求配置"
            description="调用将通过 8080 平台网关并计入租户用量"
          />
          <Segmented
            block
            className={styles.segmented}
            value={mode}
            options={[
              { value: "new", label: "新建调用" },
              { value: "subscribe", label: "重新订阅" },
            ]}
            onChange={(value) => setMode(value as "new" | "subscribe")}
          />
          <Field label="租户" htmlFor="debug-tenant">
            <Select
              id="debug-tenant"
              showSearch
              optionFilterProp="label"
              value={tenantId}
              options={tenants.map((tenant) => ({
                value: tenant.id,
                label: tenant.displayName,
              }))}
              onChange={setSelectedTenantId}
            />
          </Field>
          <Field label="目标 Agent" htmlFor="debug-agent">
            <Select
              id="debug-agent"
              value={slug || undefined}
              placeholder="选择一个已上线 Agent"
              options={availableAgents.map((agent) => ({
                value: agent.slug,
                label: `${agent.displayName} · ${agent.status}`,
              }))}
              onChange={setSlug}
            />
          </Field>
          <Field label="API Key">
            <Space.Compact block>
              <Select
                aria-label="API Key"
                style={{ width: "100%" }}
                value={keyId || undefined}
                placeholder="选择 API Key"
                options={keys.data?.map((key) => ({
                  value: key.id,
                  label: `${key.name} · ${key.prefix}`,
                }))}
                onChange={setKeyId}
              />
              <Button icon={<KeyOutlined />} onClick={create.show}>
                新建
              </Button>
            </Space.Compact>
          </Field>
          <Field
            label="API Key 明文"
            hint="平台不保存明文；当前浏览器会话中临时保存"
          >
            <Input.Password
              value={secret}
              onChange={(e) => {
                setSecret(e.target.value);
                if (keyId)
                  sessionStorage.setItem(`a2a-secret:${keyId}`, e.target.value);
              }}
              placeholder="a2a_live_…"
            />
          </Field>
          {mode === "new" ? (
            <Field label="消息">
              <Input.TextArea
                rows={8}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
              />
            </Field>
          ) : (
            <Field label="远端 Task ID">
              <Input
                value={taskId}
                onChange={(e) => setTaskId(e.target.value)}
                placeholder="输入要重新订阅的 Task ID"
              />
            </Field>
          )}
          <Space wrap className={styles.buttonRow}>
            <Button
              type="primary"
              icon={<ApiOutlined />}
              loading={busy}
              disabled={
                busy || !slug || !secret || (mode === "subscribe" && !taskId)
              }
              onClick={() => void run()}
            >
              {mode === "new" ? "发起流式调用" : "重新订阅任务"}
            </Button>
            {busy && (
              <Button icon={<DisconnectOutlined />} onClick={stop}>
                断开 SSE
              </Button>
            )}
            {taskId && (
              <Button
                danger
                icon={<StopOutlined />}
                disabled={busy}
                onClick={() => void cancel()}
              >
                取消任务
              </Button>
            )}
          </Space>
          {taskId && (
            <div className={styles.taskIdBox}>
              <Typography.Text type="secondary">Task ID</Typography.Text>
              <Typography.Text code ellipsis>
                {taskId}
              </Typography.Text>
              <CopyButton value={taskId} />
            </div>
          )}
        </section>
        <section className={styles.panel}>
          <SectionHeader
            title="响应输出"
            description="查看原始协议事件，或阅读实时聚合的 Markdown 正文"
            actions={
              <Tag>
                {events.length === MAX_RETAINED_EVENTS
                  ? `最近 ${MAX_RETAINED_EVENTS} 条事件`
                  : `${events.length} 条事件`}
              </Tag>
            }
          />
          <Tabs
            activeKey={responseView}
            onChange={(key) => setResponseView(key as "events" | "markdown")}
            items={[
              {
                key: "events",
                label: `事件明细 ${events.length}`,
                children: (
                  <PageState
                    empty={!events.length ? "等待流式事件" : undefined}
                  >
                    <Collapse
                      className={styles.eventStream}
                      size="small"
                      defaultActiveKey={
                        events.length ? [String(events.length)] : []
                      }
                      items={events.map((event) => ({
                        key: String(event.index),
                        label: (
                          <Flex justify="space-between" gap={12}>
                            <Space>
                              <Tag color="blue">{event.index}</Tag>
                              <span>{event.event ?? "message"}</span>
                              <Typography.Text type="secondary">
                                {formatTime(event.receivedAt)}
                              </Typography.Text>
                            </Space>
                            <Typography.Text type="secondary" ellipsis>
                              {findTaskId(event.data) ?? ""}
                            </Typography.Text>
                          </Flex>
                        ),
                        children: <CodeBlock value={event.data} />,
                      }))}
                    />
                  </PageState>
                ),
              },
              {
                key: "markdown",
                label: `Markdown 预览 ${markdownResult.blockCount}`,
                children: (
                  <PageState
                    empty={
                      !markdownResult.markdown
                        ? "等待 Agent 返回文本内容"
                        : undefined
                    }
                  >
                    <div className={styles.markdownViewport}>
                      <div className={styles.markdownMeta}>
                        <span>{markdownResult.blockCount} 个文本块</span>
                        <span>{markdownResult.markdown.length} 个字符</span>
                      </div>
                      <StreamingMarkdown
                        markdown={markdownResult.markdown}
                        busy={busy}
                      />
                      {chat.messages.map((message) => (
                        <div key={message.id} className={styles.chatMessage}>
                          <Typography.Text strong>
                            {message.role === "user" ? "你" : "Agent"}
                          </Typography.Text>
                          {message.parts
                            .filter((part) => part.type === "text")
                            .map((part, index) => (
                              <StreamingMarkdown
                                key={index}
                                markdown={part.text}
                                busy={chat.status === "streaming"}
                              />
                            ))}
                        </div>
                      ))}
                    </div>
                  </PageState>
                ),
              },
            ]}
          />
        </section>
      </div>
      {create.open && (
        <CreateKeyModal
          tenantId={tenantId}
          close={create.hide}
          saved={async (key) => {
            sessionStorage.setItem(`a2a-secret:${key.id}`, key.secret!);
            setKeyId(key.id);
            setSecret(key.secret!);
            create.hide();
            await keys.refresh();
          }}
        />
      )}
    </>
  );
}
function CreateKeyModal({
  tenantId,
  close,
  saved,
}: {
  tenantId: string;
  close: () => void;
  saved: (key: ApiKey) => Promise<void>;
}) {
  const { token } = useApp();
  const toast = useToast();
  const [name, setName] = useState("调试台 Key");
  const [scopes, setScopes] = useState([
    "agent:invoke",
    "task:read",
    "task:cancel",
  ]);
  const [result, setResult] = useState<ApiKey>();
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const key = await platformApi.createKey(token, tenantId, {
        name,
        scopes,
      });
      setResult(key);
      toast.success("API Key 已创建");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建失败");
    } finally {
      setBusy(false);
    }
  };
  if (result)
    return (
      <Modal
        title="保存 API Key"
        description="明文仅展示一次，关闭后平台无法恢复"
        onClose={close}
      >
        <div className={styles.secretReveal}>
          <StatusBadge value="active" />
          <Typography.Paragraph>
            立即复制并保存到安全的密钥管理工具。不要写入源码或提交到 Git。
          </Typography.Paragraph>
          <Typography.Text code copyable>
            {result.secret}
          </Typography.Text>
          <CopyButton value={result.secret!} label="复制密钥" />
          <Flex justify="flex-end" className={styles.modalFooter}>
            <Button type="primary" onClick={() => void saved(result)}>
              已安全保存，继续调试
            </Button>
          </Flex>
        </div>
      </Modal>
    );
  return (
    <Modal title="创建调试 API Key" onClose={close}>
      <Form
        className={styles.formGrid}
        layout="vertical"
        onFinish={() => void create()}
      >
        <Field label="名称">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="作用域">
          <Checkbox.Group
            className={styles.checkboxList}
            value={scopes}
            options={["agent:invoke", "task:read", "task:cancel", "usage:read"]}
            onChange={(values) => setScopes(values as string[])}
          />
        </Field>
        <FormActions cancel={close} submit="创建 Key" busy={busy} />
      </Form>
    </Modal>
  );
}
