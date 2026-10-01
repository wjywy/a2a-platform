import { expect, test, type Page } from "@playwright/test";

const auditViewports = [
  { name: "1440-desktop", width: 1440, height: 1000 },
  { name: "1024-desktop", width: 1024, height: 900 },
  { name: "768-tablet", width: 768, height: 900 },
  { name: "390-mobile", width: 390, height: 844 },
  { name: "375-mobile", width: 375, height: 812 },
] as const;

const auditedRoutes = [
  { path: "/overview", heading: "运行概览" },
  { path: "/agents", heading: "Agent 管理" },
  { path: "/tasks", heading: "任务中心" },
  { path: "/debug", heading: "" },
] as const;

async function waitForRoute(page: Page, path: string, heading: string) {
  if (path === "/debug") {
    await expect(
      page.getByRole("button", { name: "返回控制台" }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "给 Agent 发送消息" }),
    ).toBeVisible();
    return;
  }
  await expect(
    page.getByRole("heading", { name: heading, level: 1 }),
  ).toBeVisible();
  await page
    .getByText("正在加载数据")
    .last()
    .waitFor({ state: "hidden", timeout: 8_000 })
    .catch(() => undefined);
}

async function expectNoDocumentOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(
    dimensions.viewportWidth + 1,
  );
}

test("ChatGPT-aligned shell stays neutral and overflow-safe at every audit viewport", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name.includes("mobile"),
    "the test owns its five viewport matrix",
  );
  test.setTimeout(180_000);
  await page.addInitScript(() =>
    localStorage.setItem("a2a-admin-token", "dev-admin-token"),
  );

  for (const viewport of auditViewports) {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    for (const route of auditedRoutes) {
      await page.goto(route.path);
      await waitForRoute(page, route.path, route.heading);
      await expectNoDocumentOverflow(page);
      await expect(page.locator("body")).toHaveCSS(
        "background-color",
        "rgb(255, 255, 255)",
      );

      const pageBody = page.locator('[class*="pageBody"]').first();
      await expect(pageBody).toBeVisible();
      const desktopNav = page.getByRole("navigation", { name: "控制台主导航" });
      const mobileNav = page.getByRole("navigation", { name: "移动端主导航" });
      if (route.path === "/debug") {
        await expect(desktopNav).toBeHidden();
        await expect(mobileNav).toBeHidden();
        continue;
      }

      const pageBodyWidth =
        (await pageBody.boundingBox())?.width ?? Number.POSITIVE_INFINITY;
      expect(pageBodyWidth).toBeLessThanOrEqual(1280);

      if (route.path === "/overview" && viewport.width === 768) {
        const dashboardColumns = await page
          .locator('[class*="dashboardGrid"]')
          .first()
          .evaluate((element) => getComputedStyle(element).gridTemplateColumns);
        expect(dashboardColumns.trim().split(/\s+/)).toHaveLength(1);
      }

      const topbar = page.locator('[class*="topbar"]').first();
      const expectedTopbarHeight = viewport.width <= 760 ? 52 : 56;
      await expect
        .poll(async () => Math.round((await topbar.boundingBox())?.height ?? 0))
        .toBe(expectedTopbarHeight);

      if (viewport.width <= 760) {
        await expect(desktopNav).toBeHidden();
        await expect(mobileNav).toBeVisible();
        await expect(mobileNav.getByRole("button")).toHaveCount(5);
        const targets = await mobileNav
          .getByRole("button")
          .evaluateAll((buttons) =>
            buttons.map((button) => {
              const box = button.getBoundingClientRect();
              return { width: box.width, height: box.height };
            }),
          );
        expect(
          targets.every((target) => target.width >= 44 && target.height >= 44),
        ).toBeTruthy();
      } else {
        await expect(desktopNav).toBeVisible();
        await expect(mobileNav).toBeHidden();
        const sidebar = page.locator('[class*="sidebar"]').first();
        await expect(sidebar).toHaveCSS(
          "background-color",
          "rgb(249, 249, 249)",
        );
      }
    }
  }
});

test("authentication remains single-column and accessible at every audit viewport", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name.includes("mobile"),
    "the test owns its five viewport matrix",
  );
  test.setTimeout(90_000);

  for (const viewport of auditViewports) {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await page.goto(`/?ui-audit=${viewport.name}`);
    const heading = page.getByRole("heading", { name: "登录控制台" });
    await expect(heading).toBeVisible();
    await expectNoDocumentOverflow(page);
    await expect(page.locator("body")).toHaveCSS(
      "background-color",
      "rgb(255, 255, 255)",
    );

    const formPanel = heading.locator("xpath=ancestor::section[1]");
    const formWidth =
      (await formPanel.boundingBox())?.width ?? Number.POSITIVE_INFINITY;
    expect(formWidth).toBeLessThanOrEqual(420);

    const login = page.getByRole("button", { name: /登录$/ });
    const loginBox = await login.boundingBox();
    const expectedControlHeight = viewport.width <= 760 ? 44 : 40;
    expect(loginBox?.height ?? 0).toBeGreaterThanOrEqual(expectedControlHeight);

    await page.getByRole("button", { name: "没有账号？立即注册" }).click();
    await expect(
      page.getByRole("heading", { name: "创建平台账号" }),
    ).toBeVisible();
    await expectNoDocumentOverflow(page);
  }
});

test("forced colors, reduced motion, keyboard focus and enlarged root text keep the mobile shell usable", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name.includes("mobile"),
    "the test controls its media emulation",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.addInitScript(() =>
    localStorage.setItem("a2a-admin-token", "dev-admin-token"),
  );
  await page.goto("/overview");
  await expect(page.getByRole("heading", { name: "运行概览" })).toBeVisible();
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  await expectNoDocumentOverflow(page);

  const overview = page
    .getByRole("navigation", { name: "移动端主导航" })
    .getByRole("button", { name: "概览" });
  await overview.focus();
  await expect(overview).toBeFocused();
  await expect(overview).not.toHaveCSS("outline-style", "none");
  const target = await overview.boundingBox();
  expect(target?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(target?.height ?? 0).toBeGreaterThanOrEqual(44);
});
