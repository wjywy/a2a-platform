import crypto from "node:crypto";
import { config } from "./config.js";
import { query } from "./db.js";
import {
  channelChartSpecSchema,
  type ChannelChartSpec,
} from "./channel-compass-tools.js";

const palette = ["#0f766e", "#2563eb", "#d97706", "#dc2626", "#7c3aed", "#0891b2"];

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function compactNumber(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    notation: Math.abs(value) >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 2,
  }).format(value);
}

export function renderChannelChartSvg(raw: ChannelChartSpec): string {
  const spec = channelChartSpecSchema.parse(raw);
  const width = 1_000;
  const height = 560;
  const margin = { top: 92, right: 48, bottom: 92, left: 86 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const values = spec.series.flatMap((series) => series.data);
  const minimum = Math.min(0, ...values);
  const maximum = Math.max(0, ...values);
  const span = maximum - minimum || 1;
  const y = (value: number) => margin.top + ((maximum - value) / span) * plotHeight;
  const zeroY = y(0);
  const slot = plotWidth / spec.categories.length;
  const labelStep = Math.max(1, Math.ceil(spec.categories.length / 10));
  const grid = Array.from({ length: 6 }, (_, index) => {
    const value = maximum - (span * index) / 5;
    const lineY = y(value);
    return `<line x1="${margin.left}" y1="${lineY}" x2="${width - margin.right}" y2="${lineY}" stroke="#dbe4ea" stroke-width="1"/><text x="${margin.left - 12}" y="${lineY + 5}" text-anchor="end" font-size="12" fill="#52606d">${escapeXml(compactNumber(value))}</text>`;
  }).join("");
  const categoryLabels = spec.categories
    .map((category, index) => {
      if (index % labelStep !== 0 && index !== spec.categories.length - 1)
        return "";
      const x = margin.left + slot * (index + 0.5);
      return `<text x="${x}" y="${height - 48}" text-anchor="middle" font-size="12" fill="#334e68">${escapeXml(category)}</text>`;
    })
    .join("");
  const marks =
    spec.type === "bar"
      ? spec.series
          .flatMap((series, seriesIndex) => {
            const groupWidth = slot * 0.72;
            const barWidth = Math.max(2, groupWidth / spec.series.length);
            return series.data.map((value, index) => {
              const x =
                margin.left +
                slot * index +
                (slot - groupWidth) / 2 +
                seriesIndex * barWidth;
              const top = Math.min(y(value), zeroY);
              const barHeight = Math.max(1, Math.abs(zeroY - y(value)));
              return `<rect x="${x}" y="${top}" width="${Math.max(1, barWidth - 2)}" height="${barHeight}" rx="2" fill="${palette[seriesIndex]}"/>`;
            });
          })
          .join("")
      : spec.series
          .map((series, seriesIndex) => {
            const points = series.data
              .map(
                (value, index) =>
                  `${margin.left + slot * (index + 0.5)},${y(value)}`,
              )
              .join(" ");
            const circles = series.data
              .map((value, index) => {
                const x = margin.left + slot * (index + 0.5);
                return `<circle cx="${x}" cy="${y(value)}" r="4" fill="#ffffff" stroke="${palette[seriesIndex]}" stroke-width="3"/>`;
              })
              .join("");
            return `<polyline points="${points}" fill="none" stroke="${palette[seriesIndex]}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>${circles}`;
          })
          .join("");
  const legend = spec.series
    .map((series, index) => {
      const x = margin.left + index * 150;
      return `<rect x="${x}" y="54" width="12" height="12" rx="2" fill="${palette[index]}"/><text x="${x + 19}" y="65" font-size="12" fill="#243b53">${escapeXml(series.name)}${series.unit ? `（${escapeXml(series.unit)}）` : ""}</text>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc"><title id="title">${escapeXml(spec.title)}</title><desc id="desc">渠道罗盘根据数据工具返回结果生成的${spec.type === "bar" ? "柱状图" : "折线图"}</desc><rect width="100%" height="100%" fill="#ffffff"/><text x="${margin.left}" y="32" font-size="22" font-weight="700" fill="#102a43">${escapeXml(spec.title)}</text>${legend}${grid}<line x1="${margin.left}" y1="${zeroY}" x2="${width - margin.right}" y2="${zeroY}" stroke="#829ab1" stroke-width="1.5"/>${marks}${categoryLabels}<text x="${width - margin.right}" y="${height - 14}" text-anchor="end" font-size="11" fill="#829ab1">由渠道罗盘基于已验证工具数据生成</text></svg>`;
}

function signature(id: string, expires: number) {
  return crypto
    .createHmac("sha256", config.channelChartSigningSecret)
    .update(`${id}.${expires}`)
    .digest("base64url");
}

export function verifyChannelChartSignature(
  id: string,
  expires: number,
  supplied: string,
) {
  if (!Number.isInteger(expires) || expires <= Math.floor(Date.now() / 1000))
    return false;
  const expected = signature(id, expires);
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export type ChannelVisualization = {
  id: string;
  title: string;
  url: string;
  expiresAt: string;
};

export async function createChannelVisualization(input: {
  tenantId: string;
  taskId: string;
  spec: ChannelChartSpec;
}): Promise<ChannelVisualization> {
  const spec = channelChartSpecSchema.parse(input.spec);
  const id = crypto.randomUUID();
  const expiresAt = new Date(
    Date.now() + config.channelChartTtlSeconds * 1_000,
  );
  await query(
    `INSERT INTO channel_compass_visualizations(id,tenant_id,task_id,title,chart_spec,expires_at)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [
      id,
      input.tenantId,
      input.taskId,
      spec.title,
      JSON.stringify(spec),
      expiresAt,
    ],
  );
  const expires = Math.floor(expiresAt.getTime() / 1_000);
  const url = `${config.platformOrigin}/api/builtin/channel-compass/visualizations/${id}.svg?expires=${expires}&signature=${encodeURIComponent(signature(id, expires))}`;
  return { id, title: spec.title, url, expiresAt: expiresAt.toISOString() };
}

export async function getChannelVisualization(id: string) {
  const rows = await query<{
    id: string;
    tenant_id: string;
    title: string;
    chart_spec: ChannelChartSpec;
    expires_at: Date;
  }>(
    `SELECT id,tenant_id,title,chart_spec,expires_at
     FROM channel_compass_visualizations WHERE id=$1 AND expires_at>now()`,
    [id],
  );
  const row = rows[0];
  if (!row) return undefined;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    title: row.title,
    spec: channelChartSpecSchema.parse(row.chart_spec),
    expiresAt: row.expires_at.toISOString(),
  };
}
