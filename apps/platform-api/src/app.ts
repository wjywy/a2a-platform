import crypto from "node:crypto";
import cors from "cors";
import express from "express";
import { adminRouter } from "./admin-router.js";
import { authRouter } from "./auth-router.js";
import { gatewayRouter } from "./gateway-router.js";
import { catalogRouter } from "./catalog-router.js";
import { errorMiddleware, notFoundMiddleware } from "./http.js";
import {
  requireConfiguredJwtSecret,
  type AuthenticatedRequest,
} from "./auth.js";
import { config } from "./config.js";
import { prometheusMetrics, readiness } from "./operations-service.js";
import { symbolRouter } from "./symbol-router.js";

export function createApp() {
  requireConfiguredJwtSecret();
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(
    cors({
      origin: config.corsOrigins,
      credentials: true,
      allowedHeaders: [
        "authorization",
        "content-type",
        "x-api-key",
        "x-request-id",
      ],
      exposedHeaders: [
        "x-request-id",
        "x-ratelimit-minute-limit",
        "x-ratelimit-minute-remaining",
        "x-ratelimit-day-limit",
        "x-ratelimit-day-remaining",
        "x-ratelimit-month-limit",
        "x-ratelimit-month-remaining",
        "x-ratelimit-concurrent-limit",
        "x-ratelimit-concurrent-remaining",
      ],
    }),
  );
  app.use(express.json({ limit: "2mb" }));
  app.use((req: AuthenticatedRequest, res, next) => {
    req.requestId =
      req.header("x-request-id")?.slice(0, 128) || crypto.randomUUID();
    res.setHeader("X-Request-Id", req.requestId);
    res.setHeader("Cache-Control", "no-store");
    const tenantMatch = req.path.match(
      /\/tenants\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:\/|$)/i,
    );
    if (tenantMatch) req.auditTenantId = tenantMatch[1];
    next();
  });
  app.get("/healthz", (_req, res) =>
    res.json({
      ok: true,
      service: "a2a-platform-api",
      time: new Date().toISOString(),
    }),
  );
  app.get("/readyz", async (_req, res) => {
    const state = await readiness();
    res.status(state.ok ? 200 : 503).json(state);
  });
  app.get("/metrics", async (req, res) => {
    const expected = process.env.METRICS_TOKEN;
    if (expected && req.header("authorization") !== `Bearer ${expected}`) {
      res.status(401).type("text/plain").send("unauthorized\n");
      return;
    }
    res
      .type("text/plain; version=0.0.4; charset=utf-8")
      .send(await prometheusMetrics());
  });
  app.use("/api/auth", authRouter);
  app.use("/api/catalog", catalogRouter);
  app.use("/api/admin", adminRouter);
  app.use(symbolRouter);
  app.use(gatewayRouter);
  app.use(notFoundMiddleware);
  app.use(errorMiddleware);
  return app;
}
