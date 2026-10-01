import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { ChannelIntent } from "./channel-compass-tools.js";

const knowledgeFileSchema = z.object({
  id: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(160),
  entries: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(120),
        title: z.string().trim().min(1).max(160),
        content: z.string().trim().min(1).max(2_000),
      }),
    )
    .min(1)
    .max(100),
});

export type ChannelKnowledgeEntry = z.infer<
  typeof knowledgeFileSchema
>["entries"][number] & { sourceId: string; sourceTitle: string };

export type ChannelKnowledgeContext = {
  entries: ChannelKnowledgeEntry[];
  refs: Array<{ id: string; title: string; path: string }>;
};

const knowledgeRoot = fileURLToPath(
  new URL("../knowledge/channel-compass/", import.meta.url),
);

function filesFor(intent: Exclude<ChannelIntent, "capability">) {
  if (intent === "replenishment")
    return ["metrics.json", "replenishment.json"];
  if (intent === "attribution" || intent === "anomaly")
    return ["metrics.json", "diagnosis.json"];
  if (intent === "weekly_report")
    return ["metrics.json", "diagnosis.json", "replenishment.json"];
  return ["metrics.json"];
}

export async function loadChannelKnowledge(
  intent: Exclude<ChannelIntent, "capability">,
): Promise<ChannelKnowledgeContext> {
  const documents = await Promise.all(
    filesFor(intent).map(async (file) => {
      const path = `${knowledgeRoot}${file}`;
      const raw = await readFile(path, "utf8");
      return { file, document: knowledgeFileSchema.parse(JSON.parse(raw)) };
    }),
  );
  return {
    entries: documents.flatMap(({ document }) =>
      document.entries.map((entry) => ({
        ...entry,
        sourceId: document.id,
        sourceTitle: document.title,
      })),
    ),
    refs: documents.map(({ file, document }) => ({
      id: document.id,
      title: document.title,
      path: `knowledge/channel-compass/${file}`,
    })),
  };
}
