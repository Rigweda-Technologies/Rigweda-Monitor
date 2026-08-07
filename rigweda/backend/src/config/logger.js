const pino = require("pino");

const createLogger = (env) => pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: ["req.headers.authorization", "password", "token", "refreshToken"],
    censor: "[REDACTED]"
  },
  base: { service: "rigweda-api" }
});

module.exports = { createLogger };
