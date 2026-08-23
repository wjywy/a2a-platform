import { z } from "zod";
import { config } from "./config.js";
import { query } from "./db.js";
import { NotFoundError } from "./domain.js";

export type PlatformSetting = {
  key: string;
  value: unknown;
  description: string;
  sensitive: boolean;
  updatedBy: string;
  updatedAt: string;
};
type SettingRow = {
  key: string;
  value: unknown;
  description: string;
  sensitive: boolean;
  updated_by: string;
  updated_at: Date;
};
const map = (r: SettingRow): PlatformSetting => ({
  key: r.key,
  value: r.sensitive ? "••••••••" : r.value,
  description: r.description,
  sensitive: r.sensitive,
  updatedBy: r.updated_by,
  updatedAt: r.updated_at.toISOString(),
});
export const settingSchema = z.object({
  value: z.unknown(),
  description: z.string().trim().max(300).optional(),
});
const settingValueSchemas: Record<string, z.ZodTypeAny> = {
  "gateway.defaultTimeoutMs": z.number().int().min(1000).max(600_000),
  "health.intervalSeconds": z.number().int().min(5).max(3600),
  "webhook.defaultMaxAttempts": z.number().int().min(1).max(12),
  "retention.defaultDays": z.number().int().min(7).max(3650),
  "auth.localLoginEnabled": z.boolean(),
  "auth.selfRegistrationEnabled": z.boolean(),
  "notifications.emailEnabled": z.boolean(),
};
export async function listSettings(): Promise<PlatformSetting[]> {
  return (
    await query<SettingRow>("SELECT * FROM platform_settings ORDER BY key")
  ).map(map);
}
export async function getSetting(key: string): Promise<PlatformSetting> {
  const rows = await query<SettingRow>(
    "SELECT * FROM platform_settings WHERE key=$1",
    [key],
  );
  if (!rows[0]) throw new NotFoundError("平台设置", key);
  return map(rows[0]);
}
export async function getSettingValue<T>(key: string, fallback: T): Promise<T> {
  const rows = await query<{ value: T }>(
    "SELECT value FROM platform_settings WHERE key=$1",
    [key],
  );
  return rows[0]?.value ?? fallback;
}

export async function isLocalLoginEnabled(): Promise<boolean> {
  if (!config.localLoginEnabled) return false;
  return getSettingValue("auth.localLoginEnabled", true);
}
export async function isSelfRegistrationEnabled(): Promise<boolean> {
  if (!config.selfRegistrationEnabled || !(await isLocalLoginEnabled()))
    return false;
  return getSettingValue("auth.selfRegistrationEnabled", true);
}
export async function updateSetting(
  key: string,
  raw: unknown,
  actorId: string,
): Promise<PlatformSetting> {
  const input = settingSchema.parse(raw);
  const validatedValue = (settingValueSchemas[key] ?? z.unknown()).parse(
    input.value,
  );
  const rows = await query<SettingRow>(
    `UPDATE platform_settings SET value=$2,description=COALESCE($3,description),updated_by=$4,updated_at=now()
    WHERE key=$1 RETURNING *`,
    [key, JSON.stringify(validatedValue), input.description ?? null, actorId],
  );
  if (!rows[0]) throw new NotFoundError("平台设置", key);
  return map(rows[0]);
}
