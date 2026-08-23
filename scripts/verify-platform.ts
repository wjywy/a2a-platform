const consoleOrigin = process.env.CONSOLE_ORIGIN ?? "http://localhost:5173";
const gatewayOrigin = process.env.GATEWAY_ORIGIN ?? "http://localhost:8080";
const adminToken = process.env.PLATFORM_DEV_TOKEN ?? "dev-admin-token";

type Check = { name: string; ok: boolean; detail: string };
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

for (const item of checks) {
  console.log(
    `${item.ok ? "PASS" : "FAIL"}  ${item.name.padEnd(28)} ${item.detail}`,
  );
}

const failures = checks.filter((item) => !item.ok);
if (failures.length) {
  console.error(
    `Platform verification failed: ${failures.length}/${checks.length} checks failed.`,
  );
  process.exitCode = 1;
} else {
  console.log(
    `Platform verification passed: ${checks.length}/${checks.length} checks.`,
  );
}
