import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

const adminHeaders = {
  Authorization: "Bearer dev-admin-token",
  "Content-Type": "application/json",
};
const apiBase = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:8080";

type Tenant = { id: string; displayName: string };
type Conversation = { id: string; title: string; agentSlug: string };
type Message = { id: string; sequence: number; content: string };

function suffix() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function adminJson<T>(
  request: APIRequestContext,
  path: string,
  init: {
    method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
    data?: unknown;
  } = {},
): Promise<T> {
  const response = await request.fetch(`${apiBase}${path}`, {
    method: init.method ?? "GET",
    headers: adminHeaders,
    data: init.data,
  });
  expect(response.ok(), `${init.method ?? "GET"} ${path}`).toBeTruthy();
  if (response.status() === 204) return undefined as T;
  return (await response.json()) as T;
}

async function defaultTenant(request: APIRequestContext) {
  const value = await adminJson<{ items: Tenant[] }>(
    request,
    "/api/admin/tenants?page=1&pageSize=100",
  );
  expect(value.items.length).toBeGreaterThan(0);
  return value.items[0];
}

async function createConversation(
  request: APIRequestContext,
  tenantId: string,
  title: string,
): Promise<Conversation> {
  const value = await adminJson<{ conversation: Conversation }>(
    request,
    "/api/admin/studio-conversations",
    {
      method: "POST",
      data: { tenantId, agentSlug: "symbol-market", title },
    },
  );
  return value.conversation;
}

async function appendMessage(
  request: APIRequestContext,
  conversationId: string,
  tenantId: string,
  input: {
    role: "user" | "assistant";
    content: string;
    clientRequestId?: string;
  },
): Promise<Message> {
  const value = await adminJson<{ message: Message }>(
    request,
    `/api/admin/studio-conversations/${conversationId}/messages`,
    { method: "POST", data: { tenantId, status: "completed", ...input } },
  );
  return value.message;
}

async function installAdminSession(page: Page) {
  await page.addInitScript(() =>
    localStorage.setItem("a2a-admin-token", "dev-admin-token"),
  );
}

test.beforeEach(async ({ page }) => installAdminSession(page));

test("Agent Studio renders a compact conversation workspace without horizontal overflow", async ({
  page,
}, testInfo) => {
  await page.goto("/debug");
  if (testInfo.project.name.includes("mobile")) {
    await expect(
      page.getByRole("button", { name: "打开会话历史" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "打开会话历史" }).click();
    const historyDrawer = page.getByLabel("会话管理");
    await expect(historyDrawer).toBeVisible();
    await expect
      .poll(() =>
        historyDrawer.evaluate((element) =>
          Math.round(element.getBoundingClientRect().left),
        ),
      )
      .toBe(0);
    await expect(page.getByPlaceholder("搜索会话")).toBeVisible();
    await page.getByRole("button", { name: "关闭会话历史" }).first().click();
    await expect(page.getByPlaceholder("搜索会话")).toBeHidden();
  } else {
    await expect(
      page.getByLabel("会话管理").getByText("会话", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "新建对话" }).first(),
    ).toBeVisible();
  }
  await expect(page.getByRole("button", { name: /发送/ })).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);

});

test("authenticated Studio sends a real message and keeps the user bubble content-sized", async ({
  page,
}) => {
  await page.goto("/debug");
  const composer = page.getByPlaceholder("给 Agent 发送消息…");
  await expect(composer).toBeEnabled();
  await composer.fill("请分析 AAPL 的近期走势、关键风险和需要关注的指标");
  await page.getByRole("button", { name: "发送" }).click();

  const userMessage = page.locator('[class*="studioUserMessage"]').last();
  await expect(userMessage).toContainText("分析 AAPL 的近期走势");
  const bounds = await userMessage.boundingBox();
  expect(bounds, "user bubble should be rendered").not.toBeNull();
  expect(bounds!.height).toBeLessThan(220);

  // The composer is disabled while the stream is active and becomes usable
  // again only after the server sends a terminal task state.
  await expect(composer).toBeEnabled({ timeout: 25_000 });
  const agentMessage = page.locator('[class*="studioAgentMessage"]').last();
  await expect(agentMessage.locator('[class*="markdownDocument"]')).not.toBeEmpty();
});

test("Studio closes a failed SSE stream and restores the composer", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "desktop interaction runs once");
  await page.goto("/debug");
  await page.route(
    "**/api/admin/studio/agents/*/a2a/rest/message:stream",
    async (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: 'data: {"error":{"code":"REMOTE_STREAM_ERROR","message":"模拟远端 Agent 失败"}}\n\n',
      }),
  );
  const composer = page.getByPlaceholder("给 Agent 发送消息…");
  await composer.fill("触发失败流");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByRole("alert")).toContainText("模拟远端 Agent 失败");
  await expect(composer).toBeEnabled();
  await expect(page.getByRole("button", { name: "停止" })).toHaveCount(0);
});

test("conversation lifecycle endpoints retain history, idempotency, labels and export", async ({
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name.includes("mobile"),
    "server contract runs once",
  );
  const tenant = await defaultTenant(request);
  const title = `Playwright 会话 ${suffix()}`;
  const conversation = await createConversation(request, tenant.id, title);
  const requestId = crypto.randomUUID();
  const first = await appendMessage(request, conversation.id, tenant.id, {
    role: "user",
    content: "请分析今天的市场风险",
    clientRequestId: requestId,
  });
  const duplicate = await appendMessage(request, conversation.id, tenant.id, {
    role: "user",
    content: "请分析今天的市场风险",
    clientRequestId: requestId,
  });
  expect(duplicate.id).toBe(first.id);
  const assistant = await appendMessage(request, conversation.id, tenant.id, {
    role: "assistant",
    content: "我会先区分价格、新闻和事件风险。",
  });
  expect(assistant.sequence).toBe(2);

  const labelName = `待复核-${suffix()}`;
  const label = await adminJson<{ label: { id: string; name: string } }>(
    request,
    "/api/admin/studio-labels",
    {
      method: "POST",
      data: { tenantId: tenant.id, name: labelName, color: "gold" },
    },
  );
  const assigned = await adminJson<{ labels: Array<{ id: string }> }>(
    request,
    `/api/admin/studio-conversations/${conversation.id}/labels`,
    {
      method: "PUT",
      data: { tenantId: tenant.id, labelIds: [label.label.id] },
    },
  );
  expect(assigned.labels.map((item) => item.id)).toContain(label.label.id);

  const filtered = await adminJson<{ items: Conversation[] }>(
    request,
    `/api/admin/studio-conversations?tenantId=${tenant.id}&agentSlug=symbol-market&labelId=${label.label.id}`,
  );
  expect(filtered.items.map((item) => item.id)).toContain(conversation.id);

  const exported = await request.get(
    `${apiBase}/api/admin/studio-conversations/${conversation.id}/export?tenantId=${tenant.id}&format=markdown`,
    { headers: adminHeaders },
  );
  expect(exported.ok()).toBeTruthy();
  expect(await exported.text()).toContain(title);
  expect(exported.headers()["content-disposition"]).toContain("attachment");
});

test("restoring a saved conversation keeps the user-visible transcript and exposes management controls", async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name.includes("mobile"),
    "workspace selection runs once",
  );
  const tenant = await defaultTenant(request);
  const title = `恢复会话 ${suffix()}`;
  const conversation = await createConversation(request, tenant.id, title);
  await appendMessage(request, conversation.id, tenant.id, {
    role: "user",
    content: "我想从自然语言开始研究一个标的",
  });
  await appendMessage(request, conversation.id, tenant.id, {
    role: "assistant",
    content: "请告诉我标的、时间范围或关注的风险。",
  });

  await page.goto("/debug");
  await page.getByRole("button", { name: "打开 Agent 调用配置" }).click();
  const studio = page.getByLabel("Agent 调用配置");
  await studio.getByRole("combobox").first().click();
  await page.getByText(tenant.displayName, { exact: true }).last().click();
  await studio.getByRole("combobox").nth(1).click();
  await page.getByText("Symbol 市场行情 Agent", { exact: true }).last().click();
  await studio.getByRole("button", { name: "关闭 Agent 调用配置" }).click();
  const search = page.getByPlaceholder("搜索会话");
  await search.fill(title);
  await expect(page.getByRole("button", { name: title })).toBeVisible();
  await page.getByRole("button", { name: title }).click();
  const transcript = page.getByLabel("Agent 对话");
  await expect(
    transcript.getByText("我想从自然语言开始研究一个标的"),
  ).toBeVisible();
  await expect(
    transcript.getByText("请告诉我标的、时间范围或关注的风险。"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "导出会话" })).toBeVisible();
  await expect(page.getByRole("button", { name: /标签/ })).toBeVisible();
});
