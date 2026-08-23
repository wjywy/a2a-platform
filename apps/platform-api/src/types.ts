import type { AgentCard } from "@a2a-js/sdk";

export type AgentStatus = "draft" | "offline" | "online" | "degraded";
export type HealthStatus = "unknown" | "healthy" | "unhealthy";

export type PlatformAgent = {
  id: string;
  slug: string;
  displayName: string;
  cardUrl: string;
  cardSnapshot: AgentCard;
  selectedInterface: {
    url: string;
    protocolBinding: string;
    protocolVersion: string;
  };
  status: AgentStatus;
  healthStatus: HealthStatus;
  labels: string[];
  version: number;
  tenantId?: string;
  description: string;
  visibility: "private" | "tenant" | "public";
  allowedTenantIds: string[];
  invocationPolicy: {
    timeoutMs: number;
    maxRetries: number;
    maxConcurrent: number;
  };
  routingStrategy: "weighted_round_robin" | "least_connections" | "priority";
  createdAt: string;
  updatedAt: string;
};

export type AgentCardRevision = {
  id: number;
  agentId: string;
  version: number;
  cardSnapshot: AgentCard;
  selectedInterface: PlatformAgent["selectedInterface"];
  changeSummary: Record<string, unknown>;
  fetchedBy: string;
  fetchedAt: string;
};

export type AuditLog = {
  id: number;
  actorId: string;
  action: string;
  agentId: string | null;
  requestId: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
};

export type HealthCheck = {
  checkedAt: string;
  success: boolean;
  latencyMs: number | null;
  errorMessage: string | null;
};
export type DashboardSummary = {
  totalAgents: number;
  onlineAgents: number;
  degradedAgents: number;
  unhealthyAgents: number;
  taskCount: number;
  recentAudit: AuditLog[];
};
