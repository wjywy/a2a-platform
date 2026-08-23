import { z } from "zod";

export type TenantStatus = "active" | "suspended";
export type TenantRole =
  "platform_admin" | "tenant_admin" | "developer" | "viewer";
export type TenantMemberRole = Exclude<TenantRole, "platform_admin">;
export type MemberStatus = "active" | "invited" | "disabled";
export type AgentVisibility = "private" | "tenant" | "public";
export type ApiKeyScope =
  "agent:invoke" | "task:read" | "task:cancel" | "usage:read";

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(
      404,
      "RESOURCE_NOT_FOUND",
      `${resource}${id ? ` ${id}` : ""} 不存在。`,
    );
  }
}

export class ConflictError extends AppError {
  constructor(
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(409, code, message, details);
  }
}

export class ForbiddenError extends AppError {
  constructor(code: string, message: string) {
    super(403, code, message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(code: string, message: string) {
    super(401, code, message);
  }
}

export class RateLimitError extends AppError {
  constructor(message: string, details: Record<string, unknown>) {
    super(429, "QUOTA_EXCEEDED", message, details);
  }
}

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationInput = z.infer<typeof paginationSchema>;
export type Page<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export function pageResult<T>(
  items: T[],
  total: number,
  input: PaginationInput,
): Page<T> {
  return {
    items,
    page: input.page,
    pageSize: input.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / input.pageSize)),
  };
}

export function offsetOf(input: PaginationInput): number {
  return (input.page - 1) * input.pageSize;
}

export function parseDate(value: unknown, field: string): Date | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime()))
    throw new AppError(400, "VALIDATION_ERROR", `${field} 不是有效时间。`);
  return date;
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function redact(value: string, visible = 4): string {
  if (value.length <= visible) return "*".repeat(value.length);
  return `${value.slice(0, visible)}${"*".repeat(Math.min(12, value.length - visible))}`;
}
