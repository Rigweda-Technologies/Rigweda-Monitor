let redisClient = null;
let connectPromise = null;
let didLogDisabled = false;

const isRedisEnabled = () =>
  Boolean(process.env.REDIS_URL) && process.env.ENABLE_REDIS !== "false";

const getRedisClient = async () => {
  if (!isRedisEnabled()) {
    if (!didLogDisabled && process.env.NODE_ENV !== "test") {
      didLogDisabled = true;
      console.log("ℹ Redis disabled (set REDIS_URL to enable)");
    }
    return null;
  }

  if (redisClient && redisClient.status === "ready") {
    return redisClient;
  }

  if (!redisClient) {
    try {
      const Redis = require("ioredis");
      redisClient = new Redis(process.env.REDIS_URL, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 10000)
      });

      redisClient.on("error", (error) => {
        if (process.env.NODE_ENV !== "test") {
          console.error("❌ Redis error:", error?.message || error);
        }
      });
    } catch (error) {
      if (process.env.NODE_ENV !== "test") {
        console.error(
          "❌ ioredis package not found. Install it to enable Redis caching/rate limiting."
        );
      }
      redisClient = null;
      return null;
    }
  }

  if (!connectPromise) {
    connectPromise = redisClient
      .connect()
      .then(() => {
        if (process.env.NODE_ENV !== "test") {
          console.log("✅ Redis connected");
        }
      })
      .catch((error) => {
        if (process.env.NODE_ENV !== "test") {
          console.error("❌ Redis connection failed:", error?.message || error);
        }
      })
      .finally(() => {
        connectPromise = null;
      });
  }

  await connectPromise;

  if (redisClient?.status === "ready") {
    return redisClient;
  }

  return null;
};

module.exports = {
  getRedisClient,
  isRedisEnabled,
  isRedisReady: () => Boolean(redisClient && redisClient.status === "ready")
};
