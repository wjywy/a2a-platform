import { chromium, type Locator, type Page } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.E2E_BASE_URL ?? "http://localhost:5173";
const outputDir = path.resolve("artifacts/ui-hover-audit");

async function waitForConsole(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await page
    .locator("main h1")
    .first()
    .waitFor({ state: "visible", timeout: 15_000 });
  await page
    .getByText("正在加载数据")
    .waitFor({ state: "hidden", timeout: 15_000 })
    .catch(() => undefined);
  await page.waitForTimeout(350);
}

async function capture(
  page: Page,
  route: string,
  name: string,
  target: (page: Page) => Locator,
) {
  await page.goto(`${baseUrl}/${route}`);
  await waitForConsole(page);
  const locator = target(page).first();
  await locator.scrollIntoViewIfNeeded();
  await locator.hover();
  await page.waitForTimeout(120);
  await page.screenshot({ path: path.join(outputDir, `${name}.png`) });
}

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
await context.addInitScript(() =>
  localStorage.setItem("a2a-admin-token", "dev-admin-token"),
);
const page = await context.newPage();
let captured = 0;

await capture(page, "overview", "navigation-row", (current) =>
  current.getByRole("button", { name: "Agent 管理" }),
);
captured += 1;
await capture(page, "overview", "overview-agent-row", (current) =>
  current.getByRole("button", { name: /股票专家.*stock-expert/ }),
);
captured += 1;
await capture(page, "agents", "agent-tile", (current) =>
  current.locator("button").filter({ hasText: "stock-expert" }),
);
captured += 1;
await capture(page, "agents", "operation-row", (current) =>
  current.getByRole("button", { name: /后端实例/ }),
);
captured += 1;
await capture(page, "tenants", "table-row", (current) =>
  current.locator("tbody tr.ant-table-row"),
);
captured += 1;
await capture(page, "settings", "settings-row", (current) =>
  current.getByRole("button", { name: /auth\.localLoginEnabled/ }),
);
captured += 1;
await capture(page, "tenants", "input-control", (current) =>
  current.locator(".ant-input-affix-wrapper"),
);
captured += 1;
await capture(page, "debug", "select-control", (current) =>
  current.locator(".ant-select").first(),
);
captured += 1;
await capture(page, "debug", "segmented-item", (current) =>
  current.locator(".ant-segmented-item:not(.ant-segmented-item-selected)"),
);
captured += 1;
await capture(page, "debug", "tab-item", (current) =>
  current.locator(".ant-tabs-tab:not(.ant-tabs-tab-active)"),
);
captured += 1;
await capture(page, "tenants", "pagination-item", (current) =>
  current.locator(".ant-pagination-item:not(.ant-pagination-item-active)"),
);
captured += 1;

await page.goto(`${baseUrl}/debug`);
await waitForConsole(page);
await page.locator(".ant-select").first().click();
const option = page
  .locator(".ant-select-item-option:not(.ant-select-item-option-selected)")
  .first();
await option.hover();
await page.screenshot({ path: path.join(outputDir, "select-option.png") });
captured += 1;
await page.keyboard.press("Escape");

await page.locator("button").filter({ hasText: "新建" }).first().click();
await page.getByRole("dialog").waitFor({ state: "visible" });
await page.locator(".ant-checkbox-wrapper").last().hover();
await page.screenshot({ path: path.join(outputDir, "modal-checkbox.png") });
captured += 1;

await context.close();
await browser.close();
console.log(`Captured ${captured} hover screenshots in ${outputDir}`);
