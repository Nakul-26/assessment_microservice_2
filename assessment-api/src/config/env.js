import dotenv from "dotenv";

dotenv.config();

export const env = {
  PORT: process.env.PORT || 3000,
  MONGO_URI: process.env.MONGO_URI || "mongodb://mongo:27017",
  REDIS_URI: process.env.REDIS_URI || "redis://localhost:6379",
  RABBITMQ_URI: process.env.RABBITMQ_URI || "amqp://localhost",
  JWT_SECRET: process.env.JWT_SECRET || "dev_secret_change_me"
};
