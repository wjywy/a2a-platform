import { Router } from "express";
import { AgentCard, formatSSEEvent, SSE_HEADERS, StreamResponse } from "@a2a-js/sdk";
import { asyncHandler } from "./http.js";
import { config } from "./config.js";
import { cancelSymbolTask, getSymbolTask, handleSymbolMessage, isSymbolAgentSlug, symbolCard } from "./symbol-service.js";

const router = Router();

function authorized(value: string | undefined) {
  // Cards are deliberately public to satisfy discovery and health checks. Only
  // the private execution endpoint needs the per-deployment internal token.
  return Boolean(config.symbolInternalToken) && value === `Bearer ${config.symbolInternalToken}`;
}
function requireInternal(req: import("express").Request) {
  if (!authorized(req.header("authorization"))) {
    const error = new Error("内置 Symbol Agent 只接受平台网关的调用。");
    Object.assign(error, { status: 401, code: "SYMBOL_AGENT_UNAUTHORIZED" });
    throw error;
  }
}

router.options("/api/builtin/symbol/:slug/:tenant/message:send", (_req, res) => res.sendStatus(204));
router.options("/api/builtin/symbol/:slug/message:send", (_req, res) => res.sendStatus(204));
router.options("/api/builtin/symbol/:slug/:tenant/message:stream", (_req, res) => res.sendStatus(204));
router.options("/api/builtin/symbol/:slug/message:stream", (_req, res) => res.sendStatus(204));
router.options("/api/builtin/symbol/:slug", (_req, res) => res.sendStatus(204));

router.get("/api/builtin/symbol/:slug/.well-known/agent-card.json", (req, res) => {
  const slug = String(req.params.slug);
  if (!isSymbolAgentSlug(slug)) { res.status(404).json({ error: "Agent 不存在" }); return; }
  res.json(AgentCard.toJSON(AgentCard.fromJSON(symbolCard(slug))));
});

async function send(req: import("express").Request, res: import("express").Response): Promise<void> {
  const slug = String(req.params.slug);
  if (!isSymbolAgentSlug(slug)) { res.status(404).json({ error: "Agent 不存在" }); return; }
  requireInternal(req);
  const tenantId = req.params.tenant ? String(req.params.tenant) : "";
  if (!tenantId) { res.status(400).json({ error: "缺少 tenant。" }); return; }
  const task = await handleSymbolMessage(slug, tenantId, req.body);
  res.json(task);
}
router.post("/api/builtin/symbol/:slug/:tenant/message:send", asyncHandler(send));
router.post("/api/builtin/symbol/:slug/message:send", asyncHandler(send));

async function stream(req: import("express").Request, res: import("express").Response): Promise<void> {
  const slug = String(req.params.slug);
  if (!isSymbolAgentSlug(slug)) { res.status(404).json({ error: "Agent 不存在" }); return; }
  requireInternal(req);
  const tenantId = req.params.tenant ? String(req.params.tenant) : "";
  if (!tenantId) { res.status(400).json({ error: "缺少 tenant。" }); return; }
  Object.entries(SSE_HEADERS).forEach(([key, value]) => res.setHeader(key, value));
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  try {
    const result = await handleSymbolMessage(slug, tenantId, req.body);
    const event = StreamResponse.toJSON({ payload: { $case: "task", value: result as never } });
    res.write(formatSSEEvent(event));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Symbol Agent 流式调用失败。";
    res.write(formatSSEEvent({ error: { message } }));
  } finally {
    res.end();
  }
}
router.post("/api/builtin/symbol/:slug/:tenant/message:stream", asyncHandler(stream));
router.post("/api/builtin/symbol/:slug/message:stream", asyncHandler(stream));

async function task(req: import("express").Request, res: import("express").Response): Promise<void> {
  const slug = String(req.params.slug); const tenantId = req.params.tenant ? String(req.params.tenant) : ""; const taskId = String(req.params.taskId);
  if (!isSymbolAgentSlug(slug) || !tenantId || !taskId) { res.status(404).json({ error: "任务不存在" }); return; }
  requireInternal(req);
  const result = await getSymbolTask(slug, tenantId, taskId);
  if (!result) { res.status(404).json({ error: "任务不存在" }); return; }
  res.json(result);
}
async function cancel(req: import("express").Request, res: import("express").Response): Promise<void> {
  const slug = String(req.params.slug); const tenantId = req.params.tenant ? String(req.params.tenant) : ""; const taskId = String(req.params.taskId);
  if (!isSymbolAgentSlug(slug) || !tenantId || !taskId) { res.status(404).json({ error: "任务不存在" }); return; }
  requireInternal(req);
  const result = await cancelSymbolTask(slug, tenantId, taskId);
  if (!result) { res.status(404).json({ error: "任务不存在" }); return; }
  res.json(result);
}
router.get("/api/builtin/symbol/:slug/:tenant/tasks/:taskId", asyncHandler(task));
router.post("/api/builtin/symbol/:slug/:tenant/tasks/:taskId\\:cancel", asyncHandler(cancel));

export { router as symbolRouter };
