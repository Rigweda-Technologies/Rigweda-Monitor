const fs = require("fs");
const path = require("path");
const winston = require("winston");

const { combine, timestamp, printf, colorize, errors, splat, metadata, json } =
  winston.format;

const devLogFormat = printf(({ level, message, timestamp, stack, metadata: meta }) => {
  const payload = meta && Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
  return `${timestamp} [${level}]: ${stack || message}${payload}`;
});

const isTruthy = (value) => String(value).toLowerCase() === "true";
const isFalsey = (value) => String(value).toLowerCase() === "false";

const logEnabled = !isFalsey(process.env.LOG_ENABLED || "true");
const consoleEnabled = !isFalsey(process.env.LOG_CONSOLE_ENABLED || "true");
const inferredServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const fileLogEnabled = (() => {
  if (isTruthy(process.env.LOG_FILE_ENABLED || "")) return true;
  if (isFalsey(process.env.LOG_FILE_ENABLED || "")) return false;
  return !inferredServerless && process.env.NODE_ENV !== "production";
})();

const logDir = process.env.LOG_DIR || "logs";
const transports = [];
const exceptionHandlers = [];

if (consoleEnabled) {
  transports.push(
    new winston.transports.Console({
      format:
        process.env.NODE_ENV === "production"
          ? combine(timestamp(), errors({ stack: true }), splat(), metadata(), json())
          : combine(
              colorize(),
              timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
              errors({ stack: true }),
              splat(),
              metadata({ fillExcept: ["level", "message", "timestamp", "stack"] }),
              devLogFormat
            )
    })
  );
}

if (fileLogEnabled) {
  try {
    fs.mkdirSync(logDir, { recursive: true });
    transports.push(
      new winston.transports.File({
        filename: path.join(logDir, "error.log"),
        level: "error"
      })
    );
    transports.push(
      new winston.transports.File({
        filename: path.join(logDir, "combined.log")
      })
    );
    exceptionHandlers.push(
      new winston.transports.File({ filename: path.join(logDir, "exceptions.log") })
    );
  } catch (error) {
    console.warn(
      `[logger] File logging disabled. Could not create log directory "${logDir}": ${
        error?.message || error
      }`
    );
  }
}

if (!transports.length) {
  transports.push(new winston.transports.Console({ silent: true }));
}

const logger = winston.createLogger({
  silent: !logEnabled,
  level: process.env.LOG_LEVEL || "info",
  exitOnError: exceptionHandlers.length > 0,
  format: combine(
    timestamp(),
    errors({ stack: true }),
    splat(),
    metadata({ fillExcept: ["level", "message", "timestamp", "stack"] }),
    process.env.NODE_ENV === "production" ? json() : devLogFormat
  ),
  transports,
  exceptionHandlers
});

module.exports = logger;
