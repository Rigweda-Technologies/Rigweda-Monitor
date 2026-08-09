const { getRedisClient } = require("../config/redis");

const CACHE_PREFIX = "upanaya:cache";

const stableSerialize = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => stableSerialize(item));
  }

  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = stableSerialize(value[key]);
        return acc;
      }, {});
  }

  return value;
};

const buildRequestCacheKey = (req, extras = {}) => {
  const payload = {
    organizationId: req.user?.organizationId || "na",
    userId: req.user?.userId || "na",
    params: req.params || {},
    query: req.query || {},
    extras
  };

  return JSON.stringify(stableSerialize(payload));
};

const withCache = async ({ namespace, key, ttlSeconds = 60, producer }) => {
  const client = await getRedisClient();
  if (!client) {
    return producer();
  }

  const versionKey = `${CACHE_PREFIX}:v:${namespace}`;
  const namespaceVersion = (await client.get(versionKey)) || "1";
  const cacheKey = `${CACHE_PREFIX}:${namespace}:v${namespaceVersion}:${key}`;
  const cachedValue = await client.get(cacheKey);

  if (cachedValue) {
    return JSON.parse(cachedValue);
  }

  const value = await producer();
  await client.set(cacheKey, JSON.stringify(value), "EX", ttlSeconds);
  return value;
};

const invalidateCacheNamespace = async (namespace) => {
  const client = await getRedisClient();
  if (!client) {
    return false;
  }

  const versionKey = `${CACHE_PREFIX}:v:${namespace}`;
  await client.incr(versionKey);
  return true;
};

module.exports = {
  buildRequestCacheKey,
  withCache,
  invalidateCacheNamespace
};
