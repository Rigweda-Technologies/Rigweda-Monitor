const { Server } = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");
const jwt = require("jsonwebtoken");
const User = require("../modules/users/user.model");
const { getRedisClient } = require("../config/redis");

let ioInstance = null;

const normalizeToken = (token) => {
  if (!token || typeof token !== "string") return null;
  return token.startsWith("Bearer ") ? token.slice(7) : token;
};

const buildUserRoom = (organizationId, userId) => `attendance:${organizationId}:${userId}`;
const buildMonitorSettingsRoom = (organizationId) => `monitor-settings:${organizationId}`;

const resolveAuthenticatedUser = async (token) => {
  const normalizedToken = normalizeToken(token);
  if (!normalizedToken) {
    throw new Error("Authorization token missing");
  }

  const decoded = jwt.verify(normalizedToken, process.env.JWT_SECRET);
  const userId = decoded.userId || decoded._id;
  const user = await User.findById(userId).select(
    "_id email organizationIds activeOrganizationId status tokenList passwordChangeRequired"
  );

  if (!user) {
    throw new Error("User not found");
  }

  if (user.status !== "active") {
    throw new Error("User account is not active");
  }

  const hasMatchingActiveToken = Array.isArray(user.tokenList) && user.tokenList.some((entry) => {
    if (!entry?.token || entry.token !== normalizedToken) return false;
    if (entry.status && entry.status !== "active") return false;
    if (decoded.organizationId && entry.organizationId) {
      return String(entry.organizationId) === String(decoded.organizationId);
    }
    return true;
  });

  if (!hasMatchingActiveToken) {
    throw new Error("Session expired. Please login again.");
  }

  return {
    userId: String(user._id),
    organizationId: String(decoded.organizationId || ""),
    email: user.email,
    expiresAt: decoded.exp ? Number(decoded.exp) * 1000 : null
  };
};

const initRealtime = async (httpServer, { allowedOrigins = [] } = {}) => {
  ioInstance = new Server(httpServer, {
    path: process.env.SOCKET_IO_PATH || "/api/socket.io",
    cors: {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.length && !allowedOrigins.includes(origin)) {
          return callback(new Error(`CORS policy does not allow this origin: ${origin}`), false);
        }
        return callback(null, true);
      },
      methods: ["GET", "POST"],
      credentials: true
    }
  });

  const redisPublisher = await getRedisClient();
  if (redisPublisher) {
    try {
      const redisSubscriber = redisPublisher.duplicate();
      if (redisSubscriber.status !== "ready") {
        await redisSubscriber.connect();
      }
      ioInstance.adapter(createAdapter(redisPublisher, redisSubscriber));
      if (process.env.NODE_ENV !== "test") {
        console.log("✅ Realtime Redis adapter connected");
      }
    } catch (error) {
      if (process.env.NODE_ENV !== "test") {
        console.error("❌ Realtime Redis adapter failed:", error?.message || error);
      }
    }
  }

  ioInstance.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization;
      const identity = await resolveAuthenticatedUser(token);
      socket.data.identity = identity;
      return next();
    } catch (error) {
      return next(new Error(error?.message || "Unauthorized"));
    }
  });

  ioInstance.on("connection", (socket) => {
    const identity = socket.data.identity;
    if (identity?.organizationId && identity?.userId) {
      socket.join(buildUserRoom(identity.organizationId, identity.userId));
    }
    if (identity?.organizationId) {
      socket.join(buildMonitorSettingsRoom(identity.organizationId));
    }
    if (identity?.expiresAt) {
      const expiresInMs = Math.max(0, identity.expiresAt - Date.now());
      const expiryTimer = setTimeout(
        () => socket.disconnect(true),
        Math.min(expiresInMs, 2_147_483_647)
      );
      socket.once("disconnect", () => clearTimeout(expiryTimer));
    }
  });

  return ioInstance;
};

const emitAttendanceUpdate = ({ organizationId, userId }, payload) => {
  if (!ioInstance || !organizationId || !userId) return;
  ioInstance.to(buildUserRoom(String(organizationId), String(userId))).emit("attendance:updated", payload);
};

const emitNotification = ({ organizationId, userId }, payload) => {
  if (!ioInstance || !organizationId || !userId || !payload) return;
  ioInstance
    .to(buildUserRoom(String(organizationId), String(userId)))
    .emit("notification:new", payload);
};

const emitMonitorSettingsUpdate = ({ organizationId }, payload) => {
  if (!ioInstance || !organizationId || !payload) return;
  ioInstance
    .to(buildMonitorSettingsRoom(String(organizationId)))
    .emit("monitor-settings:updated", payload);
};

module.exports = {
  initRealtime,
  emitAttendanceUpdate,
  emitNotification,
  emitMonitorSettingsUpdate
};
