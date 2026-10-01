import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postcss, { type AtRule, type Rule } from "postcss";

const sourceRoot = path.resolve("apps/admin-console/src");
const tokenFile = path.join(sourceRoot, "styles/design-tokens.css");
const forbiddenWarmValues = [
  "#f4f4f2",
  "#ecece8",
  "#e5e5df",
  "#deded8",
  "#1f1f1c",
  "#5f5f58",
  "#76766f",
  "#e8e8e3",
  "#aaa9a0",
  "#292925",
  "#3a3a35",
] as const;
const requiredTokens = {
  "--color-surface-canvas": "#ffffff",
  "--color-sidebar-background": "#f9f9f9",
  "--color-sidebar-hover": "#ececec",
  "--color-sidebar-selected": "#e8e8e8",
  "--color-composer-background": "#f4f4f4",
  "--color-text-primary": "#0d0d0d",
  "--color-text-secondary": "#676767",
  "--color-text-tertiary": "#8f8f8f",
  "--color-border-subtle": "#e5e5e5",
  "--color-action-primary": "#212121",
  "--radius-composer": "24px",
  "--console-sidebar-width": "260px",
  "--console-topbar-height": "56px",
} as const;

type FileAudit = {
  file: string;
  sourceLines: number;
  rules: number;
  declarations: number;
  atRules: number;
  hoverRules: number;
};

async function collectCssFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) return collectCssFiles(absolute);
      return entry.isFile() && entry.name.endsWith(".css") ? [absolute] : [];
    }),
  );
  return nested.flat().sort();
}

function hasFinePointerGuard(rule: Rule): boolean {
  let parent = rule.parent;
  while (parent) {
    if (parent.type === "atrule") {
      const media = parent as AtRule;
      if (
        media.name.toLowerCase() === "media" &&
        media.params.includes("(hover: hover)") &&
        media.params.includes("(pointer: fine)")
      ) {
        return true;
      }
    }
    parent = parent.parent;
  }
  return false;
}

function location(file: string, line?: number): string {
  const relative = path.relative(process.cwd(), file).replaceAll("\\", "/");
  return line ? `${relative}:${line}` : relative;
}

const cssFiles = await collectCssFiles(sourceRoot);
const issues: string[] = [];
const audits: FileAudit[] = [];

for (const file of cssFiles) {
  const source = await readFile(file, "utf8");
  const root = postcss.parse(source, { from: file });
  const audit: FileAudit = {
    file: path.relative(process.cwd(), file).replaceAll("\\", "/"),
    sourceLines: source.split(/\r?\n/).length,
    rules: 0,
    declarations: 0,
    atRules: 0,
    hoverRules: 0,
  };

  root.walkAtRules(() => {
    audit.atRules += 1;
  });
  root.walkRules((rule) => {
    audit.rules += 1;
    if (rule.selector.includes(":hover")) {
      audit.hoverRules += 1;
      if (!hasFinePointerGuard(rule)) {
        issues.push(
          `${location(file, rule.source?.start?.line)} hover rule lacks a fine-pointer media guard: ${rule.selector}`,
        );
      }
    }
  });
  root.walkDecls((declaration) => {
    audit.declarations += 1;
    const property = declaration.prop.toLowerCase();
    const value = declaration.value.toLowerCase();
    const here = location(file, declaration.source?.start?.line);
    if (/\b(?:repeating-)?(?:linear|radial|conic)-gradient\(/.test(value)) {
      issues.push(`${here} contains a gradient declaration`);
    }
    if (property.includes("backdrop-filter") && /\bblur\(/.test(value)) {
      issues.push(`${here} contains backdrop blur`);
    }
    if (
      (property === "transition-property" &&
        value.split(",").some((part) => part.trim() === "all")) ||
      (property === "transition" &&
        value.split(",").some((part) => /^all(?:\s|$)/.test(part.trim())))
    ) {
      issues.push(`${here} contains transition: all`);
    }
    for (const warmValue of forbiddenWarmValues) {
      if (value.includes(warmValue)) {
        issues.push(`${here} contains retired warm-neutral value ${warmValue}`);
      }
    }
  });
  audits.push(audit);
}

const tokenSource = await readFile(tokenFile, "utf8");
for (const [name, expected] of Object.entries(requiredTokens)) {
  const match = tokenSource.match(
    new RegExp(
      `${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*([^;]+);`,
    ),
  );
  const actual = match?.[1]?.trim().toLowerCase();
  if (actual !== expected) {
    issues.push(
      `${location(tokenFile)} expected ${name}: ${expected}, received ${actual ?? "missing"}`,
    );
  }
}

const totals = audits.reduce(
  (sum, audit) => ({
    files: sum.files + 1,
    sourceLines: sum.sourceLines + audit.sourceLines,
    rules: sum.rules + audit.rules,
    declarations: sum.declarations + audit.declarations,
    atRules: sum.atRules + audit.atRules,
    hoverRules: sum.hoverRules + audit.hoverRules,
  }),
  {
    files: 0,
    sourceLines: 0,
    rules: 0,
    declarations: 0,
    atRules: 0,
    hoverRules: 0,
  },
);

console.table(audits);
console.log("CSS audit totals", totals);
if (issues.length > 0) {
  console.error(`CSS audit failed with ${issues.length} issue(s):`);
  for (const issue of issues) console.error(`- ${issue}`);
  process.exitCode = 1;
} else {
  console.log(
    "CSS audit passed: every owned CSS source and rule was parsed; no forbidden visual patterns were found.",
  );
}
