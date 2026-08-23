import { chromium, type Page } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.E2E_BASE_URL ?? "http://localhost:5173";
const outputDir = path.resolve("artifacts/ui-hover-audit");
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

const targets = [
  ["navigation", "aside nav button"],
  ["text-link", "a[href]:not(.ant-btn)"],
  ["text-input", ".ant-input:not(:disabled)"],
  [
    "input-wrapper",
    ".ant-input-affix-wrapper:not(.ant-input-affix-wrapper-disabled)",
  ],
  ["number-input", ".ant-input-number:not(.ant-input-number-disabled)"],
  ["select", ".ant-select:not(.ant-select-disabled)"],
  ["checkbox", ".ant-checkbox-wrapper"],
  ["segmented", ".ant-segmented-item:not(.ant-segmented-item-selected)"],
  ["tab", ".ant-tabs-tab:not(.ant-tabs-tab-active)"],
  ["pagination", ".ant-pagination-item:not(.ant-pagination-item-active)"],
  ["pagination-arrow", ".ant-pagination-next:not(.ant-pagination-disabled)"],
  ["table-row", "tbody tr.ant-table-row"],
  ["collapse", ".ant-collapse-header"],
  ["summary", "summary"],
  ["agent-row", 'button[class*="compactAgent"]'],
  ["agent-tile", 'button[class*="agentTile"]'],
  ["operation-row", '[class*="operationList"] button'],
  ["settings-row", '[class*="settingsList"] > button'],
] as const;

type Rect = { x: number; y: number; width: number; height: number };
type AuditItem = {
  route: string;
  category: string;
  index: number;
  rectBefore: Rect;
  rectAfter: Rect;
  layoutShift: number;
  stylesAfter: Record<string, string>;
};
type AuditTarget = (typeof targets)[number];

async function waitForConsole(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await page.locator("main h1").first().waitFor({ state: "visible" });
  await page
    .getByText("正在加载数据")
    .waitFor({ state: "hidden", timeout: 15_000 })
    .catch(() => undefined);
  await page.waitForTimeout(300);
}

function shift(before: Rect, after: Rect) {
  return Math.max(
    Math.abs(before.x - after.x),
    Math.abs(before.y - after.y),
    Math.abs(before.width - after.width),
    Math.abs(before.height - after.height),
  );
}

async function auditVisibleTargets(
  page: Page,
  contextName: string,
  targetSet: readonly AuditTarget[],
  report: AuditItem[],
) {
  for (const [category, selector] of targetSet) {
    const candidates = page.locator(selector);
    const count = Math.min(await candidates.count(), 40);
    for (let index = 0; index < count; index += 1) {
      const target = candidates.nth(index);
      if (!(await target.isVisible().catch(() => false))) continue;
      await target.scrollIntoViewIfNeeded();
      const before = await target.boundingBox();
      if (!before) continue;
      await target.hover({ force: true });
      await page.waitForTimeout(16);
      const after = await target.boundingBox();
      if (!after) continue;
      const stylesAfter = await target.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          backgroundColor: style.backgroundColor,
          borderColor: style.borderColor,
          boxShadow: style.boxShadow,
          color: style.color,
          transform: style.transform,
        };
      });
      report.push({
        route: contextName,
        category,
        index,
        rectBefore: before,
        rectAfter: after,
        layoutShift: shift(before, after),
        stylesAfter,
      });
    }
  }
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
const report: AuditItem[] = [];

for (const route of routes) {
  await page.goto(`${baseUrl}/${route}`);
  await waitForConsole(page);
  await auditVisibleTargets(page, route, targets, report);
}

await page.goto(`${baseUrl}/debug`);
await waitForConsole(page);
await page.locator("button").filter({ hasText: "新建" }).first().click();
await page.getByRole("dialog").waitFor({ state: "visible" });
await auditVisibleTargets(
  page,
  "debug-api-key-modal",
  targets.filter(([category]) =>
    [
      "text-input",
      "input-wrapper",
      "number-input",
      "select",
      "checkbox",
    ].includes(category),
  ),
  report,
);
await page.keyboard.press("Escape");

await page.goto(`${baseUrl}/tasks`);
await waitForConsole(page);
const taskDetail = page.getByRole("button", { name: "详情" }).first();
if (await taskDetail.isVisible().catch(() => false)) {
  await taskDetail.click();
  await page.getByRole("dialog").waitFor({ state: "visible" });
  await auditVisibleTargets(
    page,
    "task-detail-drawer",
    targets.filter(([category]) => ["collapse", "summary"].includes(category)),
    report,
  );
}

await writeFile(
  path.join(outputDir, "hover-audit.json"),
  JSON.stringify(report, null, 2),
  "utf8",
);
await context.close();
await browser.close();

const shifted = report.filter((item) => item.layoutShift > 0.5);
const categories = [...new Set(report.map((item) => item.category))];
console.log(
  `Audited ${report.length} hover targets across ${routes.length} routes and ${categories.length} categories.`,
);
console.log(`Layout shifts above 0.5px: ${shifted.length}.`);
if (shifted.length) {
  console.error(JSON.stringify(shifted.slice(0, 20), null, 2));
  process.exitCode = 1;
}
