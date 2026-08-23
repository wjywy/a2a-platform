import crypto from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { pool, query } from "./db.js";
import {
  AppError,
  ConflictError,
  NotFoundError,
  normalizeEmail,
  offsetOf,
  pageResult,
  paginationSchema,
  type Page,
  type TenantMemberRole,
  type TenantStatus,
} from "./domain.js";

export const tenantLimitsSchema = z.object({
  minuteRequestLimit: z.number().int().min(1).max(100_000),
  dailyRequestLimit: z.number().int().min(1).max(100_000_000),
  monthlyRequestLimit: z.number().int().min(1).max(1_000_000_000),
  concurrentRequestLimit: z.number().int().min(1).max(10_000),
  warningThresholdPercent: z.number().int().min(1).max(100),
  dataRetentionDays: z.number().int().min(7).max(3650),
});

export const createTenantSchema = tenantLimitsSchema.partial().extend({
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
  displayName: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).default(""),
});

export const updateTenantSchema = createTenantSchema
  .omit({ slug: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "至少提供一个可更新字段。");

export const tenantListSchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(["active", "suspended"]).optional(),
  includeDeleted: z.coerce.boolean().default(false),
});

export const inviteMemberSchema = z.object({
  email: z.string().email().max(254),
  displayName: z.string().trim().max(80).default(""),
  role: z.enum(["tenant_admin", "developer", "viewer"]),
  expiresInHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(72),
});

export const updateMemberSchema = z
  .object({
    role: z.enum(["tenant_admin", "developer", "viewer"]).optional(),
    status: z.enum(["active", "disabled"]).optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "至少提供 role 或 status。",
  );

export type TenantLimits = z.infer<typeof tenantLimitsSchema>;
export type Tenant = TenantLimits & {
  id: string;
  slug: string;
  displayName: string;
  description: string;
  status: TenantStatus;
  memberCount: number;
  agentCount: number;
  apiKeyCount: number;
  webhookCount: number;
  createdAt: string;
  updatedAt: string;
};

export type TenantMember = {
  id: string;
  tenantId: string;
  userId: string;
  email: string;
  displayName: string;
  role: TenantMemberRole;
  status: "active" | "invited" | "disabled";
  invitedBy?: string;
  acceptedAt?: string;
  disabledAt?: string;
  createdAt: string;
  updatedAt: string;
};

type TenantRow = {
  id: string;
  slug: string;
  display_name: string;
  description: string;
  status: TenantStatus;
  minute_request_limit: number;
  daily_request_limit: number;
  monthly_request_limit: number;
  concurrent_request_limit: number;
  warning_threshold_percent: number;
  data_retention_days: number;
  member_count: string;
  agent_count: string;
  api_key_count: string;
  webhook_count: string;
  created_at: Date;
  updated_at: Date;
};

type MemberRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  email: string;
  display_name: string;
  role: TenantMemberRole;
  status: "active" | "invited" | "disabled";
  invited_by: string | null;
  accepted_at: Date | null;
  disabled_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

const tenantSelect = `
  SELECT t.*,
    (SELECT count(*) FROM tenant_members m WHERE m.tenant_id=t.id AND m.status <> 'disabled') AS member_count,
    (SELECT count(*) FROM agents a WHERE a.tenant_id=t.id AND a.deleted_at IS NULL) AS agent_count,
    (SELECT count(*) FROM api_keys k WHERE k.tenant_id=t.id AND k.revoked_at IS NULL) AS api_key_count,
    (SELECT count(*) FROM webhook_endpoints w WHERE w.tenant_id=t.id AND w.deleted_at IS NULL) AS webhook_count
  FROM tenants t`;

function mapTenant(row: TenantRow): Tenant {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    description: row.description,
    status: row.status,
    minuteRequestLimit: row.minute_request_limit,
    dailyRequestLimit: row.daily_request_limit,
    monthlyRequestLimit: row.monthly_request_limit,
    concurrentRequestLimit: row.concurrent_request_limit,
    warningThresholdPercent: row.warning_threshold_percent,
    dataRetentionDays: row.data_retention_days,
    memberCount: Number(row.member_count),
    agentCount: Number(row.agent_count),
    apiKeyCount: Number(row.api_key_count),
    webhookCount: Number(row.webhook_count),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapMember(row: MemberRow): TenantMember {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    invitedBy: row.invited_by ?? undefined,
    acceptedAt: row.accepted_at?.toISOString(),
    disabledAt: row.disabled_at?.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function getTenant(id: string): Promise<Tenant> {
  const rows = await query<TenantRow>(
    `${tenantSelect} WHERE t.id=$1 AND t.deleted_at IS NULL`,
    [id],
  );
  if (!rows[0]) throw new NotFoundError("租户", id);
  return mapTenant(rows[0]);
}

export async function getTenantBySlug(
  slug: string,
): Promise<Tenant | undefined> {
  const rows = await query<TenantRow>(
    `${tenantSelect} WHERE t.slug=$1 AND t.deleted_at IS NULL`,
    [slug],
  );
  return rows[0] ? mapTenant(rows[0]) : undefined;
}

export async function searchTenants(raw: unknown): Promise<Page<Tenant>> {
  const input = tenantListSchema.parse(raw);
  const values: unknown[] = [];
  const clauses = input.includeDeleted ? [] : ["t.deleted_at IS NULL"];
  if (input.status) {
    values.push(input.status);
    clauses.push(`t.status=$${values.length}`);
  }
  if (input.search) {
    values.push(`%${input.search}%`);
    clauses.push(
      `(t.slug ILIKE $${values.length} OR t.display_name ILIKE $${values.length})`,
    );
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const countRows = await query<{ count: string }>(
    `SELECT count(*) FROM tenants t ${where}`,
    values,
  );
  values.push(input.pageSize, offsetOf(input));
  const rows = await query<TenantRow>(
    `${tenantSelect} ${where} ORDER BY t.created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return pageResult(rows.map(mapTenant), Number(countRows[0].count), input);
}

export async function createTenant(inputRaw: unknown): Promise<Tenant> {
  const input = createTenantSchema.parse(inputRaw);
  const existing = await getTenantBySlug(input.slug);
  if (existing)
    throw new ConflictError("TENANT_SLUG_EXISTS", "租户标识已被使用。");
  const defaults = {
    minuteRequestLimit: 120,
    dailyRequestLimit: 5000,
    monthlyRequestLimit: 10000,
    concurrentRequestLimit: 20,
    warningThresholdPercent: 80,
    dataRetentionDays: 90,
  };
  const limits = { ...defaults, ...input };
  const rows = await query<TenantRow>(
    `INSERT INTO tenants(
       slug,display_name,description,minute_request_limit,daily_request_limit,
       monthly_request_limit,concurrent_request_limit,warning_threshold_percent,data_retention_days
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *,
       '0'::text member_count,'0'::text agent_count,'0'::text api_key_count,'0'::text webhook_count`,
    [
      input.slug,
      input.displayName,
      input.description,
      limits.minuteRequestLimit,
      limits.dailyRequestLimit,
      limits.monthlyRequestLimit,
      limits.concurrentRequestLimit,
      limits.warningThresholdPercent,
      limits.dataRetentionDays,
    ],
  );
  return mapTenant(rows[0]);
}

export async function updateTenant(
  id: string,
  inputRaw: unknown,
): Promise<Tenant> {
  const input = updateTenantSchema.parse(inputRaw);
  const current = await getTenant(id);
  const next = { ...current, ...input };
  await query(
    `UPDATE tenants SET display_name=$2,description=$3,minute_request_limit=$4,daily_request_limit=$5,
       monthly_request_limit=$6,concurrent_request_limit=$7,warning_threshold_percent=$8,
       data_retention_days=$9,updated_at=now()
     WHERE id=$1 AND deleted_at IS NULL`,
    [
      id,
      next.displayName,
      next.description,
      next.minuteRequestLimit,
      next.dailyRequestLimit,
      next.monthlyRequestLimit,
      next.concurrentRequestLimit,
      next.warningThresholdPercent,
      next.dataRetentionDays,
    ],
  );
  return getTenant(id);
}

export async function changeTenantStatus(
  id: string,
  status: TenantStatus,
): Promise<Tenant> {
  await getTenant(id);
  await query(
    "UPDATE tenants SET status=$2,updated_at=now() WHERE id=$1 AND deleted_at IS NULL",
    [id, status],
  );
  return getTenant(id);
}

export async function deleteTenant(id: string): Promise<void> {
  const tenant = await getTenant(id);
  if (tenant.status !== "suspended")
    throw new ConflictError(
      "TENANT_MUST_BE_SUSPENDED",
      "删除租户前必须先停用。",
    );
  const resources =
    tenant.agentCount + tenant.apiKeyCount + tenant.webhookCount;
  if (resources > 0) {
    throw new ConflictError(
      "TENANT_NOT_EMPTY",
      "租户仍有关联 Agent、API Key 或 Webhook，不能删除。",
      {
        agentCount: tenant.agentCount,
        apiKeyCount: tenant.apiKeyCount,
        webhookCount: tenant.webhookCount,
      },
    );
  }
  await query(
    "UPDATE tenants SET deleted_at=now(),updated_at=now() WHERE id=$1",
    [id],
  );
}

export async function listMembers(tenantId: string): Promise<TenantMember[]> {
  await getTenant(tenantId);
  const rows = await query<MemberRow>(
    "SELECT * FROM tenant_members WHERE tenant_id=$1 ORDER BY created_at DESC",
    [tenantId],
  );
  return rows.map(mapMember);
}

export async function inviteMember(
  tenantId: string,
  inputRaw: unknown,
  invitedBy: string,
): Promise<{
  member: TenantMember;
  invitationToken: string;
  expiresAt: string;
}> {
  await getTenant(tenantId);
  const input = inviteMemberSchema.parse(inputRaw);
  const email = normalizeEmail(input.email);
  const existing = await query<MemberRow>(
    "SELECT * FROM tenant_members WHERE tenant_id=$1 AND email=$2",
    [tenantId, email],
  );
  if (existing[0]?.status === "active")
    throw new ConflictError("MEMBER_ALREADY_ACTIVE", "该用户已经是租户成员。");
  const invitationToken = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto
    .createHash("sha256")
    .update(invitationToken)
    .digest("hex");
  const expiresAt = new Date(
    Date.now() + input.expiresInHours * 60 * 60 * 1000,
  );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const memberRows = await client.query<MemberRow>(
      `INSERT INTO tenant_members(tenant_id,user_id,email,display_name,role,status,invited_by)
       VALUES($1,$2,$3,$4,$5,'invited',$6)
       ON CONFLICT(tenant_id,email) DO UPDATE SET role=EXCLUDED.role,status='invited',
         display_name=EXCLUDED.display_name,invited_by=EXCLUDED.invited_by,disabled_at=NULL,updated_at=now()
       RETURNING *`,
      [
        tenantId,
        `pending:${email}`,
        email,
        input.displayName,
        input.role,
        invitedBy,
      ],
    );
    await client.query(
      `UPDATE tenant_invitations SET revoked_at=now()
       WHERE tenant_id=$1 AND email=$2 AND accepted_at IS NULL AND revoked_at IS NULL`,
      [tenantId, email],
    );
    await client.query(
      `INSERT INTO tenant_invitations(tenant_id,email,role,token_hash,invited_by,expires_at)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [tenantId, email, input.role, tokenHash, invitedBy, expiresAt],
    );
    await client.query("COMMIT");
    return {
      member: mapMember(memberRows.rows[0]),
      invitationToken,
      expiresAt: expiresAt.toISOString(),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function acceptInvitation(
  token: string,
  user: { id: string; email: string; displayName?: string },
  transactionClient?: PoolClient,
): Promise<TenantMember> {
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const client = transactionClient ?? (await pool.connect());
  const ownsTransaction = !transactionClient;
  try {
    if (ownsTransaction) await client.query("BEGIN");
    const invites = await client.query<{
      id: string;
      tenant_id: string;
      email: string;
    }>(
      `SELECT id,tenant_id,email FROM tenant_invitations
       WHERE token_hash=$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now() FOR UPDATE`,
      [tokenHash],
    );
    const invite = invites.rows[0];
    if (!invite)
      throw new AppError(
        410,
        "INVITATION_INVALID",
        "邀请不存在、已撤销或已过期。",
      );
    if (normalizeEmail(user.email) !== invite.email)
      throw new AppError(
        403,
        "INVITATION_EMAIL_MISMATCH",
        "登录邮箱与受邀邮箱不一致。",
      );
    const updated = await client.query<MemberRow>(
      `UPDATE tenant_members SET user_id=$3,display_name=COALESCE(NULLIF($4,''),display_name),
         status='active',accepted_at=now(),updated_at=now()
       WHERE tenant_id=$1 AND email=$2 RETURNING *`,
      [invite.tenant_id, invite.email, user.id, user.displayName ?? ""],
    );
    await client.query(
      "UPDATE tenant_invitations SET accepted_at=now() WHERE id=$1",
      [invite.id],
    );
    if (ownsTransaction) await client.query("COMMIT");
    return mapMember(updated.rows[0]);
  } catch (error) {
    if (ownsTransaction) await client.query("ROLLBACK");
    throw error;
  } finally {
    if (ownsTransaction) client.release();
  }
}

export async function inspectInvitation(token: string): Promise<{
  tenantId: string;
  tenantName: string;
  email: string;
  role: TenantMemberRole;
  expiresAt: string;
}> {
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const rows = await query<{
    tenant_id: string;
    tenant_name: string;
    email: string;
    role: TenantMemberRole;
    expires_at: Date;
  }>(
    `SELECT i.tenant_id,t.display_name AS tenant_name,i.email,i.role,i.expires_at
     FROM tenant_invitations i JOIN tenants t ON t.id=i.tenant_id
     WHERE i.token_hash=$1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL
       AND i.expires_at>now() AND t.status='active' AND t.deleted_at IS NULL`,
    [tokenHash],
  );
  if (!rows[0])
    throw new AppError(
      410,
      "INVITATION_INVALID",
      "邀请不存在、已撤销或已过期。",
    );
  return {
    tenantId: rows[0].tenant_id,
    tenantName: rows[0].tenant_name,
    email: rows[0].email,
    role: rows[0].role,
    expiresAt: rows[0].expires_at.toISOString(),
  };
}

export async function updateMember(
  tenantId: string,
  memberId: string,
  inputRaw: unknown,
): Promise<TenantMember> {
  const input = updateMemberSchema.parse(inputRaw);
  const members = await query<MemberRow>(
    "SELECT * FROM tenant_members WHERE id=$1 AND tenant_id=$2",
    [memberId, tenantId],
  );
  const current = members[0];
  if (!current) throw new NotFoundError("租户成员", memberId);
  if (current.role === "tenant_admin" && current.status === "active") {
    const adminCount = await query<{ count: string }>(
      `SELECT count(*) FROM tenant_members WHERE tenant_id=$1 AND role='tenant_admin' AND status='active'`,
      [tenantId],
    );
    const removesLastAdmin =
      Number(adminCount[0].count) === 1 &&
      ((input.role !== undefined && input.role !== "tenant_admin") ||
        input.status === "disabled");
    if (removesLastAdmin)
      throw new ConflictError(
        "LAST_TENANT_ADMIN",
        "不能移除或降级租户的最后一名管理员。",
      );
  }
  const rows = await query<MemberRow>(
    `UPDATE tenant_members SET role=COALESCE($3,role),status=COALESCE($4,status),
       disabled_at=CASE WHEN $4='disabled' THEN now() WHEN $4='active' THEN NULL ELSE disabled_at END,
       updated_at=now() WHERE id=$1 AND tenant_id=$2 RETURNING *`,
    [memberId, tenantId, input.role ?? null, input.status ?? null],
  );
  return mapMember(rows[0]);
}

export async function removeMember(
  tenantId: string,
  memberId: string,
): Promise<void> {
  const member = await updateMember(tenantId, memberId, { status: "disabled" });
  if (member.status !== "disabled")
    throw new AppError(500, "MEMBER_REMOVE_FAILED", "成员移除失败。");
}

export async function tenantRoleForUser(
  tenantId: string,
  userId: string,
): Promise<TenantMemberRole | undefined> {
  const rows = await query<{ role: TenantMemberRole }>(
    `SELECT role FROM tenant_members WHERE tenant_id=$1 AND user_id=$2 AND status='active'`,
    [tenantId, userId],
  );
  return rows[0]?.role;
}

export async function listTenantsForUser(
  userId: string,
): Promise<Array<Tenant & { role: TenantMemberRole }>> {
  const selectWithRole = tenantSelect.replace(
    "FROM tenants t",
    ", own_membership.role AS member_role FROM tenants t",
  );
  const rows = await query<TenantRow & { member_role: TenantMemberRole }>(
    `${selectWithRole}
     JOIN tenant_members own_membership ON own_membership.tenant_id=t.id
     WHERE own_membership.user_id=$1 AND own_membership.status='active'
       AND t.deleted_at IS NULL AND t.status='active'
     ORDER BY t.display_name`,
    [userId],
  );
  return rows.map((row) => ({ ...mapTenant(row), role: row.member_role }));
}

export type TenantInvitation = {
  id: string;
  tenantId: string;
  email: string;
  role: TenantMemberRole;
  invitedBy: string;
  expiresAt: string;
  acceptedAt?: string;
  revokedAt?: string;
  createdAt: string;
};

type InvitationRow = {
  id: string;
  tenant_id: string;
  email: string;
  role: TenantMemberRole;
  invited_by: string;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
};

function mapInvitation(row: InvitationRow): TenantInvitation {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    email: row.email,
    role: row.role,
    invitedBy: row.invited_by,
    expiresAt: row.expires_at.toISOString(),
    acceptedAt: row.accepted_at?.toISOString(),
    revokedAt: row.revoked_at?.toISOString(),
    createdAt: row.created_at.toISOString(),
  };
}

export async function listInvitations(
  tenantId: string,
): Promise<TenantInvitation[]> {
  await getTenant(tenantId);
  const rows = await query<InvitationRow>(
    "SELECT * FROM tenant_invitations WHERE tenant_id=$1 ORDER BY created_at DESC",
    [tenantId],
  );
  return rows.map(mapInvitation);
}

export async function revokeInvitation(
  tenantId: string,
  invitationId: string,
): Promise<void> {
  const rows = await query<{ email: string }>(
    `UPDATE tenant_invitations SET revoked_at=now()
     WHERE id=$1 AND tenant_id=$2 AND accepted_at IS NULL AND revoked_at IS NULL
     RETURNING email`,
    [invitationId, tenantId],
  );
  if (!rows[0]) throw new NotFoundError("有效邀请", invitationId);
  await query(
    `UPDATE tenant_members SET status='disabled',disabled_at=now(),updated_at=now()
     WHERE tenant_id=$1 AND email=$2 AND status='invited'`,
    [tenantId, rows[0].email],
  );
}
