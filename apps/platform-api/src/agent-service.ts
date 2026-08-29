import { AgentCard, type StreamResponse } from "@a2a-js/sdk";
import {
  ClientFactory,
  JsonRpcTransportFactory,
  RestTransportFactory,
} from "@a2a-js/sdk/client";
import { z } from "zod";
import { updateHealth } from "./repositories.js";
import type { PlatformAgent } from "./types.js";
import { AppError } from "./domain.js";
import {
  allowPrivateOutboundTargets,
  assertSafeOutboundUrl,
} from "./url-policy.js";
import {
  createLimitedFetch,
  readLimitedResponseText,
  secureFetch,
  secureFetchWithPolicy,
} from "./secure-fetch.js";
import { config } from "./config.js";
import {
  credentialHeaders,
  type UpstreamCredential,
} from "./credential-service.js";

export const registerAgentSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9-]{3,64}$/, "slug 只能由小写字母、数字和连字符组成"),
  displayName: z.string().min(2).max(80),
  cardUrl: z.string().url(),
  labels: z.array(z.string().min(1).max(24)).max(8).default([]),
  description: z.string().trim().max(500).default(""),
  tenantId: z.string().uuid().optional(),
  visibility: z.enum(["private", "tenant", "public"]).default("private"),
  allowedTenantIds: z.array(z.string().uuid()).max(100).default([]),
  invocationPolicy: z
    .object({
      timeoutMs: z.number().int().min(1000).max(600_000).default(60_000),
      maxRetries: z.number().int().min(0).max(5).default(0),
      maxConcurrent: z.number().int().min(1).max(1000).default(20),
    })
    .default({ timeoutMs: 60_000, maxRetries: 0, maxConcurrent: 20 }),
  routingStrategy: z
    .enum(["weighted_round_robin", "least_connections", "priority"])
    .default("weighted_round_robin"),
});
export const updateAgentSchema = z
  .object({
    displayName: z.string().min(2).max(80).optional(),
    description: z.string().trim().max(500).optional(),
    labels: z.array(z.string().min(1).max(24)).max(8).optional(),
    tenantId: z.string().uuid().nullable().optional(),
    visibility: z.enum(["private", "tenant", "public"]).optional(),
    allowedTenantIds: z.array(z.string().uuid()).max(100).optional(),
    invocationPolicy: z
      .object({
        timeoutMs: z.number().int().min(1000).max(600_000),
        maxRetries: z.number().int().min(0).max(5),
        maxConcurrent: z.number().int().min(1).max(1000),
      })
      .optional(),
    routingStrategy: z
      .enum(["weighted_round_robin", "least_connections", "priority"])
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "至少提供一个可更新字段。");

export function diffAgentCards(
  previous: AgentCard,
  next: AgentCard,
): Record<string, unknown> {
  const previousSkills = new Map(
    (previous.skills ?? []).map((skill) => [skill.id, skill]),
  );
  const nextSkills = new Map(
    (next.skills ?? []).map((skill) => [skill.id, skill]),
  );
  const addedSkills = [...nextSkills.keys()].filter(
    (id) => !previousSkills.has(id),
  );
  const removedSkills = [...previousSkills.keys()].filter(
    (id) => !nextSkills.has(id),
  );
  const changedSkills = [...nextSkills.keys()].filter(
    (id) =>
      previousSkills.has(id) &&
      JSON.stringify(previousSkills.get(id)) !==
        JSON.stringify(nextSkills.get(id)),
  );
  const previousInterfaces = new Set(
    (previous.supportedInterfaces ?? []).map(
      (item) => `${item.protocolBinding}|${item.protocolVersion}|${item.url}`,
    ),
  );
  const nextInterfaces = new Set(
    (next.supportedInterfaces ?? []).map(
      (item) => `${item.protocolBinding}|${item.protocolVersion}|${item.url}`,
    ),
  );
  const changedFields = [
    "name",
    "description",
    "version",
    "documentationUrl",
    "capabilities",
  ].filter(
    (field) =>
      JSON.stringify(
        (previous as unknown as Record<string, unknown>)[field],
      ) !== JSON.stringify((next as unknown as Record<string, unknown>)[field]),
  );
  return {
    changed:
      addedSkills.length +
        removedSkills.length +
        changedSkills.length +
        changedFields.length +
        [...nextInterfaces].filter((value) => !previousInterfaces.has(value))
          .length +
        [...previousInterfaces].filter((value) => !nextInterfaces.has(value))
          .length >
      0,
    changedFields,
    skills: {
      added: addedSkills,
      removed: removedSkills,
      changed: changedSkills,
    },
    interfaces: {
      added: [...nextInterfaces].filter(
        (value) => !previousInterfaces.has(value),
      ),
      removed: [...previousInterfaces].filter(
        (value) => !nextInterfaces.has(value),
      ),
    },
  };
}

export async function resolveRemoteCard(
  cardUrl: string,
  credential: UpstreamCredential = { type: "none" },
  options: { allowPrivate?: boolean } = {},
): Promise<AgentCard> {
  let target = cardUrl;
  const credentialOrigin = new URL(cardUrl).origin;
  const allowPrivate =
    options.allowPrivate ?? allowPrivateOutboundTargets();
  for (let redirect = 0; redirect <= 3; redirect++) {
    await assertSafeOutboundUrl(target, {
      purpose: "agent_card",
      allowPrivate,
    });
    const response = await secureFetchWithPolicy(
      target,
      {
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
        headers: { accept: "application/json", ...credentialHeaders(credential) },
      },
      { allowPrivate },
    );
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Agent Card 重定向缺少 Location。");
      const redirected = new URL(location, target);
      if (credential.type !== "none" && redirected.origin !== credentialOrigin)
        throw new Error("携带凭据的 Agent Card 不允许跨 Origin 重定向。");
      target = redirected.toString();
      continue;
    }
    if (!response.ok)
      throw new Error(`Agent Card 返回 HTTP ${response.status}。`);
    const size = Number(response.headers.get("content-length") ?? 0);
    if (size > 2_000_000) throw new Error("Agent Card 超过 2MB 限制。");
    const body = await readLimitedResponseText(response, 2_000_000);
    return AgentCard.fromJSON(JSON.parse(body));
  }
  throw new Error("Agent Card 重定向次数超过 3 次。");
}

export function selectCompatibleInterface(
  card: AgentCard,
): NonNullable<AgentCard["supportedInterfaces"]>[number] {
  const candidate = card.supportedInterfaces?.find((item) =>
    ["JSONRPC", "HTTP+JSON"].includes(item.protocolBinding.toUpperCase()),
  );
  if (!candidate) {
    throw new Error("Agent Card 没有平台可代理的 JSONRPC 或 HTTP+JSON 接口。");
  }
  return candidate;
}

export async function validateRemoteAgent(
  cardUrl: string,
  credential: UpstreamCredential = { type: "none" },
  options: { allowPrivate?: boolean } = {},
): Promise<{
  card: AgentCard;
  selectedInterface: NonNullable<AgentCard["supportedInterfaces"]>[number];
}> {
  const allowPrivate =
    options.allowPrivate ?? allowPrivateOutboundTargets();
  await assertSafeOutboundUrl(cardUrl, {
    purpose: "agent_card",
    allowPrivate,
  });
  let resolved: AgentCard;
  try {
    resolved = await resolveRemoteCard(cardUrl, credential, { allowPrivate });
  } catch (error) {
    throw new AppError(
      422,
      "AGENT_CARD_UNREACHABLE",
      `无法读取远端 Agent Card：${error instanceof Error ? error.message : "网络请求失败"}`,
      { cardUrl },
    );
  }
  const card = normalizeLocalDevelopmentEndpoints(resolved, cardUrl);
  if (!card.name || !card.version) {
    throw new Error("Agent Card 缺少 name 或 version。");
  }
  const selectedInterface = selectCompatibleInterface(card);
  await assertSafeOutboundUrl(selectedInterface.url, {
    purpose: "agent_card",
    allowPrivate,
  });
  return { card, selectedInterface };
}

/**
 * A Card served from the Windows host is reachable by containers as
 * host.docker.internal, while its sample interfaces often still say localhost.
 * This narrowly fixes that local-only mismatch; public Agent Cards are untouched.
 */
export function normalizeLocalDevelopmentEndpoints(
  card: AgentCard,
  cardUrl: string,
): AgentCard {
  const cardHost = new URL(cardUrl).hostname;
  if (["localhost", "127.0.0.1", "::1"].includes(cardHost)) return card;
  const copy = structuredClone(card);
  copy.supportedInterfaces = copy.supportedInterfaces?.map((item) => {
    const endpoint = new URL(item.url);
    if (!["localhost", "127.0.0.1", "::1"].includes(endpoint.hostname))
      return item;
    endpoint.hostname = cardHost;
    return { ...item, url: endpoint.toString() };
  });
  return copy;
}

/**
 * Bundled agents are trusted code in this deployment. In local Docker their
 * public Card contains localhost, which is not the API container; use the
 * explicitly configured service origin for the actual upstream hop only.
 */
export function symbolUpstreamUrl(value: string): string {
  const publicPrefix = `${config.platformOrigin}/api/builtin/symbol/`;
  if (!value.startsWith(publicPrefix)) return value;
  return `${config.symbolInternalOrigin}${value.slice(config.platformOrigin.length)}`;
}

/**
 * The API service address is trusted deployment configuration, not Agent
 * registration input. Restrict the private-network exception to the bundled
 * Symbol path so registered third-party Agent URLs keep the SSRF boundary.
 */
export function isTrustedSymbolInternalUrl(value: string): boolean {
  return value.startsWith(
    `${config.symbolInternalOrigin}/api/builtin/symbol/`,
  );
}

export async function getRemoteClient(
  agent: PlatformAgent,
  target?: {
    selectedInterface: PlatformAgent["selectedInterface"];
    credential?: UpstreamCredential;
  },
) {
  const selected = target?.selectedInterface ?? agent.selectedInterface;
  await assertSafeOutboundUrl(selected.url, {
    purpose: "agent_card",
    allowPrivate: allowPrivateOutboundTargets(),
  });
  const card = structuredClone(agent.cardSnapshot);
  card.supportedInterfaces = [{ ...selected, url: symbolUpstreamUrl(selected.url), tenant: "" }];
  const limitedFetch = createLimitedFetch(config.maxA2AResponseBytes);
  const authHeaders = credentialHeaders(target?.credential ?? { type: "none" });
  const transportFetch: typeof fetch = (input, init = {}) =>
    limitedFetch(input, {
      ...init,
      headers: {
        ...Object.fromEntries(new Headers(init.headers).entries()),
        ...authHeaders,
      },
    });
  return new ClientFactory({
    transports: [
      new JsonRpcTransportFactory({ fetchImpl: transportFetch }),
      new RestTransportFactory({ fetchImpl: transportFetch }),
    ],
  }).createFromAgentCard(card);
}

export function platformCard(
  agent: PlatformAgent,
  platformOrigin: string,
): AgentCard {
  const card = structuredClone(agent.cardSnapshot);
  const base = platformOrigin.replace(/\/$/, "");
  if (card.provider) card.provider = { ...card.provider, url: base };
  card.documentationUrl = "";
  card.iconUrl = undefined;
  card.signatures = [];
  card.supportedInterfaces = [
    {
      url: `${base}/agents/${agent.slug}/a2a/rest`,
      protocolBinding: "HTTP+JSON",
      protocolVersion: "1.0",
      tenant: "",
    },
    {
      url: `${base}/agents/${agent.slug}/a2a/jsonrpc`,
      protocolBinding: "JSONRPC",
      protocolVersion: "1.0",
      tenant: "",
    },
  ];
  card.securitySchemes = {
    PlatformApiKey: {
      scheme: {
        $case: "apiKeySecurityScheme",
        value: {
          description: "平台代理 API Key；由租户管理员在控制台创建。",
          location: "header",
          name: "X-API-Key",
        },
      },
    },
  };
  card.securityRequirements = [{ schemes: { PlatformApiKey: { list: [] } } }];
  card.skills = card.skills.map((skill) => ({
    ...skill,
    securityRequirements: [{ schemes: { PlatformApiKey: { list: [] } } }],
  }));
  card.capabilities = {
    ...card.capabilities,
    extendedAgentCard: true,
    extensions: (card.capabilities?.extensions ?? []).map((extension) => ({
      ...extension,
      params: undefined,
    })),
  };
  return card;
}

export async function checkAgent(
  agent: PlatformAgent,
): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const startedAt = performance.now();
  try {
    const card = await resolveRemoteCard(agent.cardUrl);
    selectCompatibleInterface(card);
    const latencyMs = Math.round(performance.now() - startedAt);
    await updateHealth(agent.id, true, latencyMs);
    return { ok: true, latencyMs };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - startedAt);
    const message = error instanceof Error ? error.message : "健康检查失败";
    await updateHealth(agent.id, false, latencyMs, message);
    return { ok: false, latencyMs, error: message };
  }
}

export function streamEventSummary(event: StreamResponse): {
  remoteTaskId?: string;
  contextId?: string;
  state?: string;
} {
  const payload = event.payload;
  if (!payload) return {};
  if (payload.$case === "task") {
    return {
      remoteTaskId: payload.value.id,
      contextId: payload.value.contextId,
      state: payload.value.status?.state?.toString(),
    };
  }
  if (payload.$case === "statusUpdate") {
    return {
      remoteTaskId: payload.value.taskId,
      contextId: payload.value.contextId,
      state: payload.value.status?.state?.toString(),
    };
  }
  if (payload.$case === "artifactUpdate") {
    return {
      remoteTaskId: payload.value.taskId,
      contextId: payload.value.contextId,
    };
  }
  return {
    remoteTaskId: payload.value.taskId,
    contextId: payload.value.contextId,
  };
}
