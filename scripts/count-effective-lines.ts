import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = process.cwd();
const extensions = new Set([
  ".ts",
  ".tsx",
  ".css",
  ".sql",
  ".md",
  ".yml",
  ".yaml",
  ".conf",
  ".ps1",
]);
const ignoredDirectories = new Set([
  "node_modules",
  "dist",
  "coverage",
  "test-results",
  ".git",
]);
const ignoredFiles = new Set(["package-lock.json"]);

type FileStat = { file: string; physical: number; effective: number };
const stats: FileStat[] = [];

async function visit(directory: string): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (ignoredDirectories.has(entry.name) || ignoredFiles.has(entry.name))
      continue;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      await visit(absolute);
      continue;
    }
    if (!extensions.has(extname(entry.name).toLowerCase())) continue;
    const content = await readFile(absolute, "utf8");
    const lines = content.replaceAll("\r\n", "\n").split("\n");
    const effective = lines.filter((line) => {
      const value = line.trim();
      return (
        value.length > 0 &&
        !value.startsWith("//") &&
        !value.startsWith("/*") &&
        !value.startsWith("*")
      );
    }).length;
    stats.push({
      file: relative(root, absolute).replaceAll("\\", "/"),
      physical: lines.length,
      effective,
    });
  }
}

await visit(root);
stats.sort(
  (left, right) =>
    right.effective - left.effective || left.file.localeCompare(right.file),
);
console.log("effective\tphysical\tfile");
for (const stat of stats)
  console.log(`${stat.effective}\t${stat.physical}\t${stat.file}`);
const effective = stats.reduce((sum, item) => sum + item.effective, 0);
const physical = stats.reduce((sum, item) => sum + item.physical, 0);
console.log(`TOTAL_EFFECTIVE=${effective}`);
console.log(`TOTAL_PHYSICAL=${physical}`);
console.log(`FILES=${stats.length}`);
if (effective < 10_000) {
  console.error("Effective source line requirement was not met.");
  process.exitCode = 1;
}
