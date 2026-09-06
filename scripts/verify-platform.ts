import { LongbridgeProvider } from "../apps/platform-api/src/longbridge-provider.js";
import { analyzeGamma } from "../apps/platform-api/src/option-gamma-service.js";
import { verifySymbolRouting } from "./verify-symbol-routing.js";

const consoleOrigin = process.env.CONSOLE_ORIGIN ?? "http://localhost:5173";
const gatewayOrigin = process.env.GATEWAY_ORIGIN ?? "http://localhost:8080";
const adminToken = process.env.PLATFORM_DEV_TOKEN ?? "dev-admin-token";

type Check = { name: string; ok: boolean; skipped?: boolean; detail: string };
const checks: Check[] = [];

async function check(name: string, operation: () => Promise<string>) {
  try {
    checks.push({ name, ok: true, detail: await operation() });
  } catch (error) {
    checks.push({
      name,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

async function json(path: string, authenticated = false) {
  const response = await fetch(`${gatewayOrigin}${path}`, {
    headers: authenticated
      ? { Authorization: `Bearer ${adminToken}` }
      : undefined,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(`${response.status} ${JSON.stringify(body)}`);
  return body as Record<string, unknown>;
}

await check("Console HTML", async () => {
  const response = await fetch(consoleOrigin);
  const html = await response.text();
  if (!response.ok || !html.includes('<div id="root">')) {
    throw new Error(`unexpected console response ${response.status}`);
  }
  return `${response.status} ${response.headers.get("content-type")}`;
});

await check("Gateway health", async () => {
  const body = await json("/healthz");
  if (body.ok !== true)
    throw new Error("health payload did not report ok=true");
  return `${body.service} at ${body.time}`;
});

await check("Admin authentication", async () => {
  const response = await fetch(`${gatewayOrigin}/api/admin/session`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const body = await response.json();
  if (!response.ok || body.principal?.platformRole !== "platform_admin") {
    throw new Error(`${response.status} ${JSON.stringify(body)}`);
  }
  return `${body.principal.id} (${body.principal.platformRole})`;
});

await check("Default tenant migration", async () => {
  const body = await json("/api/admin/tenants?page=1&pageSize=100", true);
  const items = body.items as Array<{ slug: string; displayName: string }>;
  const tenant = items.find((item) => item.slug === "default");
  if (!tenant) throw new Error("default tenant is missing");
  return `${tenant.displayName} (${tenant.slug})`;
});

await check("Preserved stock-expert Agent", async () => {
  const body = await json("/api/admin/agents?search=stock-expert", true);
  const agents = body.agents as Array<{
    slug: string;
    status: string;
    tenantId?: string;
  }>;
  const agent = agents.find((item) => item.slug === "stock-expert");
  if (!agent) throw new Error("stock-expert registration is missing");
  if (!agent.tenantId)
    throw new Error("stock-expert was not assigned to the default tenant");
  return `${agent.slug} status=${agent.status}`;
});

const symbolAgentSlugs = [
  "symbol-market",
  "symbol-company",
  "symbol-technical-options",
  "symbol-news",
  "symbol-risk",
  "symbol-critic",
  "symbol-supervisor",
];

await check("Built-in Symbol Agents", async () => {
  const body = await json("/api/admin/agents?search=symbol-", true);
  const agents = body.agents as Array<{ slug: string; status: string }>;
  const found = new Map(agents.map((agent) => [agent.slug, agent]));
  const missing = symbolAgentSlugs.filter((slug) => !found.has(slug));
  if (missing.length) throw new Error(`missing=${missing.join(",")}`);
  return symbolAgentSlugs
    .map((slug) => `${slug}:${found.get(slug)?.status ?? "unknown"}`)
    .join(" ");
});

await check("Built-in Symbol Cards", async () => {
  for (const slug of symbolAgentSlugs) {
    const body = await json(`/api/builtin/symbol/${slug}/.well-known/agent-card.json`);
    const interfaces = body.supportedInterfaces as Array<{ url?: string }>;
    if (!Array.isArray(interfaces) || !interfaces.some((item) => item.url?.endsWith(`/api/builtin/symbol/${slug}`)))
      throw new Error(`${slug} card interface is invalid`);
  }
  return `${symbolAgentSlugs.length} cards discoverable`;
});

await check("Longbridge configuration status", async () => {
  const tenants = await json("/api/admin/tenants?page=1&pageSize=100", true);
  const items = tenants.items as Array<{ id: string; slug: string }>;
  const tenant = items.find((item) => item.slug === "default");
  if (!tenant) throw new Error("default tenant is missing");
  const body = await json(
    `/api/admin/tenants/${tenant.id}/market-data/longbridge`,
    true,
  );
  const summary = body.summary as {
    configured?: boolean;
    source?: string;
    status?: string;
  };
  return `configured=${Boolean(summary.configured)} source=${summary.source ?? "none"} status=${summary.status ?? "unknown"}`;
});

const longbridgeConfigured = Boolean(
  process.env.LONGBRIDGE_APP_KEY &&
    process.env.LONGBRIDGE_APP_SECRET &&
    process.env.LONGBRIDGE_ACCESS_TOKEN,
);
if (!longbridgeConfigured) {
  checks.push({
    name: "Longbridge AAPL smoke",
    ok: false,
    skipped: true,
    detail: "未配置服务端 Longbridge API-key，smoke 未执行。",
  });
} else {
  await check("Longbridge AAPL smoke", async () => {
    const provider = new LongbridgeProvider();
    const context = {
      tenantId: process.env.LONGBRIDGE_SMOKE_TENANT_ID ?? "smoke",
      agentSlug: "symbol-market",
      requestId: `verify-${Date.now()}`,
    };
    const quote = await provider.getQuote("AAPL", context);
    if (quote.meta.status !== "available" || quote.price === undefined)
      return `DEGRADED quote=${quote.meta.status} permission=${quote.meta.permission} freshness=${quote.meta.freshness}`;
    const chain = await provider.getOptionChain("AAPL", {
      ...context,
      spot: quote.price,
      asOf: quote.meta.asOf,
    });
    const optionQuotes = await provider.getOptionQuotes(
      chain.contracts.map((contract) => contract.symbol),
      { ...context, spot: quote.price, asOf: quote.meta.asOf },
    );
    const gamma = analyzeGamma({
      spot: quote.price,
      quotes: optionQuotes.quotes,
      asOf: optionQuotes.meta.asOf ?? quote.meta.asOf ?? new Date().toISOString(),
    });
    return `quote=${quote.meta.status}/${quote.meta.freshness} option=${optionQuotes.meta.status}/${optionQuotes.meta.permission} contracts=${optionQuotes.quotes.length} gammaContracts=${gamma.perContract.length}`;
  });
}

if (process.env.SYMBOL_ROUTING_SMOKE === "true") checks.push(...await verifySymbolRouting());

for (const item of checks) {
  console.log(
    `${item.skipped ? "SKIP" : item.ok ? "PASS" : "FAIL"}  ${item.name.padEnd(28)} ${item.detail}`,
  );
}

const failures = checks.filter((item) => !item.ok && !item.skipped);
if (failures.length) {
  console.error(
    `Platform verification failed: ${failures.length}/${checks.length} checks failed.`,
  );
  process.exitCode = 1;
} else {
  const skipped = checks.filter((item) => item.skipped).length;
  console.log(
    `Platform verification passed: ${checks.length - skipped}/${checks.length - skipped} checks${skipped ? `; ${skipped} skipped.` : "."}`,
  );
}
