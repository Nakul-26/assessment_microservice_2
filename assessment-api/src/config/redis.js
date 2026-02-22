import { createClient } from "redis";
import { env } from "./env.js";

let redisClient;

export async function initRedis() {
  if (redisClient) return redisClient;
  redisClient = createClient({ url: env.REDIS_URI });
  redisClient.on("error", (err) => console.log("Redis Client Error", err));
  await redisClient.connect();
  console.log("Connected to Redis");
  return redisClient;
}

export function getRedis() {
  return redisClient;
}
