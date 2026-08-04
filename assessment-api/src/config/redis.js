import { createClient } from "redis";
import { env } from "./env.js";

let redisClient;

export async function initRedis() {
  if (redisClient) return redisClient;

  let options = {};
  if (process.env.REDIS_PASS) {
    options = {
      password: process.env.REDIS_PASS,
      socket: {
        host: process.env.REDIS_HOST || "redis",
        port: parseInt(process.env.REDIS_PORT || "6379", 10)
      }
    };
  } else {
    options = { url: env.REDIS_URI };
  }

  try {
    redisClient = createClient(options);
  } catch (err) {
    console.warn("Falling back to separate host/password for Redis:", err.message);
    redisClient = createClient({
      password: process.env.REDIS_PASS,
      socket: {
        host: process.env.REDIS_HOST || "redis",
        port: parseInt(process.env.REDIS_PORT || "6379", 10)
      }
    });
  }

  redisClient.on("error", (err) => console.log("Redis Client Error", err));
  await redisClient.connect();
  console.log("Connected to Redis");
  return redisClient;
}

export function getRedis() {
  return redisClient;
}
