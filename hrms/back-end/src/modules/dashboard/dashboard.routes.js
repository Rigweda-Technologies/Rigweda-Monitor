const router = require("express").Router();
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const asyncHandler = require("../../middlewares/asyncHandler");
const controller = require("./dashboard.controller");

router.get(
  "/summary",
  auth,
  authorize([
    "EMP_VIEW",
    "TIMESHEET_VIEW_ALL",
    "ATTENDANCE_VIEW_ALL",
    "LEAVE_VIEW_ALL",
    "HOLIDAY_VIEW",
    "WEEK_OFF_VIEW",
    "ORG_SETTINGS_VIEW",
    "NOTIFICATION_VIEW_SELF"
  ]),
  asyncHandler(controller.summary)
);

module.exports = router;

