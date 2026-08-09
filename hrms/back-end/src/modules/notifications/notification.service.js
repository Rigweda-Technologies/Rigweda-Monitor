const Notification = require("./notification.model");
const { emitNotification } = require("../../realtime/socket");

exports.createNotification = async ({
  organizationId,
  recipientUserId,
  recipientEmployeeId = null,
  actorEmployeeId = null,
  type = "general",
  title,
  message,
  meta = {}
}) => {
  if (!organizationId || !recipientUserId || !title || !message) return null;
  const notification = await Notification.create({
    organizationId,
    recipientUserId,
    recipientEmployeeId,
    actorEmployeeId,
    type,
    title,
    message,
    meta
  });
  emitNotification(
    { organizationId, userId: recipientUserId },
    notification.toObject ? notification.toObject() : notification
  );
  return notification;
};

exports.createNotificationSafe = async (payload) => {
  try {
    return await exports.createNotification(payload);
  } catch (_) {
    return null;
  }
};

exports.getMyNotifications = async (req) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(50, Math.max(1, Number(req.query.limit || 10)));
  const onlyUnread = String(req.query.onlyUnread || "false") === "true";
  const skip = (page - 1) * limit;

  const query = {
    organizationId: req.user.organizationId,
    recipientUserId: req.user.userId
  };

  if (onlyUnread) {
    query.isRead = false;
  }

  const [items, total, unreadCount] = await Promise.all([
    Notification.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Notification.countDocuments(query),
    Notification.countDocuments({
      organizationId: req.user.organizationId,
      recipientUserId: req.user.userId,
      isRead: false
    })
  ]);

  return {
    items,
    page,
    limit,
    total,
    unreadCount
  };
};

exports.getMyUnreadCount = async (req) => {
  const unreadCount = await Notification.countDocuments({
    organizationId: req.user.organizationId,
    recipientUserId: req.user.userId,
    isRead: false
  });
  return { unreadCount };
};

exports.markOneAsRead = async (req) => {
  const notification = await Notification.findOneAndUpdate(
    {
      _id: req.params.id,
      organizationId: req.user.organizationId,
      recipientUserId: req.user.userId
    },
    {
      $set: {
        isRead: true,
        readAt: new Date()
      }
    },
    { new: true }
  );

  if (!notification) {
    throw new Error("Notification not found");
  }

  return notification;
};

exports.markAllAsRead = async (req) => {
  const result = await Notification.updateMany(
    {
      organizationId: req.user.organizationId,
      recipientUserId: req.user.userId,
      isRead: false
    },
    {
      $set: {
        isRead: true,
        readAt: new Date()
      }
    }
  );

  return {
    updatedCount: result.modifiedCount || 0
  };
};
