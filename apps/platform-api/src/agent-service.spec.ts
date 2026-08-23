import { describe, expect, it } from "vitest";
import type { AgentCard } from "@a2a-js/sdk";
import {
  normalizeLocalDevelopmentEndpoints,
  platformCard,
  selectCompatibleInterface,
} from "./agent-service.js";
import type { PlatformAgent } from "./types.js";

const remoteCard = {
  name: "Stock Expert",
  description: "market analysis",
  version: "1.0.0",
  capabilities: {
    streaming: true,
    pushNotifications: false,
    extendedAgentCard: false,
    extensions: [],
  },
  defaultInputModes: ["text/plain"],
  defaultOutputModes: ["text/plain"],
  skills: [],
  supportedInterfaces: [
    {
      url: "https://remote.example/a2a",
      protocolBinding: "JSONRPC",
      protocolVersion: "1.0",
      tenant: "",
    },
  ],
} as unknown as AgentCard;

const agent: PlatformAgent = {
  id: "agent-1",
  slug: "stock-expert",
  displayName: "股票专家",
  cardUrl: "https://remote.example/.well-known/agent-card.json",
  cardSnapshot: remoteCard,
  selectedInterface: remoteCard.supportedInterfaces![0],
  status: "online",
  healthStatus: "healthy",
  labels: ["finance"],
  version: 1,
  description: "",
  visibility: "private",
  allowedTenantIds: [],
  invocationPolicy: { timeoutMs: 60000, maxRetries: 0, maxConcurrent: 20 },
  routingStrategy: "weighted_round_robin",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("platform agent gateway", () => {
  it("only exposes platform REST and JSON-RPC addresses, never the remote interface", () => {
    const unsafeAgent = {
      ...agent,
      cardSnapshot: {
        ...remoteCard,
        iconUrl: "http://private.example/icon.png?token=secret",
        signatures: [
          {
            protected: "private-header",
            signature: "private-signature",
            header: undefined,
          },
        ],
        capabilities: {
          ...remoteCard.capabilities,
          extensions: [
            {
              uri: "urn:example:extension",
              description: "private routing extension",
              required: false,
              params: {
                upstreamUrl: "http://private.example",
                token: "secret",
              },
            },
          ],
        },
      },
    } as PlatformAgent;
    const card = platformCard(unsafeAgent, "https://hub.example/");
    expect(card.supportedInterfaces).toEqual([
      {
        url: "https://hub.example/agents/stock-expert/a2a/rest",
        protocolBinding: "HTTP+JSON",
        protocolVersion: "1.0",
        tenant: "",
      },
      {
        url: "https://hub.example/agents/stock-expert/a2a/jsonrpc",
        protocolBinding: "JSONRPC",
        protocolVersion: "1.0",
        tenant: "",
      },
    ]);
    expect(card.iconUrl).toBeUndefined();
    expect(card.signatures).toEqual([]);
    expect(card.capabilities?.extensions[0].params).toBeUndefined();
    expect(JSON.stringify(card)).not.toContain("private.example");
    expect(JSON.stringify(card)).not.toContain("secret");
  });

  it("accepts a compatible remote interface and rejects unsupported cards", () => {
    expect(selectCompatibleInterface(remoteCard).protocolBinding).toBe(
      "JSONRPC",
    );
    expect(() =>
      selectCompatibleInterface({ ...remoteCard, supportedInterfaces: [] }),
    ).toThrow("没有平台可代理");
  });

  it("rewrites localhost interfaces only when the Card itself is reached through the Docker host alias", () => {
    const localCard = {
      ...remoteCard,
      supportedInterfaces: [
        {
          ...remoteCard.supportedInterfaces![0],
          url: "http://localhost:41241/a2a",
        },
      ],
    };
    expect(
      normalizeLocalDevelopmentEndpoints(
        localCard,
        "http://host.docker.internal:41241/.well-known/agent-card.json",
      ).supportedInterfaces?.[0].url,
    ).toBe("http://host.docker.internal:41241/a2a");
    expect(
      normalizeLocalDevelopmentEndpoints(
        localCard,
        "http://localhost:41241/.well-known/agent-card.json",
      ).supportedInterfaces?.[0].url,
    ).toBe("http://localhost:41241/a2a");
  });
});
