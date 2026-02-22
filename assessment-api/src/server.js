import app from "./app.js";
import connectDB from "./config/db.js";
import { initRedis } from "./config/redis.js";
import { initRabbit } from "./config/rabbit.js";
import { env } from "./config/env.js";

async function startServer() {
  try {
    await connectDB();
    await initRedis();
    await initRabbit();

    app.listen(env.PORT, () => {
      console.log(`🚀 Server running on port ${env.PORT}`);
    });
  } catch (err) {
    console.error("❌ Failed to start server:", err);
    process.exit(1);
  }
}

process.on("unhandledRejection", (err) => {
  console.log(`Error: ${err && err.message ? err.message : err}`);
  process.exit(1);
});

startServer();
