import { Router } from "express";
import { z } from "zod";
import { requireAuthentication, type AuthenticatedRequest } from "./auth.js";
import { asyncHandler } from "./http.js";
import { config } from "./config.js";
import { listAgents, listVisibleAgents } from "./repositories.js";
import { listTenantsForUser } from "./tenant-service.js";
import type { PlatformAgent } from "./types.js";
import { ForbiddenError } from "./domain.js";
import { pageResult, paginationSchema } from "./domain.js";

const router = Router();
router.use(requireAuthentication);

const querySchema = paginationSchema.extend({
  tenantId: z.string().uuid().optional(),
  search: z.string().trim().max(100).optional(),
  status: z.enum(["draft", "offline", "online", "degraded"]).optional(),
});

type CatalogAccess =
  "public" | "tenant_owner" | "tenant_grant" | "platform_admin";
export type CatalogAgentDto = {
  id: string;
  slug: string;
  displayName: string;
  description: string;
  cardUrl: string;
  status: PlatformAgent["status"];
  healthStatus: PlatformAgent["healthStatus"];
  labels: string[];
  tenantId?: string;
  visibility: PlatformAgent["visibility"];
  allowedTenantIds: string[];
  invocationPolicy: PlatformAgent["invocationPolicy"];
  routingStrategy: PlatformAgent["routingStrategy"];
  selectedInterface: PlatformAgent["selectedInterface"];
  version: number;
  createdAt: string;
  updatedAt: string;
  access: CatalogAccess;
  manageable: boolean;
  administrable: boolean;
};

function safeCatalogAgent(
  agent: PlatformAgent,
  roles: Map<string, "tenant_admin" | "developer" | "viewer">,
  platformAdmin = false,
): CatalogAgentDto {
  const ownerRole = agent.tenantId ? roles.get(agent.tenantId) : undefined;
  const granted = [...roles.keys()].some((id) =>
    agent.allowedTenantIds.includes(id),
  );
  const access: CatalogAccess = platformAdmin
    ? "platform_admin"
    : ownerRole
      ? "tenant_owner"
      : granted
        ? "tenant_grant"
        : "public";
  const base = config.platformOrigin;
  return {
    id: agent.id,
    slug: agent.slug,
    displayName: agent.displayName,
    description: agent.description,
    cardUrl: `${base}/agents/${agent.slug}/.well-known/agent-card.json`,
    status: agent.status,
    healthStatus: agent.healthStatus,
    labels: [...agent.labels],
    selectedInterface: {
      url: `${base}/agents/${agent.slug}/a2a/rest`,
      protocolBinding: "HTTP+JSON",
      protocolVersion: "1.0",
    },
    tenantId: ownerRole || platformAdmin ? agent.tenantId : undefined,
    visibility: agent.visibility,
    allowedTenantIds: [],
    invocationPolicy: { ...agent.invocationPolicy },
    routingStrategy: agent.routingStrategy,
    version: agent.version,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
    access,
    manageable:
      platformAdmin ||
      ownerRole === "tenant_admin" ||
      ownerRole === "developer",
    administrable: platformAdmin || ownerRole === "tenant_admin",
  };
}

router.get(
  "/agents",
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const input = querySchema.parse(req.query);
    const memberships =
      req.principal?.platformRole === "platform_admin"
        ? []
        : await listTenantsForUser(req.principal!.id);
    const selected = input.tenantId
      ? memberships.filter((tenant) => tenant.id === input.tenantId)
      : memberships;
    if (
      input.tenantId &&
      req.principal?.platformRole !== "platform_admin" &&
      !selected.length
    )
      throw new ForbiddenError(
        "TENANT_CATALOG_DENIED",
        "不能查看未加入租户的 Agent 授权目录。",
      );
    const roles = new Map(selected.map((tenant) => [tenant.id, tenant.role]));
    const tenantIds = [...roles.keys()];
    const platformAdmin = req.principal?.platformRole === "platform_admin";
    if (platformAdmin) {
      const agents = await listAgents(input);
      const start = (input.page - 1) * input.pageSize;
      res.json(
        pageResult(
          agents
            .slice(start, start + input.pageSize)
            .map((agent) => safeCatalogAgent(agent, roles, true)),
          agents.length,
          input,
        ),
      );
      return;
    }
    const agents = await listVisibleAgents(tenantIds, input);
    res.json({
      ...agents,
      items: agents.items.map((agent) => safeCatalogAgent(agent, roles)),
    });
  }),
);

export { router as catalogRouter };
