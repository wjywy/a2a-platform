import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "./domain.js";
import type { AuthenticatedRequest } from "./auth.js";
import { writeAudit, type AuditContext } from "./audit-service.js";

export function asyncHandler(
  handler: (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    handler(req as AuthenticatedRequest, res, next).catch(next);
  };
}
export function pathParam(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] : value;
}
export function optionalQuery(req: Request, name: string): string | undefined {
  const value = req.query[name];
  return typeof value === "string" ? value : undefined;
}
export function auditContext(
  req: AuthenticatedRequest,
  tenantId?: string,
): AuditContext {
  return {
    actorId: req.principal?.id ?? "anonymous",
    tenantId,
    requestId: req.requestId,
    ipAddress: req.ip,
    userAgent: req.header("user-agent") ?? undefined,
  };
}
export function errorMiddleware(
  error: unknown,
  req: AuthenticatedRequest,
  res: Response,
  _next: NextFunction,
): void {
  if (
    req.principal &&
    req.path.startsWith("/api/admin") &&
    !["GET", "HEAD", "OPTIONS"].includes(req.method)
  ) {
    void writeAudit(
      auditContext(
        req,
        req.auditTenantId ??
          (typeof req.params?.tenantId === "string"
            ? req.params.tenantId
            : undefined),
      ),
      "request.failed",
      { type: "http_request", id: `${req.method} ${req.path}` },
      {
        method: req.method,
        path: req.path,
        error: error instanceof Error ? error.message : String(error),
      },
      "failure",
    ).catch((auditError) =>
      console.error("Failed to write failure audit", auditError),
    );
  }
  if (res.headersSent) {
    if (!res.writableEnded) res.end();
    return;
  }
  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "请求参数不符合要求。",
        fields: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      requestId: req.requestId,
    });
    return;
  }
  if (error instanceof AppError) {
    res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
      requestId: req.requestId,
    });
    return;
  }
  console.error("Unhandled request error", {
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    error,
  });
  res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "服务内部错误。" },
    requestId: req.requestId,
  });
}
export function notFoundMiddleware(
  req: AuthenticatedRequest,
  res: Response,
): void {
  res.status(404).json({
    error: {
      code: "ROUTE_NOT_FOUND",
      message: `没有匹配 ${req.method} ${req.path} 的接口。`,
    },
    requestId: req.requestId,
  });
}
