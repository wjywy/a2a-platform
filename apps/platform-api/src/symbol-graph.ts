import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { config } from "./config.js";
import { query } from "./db.js";

type Json = Record<string, unknown>;
export type SymbolGraphInput = { tenantId: string; taskId: string; agentSlug: string; intent: Json };
export type SymbolGraphOutput = { text: string; data: Json };
export type SymbolExecutor = (agentSlug: string) => Promise<SymbolGraphOutput>;
type GraphState = { agentSlug: string; plan: string[]; evidence: Record<string, SymbolGraphOutput> };

const specialistSlugs = ["symbol-market", "symbol-company", "symbol-technical-options", "symbol-news", "symbol-risk", "symbol-critic"] as const;
const nodeFor = (slug: string) => slug.replace(/^symbol-/, "").replaceAll("-", "_");
const State = Annotation.Root({
  tenantId: Annotation<string>, taskId: Annotation<string>, agentSlug: Annotation<string>, intent: Annotation<Json>,
  plan: Annotation<string[]>({ reducer: (_old, next) => next, default: () => [] }),
  evidence: Annotation<Record<string, SymbolGraphOutput>>({ reducer: (old, next) => ({ ...old, ...next }), default: () => ({}) }),
  result: Annotation<SymbolGraphOutput | undefined>,
});

let saver: PostgresSaver | undefined;
let saverReady: Promise<void> | undefined;
function checkpointer() {
  saver ??= PostgresSaver.fromConnString(config.postgresUrl, { schema: "langgraph_symbol" });
  saverReady ??= saver.setup();
  return { saver, ready: saverReady };
}
function threadId(input: SymbolGraphInput) { return `${input.tenantId}:${input.agentSlug}:${input.taskId}`; }

async function upsertRun(input: SymbolGraphInput, status: "running" | "input_required" | "completed" | "failed" | "cancelled", output?: Json, error?: Json) {
  const rows = await query<{ id: string }>(`INSERT INTO agent_runs(tenant_id,agent_slug,a2a_task_id,graph_thread_id,status,input,started_at,completed_at,output,error)
    VALUES($1,$2,$3,$4,$5,$6,CASE WHEN $5='running' THEN now() END,CASE WHEN $5 IN ('completed','failed','input_required','cancelled') THEN now() END,$7,$8)
    ON CONFLICT(tenant_id,agent_slug,a2a_task_id) DO UPDATE SET
      status=EXCLUDED.status,input=EXCLUDED.input,output=COALESCE(EXCLUDED.output,agent_runs.output),error=EXCLUDED.error,
      started_at=CASE WHEN EXCLUDED.status='running' THEN COALESCE(agent_runs.started_at,now()) ELSE agent_runs.started_at END,
      completed_at=CASE WHEN EXCLUDED.status IN ('completed','failed','input_required','cancelled') THEN now() ELSE NULL END,updated_at=now()
    RETURNING id`, [input.tenantId, input.agentSlug, input.taskId, threadId(input), status, JSON.stringify(input.intent), output ? JSON.stringify(output) : null, error ? JSON.stringify(error) : null]);
  return rows[0].id;
}
async function event(runId: string, node: string, kind: "node_started" | "node_completed" | "tool" | "interrupt" | "error" | "final", payload: Json = {}) {
  await query(`INSERT INTO agent_run_events(run_id,sequence,node,kind,payload)
    VALUES($1,(SELECT coalesce(max(sequence),0)+1 FROM agent_run_events WHERE run_id=$1),$2,$3,$4)`, [runId,node,kind,JSON.stringify(payload)]);
}

/** Records a durable, recoverable user-input pause without guessing a security identifier. */
export async function recordSymbolInterrupt(input: SymbolGraphInput, missing: string[]) {
  const runId = await upsertRun(input, "input_required");
  await event(runId, "collect_input", "interrupt", { missing });
}

/** Product-safe trajectory: node timing and tool outcomes, never hidden reasoning. */
export async function getSymbolRunTrajectory(tenantId: string, taskId: string, agentSlug: string) {
  const runs = await query<{ id: string; status: string; graph_thread_id: string; created_at: string; updated_at: string }>(
    `SELECT id,status,graph_thread_id,created_at,updated_at FROM agent_runs WHERE tenant_id=$1 AND a2a_task_id=$2 AND agent_slug=$3`, [tenantId, taskId, agentSlug]);
  const run = runs[0]; if (!run) return undefined;
  const events = await query<{ sequence: number; node: string; kind: string; payload: Json; created_at: string }>(
    `SELECT sequence,node,kind,payload,created_at FROM agent_run_events WHERE run_id=$1 ORDER BY sequence ASC`, [run.id]);
  return { id: run.id, status: run.status, threadId: run.graph_thread_id, createdAt: run.created_at, updatedAt: run.updated_at, events };
}

/** Durable LangGraph orchestration; supervisor runs each specialist node then writes its brief. */
export async function runSymbolGraph(input: SymbolGraphInput, execute: SymbolExecutor): Promise<SymbolGraphOutput> {
  const runId = await upsertRun(input, "running");
  // Nodes are selected from the registered Agent Card at runtime. LangGraph's
  // fluent type builder cannot infer this dynamic node set, while State remains
  // fully defined above and is validated by the compiled graph at invocation.
  const graph: any = new StateGraph(State);
  graph.addNode("plan_graph", async (state: GraphState) => {
    const plan = state.agentSlug === "symbol-supervisor" ? [...specialistSlugs, "symbol-supervisor"] : [state.agentSlug];
    await event(runId, "plan_graph", "node_completed", { plan }); return { plan };
  });
  for (const slug of specialistSlugs) {
    const node = nodeFor(slug);
    graph.addNode(node, async () => {
      await event(runId, node, "node_started", { agent: slug });
      const result = await execute(slug);
      await event(runId, node, "node_completed", { agent: slug, hasArtifact: Boolean(result.data) });
      return { evidence: { [slug]: result }, ...(input.agentSlug === slug ? { result } : {}) };
    });
  }
  graph.addNode("supervisor", async (state: GraphState) => {
    await event(runId, "supervisor", "node_started", { evidence: Object.keys(state.evidence) });
    const result = await execute("symbol-supervisor");
    await event(runId, "supervisor", "node_completed", { hasArtifact: Boolean(result.data) });
    return { result };
  });
  graph.addNode("finalize", async (state: GraphState) => { await event(runId, "finalize", "final", { plan: state.plan, evidence: Object.keys(state.evidence) }); return {}; });
  graph.addEdge(START, "plan_graph");
  graph.addConditionalEdges("plan_graph", (state: GraphState) => state.agentSlug === "symbol-supervisor" ? "market" : nodeFor(state.agentSlug));
  const supervisorNext: Record<string, string> = { market: "company", company: "technical_options", technical_options: "news", news: "risk", risk: "critic", critic: "supervisor" };
  for (const slug of specialistSlugs) {
    const node = nodeFor(slug);
    graph.addConditionalEdges(node, (state: GraphState) => state.agentSlug === "symbol-supervisor" ? supervisorNext[node] : "finalize");
  }
  graph.addEdge("supervisor", "finalize"); graph.addEdge("finalize", END);
  try {
    const { saver: checkpointSaver, ready } = checkpointer(); await ready;
    const compiled = graph.compile({ checkpointer: checkpointSaver });
    const state = await compiled.invoke({ tenantId: input.tenantId, taskId: input.taskId, agentSlug: input.agentSlug, intent: input.intent }, { configurable: { thread_id: threadId(input) } });
    const result = state.result ?? state.evidence[input.agentSlug]; if (!result) throw new Error("LangGraph 未返回研究结果。");
    await upsertRun(input, "completed", result.data); return result;
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "未知图执行错误";
    await event(runId, "graph", "error", { message }); await upsertRun(input, "failed", undefined, { message }); throw caught;
  }
}
