import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

const apiBase = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:8080";
const screenshots = path.resolve("artifacts/studio-product");
const adminHeaders = {
  Authorization: "Bearer dev-admin-token",
  "Content-Type": "application/json",
};

type Tenant = {
  id: string;
  slug: string;
  displayName: string;
  status: "active" | "suspended";
};

type Conversation = {
  id: string;
  title: string;
  agentSlug: string;
  status: "active" | "archived" | "deleted";
};

type Message = {
  id: string;
  sequence: number;
  role: "user" | "assistant" | "system";
  content: string;
};

function unique(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function apiJson<T>(
  request: APIRequestContext,
  route: string,
  init: {
    method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
    data?: unknown;
  } = {},
) {
  const response = await request.fetch(`${apiBase}${route}`, {
    method: init.method ?? "GET",
    headers: adminHeaders,
    data: init.data,
  });
  expect(response.ok(), `${init.method ?? "GET"} ${route}`).toBeTruthy();
  if (response.status() === 204) return undefined as T;
  return (await response.json()) as T;
}

async function getDefaultTenant(request: APIRequestContext) {
  const result = await apiJson<{ items: Tenant[] }>(
    request,
    "/api/admin/tenants?page=1&pageSize=100",
  );
  const tenant =
    result.items.find(
      (item) => item.slug === "default" && item.status === "active",
    ) ?? result.items.find((item) => item.status === "active");
  expect(tenant, "an active tenant is required for Studio").toBeTruthy();
  return tenant!;
}

async function createConversation(
  request: APIRequestContext,
  tenantId: string,
  title: string,
) {
  const result = await apiJson<{ conversation: Conversation }>(
    request,
    "/api/admin/studio-conversations",
    {
      method: "POST",
      data: { tenantId, agentSlug: "symbol-market", title },
    },
  );
  return result.conversation;
}

async function appendMessage(
  request: APIRequestContext,
  tenantId: string,
  conversationId: string,
  role: Message["role"],
  content: string,
) {
  const result = await apiJson<{ message: Message }>(
    request,
    `/api/admin/studio-conversations/${conversationId}/messages`,
    {
      method: "POST",
      data: {
        tenantId,
        role,
        content,
        status: "completed",
        clientRequestId: crypto.randomUUID(),
      },
    },
  );
  return result.message;
}

async function setConversationStatus(
  request: APIRequestContext,
  tenantId: string,
  conversationId: string,
  status: Conversation["status"],
) {
  await apiJson(request, `/api/admin/studio-conversations/${conversationId}`, {
    method: "PATCH",
    data: { tenantId, status },
  }).catch(() => undefined);
}

async function installAdminSession(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("a2a-admin-token", "dev-admin-token");
    localStorage.removeItem("a2a-studio-draft");
  });
}

async function openStudio(page: Page) {
  await page.goto("/debug");
  await expect(page.getByTestId("studio-workspace")).toBeVisible();
  await expect(page.getByRole("button", { name: "返回控制台" })).toBeVisible();
}

async function configureMarketAgent(page: Page, tenant: Tenant) {
  await page
    .getByRole("button", { name: "打开 Agent 调用配置" })
    .first()
    .click();
  const drawer = page.getByRole("dialog", { name: "Agent 调用配置" });
  await expect(drawer).toBeVisible();

  const tenantSelect = drawer.getByRole("combobox", { name: "调用租户" });
  await tenantSelect.click();
  await page.getByText(tenant.displayName, { exact: true }).last().click();

  const agentSelect = drawer.getByRole("combobox", { name: "调用 Agent" });
  await agentSelect.click();
  await page.getByText("Symbol 市场行情 Agent", { exact: true }).last().click();

  await drawer.getByRole("button", { name: "关闭 Agent 调用配置" }).click();
  await expect(drawer).toBeHidden();
}

async function findConversation(page: Page, conversation: Conversation) {
  const search = page.getByRole("textbox", { name: "搜索会话" });
  await search.fill(conversation.title);
  const row = page.locator(`[data-conversation-id="${conversation.id}"]`);
  await expect(row).toBeVisible();
  return row;
}

async function openConversation(page: Page, conversation: Conversation) {
  const row = await findConversation(page, conversation);
  await row.locator("button").first().click();
  await expect(
    page.locator(`[data-conversation-id="${conversation.id}"]`),
  ).toHaveClass(/historyItemActive/);
}

async function openRowMenu(row: Locator) {
  await row.getByRole("button", { name: /打开“.*”的会话操作/ }).click();
}

async function waitForReadyComposer(page: Page) {
  const composer = page.getByRole("textbox", { name: "给 Agent 发送消息" });
  await expect(composer).toBeEnabled({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "停止生成" })).toHaveCount(0);
  return composer;
}

test.beforeEach(async ({ page }) => {
  await installAdminSession(page);
  await mkdir(screenshots, { recursive: true });
});

test("Studio desktop and mobile geometry is full-viewport, readable and overflow-safe", async ({
  page,
}, testInfo) => {
  await openStudio(page);

  const layout = await page.evaluate(() => {
    const rect = (selector: string) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) return null;
      const box = element.getBoundingClientRect();
      return {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        right: box.right,
        bottom: box.bottom,
      };
    };
    const outside = [...document.querySelectorAll("button, input, textarea")]
      .filter((element) => {
        if (!(element instanceof HTMLElement)) return false;
        if (!element.offsetParent) return false;
        if (element.closest('[aria-label="会话管理"]')) return false;
        const box = element.getBoundingClientRect();
        return box.left < -1 || box.right > innerWidth + 1;
      })
      .map(
        (element) => element.getAttribute("aria-label") || element.textContent,
      );
    return {
      viewport: { width: innerWidth, height: innerHeight },
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      workspace: rect('[data-testid="studio-workspace"]'),
      history: rect('[aria-label="会话管理"]'),
      header: rect('[class*="studioHeader"]'),
      composer: rect('form[aria-label="消息输入区"]'),
      outside,
    };
  });

  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewport.width + 1);
  expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewport.width + 1);
  expect(layout.workspace?.width).toBeCloseTo(layout.viewport.width, 0);
  expect(layout.workspace?.height).toBeCloseTo(layout.viewport.height, 0);
  expect(layout.header?.height).toBeCloseTo(56, 0);
  expect(layout.composer?.right).toBeLessThanOrEqual(layout.viewport.width);
  expect(layout.composer?.bottom).toBeLessThanOrEqual(layout.viewport.height);
  expect(layout.outside).toEqual([]);

  if (testInfo.project.name.includes("mobile")) {
    await expect(
      page.getByRole("button", { name: "打开会话历史" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "打开会话菜单" }),
    ).toBeHidden();
    expect(layout.history?.right).toBeLessThanOrEqual(0);

    const topTargets = await page
      .getByRole("button", { name: /返回控制台|打开会话历史/ })
      .evaluateAll((buttons) =>
        buttons.map((button) => {
          const box = button.getBoundingClientRect();
          return { width: box.width, height: box.height };
        }),
      );
    expect(topTargets.every((box) => box.width >= 40 && box.height >= 40)).toBe(
      true,
    );

    const composerBefore = await page
      .getByRole("form", { name: "消息输入区" })
      .boundingBox();
    await page.getByRole("button", { name: "打开会话历史" }).click();
    const drawer = page.getByLabel("会话管理");
    await expect(drawer).toBeVisible();
    await expect
      .poll(() =>
        drawer.evaluate((element) =>
          Math.round(element.getBoundingClientRect().x),
        ),
      )
      .toBe(0);
    const drawerBox = await drawer.boundingBox();
    expect(drawerBox?.x).toBe(0);
    expect(drawerBox?.width).toBeLessThan(layout.viewport.width);
    const composerAfter = await page
      .getByRole("form", { name: "消息输入区" })
      .boundingBox();
    expect(composerAfter).toEqual(composerBefore);
    await page.screenshot({
      path: path.join(screenshots, "mobile-history-drawer.png"),
    });
    await drawer.getByRole("button", { name: "关闭会话历史" }).click();
    await expect(drawer).toBeHidden();
    await page.screenshot({
      path: path.join(screenshots, "mobile-empty-conversation.png"),
    });
  } else {
    expect(layout.history?.x).toBe(0);
    expect(layout.history?.width).toBeCloseTo(260, 0);
    expect(layout.composer?.width).toBeLessThanOrEqual(768);
    await page.screenshot({
      path: path.join(screenshots, "desktop-empty-conversation.png"),
    });
  }
});

test("switching conversations keeps the history list visible while the transcript loads", async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name.includes("mobile"),
    "desktop history regression",
  );
  const tenant = await getDefaultTenant(request);
  const current = await createConversation(
    request,
    tenant.id,
    unique("当前会话"),
  );
  const next = await createConversation(request, tenant.id, unique("切换会话"));
  let releaseDetail: () => void = () => undefined;
  const detailHeld = new Promise<void>((resolve) => {
    releaseDetail = resolve;
  });
  let detailRequested: () => void = () => undefined;
  const detailStarted = new Promise<void>((resolve) => {
    detailRequested = resolve;
  });
  const detailRoute = `**/api/admin/studio-conversations/${next.id}?*`;
  let releaseHistory: () => void = () => undefined;
  const historyHeld = new Promise<void>((resolve) => {
    releaseHistory = resolve;
  });
  let historyReloadCount = 0;

  try {
    await openStudio(page);
    await configureMarketAgent(page, tenant);
    await openConversation(page, current);
    const nextRow = await findConversation(page, next);
    await page.route("**/api/admin/studio-conversations?*", async (route) => {
      historyReloadCount += 1;
      await historyHeld;
      await route.continue().catch(() => undefined);
    });
    await page.route(detailRoute, async (route) => {
      detailRequested();
      await detailHeld;
      await route.continue().catch(() => undefined);
    });

    await nextRow.locator("button").first().click();
    await detailStarted;

    const historyList = page.locator('[class*="historyList"]').first();
    await expect(historyList).toHaveAttribute("aria-busy", "false");
    await expect(nextRow).toBeVisible();
    await expect(page.getByText("正在读取会话")).toHaveCount(0);
    await expect(nextRow.getByLabel("正在打开此会话")).toHaveCount(0);
    await expect(
      nextRow.getByRole("button", { name: `打开“${next.title}”的会话操作` }),
    ).toBeVisible();
    await expect(page.getByLabel("正在打开会话")).toBeVisible();
    await page.screenshot({
      path: path.join(
        screenshots,
        "desktop-history-switch-content-loading.png",
      ),
    });

    releaseDetail();
    await expect(nextRow).toHaveClass(/historyItemActive/);
    await expect(historyList).toHaveAttribute("aria-busy", "false");
    expect(historyReloadCount).toBe(0);
  } finally {
    releaseDetail();
    releaseHistory();
    await page.unroute("**/api/admin/studio-conversations?*");
    await page.unroute(detailRoute);
    await setConversationStatus(request, tenant.id, current.id, "deleted");
    await setConversationStatus(request, tenant.id, next.id, "deleted");
  }
});

test("desktop history UI performs rename, archive, restore, export and delete", async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name.includes("mobile"),
    "desktop history workflow",
  );
  test.setTimeout(60_000);
  const tenant = await getDefaultTenant(request);
  const conversation = await createConversation(
    request,
    tenant.id,
    unique("历史操作"),
  );
  await appendMessage(
    request,
    tenant.id,
    conversation.id,
    "user",
    "请整理这一轮历史操作验证。",
  );
  await appendMessage(
    request,
    tenant.id,
    conversation.id,
    "assistant",
    "会话已经保存，可以执行管理操作。",
  );

  try {
    await openStudio(page);
    await configureMarketAgent(page, tenant);
    let row = await findConversation(page, conversation);

    await openRowMenu(row);
    await page.getByRole("menuitem", { name: "重命名" }).click();
    const rename = row.getByRole("textbox", { name: /重命名/ });
    const renamedTitle = unique("已重命名会话");
    await rename.fill(renamedTitle);
    await rename.press("Enter");
    await expect(row).toContainText(renamedTitle);
    conversation.title = renamedTitle;

    await openRowMenu(row);
    await page.getByRole("menuitem", { name: "归档会话" }).click();
    await expect(row).toBeHidden();
    await page.getByRole("button", { name: "当前会话" }).click();
    row = await findConversation(page, conversation);
    await expect(page.getByRole("button", { name: "已归档" })).toBeVisible();

    await openRowMenu(row);
    await page.getByRole("menuitem", { name: "恢复会话" }).click();
    await expect(row).toBeHidden();
    await page.getByRole("button", { name: "已归档" }).click();
    row = await findConversation(page, conversation);
    await row.locator("button").first().click();

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "打开会话菜单" }).click();
    await page.getByRole("menuitem", { name: "导出会话" }).click();
    const exported = await download;
    expect(exported.suggestedFilename()).toMatch(/\.md$/);
    await expect(page.getByText("会话导出已开始")).toBeVisible();

    row = await findConversation(page, conversation);
    await openRowMenu(row);
    await page.getByRole("menuitem", { name: "删除" }).click();
    const dialog = page.getByRole("dialog", { name: "删除这个会话？" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /删\s*除/ }).click();
    await expect(dialog).toBeHidden();
    await expect(row).toBeHidden();
  } finally {
    await setConversationStatus(request, tenant.id, conversation.id, "deleted");
  }
});

test("message actions copy, edit with revision, branch, feedback and retry against real persistence", async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name.includes("mobile"),
    "desktop message workflow",
  );
  test.setTimeout(120_000);
  const tenant = await getDefaultTenant(request);
  const originalQuestion = "请分析 AAPL 的价格、新闻与主要风险。";
  const editedQuestion = "请分析 AAPL 的价格、新闻、估值与主要风险。";
  const conversation = await createConversation(
    request,
    tenant.id,
    unique("消息操作"),
  );
  await appendMessage(
    request,
    tenant.id,
    conversation.id,
    "user",
    originalQuestion,
  );
  await appendMessage(
    request,
    tenant.id,
    conversation.id,
    "assistant",
    "先检查价格趋势，再结合新闻和风险事件。",
  );

  try {
    await openStudio(page);
    await configureMarketAgent(page, tenant);
    await openConversation(page, conversation);

    const userMessage = page.locator('[data-message-role="user"]').last();
    const assistantMessage = page
      .locator('[data-message-role="assistant"]')
      .last();
    await userMessage.getByRole("button", { name: "复制消息" }).click();
    await expect(page.getByText("已复制到剪贴板")).toBeVisible();

    await assistantMessage.getByRole("button", { name: "有帮助" }).click();
    await expect(page.getByText("感谢你的反馈")).toBeVisible();

    await userMessage.getByRole("button", { name: "编辑并重新发送" }).click();
    const editor = userMessage.getByRole("textbox");
    await editor.fill(editedQuestion);
    await userMessage.getByRole("button", { name: "保存并重新发送" }).click();
    await waitForReadyComposer(page);
    await expect(
      page.locator('[data-message-role="user"]').last(),
    ).toContainText(editedQuestion);
    await expect(
      page.locator('[data-message-role="assistant"]').last(),
    ).not.toBeEmpty();

    const editedUser = page.locator('[data-message-role="user"]').last();
    await editedUser.getByRole("button", { name: "查看编辑记录" }).click();
    const revisions = page.getByRole("dialog", { name: "消息编辑记录" });
    await expect(revisions).toContainText(originalQuestion);
    await revisions.getByRole("button", { name: "关闭消息编辑记录" }).click();

    const editedAssistant = page
      .locator('[data-message-role="assistant"]')
      .last();
    await editedAssistant.getByRole("button", { name: "重新生成" }).click();
    await waitForReadyComposer(page);
    await expect(
      page.locator('[data-message-role="assistant"]').last(),
    ).not.toBeEmpty();

    await page.screenshot({
      path: path.join(screenshots, "desktop-conversation-actions.png"),
    });

    const retriedUser = page.locator('[data-message-role="user"]').last();
    await retriedUser.getByRole("button", { name: "从这里分支" }).click();
    await expect(page.getByText("已创建会话分支")).toBeVisible();
  } finally {
    await setConversationStatus(request, tenant.id, conversation.id, "deleted");
  }
});

test("stream stop, recovery, keyboard commands and error retry remain mutually consistent", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name.includes("mobile"),
    "desktop keyboard workflow",
  );
  test.setTimeout(60_000);
  await openStudio(page);
  const composer = page.getByRole("textbox", { name: "给 Agent 发送消息" });
  const send = page.getByRole("button", { name: "发送", exact: true });

  await expect(send).toBeDisabled();
  await page.keyboard.press("Control+/");
  const settings = page.getByRole("dialog", { name: "Agent 调用配置" });
  await expect(settings).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();

  await composer.fill("请开始分析 AAPL，并先给出一句简短结论。 ");
  await send.click();
  const stop = page.getByRole("button", { name: "停止生成" });
  await expect(stop).toBeVisible();
  await stop.click();
  await expect(stop).toHaveCount(0);
  await expect(composer).toBeEnabled();

  await page.route(
    "**/api/admin/studio/agents/*/a2a/rest/message:stream",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: 'data: {"error":{"code":"RETRYABLE","message":"可恢复的远端错误"}}\n\n',
      }),
  );
  await composer.fill("验证失败后继续发送");
  await send.click();
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("可恢复的远端错误");
  await expect(composer).toBeEnabled();
  await alert.getByRole("button", { name: "关闭" }).click();
  await expect(alert).toBeHidden();
  await page.unroute("**/api/admin/studio/agents/*/a2a/rest/message:stream");

  await page.keyboard.press("Control+Shift+N");
  await expect(page.locator('[data-message-role="user"]')).toHaveCount(0);
  await page.keyboard.press("Control+Shift+O");
  await expect(composer).toBeFocused();
});

test("mobile real conversation keeps the Composer visible and all primary actions touchable", async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "mobile-only real path");
  test.setTimeout(60_000);
  await openStudio(page);
  const composer = page.getByRole("textbox", { name: "给 Agent 发送消息" });
  await composer.fill("请用两句话说明 AAPL 研究应该先看哪些指标");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await waitForReadyComposer(page);

  const user = page.locator('[data-message-role="user"]').last();
  const assistant = page.locator('[data-message-role="assistant"]').last();
  await expect(user).toContainText("AAPL 研究");
  await expect(assistant).not.toBeEmpty();

  const geometry = await page.evaluate(() => {
    const composer = document.querySelector('form[aria-label="消息输入区"]');
    const user = document.querySelector('[data-message-role="user"] > div');
    const composerRect = composer?.getBoundingClientRect();
    const userRect = user?.getBoundingClientRect();
    return {
      width: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      composerBottom: composerRect?.bottom ?? 0,
      composerWidth: composerRect?.width ?? 0,
      userWidth: userRect?.width ?? 0,
    };
  });
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.width + 1);
  expect(geometry.composerBottom).toBeLessThanOrEqual(812);
  expect(geometry.composerWidth).toBeLessThanOrEqual(geometry.width - 20);
  expect(geometry.userWidth).toBeLessThan(geometry.width * 0.9);

  const actions = user.getByRole("button");
  const boxes = await actions.evaluateAll((buttons) =>
    buttons.map((button) => {
      const box = button.getBoundingClientRect();
      return { width: box.width, height: box.height };
    }),
  );
  expect(boxes.length).toBeGreaterThan(0);
  expect(boxes.every((box) => box.width >= 38 && box.height >= 38)).toBe(true);
  await page.screenshot({
    path: path.join(screenshots, "mobile-real-conversation.png"),
  });
});
