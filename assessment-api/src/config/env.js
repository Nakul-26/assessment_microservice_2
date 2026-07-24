import dotenv from "dotenv";

dotenv.config();

export const env = {
  PORT: process.env.PORT || 3000,
  MONGO_URI: process.env.MONGO_URI || "mongodb://mongo:27017",
  MONGO_DB_NAME: process.env.MONGO_DB_NAME || "assessment_db",
  REDIS_URI: process.env.REDIS_URI || "redis://localhost:6379",
  RABBITMQ_URI: process.env.RABBITMQ_URI || "amqp://localhost",
  JWT_SECRET: process.env.JWT_SECRET || "dev_secret_change_me",
  TESTING_PLATFORM_KEY: process.env.TESTING_PLATFORM_KEY || (process.env.NODE_ENV === "production" ? null : "testing_platform_secret"),
  ARVENTIQ_SECRET: process.env.ARVENTIQ_SECRET || (process.env.NODE_ENV === "production" ? null : "arventiq_dev_secret"),
  JUDGE_SERVICE_URL: process.env.JUDGE_SERVICE_URL || "http://judge-service-go:8081"
};

if (process.env.NODE_ENV === "production" && !env.TESTING_PLATFORM_KEY) {
  throw new Error("FATAL: TESTING_PLATFORM_KEY is required in production environment");
}

if (process.env.NODE_ENV === "production" && !env.ARVENTIQ_SECRET) {
  throw new Error("FATAL: ARVENTIQ_SECRET is required in production environment");
}
