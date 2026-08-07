require("dotenv").config();
const { loadEnv } = require("./config/env");
const { createLogger } = require("./config/logger");
const { createPool } = require("./database/pool");
const { createApp } = require("./app");

const env = loadEnv();
const logger = createLogger(env);
const pool = createPool(env);
pool.on("error", (error) => logger.error({ err: error }, "Unexpected PostgreSQL pool error"));
const app = createApp({ env, logger, pool });
const server = app.listen(env.PORT, async (error) => {
  if (error) {
    const message = error.code === "EADDRINUSE"
      ? `Port ${env.PORT} is already in use. Another Rigweda backend may already be running.`
      : "Rigweda API failed to start";
    logger.fatal({ err: error, port: env.PORT }, message);
    await pool.end().catch((poolError) => logger.error({ err: poolError }, "PostgreSQL pool shutdown failed"));
    process.exitCode = 1;
    return;
  }
  logger.info({ port: env.PORT }, "Rigweda API started");
});
server.requestTimeout=env.HTTP_REQUEST_TIMEOUT_MS;
server.keepAliveTimeout=env.HTTP_KEEP_ALIVE_TIMEOUT_MS;
server.headersTimeout=Math.max(env.HTTP_KEEP_ALIVE_TIMEOUT_MS+5000,env.HTTP_REQUEST_TIMEOUT_MS+5000);

let shuttingDown = false;
const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Graceful shutdown started");
  server.close(async () => {
    try {
      await pool.end();
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, "Graceful shutdown failed");
      process.exit(1);
    }
  });
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
