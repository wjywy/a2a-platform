import { chromium, type BrowserContext, type Page } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.E2E_BASE_URL ?? "http://localhost:5173";
const outputDir = path.resolve("artifacts/ui-audit");
const routes = [
  "overview",
  "tenants",
  "members",
  "agents",
  "debug",
  "tasks",
  "usage",
  "webhooks",
  "alerts",
  "audit",
  "settings",
] as const;

async function waitForConsole(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  if (new URL(page.url()).pathname === "/debug") {
    await page.getByRole("button", { name: "返回控制台" }).waitFor({
      state: "visible",
      timeout: 15_000,
    });
    await page.waitForTimeout(500);
    return;
  }
  await page
    .locator("main h1")
    .first()
    .waitFor({ state: "visible", timeout: 15_000 });
  await page
    .getByText("正在加载数据")
    .waitFor({ state: "hidden", timeout: 15_000 })
    .catch(() => undefined);
  await page.waitForTimeout(500);
}

async function captureRoutes(context: BrowserContext, viewportName: string) {
  const page = await context.newPage();
  for (const route of routes) {
    await page.goto(`${baseUrl}/${route}`);
    await waitForConsole(page);
    await page.screenshot({
      path: path.join(outputDir, `${viewportName}-${route}.png`),
      fullPage: true,
    });
  }
  await page.close();
}

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });

const viewports = [
  {
    name: "1440-desktop",
    viewport: { width: 1440, height: 1000 },
    isMobile: false,
  },
  {
    name: "1024-desktop",
    viewport: { width: 1024, height: 900 },
    isMobile: false,
  },
  {
    name: "768-tablet",
    viewport: { width: 768, height: 900 },
    isMobile: false,
  },
  { name: "390-mobile", viewport: { width: 390, height: 844 }, isMobile: true },
  { name: "375-mobile", viewport: { width: 375, height: 812 }, isMobile: true },
] as const;

for (const config of viewports) {
  const context = await browser.newContext({
    viewport: config.viewport,
    isMobile: config.isMobile,
    hasTouch: config.isMobile,
  });
  await context.addInitScript(() =>
    localStorage.setItem("a2a-admin-token", "dev-admin-token"),
  );
  await captureRoutes(context, config.name);
  await context.close();

  const authContext = await browser.newContext({
    viewport: config.viewport,
    isMobile: config.isMobile,
    hasTouch: config.isMobile,
  });
  const authPage = await authContext.newPage();
  await authPage.goto(baseUrl);
  await authPage.waitForLoadState("domcontentloaded");
  await authPage
    .getByRole("heading", { name: "登录控制台" })
    .waitFor({ state: "visible" });
  await authPage.screenshot({
    path: path.join(outputDir, `${config.name}-login.png`),
    fullPage: true,
  });
  await authPage.getByRole("button", { name: "没有账号？立即注册" }).click();
  await authPage.screenshot({
    path: path.join(outputDir, `${config.name}-register.png`),
    fullPage: true,
  });
  await authContext.close();
}

await browser.close();

console.log(
  `Captured ${viewports.length * (routes.length + 2)} screenshots in ${outputDir}`,
);
