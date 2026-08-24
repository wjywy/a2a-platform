import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { Button, Input, Select, Tag, Typography } from "antd";
import { PauseCircleOutlined, SendOutlined, SettingOutlined } from "@ant-design/icons";
import { useApp } from "../AppContext";
import { platformApi, type AgentRunTrajectory } from "../api";
import { useAsync } from "../hooks";
import { StreamingMarkdown } from "./StreamingMarkdown";
import { A2AChatTransport } from "../a2a-chat-transport";
import styles from "../App.module.css";

function findTaskId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  for (const key of ["taskId", "id"]) if (typeof item[key] === "string" && item[key]) return item[key] as string;
  for (const child of Object.values(item)) { const found = findTaskId(child); if (found) return found; }
  return undefined;
}

function statusLabel(status: string) {
  return ({ running: "运行中", input_required: "等待补充", completed: "已完成", failed: "失败", cancelled: "已取消" } as Record<string, string>)[status] ?? status;
}

export function AgentStudio() {
  const { token, agents, tenants, selectedTenantId, setSelectedTenantId } = useApp();
  const tenantId = selectedTenantId || tenants[0]?.id || "";
  const keys = useAsync(() => tenantId ? platformApi.keys(token, tenantId, false) : Promise.resolve([]), [token, tenantId]);
  const [keyId, setKeyId] = useState("");
  const [secret, setSecret] = useState("");
  const [slug, setSlug] = useState("");
  const [prompt, setPrompt] = useState("");
  const [taskId, setTaskId] = useState("");
  const [trajectory, setTrajectory] = useState<AgentRunTrajectory | null>();
  const [settingsOpen, setSettingsOpen] = useState(true);
  const config = useRef({ slug: "", apiKey: "", onEvent: undefined as undefined | ((event: unknown) => void) });
  config.current = { slug, apiKey: secret, onEvent: (event) => { const next = findTaskId(event); if (next) setTaskId(next); } };
  const transport = useMemo(() => new A2AChatTransport(() => config.current), []);
  const chat = useChat({ transport });
  const availableAgents = useMemo(() => agents.filter((agent) => ["online", "degraded"].includes(agent.status) && (!tenantId || agent.tenantId === tenantId || agent.visibility === "public" || agent.allowedTenantIds.includes(tenantId))), [agents, tenantId]);

  useEffect(() => { if (!slug && availableAgents[0]) setSlug(availableAgents[0].slug); }, [availableAgents, slug]);
  useEffect(() => { if (!keyId && keys.data?.[0]) setKeyId(keys.data[0].id); }, [keys.data, keyId]);
  useEffect(() => { setSecret(keyId ? sessionStorage.getItem(`a2a-secret:${keyId}`) ?? "" : ""); }, [keyId]);
  useEffect(() => {
    if (!taskId || !tenantId || !slug) { setTrajectory(null); return; }
    let alive = true;
    const load = async () => { try { const run = await platformApi.agentRun(token, tenantId, slug, taskId); if (alive) setTrajectory(run); } catch { if (alive) setTrajectory(null); } };
    void load();
    const timer = window.setInterval(() => void load(), chat.status === "streaming" ? 1200 : 5000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [chat.status, slug, taskId, tenantId, token]);

  const send = async () => {
    const message = prompt.trim();
    if (!message || chat.status === "streaming" || !slug || !secret) return;
    setPrompt("");
    await chat.sendMessage({ text: message });
  };
  const selected = availableAgents.find((agent) => agent.slug === slug);
  return <div className={styles.agentStudio}>
    <aside className={styles.studioSidebar}>
      <div className={styles.studioBrand}><span>Agent Studio</span><Tag color="blue">A2A + LangGraph</Tag></div>
      <Typography.Text type="secondary">选择一个已上线 Agent，使用租户 API Key 发起受治理的真实调用。</Typography.Text>
      <label>租户<Select value={tenantId || undefined} options={tenants.map((tenant) => ({ value: tenant.id, label: tenant.displayName }))} onChange={setSelectedTenantId} /></label>
      <label>Agent<Select value={slug || undefined} options={availableAgents.map((agent) => ({ value: agent.slug, label: agent.displayName }))} onChange={(value) => { setSlug(value); setTaskId(""); }} /></label>
      <div className={styles.studioAgentCard}><b>{selected?.displayName ?? "尚未选择 Agent"}</b><span>{selected?.description ?? "请选择具备健康实例的 Agent。"}</span><Tag color={selected?.healthStatus === "healthy" ? "green" : "gold"}>{selected?.healthStatus ?? "unknown"}</Tag></div>
      <Button type="text" icon={<SettingOutlined />} onClick={() => setSettingsOpen((value) => !value)}>调用凭据</Button>
      {settingsOpen && <div className={styles.studioSettings}>
        <label>已保存的 Key<Select value={keyId || undefined} placeholder="选择 API Key" options={keys.data?.map((key) => ({ value: key.id, label: `${key.name} · ${key.prefix}` }))} onChange={setKeyId} /></label>
        <label>API Key 明文<Input.Password value={secret} placeholder="a2a_live_…" onChange={(event) => { setSecret(event.target.value); if (keyId) sessionStorage.setItem(`a2a-secret:${keyId}`, event.target.value); }} /></label>
        <Typography.Text type="secondary">仅保存在本浏览器会话内，不会发送到管理 API。</Typography.Text>
      </div>}
    </aside>
    <main className={styles.studioConversation}>
      <header className={styles.studioHeader}><div><b>{selected?.displayName ?? "选择 Agent 开始对话"}</b><span>{taskId ? `Task ${taskId.slice(0, 8)}…` : "新对话"}</span></div><div className={styles.studioHeaderActions}>{chat.status === "streaming" && <Button size="small" onClick={() => chat.stop()}>停止</Button>}{trajectory && <Tag color={trajectory.status === "completed" ? "green" : trajectory.status === "failed" ? "red" : "blue"}>{statusLabel(trajectory.status)}</Tag>}</div></header>
      {chat.error && <div className={styles.studioError} role="alert">{chat.error.message || "调用失败，请检查 Agent 状态、API Key 或稍后重试。"}</div>}
      <div className={styles.studioMessages}>
        {!chat.messages.length && <div className={styles.studioEmpty}><h2>从自然语言开始</h2><p>例如：“分析 AAPL 近期走势、新闻风险，并说明我还需要验证什么。”系统会在缺少标的或观点时继续询问，不会使用硬编码公司映射替你猜测。</p></div>}
        {chat.messages.map((message) => <article className={message.role === "user" ? styles.studioUserMessage : styles.studioAgentMessage} key={message.id}><div className={styles.messageRole}>{message.role === "user" ? "你" : selected?.displayName ?? "Agent"}</div>{message.parts.filter((part) => part.type === "text").map((part, index) => <StreamingMarkdown key={index} markdown={part.text} busy={chat.status === "streaming" && message.role === "assistant"} />)}</article>)}
      </div>
      <form className={styles.studioComposer} onSubmit={(event) => { event.preventDefault(); void send(); }}><Input.TextArea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={secret ? "输入任何自然语言消息…" : "先在左侧填写 API Key"} autoSize={{ minRows: 2, maxRows: 7 }} disabled={!secret || !slug || chat.status === "streaming"} /><Button type="primary" htmlType="submit" icon={<SendOutlined />} loading={chat.status === "streaming"} disabled={!prompt.trim() || !secret || !slug}>发送</Button></form>
    </main>
    <aside className={styles.studioTrace}>
      <div className={styles.traceTitle}><b>运行轨迹</b><span>仅展示节点与工具状态</span></div>
      {!trajectory && <div className={styles.traceEmpty}><PauseCircleOutlined /><p>调用后会在这里展示安全的 LangGraph 执行轨迹。</p></div>}
      {trajectory?.events.map((event) => <div className={styles.traceEvent} key={event.sequence}><span className={`${styles.traceDot} ${styles[`trace_${event.kind}`] ?? ""}`} /><div><b>{event.node.replaceAll("_", " ")}</b><small>{event.kind.replaceAll("_", " · ")}</small>{event.kind === "interrupt" && <p>等待补充：{Array.isArray(event.payload.missing) ? event.payload.missing.join("、") : "需要更多信息"}</p>}</div></div>)}
    </aside>
  </div>;
}
