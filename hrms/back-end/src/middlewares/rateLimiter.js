const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const { ipKeyGenerator } = require("express-rate-limit");
const { getRedisClient, isRedisEnabled } = require("../config/redis");

let RedisStore = null;
try {
  ({ RedisStore } = require("rate-limit-redis"));
} catch (_) {
  RedisStore = null;
}

const createRedisStore = () => {
  if (
    !RedisStore ||
    process.env.ENABLE_REDIS_RATE_LIMIT === "false" ||
    !isRedisEnabled()
  ) {
    return undefined;
  }

  return new RedisStore({
    sendCommand: async (...args) => {
      const client = await getRedisClient();
      if (!client) {
        throw new Error("Redis unavailable");
      }
      return client.call(...args);
    }
  });
};

const sharedLimiterOptions = {
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRedisStore()
};

const buildAuthRateLimitKey = (req) => {
  const authHeader = typeof req.headers.authorization === "string"
    ? req.headers.authorization.trim()
    : "";

  if (authHeader.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token) {
      const digest = crypto.createHash("sha256").update(token).digest("hex");
      return `token:${digest}`;
    }
  }

  return ipKeyGenerator(req.ip);
};

/**
 * Public APIs (login, register, otp, etc.)
 */
const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10000,
  ...sharedLimiterOptions,
  message: {
    code: 429,
    message: "Too many requests. Try again later.",
    data: null,
    error: null
  }
});

/**
 * Authenticated APIs (normal app usage)
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3000,
  keyGenerator: buildAuthRateLimitKey,
  ...sharedLimiterOptions
});

module.exports = {
  publicLimiter,
  authLimiter
};
