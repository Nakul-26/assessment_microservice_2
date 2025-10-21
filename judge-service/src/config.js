export const RABBITMQ = {
  URL: process.env.RABBITMQ_URL || "amqp://rabbitmq:5672",
  SUBMISSION_QUEUE: process.env.SUBMISSION_QUEUE || "submission_queue",
  RESULT_QUEUE: process.env.RESULT_QUEUE || "submission_results",
};

export const SANDBOX = {
  TIMEOUT_MS: Number(process.env.SANDBOX_TIMEOUT_MS || 5000), // default 5s
  MEMORY_BYTES: Number(process.env.SANDBOX_MEMORY_BYTES || 256 * 1024 * 1024), // 256MB
  CPU_SHARES: Number(process.env.SANDBOX_CPU_SHARES || 512), // relative
  PIDS_LIMIT: Number(process.env.SANDBOX_PIDS_LIMIT || 64),
  MAX_STDOUT_BYTES: Number(process.env.MAX_STDOUT_BYTES || 64 * 1024), // 64KB
};
