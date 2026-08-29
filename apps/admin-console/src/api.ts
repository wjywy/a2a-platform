export type Page<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};
export type Tenant = {
  id: string;
  slug: string;
  displayName: string;
  description: string;
  status: "active" | "suspended";
  minuteRequestLimit: number;
  dailyRequestLimit: number;
  monthlyRequestLimit: number;
  concurrentRequestLimit: number;
  warningThresholdPercent: number;
  dataRetentionDays: number;
  role?: TenantMember["role"];
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
  role: "tenant_admin" | "developer" | "viewer";
  status: "active" | "invited" | "disabled";
  invitedBy?: string;
  acceptedAt?: string;
  disabledAt?: string;
  createdAt: string;
  updatedAt: string;
};
export type ManagedAgent = {
  id: string;
  slug: string;
  displayName: string;
  description: string;
  cardUrl: string;
  status: "draft" | "offline" | "online" | "degraded";
  healthStatus: "unknown" | "healthy" | "unhealthy";
  labels: string[];
  tenantId?: string;
  visibility: "private" | "tenant" | "public";
  allowedTenantIds: string[];
  invocationPolicy: {
    timeoutMs: number;
    maxRetries: number;
    maxConcurrent: number;
  };
  routingStrategy: "weighted_round_robin" | "least_connections" | "priority";
  selectedInterface: {
    protocolBinding: string;
    protocolVersion: string;
    url: string;
  };
  version: number;
  updatedAt: string;
  createdAt: string;
};
export type CatalogAgent = ManagedAgent & {
  access: "public" | "tenant_owner" | "tenant_grant" | "platform_admin";
  manageable: boolean;
  administrable: boolean;
};
export type Agent = ManagedAgent | CatalogAgent;
export type ApiKey = {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  prefix: string;
  scopes: string[];
  expiresAt?: string;
  lastUsedAt?: string;
  revokedAt?: string;
  minuteRequestLimit?: number;
  dailyRequestLimit?: number;
  monthlyRequestLimit?: number;
  concurrentRequestLimit?: number;
  createdBy: string;
  createdAt: string;
  agentIds: string[];
  secret?: string;
};
export type HealthCheck = {
  checkedAt: string;
  success: boolean;
  latencyMs?: number;
  errorMessage?: string;
};
export type CardRevision = {
  id: number;
  agentId: string;
  version: number;
  cardSnapshot: Record<string, unknown>;
  selectedInterface: Record<string, unknown>;
  changeSummary: Record<string, unknown>;
  fetchedBy: string;
  fetchedAt: string;
};
export type TaskSummary = {
  id: number;
  agentId: string;
  agentSlug: string;
  agentName: string;
  agentInstanceId?: string;
  agentInstanceName?: string;
  tenantId?: string;
  tenantName?: string;
  apiKeyId?: string;
  apiKeyName?: string;
  remoteTaskId: string;
  contextId?: string;
  requestId?: string;
  operation: string;
  state?: string;
  statusCode?: number;
  errorCode?: string;
  errorMessage?: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  retryCount: number;
  cancelledAt?: string;
  lastEventAt: string;
  createdAt: string;
  updatedAt: string;
};
export type TaskDetail = TaskSummary & {
  latestEvent: Record<string, unknown>;
  requestPayload: Record<string, unknown>;
  artifacts: Array<Record<string, unknown>>;
  events: Array<{
    id: number;
    sequence: number;
    eventType: string;
    state?: string;
    payload: Record<string, unknown>;
    payloadBytes: number;
    occurredAt: string;
  }>;
};
export type AgentRunTrajectory = {
  id: string;
  status: string;
  threadId: string;
  createdAt: string;
  updatedAt: string;
  events: Array<{
    sequence: number;
    node: string;
    kind:
      | "node_started"
      | "node_completed"
      | "tool"
      | "interrupt"
      | "error"
      | "final";
    payload: Record<string, unknown>;
    created_at: string;
  }>;
};
export type SymbolConversationSummary = {
  taskId: string;
  contextId: string;
  agentSlug: string;
  state: "collecting" | "completed" | "failed" | "cancelled";
  title: string;
  preview: string;
  updatedAt: string;
  archivedAt?: string;
};
export type SymbolConversationDetail = SymbolConversationSummary & {
  intent: Record<string, unknown>;
  transcript: Array<{ role: "user" | "agent"; text: string; at: string }>;
  result: Record<string, unknown> | null;
};
export type StudioConversation = {
  id: string;
  tenantId: string;
  agentSlug: string;
  title: string;
  status: "active" | "archived" | "deleted";
  lastTaskId?: string;
  messageCount: number;
  lastMessageAt?: string;
  archivedAt?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  preview?: string;
  labels?: StudioLabel[];
};
export type StudioLabel = {
  id: string;
  tenantId: string;
  name: string;
  color: "blue" | "cyan" | "purple" | "gold" | "green" | "red" | "gray";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};
export type StudioMessage = {
  id: string;
  conversationId: string;
  sequence: number;
  role: "user" | "assistant" | "system";
  content: string;
  status: "pending" | "streaming" | "completed" | "failed" | "cancelled";
  taskId?: string;
  errorCode?: string;
  metadata: Record<string, unknown>;
  clientRequestId?: string;
  createdAt: string;
  updatedAt: string;
};
export type StudioConversationDetail = StudioConversation & {
  messages: StudioMessage[];
};
export type StudioConversationEvent = {
  id: number;
  conversationId: string;
  actorId: string;
  kind: string;
  messageId?: string;
  detail: Record<string, unknown>;
  createdAt: string;
};
export type StudioMessageFeedback = {
  messageId: string;
  rating: -1 | 1;
  note?: string;
  updatedAt: string;
};
export type StudioMessageRevision = {
  id: string;
  messageId: string;
  revision: number;
  content: string;
  editedBy: string;
  createdAt: string;
};
export type UsageRecord = {
  id: number;
  tenantId: string;
  tenantName: string;
  apiKeyId?: string;
  apiKeyName?: string;
  agentId?: string;
  agentName?: string;
  agentInstanceId?: string;
  agentInstanceName?: string;
  callerId?: string;
  requestId: string;
  operation: string;
  statusCode: number;
  latencyMs?: number;
  inputBytes: number;
  outputBytes: number;
  eventCount: number;
  errorCode?: string;
  errorMessage?: string;
  remoteTaskId?: string;
  createdAt: string;
};
export type UsageSummary = {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  failureRate: number;
  averageLatencyMs: number;
  p95LatencyMs: number;
  inputBytes: number;
  outputBytes: number;
  trend: Array<{
    bucket: string;
    requests: number;
    failures: number;
    averageLatencyMs: number;
  }>;
};
export type Webhook = {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  targetUrl: string;
  events: string[];
  enabled: boolean;
  timeoutMs: number;
  maxAttempts: number;
  lastDeliveryAt?: string;
  createdAt: string;
  updatedAt: string;
  signingSecret?: string;
};
export type WebhookDelivery = {
  id: string;
  webhookId: string;
  tenantId: string;
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  attempt: number;
  status: "pending" | "delivering" | "succeeded" | "retrying" | "dead_letter";
  responseStatus?: number;
  responseBody?: string;
  errorMessage?: string;
  nextAttemptAt: string;
  deliveredAt?: string;
  createdAt: string;
  updatedAt: string;
};
export type AlertRule = {
  id: string;
  tenantId?: string;
  agentId?: string;
  name: string;
  metric: string;
  operator: "gt" | "lt";
  threshold: number;
  windowMinutes: number;
  severity: "info" | "warning" | "critical";
  cooldownMinutes: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};
export type AlertEvent = {
  id: number;
  ruleId: string;
  ruleName: string;
  tenantId?: string;
  status: "open" | "acknowledged" | "silenced" | "resolved";
  value: number;
  message: string;
  fingerprint: string;
  severity: "info" | "warning" | "critical";
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  silencedUntil?: string;
  metadata: Record<string, unknown>;
  openedAt: string;
  resolvedAt?: string;
  updatedAt: string;
};
export type AuditEntry = {
  id: number;
  actorId: string;
  tenantId?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  agentId?: string;
  requestId?: string;
  outcome: "success" | "failure";
  detail: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
};
export type PlatformSetting = {
  key: string;
  value: unknown;
  description: string;
  sensitive: boolean;
  updatedBy: string;
  updatedAt: string;
};
export type Dashboard = {
  totalAgents: number;
  onlineAgents: number;
  degradedAgents: number;
  unhealthyAgents: number;
  taskCount: number;
  recentAudit: AuditEntry[];
};
export type PlatformUser = {
  id: string;
  email: string;
  displayName: string;
  platformRole?: "platform_admin";
  status: "active" | "draining" | "disabled";
  emailVerified: boolean;
  lastLoginAt?: string;
  createdAt?: string;
  updatedAt?: string;
};
export type AuthConfig = {
  localLoginEnabled: boolean;
  selfRegistrationEnabled: boolean;
  oidcEnabled: boolean;
  issuer?: string;
};
export type Invitation = {
  id?: string;
  tenantId: string;
  tenantName?: string;
  email: string;
  role: TenantMember["role"];
  invitedBy?: string;
  expiresAt: string;
  acceptedAt?: string;
  revokedAt?: string;
  createdAt?: string;
};
export type AgentInstance = {
  id: string;
  agentId: string;
  name: string;
  cardUrl: string;
  selectedInterface: {
    protocolBinding: string;
    protocolVersion: string;
    url: string;
  };
  weight: number;
  priority: number;
  status: "active" | "disabled";
  healthStatus: "unknown" | "healthy" | "unhealthy";
  lastHealthAt?: string;
  lastError?: string;
  activeRequests: number;
  credential: {
    type: "none" | "bearer" | "api_key" | "headers";
    configured: boolean;
  };
  createdAt: string;
  updatedAt: string;
};
export type NotificationChannel = {
  id: string;
  tenantId: string;
  name: string;
  type: "webhook" | "email";
  destination: string;
  enabled: boolean;
  config: { timeoutMs: number; maxAttempts: number; subjectPrefix: string };
  signingConfigured: boolean;
  signingSecret?: string;
  lastDeliveryAt?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};
export type NotificationRecord = {
  id: number;
  tenantId?: string;
  alertEventId?: number;
  channelId?: string;
  channelName?: string;
  channel: "console" | "webhook" | "email";
  destination?: string;
  eventType?: "alert.triggered" | "alert.recovered";
  status:
    "pending" | "delivering" | "retrying" | "sent" | "failed" | "suppressed";
  payload: Record<string, unknown>;
  attempt: number;
  maxAttempts: number;
  nextAttemptAt: string;
  responseStatus?: number;
  responseBody?: string;
  errorMessage?: string;
  deliveredAt?: string;
  createdAt: string;
  updatedAt: string;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
type QueryValue = string | number | boolean | undefined | null;
const qs = (input: Record<string, QueryValue>) => {
  const value = new URLSearchParams();
  Object.entries(input).forEach(([key, item]) => {
    if (item !== undefined && item !== null && item !== "")
      value.set(key, String(item));
  });
  const output = value.toString();
  return output ? `?${output}` : "";
};
async function request<T>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  let response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (response.status === 401 && !path.startsWith("/api/auth/")) {
    const refreshed = await fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (refreshed.ok) {
      const session = (await refreshed.json()) as { accessToken: string };
      localStorage.setItem("a2a-admin-token", session.accessToken);
      window.dispatchEvent(
        new CustomEvent("a2a-token-refreshed", { detail: session.accessToken }),
      );
      response = await fetch(path, {
        ...init,
        credentials: "include",
        headers: {
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          Authorization: `Bearer ${session.accessToken}`,
          ...init.headers,
        },
      });
    }
  }
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    // API gateways may return either { error: { ... } } or the error payload
    // itself. Normalize both shapes so the user sees the actionable message.
    const error =
      body && typeof body === "object" && "error" in body ? body.error : body;
    throw new ApiError(
      response.status,
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "REQUEST_FAILED",
      typeof error === "string"
        ? error
        : error &&
            typeof error === "object" &&
            "message" in error &&
            typeof error.message === "string"
          ? error.message
          : `请求失败 (${response.status})`,
      error &&
        typeof error === "object" &&
        "details" in error &&
        error.details &&
        typeof error.details === "object"
        ? (error.details as Record<string, unknown>)
        : undefined,
    );
  }
  return body as T;
}
export async function downloadStudioConversation(
  token: string,
  tenantId: string,
  conversationId: string,
  format: "markdown" | "json" | "text" = "markdown",
) {
  const response = await fetch(
    `/api/admin/studio-conversations/${encodeURIComponent(conversationId)}/export${qs({ tenantId, format })}`,
    { credentials: "include", headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = body?.error ?? body;
    throw new ApiError(
      response.status,
      error?.code ?? "STUDIO_EXPORT_FAILED",
      error?.message ?? "导出会话失败。",
    );
  }
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const filename =
    /filename="?([^";]+)"?/i.exec(disposition)?.[1] ??
    `a2a-conversation.${format === "markdown" ? "md" : format}`;
  return { filename, blob: await response.blob() };
}
const json = (value: unknown) => JSON.stringify(value);

export const platformApi = {
  authConfig: () => request<AuthConfig>("/api/auth/config", ""),
  login: (email: string, password: string) =>
    request<{ accessToken: string; user: PlatformUser }>(
      "/api/auth/login",
      "",
      {
        method: "POST",
        body: json({ email, password }),
      },
    ),
  register: (email: string, displayName: string, password: string) =>
    request<{ accessToken: string; user: PlatformUser }>(
      "/api/auth/register",
      "",
      {
        method: "POST",
        body: json({ email, displayName, password }),
      },
    ),
  refreshSession: () =>
    request<{ accessToken: string; user: PlatformUser }>(
      "/api/auth/refresh",
      "",
      {
        method: "POST",
        body: "{}",
      },
    ),
  logout: (token: string) =>
    request<void>("/api/auth/logout", token, { method: "POST", body: "{}" }),
  me: (token: string) =>
    request<{ user: PlatformUser; tenants: Tenant[] }>("/api/auth/me", token),
  agentRun: (
    token: string,
    tenantId: string,
    agentSlug: string,
    taskId: string,
  ) =>
    request<{ run: AgentRunTrajectory | null }>(
      `/api/admin/agent-runs/${encodeURIComponent(agentSlug)}/${encodeURIComponent(taskId)}?tenantId=${encodeURIComponent(tenantId)}`,
      token,
    ).then((value) => value.run),
  oidcStart: () =>
    request<{ authorizationUrl: string }>("/api/auth/oidc/start", ""),
  oidcExchange: (code: string) =>
    request<{ accessToken: string; user: PlatformUser }>(
      "/api/auth/oidc/exchange",
      "",
      {
        method: "POST",
        body: json({ code }),
      },
    ),
  invitation: (token: string) =>
    request<{ invitation: Invitation }>(
      `/api/auth/invitations/${encodeURIComponent(token)}`,
      "",
    ).then((x) => x.invitation),
  activateInvitation: (token: string, displayName: string, password: string) =>
    request<{ accessToken: string; user: PlatformUser }>(
      `/api/auth/invitations/${encodeURIComponent(token)}/activate`,
      "",
      {
        method: "POST",
        body: json({ displayName, password }),
      },
    ),
  acceptInvitation: (token: string, accessToken: string) =>
    request<{ member: TenantMember }>(
      `/api/admin/invitations/${encodeURIComponent(token)}/accept`,
      accessToken,
      { method: "POST" },
    ).then((x) => x.member),
  session: (token: string) =>
    request<{
      principal: { id: string; displayName?: string; platformRole?: string };
    }>("/api/admin/session", token),
  dashboard: (token: string, tenantId?: string) =>
    request<{
      summary: Dashboard;
      taskStats: Record<string, number>;
      usage: UsageSummary;
    }>(`/api/admin/dashboard${qs({ tenantId })}`, token),
  tenants: (token: string, input: Record<string, QueryValue> = {}) =>
    request<Page<Tenant>>(`/api/admin/tenants${qs(input)}`, token),
  tenant: (token: string, id: string) =>
    request<{ tenant: Tenant }>(`/api/admin/tenants/${id}`, token).then(
      (x) => x.tenant,
    ),
  createTenant: (
    token: string,
    data: Partial<Tenant> & { slug: string; displayName: string },
  ) =>
    request<{ tenant: Tenant }>("/api/admin/tenants", token, {
      method: "POST",
      body: json(data),
    }).then((x) => x.tenant),
  updateTenant: (token: string, id: string, data: Partial<Tenant>) =>
    request<{ tenant: Tenant }>(`/api/admin/tenants/${id}`, token, {
      method: "PATCH",
      body: json(data),
    }).then((x) => x.tenant),
  tenantStatus: (token: string, id: string, status: "active" | "suspended") =>
    request<{ tenant: Tenant }>(`/api/admin/tenants/${id}/status`, token, {
      method: "POST",
      body: json({ status }),
    }).then((x) => x.tenant),
  deleteTenant: (token: string, id: string) =>
    request<void>(`/api/admin/tenants/${id}`, token, { method: "DELETE" }),
  members: (token: string, tenantId: string) =>
    request<{ members: TenantMember[] }>(
      `/api/admin/tenants/${tenantId}/members`,
      token,
    ).then((x) => x.members),
  invitations: (token: string, tenantId: string) =>
    request<{ invitations: Invitation[] }>(
      `/api/admin/tenants/${tenantId}/invitations`,
      token,
    ).then((x) => x.invitations),
  revokeInvitation: (token: string, tenantId: string, invitationId: string) =>
    request<void>(
      `/api/admin/tenants/${tenantId}/invitations/${invitationId}`,
      token,
      { method: "DELETE" },
    ),
  inviteMember: (
    token: string,
    tenantId: string,
    data: {
      email: string;
      displayName: string;
      role: TenantMember["role"];
      expiresInHours?: number;
    },
  ) =>
    request<{
      member: TenantMember;
      invitationToken: string;
      expiresAt: string;
    }>(`/api/admin/tenants/${tenantId}/members/invite`, token, {
      method: "POST",
      body: json(data),
    }),
  updateMember: (
    token: string,
    tenantId: string,
    memberId: string,
    data: { role?: TenantMember["role"]; status?: "active" | "disabled" },
  ) =>
    request<{ member: TenantMember }>(
      `/api/admin/tenants/${tenantId}/members/${memberId}`,
      token,
      { method: "PATCH", body: json(data) },
    ).then((x) => x.member),
  removeMember: (token: string, tenantId: string, memberId: string) =>
    request<void>(`/api/admin/tenants/${tenantId}/members/${memberId}`, token, {
      method: "DELETE",
    }),
  agents: (token: string, input: Record<string, QueryValue> = {}) =>
    request<{ agents: Agent[] }>(`/api/admin/agents${qs(input)}`, token).then(
      (x) => x.agents,
    ),
  catalogAgents: (token: string, input: Record<string, QueryValue> = {}) =>
    request<Page<CatalogAgent>>(`/api/catalog/agents${qs(input)}`, token),
  agent: (token: string, slug: string) =>
    request<{ agent: Agent }>(`/api/admin/agents/${slug}`, token).then(
      (x) => x.agent,
    ),
  createAgent: (
    token: string,
    data: Partial<Agent> & {
      slug: string;
      displayName: string;
      cardUrl: string;
    },
  ) =>
    request<{ agent: Agent }>("/api/admin/agents", token, {
      method: "POST",
      body: json(data),
    }).then((x) => x.agent),
  updateAgent: (token: string, slug: string, data: Partial<Agent>) =>
    request<{ agent: Agent }>(`/api/admin/agents/${slug}`, token, {
      method: "PATCH",
      body: json(data),
    }).then((x) => x.agent),
  removeAgent: (token: string, slug: string) =>
    request<void>(`/api/admin/agents/${slug}`, token, { method: "DELETE" }),
  agentStatus: (token: string, slug: string, status: "online" | "offline") =>
    request<{ agent: Agent }>(`/api/admin/agents/${slug}/status`, token, {
      method: "POST",
      body: json({ status }),
    }).then((x) => x.agent),
  refreshCard: (token: string, slug: string) =>
    request<{ agent: Agent; diff: Record<string, unknown> }>(
      `/api/admin/agents/${slug}/refresh-card`,
      token,
      { method: "POST" },
    ),
  healthCheck: (token: string, slug: string) =>
    request<{
      result: { ok: boolean; latencyMs?: number; error?: string };
      health: HealthCheck[];
    }>(`/api/admin/agents/${slug}/health-check`, token, { method: "POST" }),
  health: (token: string, slug: string) =>
    request<{ health: HealthCheck[] }>(
      `/api/admin/agents/${slug}/health`,
      token,
    ).then((x) => x.health),
  cardRevisions: (token: string, slug: string) =>
    request<{ revisions: CardRevision[] }>(
      `/api/admin/agents/${slug}/card-revisions`,
      token,
    ).then((x) => x.revisions),
  agentInstances: (token: string, slug: string) =>
    request<{ instances: AgentInstance[] }>(
      `/api/admin/agents/${slug}/instances`,
      token,
    ).then((x) => x.instances),
  createAgentInstance: (
    token: string,
    slug: string,
    data: {
      name: string;
      cardUrl: string;
      weight?: number;
      priority?: number;
      status?: "active" | "disabled";
      credential?:
        | { type: "none" }
        | { type: "bearer"; token: string }
        | { type: "api_key"; headerName: string; value: string }
        | { type: "headers"; headers: Record<string, string> };
    },
  ) =>
    request<{ instance: AgentInstance }>(
      `/api/admin/agents/${slug}/instances`,
      token,
      {
        method: "POST",
        body: json(data),
      },
    ).then((x) => x.instance),
  updateAgentInstance: (
    token: string,
    slug: string,
    instanceId: string,
    data: Record<string, unknown>,
  ) =>
    request<{ instance: AgentInstance }>(
      `/api/admin/agents/${slug}/instances/${instanceId}`,
      token,
      { method: "PATCH", body: json(data) },
    ).then((x) => x.instance),
  deleteAgentInstance: (token: string, slug: string, instanceId: string) =>
    request<void>(`/api/admin/agents/${slug}/instances/${instanceId}`, token, {
      method: "DELETE",
    }),
  checkAgentInstance: (token: string, slug: string, instanceId: string) =>
    request<{ result: { ok: boolean; latencyMs?: number; error?: string } }>(
      `/api/admin/agents/${slug}/instances/${instanceId}/health-check`,
      token,
      { method: "POST" },
    ).then((x) => x.result),
  keys: (token: string, tenantId: string, includeRevoked = true) =>
    request<{ keys: ApiKey[] }>(
      `/api/admin/tenants/${tenantId}/api-keys${qs({ includeRevoked })}`,
      token,
    ).then((x) => x.keys),
  createKey: (
    token: string,
    tenantId: string,
    data: {
      name: string;
      description?: string;
      scopes: string[];
      expiresAt?: string | null;
      minuteRequestLimit?: number | null;
      dailyRequestLimit?: number | null;
      monthlyRequestLimit?: number | null;
      concurrentRequestLimit?: number | null;
      agentIds?: string[];
    },
  ) =>
    request<{ key: ApiKey }>(`/api/admin/tenants/${tenantId}/api-keys`, token, {
      method: "POST",
      body: json(data),
    }).then((x) => x.key),
  updateKey: (
    token: string,
    tenantId: string,
    keyId: string,
    data: Omit<
      Partial<ApiKey>,
      | "expiresAt"
      | "minuteRequestLimit"
      | "dailyRequestLimit"
      | "monthlyRequestLimit"
      | "concurrentRequestLimit"
    > & {
      expiresAt?: string | null;
      minuteRequestLimit?: number | null;
      dailyRequestLimit?: number | null;
      monthlyRequestLimit?: number | null;
      concurrentRequestLimit?: number | null;
    },
  ) =>
    request<{ key: ApiKey }>(
      `/api/admin/tenants/${tenantId}/api-keys/${keyId}`,
      token,
      { method: "PATCH", body: json(data) },
    ).then((x) => x.key),
  revokeKey: (token: string, tenantId: string, keyId: string) =>
    request<{ key: ApiKey }>(
      `/api/admin/tenants/${tenantId}/api-keys/${keyId}/revoke`,
      token,
      { method: "POST" },
    ).then((x) => x.key),
  tasks: (token: string, input: Record<string, QueryValue> = {}) =>
    request<Page<TaskSummary>>(`/api/admin/tasks${qs(input)}`, token),
  task: (token: string, id: number) =>
    request<{ task: TaskDetail }>(`/api/admin/tasks/${id}`, token).then(
      (x) => x.task,
    ),
  taskEventsUrl: (id: number) => `/api/admin/tasks/${id}/events.json`,
  symbolConversations: (
    token: string,
    tenantId: string,
    agentSlug: string,
    includeArchived = false,
  ) =>
    request<{ conversations: SymbolConversationSummary[] }>(
      `/api/admin/symbol-conversations${qs({ tenantId, agentSlug, includeArchived })}`,
      token,
    ).then((x) => x.conversations),
  symbolConversation: (token: string, tenantId: string, taskId: string) =>
    request<{ conversation: SymbolConversationDetail }>(
      `/api/admin/symbol-conversations/${encodeURIComponent(taskId)}${qs({ tenantId })}`,
      token,
    ).then((x) => x.conversation),
  renameSymbolConversation: (
    token: string,
    tenantId: string,
    taskId: string,
    title: string,
  ) =>
    request<{ conversation: SymbolConversationSummary }>(
      `/api/admin/symbol-conversations/${encodeURIComponent(taskId)}${qs({ tenantId })}`,
      token,
      { method: "PATCH", body: json({ title }) },
    ).then((x) => x.conversation),
  archiveSymbolConversation: (
    token: string,
    tenantId: string,
    taskId: string,
    archived = true,
  ) =>
    request<{ conversation: SymbolConversationSummary }>(
      `/api/admin/symbol-conversations/${encodeURIComponent(taskId)}/archive${qs({ tenantId })}`,
      token,
      { method: "POST", body: json({ archived }) },
    ).then((x) => x.conversation),
  studioConversations: (
    token: string,
    input: {
      tenantId: string;
      agentSlug?: string;
      status?: "active" | "archived" | "deleted";
      search?: string;
      labelId?: string;
      page?: number;
      pageSize?: number;
    },
  ) =>
    request<Page<StudioConversation>>(
      `/api/admin/studio-conversations${qs(input)}`,
      token,
    ),
  createStudioConversation: (
    token: string,
    input: { tenantId: string; agentSlug: string; title?: string },
  ) =>
    request<{ conversation: StudioConversation }>(
      "/api/admin/studio-conversations",
      token,
      { method: "POST", body: json(input) },
    ).then((x) => x.conversation),
  studioLabels: (token: string, tenantId: string) =>
    request<{ labels: StudioLabel[] }>(
      `/api/admin/studio-labels${qs({ tenantId })}`,
      token,
    ).then((x) => x.labels),
  createStudioLabel: (
    token: string,
    input: { tenantId: string; name: string; color?: StudioLabel["color"] },
  ) =>
    request<{ label: StudioLabel }>("/api/admin/studio-labels", token, {
      method: "POST",
      body: json(input),
    }).then((x) => x.label),
  deleteStudioLabel: (token: string, tenantId: string, labelId: string) =>
    request<void>(
      `/api/admin/studio-labels/${encodeURIComponent(labelId)}${qs({ tenantId })}`,
      token,
      { method: "DELETE" },
    ),
  studioConversation: (
    token: string,
    tenantId: string,
    conversationId: string,
  ) =>
    request<{ conversation: StudioConversationDetail }>(
      `/api/admin/studio-conversations/${encodeURIComponent(conversationId)}${qs({ tenantId })}`,
      token,
    ).then((x) => x.conversation),
  updateStudioConversation: (
    token: string,
    conversationId: string,
    input: {
      tenantId: string;
      title?: string;
      status?: "active" | "archived" | "deleted";
    },
  ) =>
    request<{ conversation: StudioConversation }>(
      `/api/admin/studio-conversations/${encodeURIComponent(conversationId)}`,
      token,
      { method: "PATCH", body: json(input) },
    ).then((x) => x.conversation),
  appendStudioMessage: (
    token: string,
    conversationId: string,
    input: {
      tenantId: string;
      role: "user" | "assistant" | "system";
      content: string;
      status?: StudioMessage["status"];
      taskId?: string;
      errorCode?: string;
      metadata?: Record<string, unknown>;
      clientRequestId?: string;
    },
  ) =>
    request<{ message: StudioMessage }>(
      `/api/admin/studio-conversations/${encodeURIComponent(conversationId)}/messages`,
      token,
      { method: "POST", body: json(input) },
    ).then((x) => x.message),
  updateStudioMessage: (
    token: string,
    conversationId: string,
    messageId: string,
    input: {
      tenantId: string;
      content?: string;
      status?: StudioMessage["status"];
      taskId?: string | null;
      errorCode?: string | null;
      metadata?: Record<string, unknown>;
    },
  ) =>
    request<{ message: StudioMessage }>(
      `/api/admin/studio-conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`,
      token,
      { method: "PATCH", body: json(input) },
    ).then((x) => x.message),
  forkStudioConversation: (
    token: string,
    conversationId: string,
    input: {
      tenantId: string;
      title?: string;
      throughSequence?: number;
    },
  ) =>
    request<{ conversation: StudioConversationDetail }>(
      `/api/admin/studio-conversations/${encodeURIComponent(conversationId)}/fork`,
      token,
      { method: "POST", body: json(input) },
    ).then((x) => x.conversation),
  studioConversationEvents: (
    token: string,
    tenantId: string,
    conversationId: string,
  ) =>
    request<{ events: StudioConversationEvent[] }>(
      `/api/admin/studio-conversations/${encodeURIComponent(conversationId)}/events${qs({ tenantId })}`,
      token,
    ).then((x) => x.events),
  studioMessageFeedback: (
    token: string,
    conversationId: string,
    messageId: string,
    input: { tenantId: string; rating: -1 | 1; note?: string },
  ) =>
    request<{ feedback: StudioMessageFeedback }>(
      `/api/admin/studio-conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/feedback`,
      token,
      { method: "PUT", body: json(input) },
    ).then((x) => x.feedback),
  studioMessageRevisions: (
    token: string,
    tenantId: string,
    conversationId: string,
    messageId: string,
  ) =>
    request<{ revisions: StudioMessageRevision[] }>(
      `/api/admin/studio-conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/revisions${qs({ tenantId })}`,
      token,
    ).then((x) => x.revisions),
  replaceStudioConversationLabels: (
    token: string,
    conversationId: string,
    input: { tenantId: string; labelIds: string[] },
  ) =>
    request<{ labels: StudioLabel[] }>(
      `/api/admin/studio-conversations/${encodeURIComponent(conversationId)}/labels`,
      token,
      { method: "PUT", body: json(input) },
    ).then((x) => x.labels),
  usage: (token: string, input: Record<string, QueryValue> = {}) =>
    request<Page<UsageRecord>>(`/api/admin/usage${qs(input)}`, token),
  usageSummary: (token: string, input: Record<string, QueryValue> = {}) =>
    request<{ summary: UsageSummary }>(
      `/api/admin/usage/summary${qs(input)}`,
      token,
    ).then((x) => x.summary),
  usageExportUrl: (input: Record<string, QueryValue> = {}) =>
    `/api/admin/usage/export.csv${qs(input)}`,
  webhooks: (token: string, tenantId: string) =>
    request<{ webhooks: Webhook[] }>(
      `/api/admin/tenants/${tenantId}/webhooks`,
      token,
    ).then((x) => x.webhooks),
  createWebhook: (
    token: string,
    tenantId: string,
    data: Partial<Webhook> & {
      name: string;
      targetUrl: string;
      events: string[];
    },
  ) =>
    request<{ webhook: Webhook }>(
      `/api/admin/tenants/${tenantId}/webhooks`,
      token,
      { method: "POST", body: json(data) },
    ).then((x) => x.webhook),
  updateWebhook: (
    token: string,
    tenantId: string,
    id: string,
    data: Partial<Webhook>,
  ) =>
    request<{ webhook: Webhook }>(
      `/api/admin/tenants/${tenantId}/webhooks/${id}`,
      token,
      { method: "PATCH", body: json(data) },
    ).then((x) => x.webhook),
  deleteWebhook: (token: string, tenantId: string, id: string) =>
    request<void>(`/api/admin/tenants/${tenantId}/webhooks/${id}`, token, {
      method: "DELETE",
    }),
  rotateWebhookSecret: (token: string, tenantId: string, id: string) =>
    request<{ signingSecret: string }>(
      `/api/admin/tenants/${tenantId}/webhooks/${id}/rotate-secret`,
      token,
      { method: "POST" },
    ),
  testWebhook: (token: string, tenantId: string, id: string) =>
    request<{ delivery: WebhookDelivery }>(
      `/api/admin/tenants/${tenantId}/webhooks/${id}/test`,
      token,
      { method: "POST" },
    ).then((x) => x.delivery),
  deliveries: (
    token: string,
    tenantId: string,
    id: string,
    input: Record<string, QueryValue> = {},
  ) =>
    request<Page<WebhookDelivery>>(
      `/api/admin/tenants/${tenantId}/webhooks/${id}/deliveries${qs(input)}`,
      token,
    ),
  replayDelivery: (token: string, tenantId: string, id: string) =>
    request<{ delivery: WebhookDelivery }>(
      `/api/admin/tenants/${tenantId}/webhook-deliveries/${id}/replay`,
      token,
      { method: "POST" },
    ).then((x) => x.delivery),
  notificationChannels: (token: string, tenantId: string) =>
    request<{ channels: NotificationChannel[] }>(
      `/api/admin/tenants/${tenantId}/notification-channels`,
      token,
    ).then((x) => x.channels),
  createNotificationChannel: (
    token: string,
    tenantId: string,
    data: Partial<NotificationChannel> & {
      name: string;
      type: NotificationChannel["type"];
      destination: string;
    },
  ) =>
    request<{ channel: NotificationChannel }>(
      `/api/admin/tenants/${tenantId}/notification-channels`,
      token,
      { method: "POST", body: json(data) },
    ).then((x) => x.channel),
  updateNotificationChannel: (
    token: string,
    tenantId: string,
    channelId: string,
    data: Partial<NotificationChannel>,
  ) =>
    request<{ channel: NotificationChannel }>(
      `/api/admin/tenants/${tenantId}/notification-channels/${channelId}`,
      token,
      { method: "PATCH", body: json(data) },
    ).then((x) => x.channel),
  deleteNotificationChannel: (
    token: string,
    tenantId: string,
    channelId: string,
  ) =>
    request<void>(
      `/api/admin/tenants/${tenantId}/notification-channels/${channelId}`,
      token,
      { method: "DELETE" },
    ),
  rotateNotificationSecret: (
    token: string,
    tenantId: string,
    channelId: string,
  ) =>
    request<{ signingSecret: string }>(
      `/api/admin/tenants/${tenantId}/notification-channels/${channelId}/rotate-secret`,
      token,
      { method: "POST" },
    ),
  testNotificationChannel: (
    token: string,
    tenantId: string,
    channelId: string,
  ) =>
    request<{ record: NotificationRecord }>(
      `/api/admin/tenants/${tenantId}/notification-channels/${channelId}/test`,
      token,
      { method: "POST" },
    ).then((x) => x.record),
  notifications: (token: string, input: Record<string, QueryValue> = {}) =>
    request<Page<NotificationRecord>>(
      `/api/admin/notifications${qs(input)}`,
      token,
    ),
  replayNotification: (token: string, id: number) =>
    request<{ record: NotificationRecord }>(
      `/api/admin/notifications/${id}/replay`,
      token,
      { method: "POST" },
    ).then((x) => x.record),
  alertRules: (token: string, tenantId?: string) =>
    request<{ rules: AlertRule[] }>(
      `/api/admin/alerts/rules${qs({ tenantId })}`,
      token,
    ).then((x) => x.rules),
  createAlertRule: (
    token: string,
    data: Partial<AlertRule> & {
      name: string;
      metric: string;
      operator: "gt" | "lt";
      threshold: number;
    },
  ) =>
    request<{ rule: AlertRule }>("/api/admin/alerts/rules", token, {
      method: "POST",
      body: json(data),
    }).then((x) => x.rule),
  updateAlertRule: (token: string, id: string, data: Partial<AlertRule>) =>
    request<{ rule: AlertRule }>(`/api/admin/alerts/rules/${id}`, token, {
      method: "PATCH",
      body: json(data),
    }).then((x) => x.rule),
  deleteAlertRule: (token: string, id: string) =>
    request<void>(`/api/admin/alerts/rules/${id}`, token, { method: "DELETE" }),
  alertEvents: (token: string, input: Record<string, QueryValue> = {}) =>
    request<Page<AlertEvent>>(`/api/admin/alerts/events${qs(input)}`, token),
  acknowledgeAlert: (token: string, id: number) =>
    request<{ event: AlertEvent }>(
      `/api/admin/alerts/events/${id}/acknowledge`,
      token,
      { method: "POST" },
    ).then((x) => x.event),
  silenceAlert: (token: string, id: number, minutes: number) =>
    request<{ event: AlertEvent }>(
      `/api/admin/alerts/events/${id}/silence`,
      token,
      { method: "POST", body: json({ minutes }) },
    ).then((x) => x.event),
  audit: (token: string, input: Record<string, QueryValue> = {}) =>
    request<Page<AuditEntry>>(`/api/admin/audit${qs(input)}`, token),
  auditActions: (token: string) =>
    request<{ actions: string[] }>("/api/admin/audit/actions", token).then(
      (x) => x.actions,
    ),
  settings: (token: string) =>
    request<{ settings: PlatformSetting[] }>("/api/admin/settings", token).then(
      (x) => x.settings,
    ),
  updateSetting: (
    token: string,
    key: string,
    value: unknown,
    description?: string,
  ) =>
    request<{ setting: PlatformSetting }>(
      `/api/admin/settings/${encodeURIComponent(key)}`,
      token,
      { method: "PUT", body: json({ value, description }) },
    ).then((x) => x.setting),
  users: (token: string) =>
    request<{ users: PlatformUser[] }>("/api/admin/users", token).then(
      (x) => x.users,
    ),
  createUser: (
    token: string,
    data: {
      email: string;
      displayName: string;
      password?: string;
      platformRole?: "platform_admin" | null;
    },
  ) =>
    request<{ user: PlatformUser }>("/api/admin/users", token, {
      method: "POST",
      body: json(data),
    }).then((x) => x.user),
  userStatus: (token: string, userId: string, status: "active" | "disabled") =>
    request<{ user: PlatformUser }>(
      `/api/admin/users/${encodeURIComponent(userId)}/status`,
      token,
      {
        method: "POST",
        body: json({ status }),
      },
    ).then((x) => x.user),
  userPlatformRole: (
    token: string,
    userId: string,
    platformRole: "platform_admin" | null,
  ) =>
    request<{ user: PlatformUser }>(
      `/api/admin/users/${encodeURIComponent(userId)}/platform-role`,
      token,
      {
        method: "PATCH",
        body: json({ platformRole }),
      },
    ).then((x) => x.user),
  resetUserPassword: (token: string, userId: string, password: string) =>
    request<void>(
      `/api/admin/users/${encodeURIComponent(userId)}/password`,
      token,
      {
        method: "POST",
        body: json({ password }),
      },
    ),
};

export async function authorizedDownload(
  url: string,
  token: string,
  filename: string,
): Promise<void> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok)
    throw new ApiError(
      response.status,
      "DOWNLOAD_FAILED",
      `下载失败 (${response.status})`,
    );
  const href = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export type SseEnvelope = { event?: string; data: unknown; raw: string };
export async function* streamAgent(input: {
  slug: string;
  apiKey: string;
  question: string;
  signal?: AbortSignal;
  /** Continue a TASK_STATE_INPUT_REQUIRED conversation with the same task. */
  continueTaskId?: string;
  taskId?: string;
}): AsyncGenerator<SseEnvelope> {
  const path = input.taskId
    ? `/agents/${input.slug}/a2a/rest/tasks/${encodeURIComponent(input.taskId)}:subscribe`
    : `/agents/${input.slug}/a2a/rest/message:stream`;
  const body = input.taskId
    ? undefined
    : json({
        message: {
          messageId: crypto.randomUUID(),
          role: "ROLE_USER",
          parts: [
            {
              // This is the A2A REST JSON representation. The SDK's
              // in-memory `$case` shape is deliberately not used here: it
              // serializes to an empty part on the wire.
              text: input.question,
              mediaType: "text/plain",
              filename: "",
              metadata: undefined,
            },
          ],
          taskId: input.continueTaskId ?? "",
          contextId: "",
          extensions: [],
          metadata: {},
          referenceTaskIds: [],
        },
        configuration: undefined,
        metadata: {},
      });
  const response = await fetch(path, {
    method: "POST",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      "X-API-Key": input.apiKey,
    },
    body,
    signal: input.signal,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new ApiError(
      response.status,
      payload.error?.code ?? "STREAM_FAILED",
      payload.error?.message ?? `调用失败 (${response.status})`,
    );
  }
  if (!response.body)
    throw new ApiError(502, "STREAM_BODY_MISSING", "网关没有返回流式响应体。");
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      let event: string | undefined;
      const data: string[] = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (!data.length) continue;
      const raw = data.join("\n");
      let parsed: unknown = raw;
      try {
        parsed = JSON.parse(raw);
      } catch {
        /* 文本事件保持原样 */
      }
      yield { event, data: parsed, raw };
    }
  }
}

export async function* streamStudioAgent(input: {
  token: string;
  tenantId: string;
  slug: string;
  question: string;
  signal?: AbortSignal;
  continueTaskId?: string;
}): AsyncGenerator<SseEnvelope> {
  const response = await fetch(
    `/api/admin/studio/agents/${encodeURIComponent(input.slug)}/a2a/rest/message:stream`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${input.token}`, "Content-Type": "application/json" },
      body: json({
        tenantId: input.tenantId,
        request: {
          message: {
            messageId: crypto.randomUUID(), role: "ROLE_USER",
            parts: [{ text: input.question, mediaType: "text/plain", filename: "", metadata: undefined }],
            taskId: input.continueTaskId ?? "", contextId: "", extensions: [], metadata: {}, referenceTaskIds: [],
          }, configuration: undefined, metadata: {},
        },
      }),
      signal: input.signal,
    },
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new ApiError(response.status, payload.error?.code ?? "STUDIO_STREAM_FAILED", payload.error?.message ?? `调用失败 (${response.status})`);
  }
  if (!response.body) throw new ApiError(502, "STUDIO_STREAM_BODY_MISSING", "在线调试未返回流式响应体。");
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      let event: string | undefined;
      const data: string[] = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (!data.length) continue;
      const raw = data.join("\n");
      let parsed: unknown = raw;
      try { parsed = JSON.parse(raw); } catch { /* preserve text event */ }
      yield { event, data: parsed, raw };
    }
  }
}

export async function cancelRemoteTask(
  slug: string,
  taskId: string,
  apiKey: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(
    `/agents/${slug}/a2a/rest/tasks/${encodeURIComponent(taskId)}:cancel`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: "{}",
    },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(
      response.status,
      body.error?.code ?? "CANCEL_FAILED",
      body.error?.message ?? "取消失败",
    );
  return body;
}

export async function subscribePlatformEvents(
  token: string,
  tenantId: string | undefined,
  onEvent: (event: unknown) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(`/api/admin/events${qs({ tenantId })}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  if (!response.ok || !response.body) {
    throw new ApiError(
      response.status,
      "EVENT_SUBSCRIPTION_FAILED",
      "实时事件订阅失败。",
    );
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      try {
        onEvent(JSON.parse(data));
      } catch {
        onEvent(data);
      }
    }
  }
}
