import { createClient, type RedisClientType } from "redis";
import { config } from "./config.js";

let client: RedisClientType | undefined;

export async function getRedis(): Promise<RedisClientType | undefined> {
  if (client?.isReady) return client;
  try {
    client ??= createClient({ url: config.redisUrl });
    client.on("error", (error) => console.error("Redis error:", error.message));
    if (!client.isOpen) await client.connect();
    return client;
  } catch (error) {
    console.warn(
      "Redis unavailable; rate limits and notifications are disabled.",
    );
    return undefined;
  }
}

export async function enforceRateLimit(key: string): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return true;
  const bucket = `${key}:${Math.floor(Date.now() / 60_000)}`;
  const count = await redis.incr(bucket);
  if (count === 1) await redis.expire(bucket, 60);
  return count <= config.rateLimitPerMinute;
}

export async function publishTenantEvent(
  tenantId: string,
  event: Record<string, unknown>,
): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;
  await redis.publish(
    `platform:${tenantId}:events`,
    JSON.stringify({
      ...event,
      tenantId,
      occurredAt: new Date().toISOString(),
    }),
  );
}

export async function subscribePattern(
  pattern: string,
  listener: (message: string, channel: string) => void,
): Promise<() => Promise<void>> {
  const redis = await getRedis();
  if (!redis) return async () => undefined;
  const subscriber = redis.duplicate();
  subscriber.on("error", (error) =>
    console.error("Redis subscriber error:", error.message),
  );
  await subscriber.connect();
  await subscriber.pSubscribe(pattern, listener);
  return async () => {
    if (!subscriber.isOpen) return;
    await subscriber.pUnsubscribe(pattern);
    await subscriber.quit();
  };
}
