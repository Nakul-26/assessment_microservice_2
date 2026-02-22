import { getRedis } from "../config/redis.js";

export async function getCacheJSON(key) {
  const redis = getRedis();
  if (!redis) return null;
  const raw = await redis.get(key);
  return raw ? JSON.parse(raw) : null;
}

export async function setCacheJSON(key, value, ttlSeconds = 3600) {
  const redis = getRedis();
  if (!redis) return;
  await redis.set(key, JSON.stringify(value), { EX: ttlSeconds });
}
