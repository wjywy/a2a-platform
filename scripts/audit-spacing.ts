import { chromium, type Locator, type Page } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.E2E_BASE_URL ?? "http://localhost:5173";
const outputDir = path.resolve("artifacts/ui-spacing-audit");
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

type Failure = {
  viewport: string;
  route: string;
  rule: string;
  actual: number;
  expected: number;
  index?: number;
};

async function waitForConsole(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await page.locator("main h1").first().waitFor({ state: "visible" });
  await page
    .getByText("正在加载数据")
    .waitFor({ state: "hidden", timeout: 15_000 })
    .catch(() => undefined);
  await page.waitForTimeout(250);
}

async function numericStyle(locator: Locator, property: string) {
  return locator.evaluate(
    (element, name) =>
      parseFloat(getComputedStyle(element).getPropertyValue(name)),
    property,
  );
}

async function visibleLocators(locator: Locator) {
  const result: Locator[] = [];
  for (let index = 0; index < (await locator.count()); index += 1) {
    const item = locator.nth(index);
    if (await item.isVisible().catch(() => false)) result.push(item);
  }
  return result;
}

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const failures: Failure[] = [];
let checks = 0;

for (const config of [
  { name: "desktop", viewport: { width: 1440, height: 1000 } },
  { name: "mobile", viewport: { width: 375, height: 812 } },
]) {
  const context = await browser.newContext({ viewport: config.viewport });
  await context.addInitScript(() =>
    localStorage.setItem("a2a-admin-token", "dev-admin-token"),
  );
  const page = await context.newPage();

  for (const route of routes) {
    await page.goto(`${baseUrl}/${route}`);
    await waitForConsole(page);
    const pageBody = page.locator('main [class*="pageBody"]').first();
    const minimumPageInset = config.name === "mobile" ? 12 : 20;
    for (const property of ["padding-left", "padding-right", "padding-top"]) {
      const actual = await numericStyle(pageBody, property);
      checks += 1;
      if (actual < minimumPageInset)
        failures.push({
          viewport: config.name,
          route,
          rule: `page-${property}`,
          actual,
          expected: minimumPageInset,
        });
    }

    const panels = await visibleLocators(page.locator('main [class*="panel"]'));
    const minimumPanelInset = config.name === "mobile" ? 14 : 16;
    for (let index = 0; index < panels.length; index += 1) {
      for (const property of [
        "padding-left",
        "padding-right",
        "padding-top",
        "padding-bottom",
      ]) {
        const actual = await numericStyle(panels[index], property);
        checks += 1;
        if (actual < minimumPanelInset)
          failures.push({
            viewport: config.name,
            route,
            rule: `panel-${property}`,
            actual,
            expected: minimumPanelInset,
            index,
          });
      }
    }

    for (const [rule, selector, minimum] of [
      ["section-header-gap", '[class*="sectionHeader"]', 12],
      ["toolbar-gap", '[class*="toolbar"]', 12],
    ] as const) {
      const elements = await visibleLocators(page.locator(selector));
      for (let index = 0; index < elements.length; index += 1) {
        const gap = await elements[index].evaluate((element) => {
          const next = element.nextElementSibling;
          if (!next) return Number.POSITIVE_INFINITY;
          return (
            next.getBoundingClientRect().top -
            element.getBoundingClientRect().bottom
          );
        });
        checks += 1;
        if (gap < minimum)
          failures.push({
            viewport: config.name,
            route,
            rule,
            actual: gap,
            expected: minimum,
            index,
          });
      }
    }

    if (config.name === "mobile") {
      const main = page.locator("main");
      const nav = page.locator('nav[class*="mobileNav"]');
      const mainBottom = await numericStyle(main, "padding-bottom");
      const navHeight = (await nav.boundingBox())?.height ?? 0;
      checks += 1;
      if (mainBottom < navHeight + 8)
        failures.push({
          viewport: config.name,
          route,
          rule: "mobile-navigation-clearance",
          actual: mainBottom - navHeight,
          expected: 8,
        });
    }
  }

  await context.close();
}

await browser.close();
await writeFile(
  path.join(outputDir, "spacing-audit.json"),
  JSON.stringify({ checks, failures }, null, 2),
  "utf8",
);
console.log(`Completed ${checks} spacing checks across 22 route/viewports.`);
console.log(`Spacing failures: ${failures.length}.`);
if (failures.length) {
  console.error(JSON.stringify(failures.slice(0, 30), null, 2));
  process.exitCode = 1;
}
