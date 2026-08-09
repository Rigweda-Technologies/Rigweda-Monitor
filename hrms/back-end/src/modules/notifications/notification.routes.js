const router = require("express").Router();
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const asyncHandler = require("../../middlewares/asyncHandler");
const controller = require("./notification.controller");

router.get(
  "/my",
  auth,
  authorize("NOTIFICATION_VIEW_SELF"),
  asyncHandler(controller.myNotifications)
);

router.get(
  "/unread-count",
  auth,
  authorize("NOTIFICATION_VIEW_SELF"),
  asyncHandler(controller.myUnreadCount)
);

router.patch(
  "/:id/read",
  auth,
  authorize("NOTIFICATION_MANAGE_SELF"),
  asyncHandler(controller.markRead)
);

router.patch(
  "/read-all",
  auth,
  authorize("NOTIFICATION_MANAGE_SELF"),
  asyncHandler(controller.markAllRead)
);

module.exports = router;

