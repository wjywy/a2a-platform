import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

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
const testApiBaseUrl = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:8080";

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
      page
        .getByTitle(
          "http://localhost:8080/agents/stock-expert/.well-known/agent-card.json",
        )
        .last(),
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
  await expect(page.getByText("正在加载数据").last()).toBeHidden();

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
      await expect(page.getByPlaceholder("给 Agent 发送消息…")).toBeVisible();
      await page.goto("/overview");
      await expect(
        page.getByRole("heading", { name: "运行概览" }),
      ).toBeVisible();
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
  await page
    .getByRole("button", { name: "打开 Agent 调用配置" })
    .first()
    .click();
  const drawer = page.getByLabel("Agent 调用配置", { exact: true });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("服务端安全代理")).toBeVisible();
  await drawer.getByRole("button", { name: "关闭 Agent 调用配置" }).click();
  await expect(drawer).toBeHidden();
  await page.reload();
  await expect(page.getByRole("button", { name: "返回控制台" })).toBeVisible();
  await expect(page.getByPlaceholder("给 Agent 发送消息…")).toBeVisible();
});

test("desktop console keeps visited page state and avoids duplicate reloads", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name.includes("mobile"),
    "desktop sidebar regression",
  );
  await page.goto("/overview");
  await expect(page.getByRole("heading", { name: "运行概览" })).toBeVisible();

  await page.getByRole("button", { name: "Agent 管理", exact: true }).click();
  await page.getByPlaceholder("名称、slug 或标签").fill("symbol-market");
  await page.getByRole("button", { name: "任务中心", exact: true }).click();
  await expect(page.getByRole("heading", { name: "任务中心" })).toBeVisible();
  await page.getByRole("button", { name: "Agent 管理", exact: true }).click();
  await expect(page.getByPlaceholder("名称、slug 或标签")).toHaveValue(
    "symbol-market",
  );

  await page.getByRole("button", { name: "概览", exact: true }).click();
  await expect(page.getByRole("heading", { name: "运行概览" })).toBeVisible();
  await page.waitForTimeout(200);
  let repeatedDashboardRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/admin/dashboard") {
      repeatedDashboardRequests += 1;
    }
  });
  await page.getByRole("button", { name: "任务中心", exact: true }).click();
  await page.getByRole("button", { name: "概览", exact: true }).click();
  await page.waitForTimeout(350);
  expect(repeatedDashboardRequests).toBe(0);
});

test("Studio hover help uses a stable light surface instead of a black flash", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name.includes("mobile"),
    "desktop hover regression",
  );
  await page.goto("/debug");
  await expect(page.getByTestId("studio-workspace")).toBeVisible();
  const returnButton = page.getByRole("button", { name: "返回控制台" });
  await returnButton.hover();
  const tooltip = page.locator(".ant-tooltip-container:visible");
  await expect(tooltip).toHaveText("返回控制台");
  const style = await tooltip.evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      background: computed.backgroundColor,
      color: computed.color,
      borderStyle: computed.borderStyle,
      opacity: computed.opacity,
    };
  });
  expect(style.background).toBe("rgb(255, 255, 255)");
  expect(style.color).not.toBe("rgb(255, 255, 255)");
  expect(style.borderStyle).toBe("solid");
  expect(style.opacity).toBe("1");

  const motion = await returnButton.evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      properties: computed.transitionProperty.split(", "),
      durations: computed.transitionDuration.split(", "),
    };
  });
  expect(motion.properties).toContain("background-color");
  expect(motion.durations).toContain("0.14s");
});

test("Agent management hover states do not introduce dark or shifting borders", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name.includes("mobile"),
    "desktop hover regression",
  );
  await page.goto("/agents");
  await expect(page.getByRole("heading", { name: "Agent 列表" })).toBeVisible();

  const sidebarRegister = page
    .getByRole("button", { name: /注册 Agent/ })
    .first();
  await expect(sidebarRegister).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await sidebarRegister.hover();
  await expect(sidebarRegister).toHaveCSS(
    "background-color",
    "rgb(238, 238, 238)",
  );

  const register = page
    .getByRole("main")
    .getByRole("button", { name: /注册 Agent/ });
  await expect(register).toHaveCSS("background-color", "rgb(33, 33, 33)");
  await register.hover();
  await expect(register).toHaveCSS("background-color", "rgb(48, 48, 48)");

  const readBorder = (locator: import("@playwright/test").Locator) =>
    locator.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        width: style.borderWidth,
        color: style.borderColor,
        style: style.borderStyle,
        darkestChannel: Math.min(
          ...(style.borderColor.match(/\d+/g) ?? []).map(Number),
        ),
      };
    });

  const card = page.locator('[class*="agentCard"]').first();
  const tile = card.locator('button[class*="agentCardAction"]');
  await expect(card).toHaveClass(/ant-card/);
  const grid = page.locator('[class*="agentGrid"]');
  await expect(grid).toHaveCSS("column-gap", "12px");
  const badgeEdges = await page
    .locator('[class*="agentCard"]')
    .evaluateAll((cards) =>
      cards.map((card) => {
        const headerTag = card.querySelector("header .ant-tag");
        const footerTag = card.querySelector("footer .ant-tag");
        if (
          !(headerTag instanceof HTMLElement) ||
          !(footerTag instanceof HTMLElement)
        )
          return undefined;
        return {
          headerRight: Math.round(headerTag.getBoundingClientRect().right),
          footerRight: Math.round(footerTag.getBoundingClientRect().right),
        };
      }),
    );
  expect(
    badgeEdges.every(
      (edge) => edge && Math.abs(edge.headerRight - edge.footerRight) <= 1,
    ),
  ).toBeTruthy();
  const tileBefore = await readBorder(card);
  await tile.hover();
  const tileHover = await readBorder(card);
  expect(tileHover.width).toBe(tileBefore.width);
  expect(tileHover.style).toBe(tileBefore.style);
  expect(tileHover.darkestChannel).toBeGreaterThanOrEqual(175);

  const tileMotion = await card.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      properties: style.transitionProperty.split(", "),
      durations: style.transitionDuration.split(", "),
    };
  });
  expect(tileMotion.properties).toContain("background-color");
  expect(tileMotion.durations).toContain("0.14s");

  await tile.focus();
  const focusOutline = await tile.evaluate((element) => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: style.outlineWidth };
  });
  expect(focusOutline.style).toBe("solid");
  expect(Number.parseFloat(focusOutline.width)).toBeGreaterThanOrEqual(2);

  const tileBox = await tile.boundingBox();
  if (!tileBox) throw new Error("Agent 卡片操作区没有可点击区域");
  await page.mouse.move(
    tileBox.x + tileBox.width / 2,
    tileBox.y + tileBox.height / 2,
  );
  await page.mouse.down();
  await expect(card).toHaveCSS("transform", "matrix(0.985, 0, 0, 0.985, 0, 0)");
  await expect(tile).toHaveCSS("transform", "none");
  await page.mouse.up();

  const search = page.locator(".ant-input-affix-wrapper").first();
  const searchBefore = await readBorder(search);
  await search.hover();
  expect(await readBorder(search)).toEqual(searchBefore);

  const edit = page
    .locator(
      '[class*="splitWorkspace"] .ant-btn-default:not(.ant-btn-dangerous)',
    )
    .filter({ hasText: "编辑" })
    .first();
  await expect(edit).toBeVisible();
  const editBefore = await readBorder(edit);
  await edit.hover();
  expect(await readBorder(edit)).toEqual(editBefore);

  const screenshotDirectory = path.join(
    process.cwd(),
    "artifacts",
    "studio-product",
  );
  await mkdir(screenshotDirectory, { recursive: true });
  await page.screenshot({
    path: path.join(screenshotDirectory, "desktop-agent-card-grid.png"),
    fullPage: true,
  });

  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedDurations = await card.evaluate((element) =>
    getComputedStyle(element)
      .transitionDuration.split(", ")
      .map((duration) => {
        const value = Number.parseFloat(duration);
        return duration.endsWith("ms") ? value / 1_000 : value;
      }),
  );
  expect(reducedDurations.every((duration) => duration <= 0.001)).toBeTruthy();

  const sidebarRegisterBox = await sidebarRegister.boundingBox();
  if (!sidebarRegisterBox) throw new Error("侧栏注册 Agent 按钮不可点击");
  await page.mouse.move(
    sidebarRegisterBox.x + sidebarRegisterBox.width / 2,
    sidebarRegisterBox.y + sidebarRegisterBox.height / 2,
  );
  await page.mouse.down();
  const sidebarActiveBackground = await sidebarRegister.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  const activeChannels =
    sidebarActiveBackground.match(/\d+/g)?.map(Number) ?? [];
  expect(activeChannels).toHaveLength(3);
  expect(activeChannels.every((channel) => channel >= 180)).toBeTruthy();
  await page.mouse.up();
});

test("Agent cards remain single-column and touch-safe on mobile", async ({
  page,
}, testInfo) => {
  test.skip(
    !testInfo.project.name.includes("mobile"),
    "mobile-only layout check",
  );
  await page.goto("/agents");
  await expect(page.getByRole("heading", { name: "Agent 列表" })).toBeVisible();

  const layout = await page.evaluate(() => {
    const grid = document.querySelector('[class*="agentGrid"]');
    const cards = [...document.querySelectorAll('[class*="agentCard"]')];
    const action = document.querySelector('[class*="agentCardAction"]');
    const gridStyle = grid ? getComputedStyle(grid) : undefined;
    const actionBox = action?.getBoundingClientRect();
    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
      columns: gridStyle?.gridTemplateColumns.split(" ").filter(Boolean).length,
      cardsFit: cards.every((card) => {
        const box = card.getBoundingClientRect();
        return box.left >= -1 && box.right <= innerWidth + 1;
      }),
      target: actionBox
        ? { width: actionBox.width, height: actionBox.height }
        : undefined,
    };
  });

  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
  expect(layout.columns).toBe(1);
  expect(layout.cardsFit).toBeTruthy();
  expect(layout.target?.width).toBeGreaterThanOrEqual(40);
  expect(layout.target?.height).toBeGreaterThanOrEqual(40);

  const screenshotDirectory = path.join(
    process.cwd(),
    "artifacts",
    "studio-product",
  );
  await mkdir(screenshotDirectory, { recursive: true });
  await page.screenshot({
    path: path.join(screenshotDirectory, "mobile-agent-card-grid.png"),
    fullPage: true,
  });
});

test("platform admin can assign an existing user as a platform administrator", async ({
  page,
  request,
}, testInfo) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-platform-role-${suffix}@example.test`;
  const password = "E2e-Platform-Role!2026";
  let userId = "";
  try {
    const create = await request.post(`${testApiBaseUrl}/api/admin/users`, {
      headers: adminHeaders,
      data: {
        email,
        displayName: "Existing Login User",
        password,
      },
    });
    expect(create.ok()).toBeTruthy();
    userId = (await create.json()).user.id as string;

    const login = await request.post(`${testApiBaseUrl}/api/auth/login`, {
      data: { email, password },
    });
    expect(login.ok()).toBeTruthy();

    await page.goto("/members");
    await expect(page.getByRole("heading", { name: "成员与角色" })).toBeVisible();
    const row = page.locator("tr", { hasText: email });
    await expect(row).toContainText("普通用户");
    await row.getByRole("button", { name: "设为管理员" }).click();
    await expect(page.getByRole("dialog")).toContainText("设为平台管理员");
    const confirm = page.getByRole("button", { name: "确认授予" });
    await confirm.click();
    await expect(row).toContainText("平台管理员");
    await expect(page.getByText("已授予平台管理员权限")).toBeVisible();
    const viewport = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
    }));
    expect(viewport.documentWidth).toBeLessThanOrEqual(viewport.viewportWidth + 1);
    const screenshotDirectory = path.join(
      process.cwd(),
      "artifacts",
      "platform-role-management",
    );
    await mkdir(screenshotDirectory, { recursive: true });
    await page.screenshot({
      path: path.join(
        screenshotDirectory,
        `platform-admin-grant-${testInfo.project.name}.png`,
      ),
      fullPage: true,
    });
  } finally {
    if (userId) {
      await request.patch(
        `${testApiBaseUrl}/api/admin/users/${userId}/platform-role`,
        { headers: adminHeaders, data: { platformRole: null } },
      );
      await request.post(
        `${testApiBaseUrl}/api/admin/users/${userId}/status`,
        { headers: adminHeaders, data: { status: "disabled" } },
      );
    }
  }
});
