const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const asyncHandler = require("../../middlewares/asyncHandler");
const { buildSuccessResponse } = require("../../utils/responseBuilder");
const User = require("../../modules/users/user.model");
const notificationService = require("../../modules/notifications/notification.service");
const { sendPushNotification } = require("../../utils/fcm");

const PUSH_TOKEN_SCHEMA = {
  pushTokens: [
    {
      token: {
        type: String,
        trim: true
      },
      platform: {
        type: String,
        enum: ["android", "ios", "unknown"],
        default: "unknown"
      },
      createdAt: {
        type: Date,
        default: Date.now
      },
      updatedAt: {
        type: Date,
        default: Date.now
      }
    }
  ]
};

const normalizePlatform = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "android" || normalized === "ios") return normalized;
  return "unknown";
};

const ensureUserPushTokenField = () => {
  if (User.schema.path("pushTokens")) return;
  User.schema.add(PUSH_TOKEN_SCHEMA);
};

const registerDeviceToken = async ({ userId, token, platform }) => {
  const normalizedToken = String(token || "").trim();
  if (!normalizedToken) {
    throw { code: 400, message: "FCM token is required" };
  }

  await User.updateMany(
    { _id: { $ne: userId }, "pushTokens.token": normalizedToken },
    { $pull: { pushTokens: { token: normalizedToken } } }
  );

  const timestamp = new Date();
  const updateResult = await User.updateOne(
    {
      _id: userId,
      "pushTokens.token": normalizedToken
    },
    {
      $set: {
        "pushTokens.$.platform": normalizePlatform(platform),
        "pushTokens.$.updatedAt": timestamp
      }
    }
  );

  if (!updateResult.matchedCount) {
    await User.updateOne(
      { _id: userId },
      {
        $push: {
          pushTokens: {
            token: normalizedToken,
            platform: normalizePlatform(platform),
            createdAt: timestamp,
            updatedAt: timestamp
          }
        }
      }
    );
  }

  return { token: normalizedToken };
};

const unregisterDeviceToken = async ({ userId, token }) => {
  const normalizedToken = String(token || "").trim();
  if (!normalizedToken) {
    throw { code: 400, message: "FCM token is required" };
  }

  await User.updateOne(
    { _id: userId },
    { $pull: { pushTokens: { token: normalizedToken } } }
  );

  return { token: normalizedToken };
};

const sendPushNotificationSafe = async (notification) => {
  if (!notification?.recipientUserId) return;

  try {
    const user = await User.findById(notification.recipientUserId).select("pushTokens").lean();
    const tokens = (user?.pushTokens || []).map((item) => item?.token).filter(Boolean);

    const result = await sendPushNotification({
      tokens,
      title: notification.title,
      message: notification.message,
      data: {
        notificationId: String(notification._id),
        type: notification.type,
        organizationId: String(notification.organizationId),
        recipientUserId: String(notification.recipientUserId)
      }
    });

    if (result?.skipped) {
      console.log(
        "FCM push skipped:",
        result.reason,
        "recipientUserId=",
        String(notification.recipientUserId)
      );
    } else if (result?.failureCount) {
      console.warn(
        "FCM push partially failed:",
        `success=${result.successCount || 0}`,
        `failure=${result.failureCount || 0}`,
        "recipientUserId=",
        String(notification.recipientUserId)
      );
    }

    if (result?.invalidTokens?.length) {
      await User.updateOne(
        { _id: notification.recipientUserId },
        {
          $pull: {
            pushTokens: {
              token: { $in: result.invalidTokens }
            }
          }
        }
      );
    }
  } catch (error) {
    console.warn("FCM push notification failed:", error?.message || error);
  }
};

const patchNotificationService = () => {
  if (notificationService.__fcmPatched) return;

  const originalCreateNotification = notificationService.createNotification;

  notificationService.createNotification = async (payload) => {
    const notification = await originalCreateNotification(payload);
    if (notification) {
      void sendPushNotificationSafe(notification);
    }
    return notification;
  };

  notificationService.createNotificationSafe = async (payload) => {
    try {
      return await notificationService.createNotification(payload);
    } catch (_) {
      return null;
    }
  };

  notificationService.__fcmPatched = true;
};

const createRoutes = () => {
  const router = require("express").Router();

  router.post(
    "/device-token/register",
    auth,
    authorize("NOTIFICATION_MANAGE_SELF"),
    asyncHandler(async (req, res) => {
      const data = await registerDeviceToken({
        userId: req.user.userId,
        token: req.body?.token,
        platform: req.body?.platform
      });

      res
        .status(200)
        .json(buildSuccessResponse({ message: "FCM device token saved", data }));
    })
  );

  router.post(
    "/device-token/unregister",
    auth,
    authorize("NOTIFICATION_MANAGE_SELF"),
    asyncHandler(async (req, res) => {
      const data = await unregisterDeviceToken({
        userId: req.user.userId,
        token: req.body?.token
      });

      res
        .status(200)
        .json(buildSuccessResponse({ message: "FCM device token removed", data }));
    })
  );

  return router;
};

const mount = (app) => {
  ensureUserPushTokenField();
  patchNotificationService();
  app.use("/api/notifications", createRoutes());
};

module.exports = {
  mount
};
