import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }, testInfo) => {
  if (
    testInfo.title.includes("invited developer") ||
    testInfo.title.includes("self-registered customer")
  )
    return;
  await page.addInitScript(() =>
    localStorage.setItem("a2a-admin-token", "dev-admin-token"),
  );
});

const adminHeaders = {
  Authorization: "Bearer dev-admin-token",
  "Content-Type": "application/json",
};

test("self-registered customer can sign up, browse the safe public catalog, and log in again", async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name.includes("mobile"),
    "the complete registration journey is exercised once at desktop width",
  );
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-register-${suffix}@example.test`;
  const password = "E2e-Self-Register!2026";
  let userId = "";
  let originalAgent:
    | {
        visibility: "private" | "tenant" | "public";
        allowedTenantIds: string[];
      }
    | undefined;
  try {
    const agentResponse = await request.get(
      "http://127.0.0.1:8080/api/admin/agents/stock-expert",
      { headers: adminHeaders },
    );
    expect(agentResponse.ok()).toBeTruthy();
    originalAgent = (await agentResponse.json()).agent;
    const publishResponse = await request.patch(
      "http://127.0.0.1:8080/api/admin/agents/stock-expert",
      {
        headers: adminHeaders,
        data: { visibility: "public" },
      },
    );
    expect(publishResponse.ok()).toBeTruthy();

    await page.goto("/");
    await page.getByRole("button", { name: "没有账号？立即注册" }).click();
    await expect(
      page.getByRole("heading", { name: "创建平台账号" }),
    ).toBeVisible();
    await page.getByLabel("显示名称").fill("E2E Self Registered");
    await page.getByLabel("邮箱").fill(email);
    await page.getByLabel("设置密码（至少 12 位）").fill(password);
    await page.getByLabel("确认密码").fill(password);
    await page.getByRole("button", { name: "注册并登录" }).click();

    await expect(
      page.getByRole("heading", { name: "Agent 目录", level: 1 }),
    ).toBeVisible();
    await expect(page.getByText("股票专家").first()).toBeVisible();
    await expect(page.getByText("公开可见")).toBeVisible();
    await page.getByRole("button", { name: /股票专家/ }).click();
    await expect(
      page.getByTitle(
        "http://localhost:8080/agents/stock-expert/.well-known/agent-card.json",
      ).last(),
    ).toBeVisible();
    await expect(page.getByText(/host\.docker\.internal/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /注册 Agent/ })).toHaveCount(
      0,
    );
    await expect(page.getByText("后端实例", { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "退出登录" }).click();
    await expect(
      page.getByRole("heading", { name: "登录控制台" }),
    ).toBeVisible();
    await page.getByLabel("邮箱").fill(email);
    await page.getByLabel("密码").fill(password);
    await page.getByRole("button", { name: "登录" }).click();
    await expect(
      page.getByRole("heading", { name: "Agent 目录", level: 1 }),
    ).toBeVisible();
  } finally {
    if (originalAgent) {
      await request.patch(
        "http://127.0.0.1:8080/api/admin/agents/stock-expert",
        {
          headers: adminHeaders,
          data: {
            visibility: originalAgent.visibility,
            allowedTenantIds: originalAgent.allowedTenantIds,
          },
        },
      );
    }
    const usersResponse = await request.get(
      "http://127.0.0.1:8080/api/admin/users",
      { headers: adminHeaders },
    );
    if (usersResponse.ok()) {
      const users = (await usersResponse.json()).users as Array<{
        id: string;
        email: string;
      }>;
      userId = users.find((user) => user.email === email)?.id ?? "";
    }
    if (userId) {
      await request.post(
        `http://127.0.0.1:8080/api/admin/users/${userId}/status`,
        { headers: adminHeaders, data: { status: "disabled" } },
      );
    }
  }
});

test("invited developer can activate an account and sees role-appropriate actions", async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name.includes("mobile"),
    "the invitation workflow is exercised once at desktop width",
  );
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-developer-${suffix}@example.test`;
  let tenantId = "";
  let userId = "";
  try {
    const tenantResponse = await request.post(
      "http://127.0.0.1:8080/api/admin/tenants",
      {
        headers: adminHeaders,
        data: {
          slug: `e2e-${suffix}`.toLowerCase(),
          displayName: `E2E 客户空间 ${suffix}`,
          description: "Playwright invitation and authorization isolation test",
        },
      },
    );
    expect(tenantResponse.ok()).toBeTruthy();
    tenantId = (await tenantResponse.json()).tenant.id as string;

    const invitationResponse = await request.post(
      `http://127.0.0.1:8080/api/admin/tenants/${tenantId}/members/invite`,
      {
        headers: adminHeaders,
        data: {
          email,
          displayName: "E2E Developer",
          role: "developer",
          expiresInHours: 1,
        },
      },
    );
    expect(invitationResponse.ok()).toBeTruthy();
    const invitationToken = (await invitationResponse.json())
      .invitationToken as string;

    await page.goto(`/invite/${invitationToken}`);
    await expect(
      page.getByRole("heading", { name: "激活你的账号" }),
    ).toBeVisible();
    await expect(page.getByText(/developer 身份加入/)).toBeVisible();
    await page.getByLabel("显示名称").fill("E2E Developer");
    await page.getByLabel("设置密码（至少 12 位）").fill("E2e-Developer!2026");
    await page.getByLabel("确认密码").fill("E2e-Developer!2026");
    await page.getByRole("button", { name: "激活并加入" }).click();

    await expect(page.getByRole("heading", { name: "运行概览" })).toBeVisible();
    await expect(page.getByText("developer", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "平台设置", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Webhook", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Webhook 端点" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "创建 Webhook" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "轮换密钥" })).toHaveCount(0);
  } finally {
    if (tenantId) {
      await request.post(
        `http://127.0.0.1:8080/api/admin/tenants/${tenantId}/status`,
        { headers: adminHeaders, data: { status: "suspended" } },
      );
      await request.delete(
        `http://127.0.0.1:8080/api/admin/tenants/${tenantId}`,
        { headers: adminHeaders },
      );
    }
    const usersResponse = await request.get(
      "http://127.0.0.1:8080/api/admin/users",
      { headers: adminHeaders },
    );
    if (usersResponse.ok()) {
      const users = (await usersResponse.json()).users as Array<{
        id: string;
        email: string;
      }>;
      userId = users.find((user) => user.email === email)?.id ?? "";
    }
    if (userId) {
      await request.post(
        `http://127.0.0.1:8080/api/admin/users/${userId}/status`,
        { headers: adminHeaders, data: { status: "disabled" } },
      );
    }
  }
});

test("all primary console pages are reachable and render real content", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name.includes("mobile"),
    "desktop navigation is verified in this scenario",
  );
  await page.goto("/overview");
  await expect(page.getByText("A2A Hub")).toBeVisible();
  await expect(page.getByRole("heading", { name: "运行概览" })).toBeVisible();
  await expect(page.getByText("正在加载数据")).toBeHidden();

  const pages = [
    ["租户管理", "租户列表", "/tenants"],
    ["成员与角色", "成员与角色", "/members"],
    ["Agent 管理", "Agent 列表", "/agents"],
    ["在线调试", "请求配置", "/debug"],
    ["任务中心", "任务列表", "/tasks"],
    ["用量分析", "用量趋势", "/usage"],
    ["Webhook", "Webhook 端点", "/webhooks"],
    ["告警中心", "活动告警", "/alerts"],
    ["审计中心", "操作审计", "/audit"],
    ["平台设置", "平台参数", "/settings"],
  ] as const;
  for (const [navigation, heading, path] of pages) {
    await page.getByRole("button", { name: navigation, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    if (path === "/debug") {
      await expect(
        page.getByRole("button", { name: "返回控制台" }),
      ).toBeVisible();
      await expect(
        page.getByPlaceholder("给 Agent 发送消息…"),
      ).toBeVisible();
      await page.goto("/overview");
      await expect(page.getByRole("heading", { name: "运行概览" })).toBeVisible();
      continue;
    }
    await expect(
      page.getByRole("heading", { name: heading, exact: true, level: 2 }),
    ).toBeVisible();
    await expect(page.getByText("加载失败")).toBeHidden();
  }
});

test("history routes support legacy links, direct refresh and browser back", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name.includes("mobile"),
    "history navigation is exercised once at desktop width",
  );
  await page.goto("/#/agents");
  await expect(page).toHaveURL(/\/agents$/);
  await expect(page.getByRole("heading", { name: "Agent 列表" })).toBeVisible();

  await page.goto("/overview");
  await page.getByRole("button", { name: "Agent 管理", exact: true }).click();
  await expect(page).toHaveURL(/\/agents$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/overview$/);
  await expect(page.getByRole("heading", { name: "运行概览" })).toBeVisible();

  await page.goto("/agents/");
  await expect(page).toHaveURL(/\/agents$/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Agent 列表" })).toBeVisible();
});

test("tenant and Agent data survive the platform upgrade", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name.includes("mobile"),
    "data table is verified at desktop width",
  );
  await page.goto("/tenants");
  await page.getByPlaceholder("搜索租户名称或标识").fill("默认租户");
  await expect(
    page.getByRole("strong").filter({ hasText: "默认租户" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Agent 管理", exact: true }).click();
  await expect(page.getByText("股票专家").first()).toBeVisible();
  await expect(page.getByText("stock-expert").first()).toBeVisible();
});

test("375px mobile layout exposes the compact navigation without horizontal page overflow", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name.includes("desktop"),
    "mobile-only responsive assertion",
  );
  await page.goto("/overview");
  await expect(page.getByRole("heading", { name: "运行概览" })).toBeVisible();
  await expect(page.getByText("概览", { exact: true }).last()).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(
    dimensions.clientWidth + 1,
  );
  await page.getByText("任务", { exact: true }).last().click();
  await expect(page.getByRole("heading", { name: "任务中心" })).toBeVisible();
  await page.getByText("租户", { exact: true }).last().click();
  await expect(page.getByRole("heading", { name: "租户管理" })).toBeVisible();
});

test("Agent registration dialog contains operational fields and can be dismissed", async ({
  page,
}) => {
  await page.goto("/agents");
  await page
    .getByRole("button", { name: /注册 Agent/ })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "注册 A2A Agent" }),
  ).toBeVisible();
  await expect(page.getByText("Agent Card 完整 URL")).toBeVisible();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("所属租户")).toBeVisible();
  await page.getByRole("button", { name: "关闭" }).click();
  await expect(
    page.getByRole("heading", { name: "注册 A2A Agent" }),
  ).toBeHidden();
});

test("debug studio keeps its server-side configuration drawer after refresh", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name.includes("mobile"),
    "the configuration drawer is intentionally desktop-only",
  );
  await page.goto("/debug");
  await page.getByRole("button", { name: "打开 Agent 调用配置" }).click();
  const drawer = page.getByLabel("Agent 调用配置", { exact: true });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("服务端安全代理")).toBeVisible();
  await drawer
    .getByRole("button", { name: "关闭 Agent 调用配置" })
    .click();
  await expect(drawer).toBeHidden();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "返回控制台" }),
  ).toBeVisible();
  await expect(page.getByPlaceholder("给 Agent 发送消息…")).toBeVisible();
});
