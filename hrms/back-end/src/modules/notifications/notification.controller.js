const service = require("./notification.service");
const { buildSuccessResponse } = require("../../utils/responseBuilder");

exports.myNotifications = async (req, res) => {
  const data = await service.getMyNotifications(req);
  res.status(200).json(buildSuccessResponse({ data }));
};

exports.myUnreadCount = async (req, res) => {
  const data = await service.getMyUnreadCount(req);
  res.status(200).json(buildSuccessResponse({ data }));
};

exports.markRead = async (req, res) => {
  const data = await service.markOneAsRead(req);
  res.status(200).json(buildSuccessResponse({ message: "Notification marked as read", data }));
};

exports.markAllRead = async (req, res) => {
  const data = await service.markAllAsRead(req);
  res.status(200).json(buildSuccessResponse({ message: "All notifications marked as read", data }));
};

