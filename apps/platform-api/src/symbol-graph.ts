import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { config } from "./config.js";
import { query } from "./db.js";

type Json = Record<string, unknown>;
export type SymbolGraphInput = { tenantId: string; taskId: string; agentSlug: string; intent: Json };
export type SymbolGraphOutput = { text: string; data: Json };

const State = Annotation.Root({
  tenantId: Annotation<string>, taskId: Annotation<string>, agentSlug: Annotation<string>,
  intent: Annotation<Json>, plan: Annotation<string[]>({ reducer: (_a, b) => b, default: () => [] }),
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

async function upsertRun(input: SymbolGraphInput, status: string, output?: Json, error?: Json) {
  const rows = await query<{ id: string }>(`INSERT INTO agent_runs(tenant_id,agent_slug,a2a_task_id,graph_thread_id,status,input,started_at,completed_at,output,error)
    VALUES($1,$2,$3,$4,$5,$6,CASE WHEN $5='running' THEN now() END,CASE WHEN $5 IN ('completed','failed','input_required','cancelled') THEN now() END,$7,$8)
    ON CONFLICT(tenant_id,agent_slug,a2a_task_id) DO UPDATE SET status=EXCLUDED.status,output=EXCLUDED.output,error=EXCLUDED.error,completed_at=EXCLUDED.completed_at,updated_at=now()
    RETURNING id`, [input.tenantId, input.agentSlug, input.taskId, threadId(input), status, JSON.stringify(input.intent), output ? JSON.stringify(output) : null, error ? JSON.stringify(error) : null]);
  return rows[0].id;
}
async function event(runId: string, node: string, kind: string, payload: Json = {}) {
  await query(`INSERT INTO agent_run_events(run_id,sequence,node,kind,payload)
    VALUES($1,(SELECT coalesce(max(sequence),0)+1 FROM agent_run_events WHERE run_id=$1),$2,$3,$4)`, [runId,node,kind,JSON.stringify(payload)]);
}

/** Runs the durable graph and records an auditable node timeline. */
export async function runSymbolGraph(input: SymbolGraphInput, execute: () => Promise<SymbolGraphOutput>): Promise<SymbolGraphOutput> {
  const runId = await upsertRun(input, "running");
  const graph = new StateGraph(State)
    .addNode("plan_graph", async (state) => { const plan = state.agentSlug === "symbol-supervisor" ? ["market","company","technical-options","news","risk","critic","supervisor"] : [state.agentSlug.replace(/^symbol-/, "")]; await event(runId,"plan_graph","node_completed",{plan}); return { plan }; })
    .addNode("execute", async () => { await event(runId,"execute","node_started"); const result = await execute(); await event(runId,"execute","node_completed",{hasArtifact:Boolean(result.data)}); return { result }; })
    .addNode("finalize", async (state) => { await event(runId,"finalize","final",{plan:state.plan}); return {}; })
    .addEdge(START,"plan_graph").addEdge("plan_graph","execute").addEdge("execute","finalize").addEdge("finalize",END);
  try {
    const { saver: checkpointSaver, ready } = checkpointer(); await ready;
    const compiled = graph.compile({ checkpointer: checkpointSaver });
    const state = await compiled.invoke({ tenantId: input.tenantId, taskId: input.taskId, agentSlug: input.agentSlug, intent: input.intent }, { configurable: { thread_id: threadId(input) } });
    const result = state.result; if (!result) throw new Error("LangGraph 未返回研究结果。");
    await upsertRun(input,"completed",result.data); return result;
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "未知图执行错误";
    await event(runId,"graph","error",{message}); await upsertRun(input,"failed",undefined,{message}); throw caught;
  }
}
