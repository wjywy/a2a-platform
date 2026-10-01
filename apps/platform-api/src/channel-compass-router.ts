import crypto from "node:crypto";
import { Router } from "express";
import {
  AgentCard,
  formatSSEEvent,
  SSE_HEADERS,
  StreamResponse,
  Task,
  TaskStatusUpdateEvent,
} from "@a2a-js/sdk";
import { config } from "./config.js";
import { asyncHandler } from "./http.js";
import {
  cancelChannelCompassTask,
  channelCompassCard,
  getChannelCompassTask,
  handleChannelCompassMessage,
} from "./channel-compass-service.js";
import {
  getChannelVisualization,
  renderChannelChartSvg,
  verifyChannelChartSignature,
} from "./channel-compass-visualization.js";

const router = Router();
const active = new Map<string, AbortController>();

function requireInternal(req: import("express").Request) {
  if (
    !config.channelCompassInternalToken ||
    req.header("authorization") !==
      `Bearer ${config.channelCompassInternalToken}`
  ) {
    const error = new Error("渠道罗盘只接受平台网关的调用。");
    Object.assign(error, {
      status: 401,
      code: "CHANNEL_COMPASS_UNAUTHORIZED",
    });
    throw error;
  }
}

function tenant(req: import("express").Request) {
  if (typeof req.params.tenant === "string" && req.params.tenant)
    return req.params.tenant;
  const body = req.body as { tenant?: unknown } | undefined;
  return typeof body?.tenant === "string" ? body.tenant : "";
}

function requestedTaskId(req: import("express").Request) {
  const body = req.body as { message?: { taskId?: unknown } } | undefined;
  return typeof body?.message?.taskId === "string"
    ? body.message.taskId
    : undefined;
}

function streamHeaders(res: import("express").Response) {
  Object.entries(SSE_HEADERS).forEach(([key, value]) =>
    res.setHeader(key, value),
  );
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
}

function writeEvent(
  res: import("express").Response,
  event: Record<string, unknown>,
) {
  if (!res.destroyed && !res.writableEnded) res.write(formatSSEEvent(event));
}

function workingEvent(taskId: string, contextId: string) {
  return StreamResponse.toJSON({
    payload: {
      $case: "statusUpdate",
      value: TaskStatusUpdateEvent.fromJSON({
        taskId,
        contextId,
        status: {
          state: "TASK_STATE_WORKING",
          timestamp: new Date().toISOString(),
        },
        metadata: {
          agent: "channel-compass",
          phase: "collecting-tool-evidence",
          messageSource: "protocol",
        },
      }),
    },
  }) as Record<string, unknown>;
}

function terminalEvent(task: Record<string, unknown>) {
  return StreamResponse.toJSON({
    payload: { $case: "task", value: Task.fromJSON(task) },
  }) as Record<string, unknown>;
}

function serveCard(
  _req: import("express").Request,
  res: import("express").Response,
) {
  res.setHeader(
    "Link",
    "</api/builtin/channel-compass/.well-known/agent-card.json>; rel=\"agent-card\"",
  );
  res.json(AgentCard.toJSON(AgentCard.fromJSON(channelCompassCard())));
}

router.options("/api/builtin/channel-compass", (_req, res) =>
  res.sendStatus(204),
);
router.options(
  "/api/builtin/channel-compass/:tenant/message\\:send",
  (_req, res) => res.sendStatus(204),
);
router.options(
  "/api/builtin/channel-compass/message\\:send",
  (_req, res) => res.sendStatus(204),
);
router.options(
  "/api/builtin/channel-compass/:tenant/message\\:stream",
  (_req, res) => res.sendStatus(204),
);
router.options(
  "/api/builtin/channel-compass/message\\:stream",
  (_req, res) => res.sendStatus(204),
);
router.get("/api/builtin/channel-compass", serveCard);
router.get(
  "/api/builtin/channel-compass/.well-known/agent-card.json",
  serveCard,
);

async function send(
  req: import("express").Request,
  res: import("express").Response,
) {
  requireInternal(req);
  const tenantId = tenant(req);
  if (!tenantId) {
    res.status(400).json({ error: "缺少 tenant。" });
    return;
  }
  res.json(await handleChannelCompassMessage(tenantId, req.body));
}

router.post(
  "/api/builtin/channel-compass/:tenant/message\\:send",
  asyncHandler(send),
);
router.post(
  "/api/builtin/channel-compass/message\\:send",
  asyncHandler(send),
);

async function stream(
  req: import("express").Request,
  res: import("express").Response,
) {
  requireInternal(req);
  const tenantId = tenant(req);
  if (!tenantId) {
    res.status(400).json({ error: "缺少 tenant。" });
    return;
  }
  const controller = new AbortController();
  const provisional = requestedTaskId(req) ?? crypto.randomUUID();
  const key = `${tenantId}:${provisional}`;
  active.set(key, controller);
  streamHeaders(res);
  try {
    const result = await handleChannelCompassMessage(tenantId, req.body, {
      signal: controller.signal,
      onStart: ({ taskId, contextId }) => {
        if (taskId !== provisional) {
          active.delete(key);
          active.set(`${tenantId}:${taskId}`, controller);
        }
        writeEvent(res, workingEvent(taskId, contextId));
      },
    });
    writeEvent(res, terminalEvent(result as Record<string, unknown>));
  } finally {
    for (const [activeKey, candidate] of active.entries()) {
      if (candidate === controller) active.delete(activeKey);
    }
    if (!res.destroyed && !res.writableEnded) res.end();
  }
}

router.post(
  "/api/builtin/channel-compass/:tenant/message\\:stream",
  asyncHandler(stream),
);
router.post(
  "/api/builtin/channel-compass/message\\:stream",
  asyncHandler(stream),
);

async function getTask(
  req: import("express").Request,
  res: import("express").Response,
) {
  requireInternal(req);
  const tenantId = tenant(req);
  const taskId = String(req.params.taskId);
  const task = tenantId
    ? await getChannelCompassTask(tenantId, taskId)
    : undefined;
  if (!task) {
    res.status(404).json({ error: "任务不存在" });
    return;
  }
  res.json(task);
}

async function subscribe(
  req: import("express").Request,
  res: import("express").Response,
) {
  requireInternal(req);
  const tenantId = tenant(req);
  const taskId = String(req.params.taskId);
  const task = tenantId
    ? await getChannelCompassTask(tenantId, taskId)
    : undefined;
  if (!task) {
    res.status(404).json({ error: "任务不存在" });
    return;
  }
  streamHeaders(res);
  writeEvent(res, terminalEvent(task as Record<string, unknown>));
  if (!res.destroyed && !res.writableEnded) res.end();
}

async function cancel(
  req: import("express").Request,
  res: import("express").Response,
) {
  requireInternal(req);
  const tenantId = tenant(req);
  const taskId = String(req.params.taskId);
  active.get(`${tenantId}:${taskId}`)?.abort();
  const task = tenantId
    ? await cancelChannelCompassTask(tenantId, taskId)
    : undefined;
  if (!task) {
    res.status(404).json({ error: "任务不存在" });
    return;
  }
  res.json(task);
}

router.get(
  "/api/builtin/channel-compass/:tenant/tasks/:taskId",
  asyncHandler(getTask),
);
router.get(
  "/api/builtin/channel-compass/:tenant/tasks/:taskId\\:subscribe",
  asyncHandler(subscribe),
);
router.post(
  "/api/builtin/channel-compass/:tenant/tasks/:taskId\\:subscribe",
  asyncHandler(subscribe),
);
router.post(
  "/api/builtin/channel-compass/:tenant/tasks/:taskId\\:cancel",
  asyncHandler(cancel),
);

router.get(
  "/api/builtin/channel-compass/visualizations/:id.svg",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const expires = Number(req.query.expires);
    const signature =
      typeof req.query.signature === "string" ? req.query.signature : "";
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        id,
      ) ||
      !verifyChannelChartSignature(id, expires, signature)
    ) {
      res.status(403).json({ error: "图表链接无效或已过期。" });
      return;
    }
    const chart = await getChannelVisualization(id);
    if (!chart) {
      res.status(404).json({ error: "图表不存在或已过期。" });
      return;
    }
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'",
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.type("image/svg+xml").send(renderChannelChartSvg(chart.spec));
  }),
);

export { router as channelCompassRouter };
