const router = require("express").Router();
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const validate = require("../../middlewares/validate.middleware");
const asyncHandler = require("../../middlewares/asyncHandler");

const controller = require("./timesheet.controller");
const {
  checkInSchema,
  checkOutSchema,
  createWeeklySchema,
  updateWeeklySchema,
  submitWeeklySchema,
  actionWeeklySchema,
  overrideAttendanceSchema,
  bulkOverrideAttendanceSchema,
  customBulkOverrideAttendanceSchema,
  lockAttendanceMonthSchema,
  attendanceRequestDefaultsSchema,
  raiseAttendanceRequestSchema,
  attendanceRequestActionSchema
} = require("./timesheet.validation");

// Check-in / Check-out
router.post(
  "/check-in",
  auth,
  authorize("TIMESHEET_CHECKIN_SELF"),
  validate(checkInSchema),
  asyncHandler(controller.checkIn)
);

router.post(
  "/check-out",
  auth,
  authorize("TIMESHEET_CHECKOUT_SELF"),
  validate(checkOutSchema),
  asyncHandler(controller.checkOut)
);

// Attendance views
router.get(
  "/attendance/my",
  auth,
  authorize("TIMESHEET_VIEW_SELF"),
  asyncHandler(controller.myAttendance)
);

router.get(
  "/attendance",
  auth,
  authorize("TIMESHEET_VIEW_ALL"),
  asyncHandler(controller.attendanceList)
);

router.get(
  "/attendance/matrix",
  auth,
  authorize("ATTENDANCE_VIEW_ALL"),
  asyncHandler(controller.attendanceMatrix)
);

router.get(
  "/attendance/matrix/my",
  auth,
  authorize(["ATTENDANCE_VIEW_SELF", "TIMESHEET_VIEW_SELF"]),
  asyncHandler(controller.myAttendanceMatrix)
);

router.get(
  "/attendance/matrix/history",
  auth,
  authorize("ATTENDANCE_VIEW_ALL"),
  asyncHandler(controller.attendanceCellHistory)
);

router.get(
  "/attendance/matrix/history/my",
  auth,
  authorize(["ATTENDANCE_VIEW_SELF", "TIMESHEET_VIEW_SELF"]),
  asyncHandler(controller.myAttendanceCellHistory)
);

router.put(
  "/attendance/matrix/:employeeId",
  auth,
  authorize("ATTENDANCE_MANAGE"),
  validate(overrideAttendanceSchema),
  asyncHandler(controller.overrideAttendance)
);

router.post(
  "/attendance/matrix/bulk",
  auth,
  authorize("ATTENDANCE_MANAGE"),
  validate(bulkOverrideAttendanceSchema),
  asyncHandler(controller.bulkOverrideAttendance)
);

router.post(
  "/attendance/matrix/custom-bulk",
  auth,
  authorize("ATTENDANCE_MANAGE"),
  validate(customBulkOverrideAttendanceSchema),
  asyncHandler(controller.customBulkOverrideAttendance)
);

router.post(
  "/attendance/matrix/lock-month",
  auth,
  authorize("ATTENDANCE_MANAGE"),
  validate(lockAttendanceMonthSchema),
  asyncHandler(controller.lockAttendanceMonth)
);

router.post(
  "/attendance/requests/my",
  auth,
  authorize("TIMESHEET_VIEW_SELF"),
  validate(raiseAttendanceRequestSchema),
  asyncHandler(controller.raiseAttendanceRequest)
);

router.get(
  "/attendance/requests/defaults/my",
  auth,
  authorize("TIMESHEET_VIEW_SELF"),
  validate(attendanceRequestDefaultsSchema, "query"),
  asyncHandler(controller.attendanceRequestDefaults)
);

router.get(
  "/attendance/requests/my",
  auth,
  authorize("TIMESHEET_VIEW_SELF"),
  asyncHandler(controller.myAttendanceRequests)
);

router.get(
  "/attendance/requests",
  auth,
  authorize("ATTENDANCE_MANAGE"),
  asyncHandler(controller.attendanceRequests)
);

router.get(
  "/attendance/requests/pending/my-approvals",
  auth,
  authorize("ATTENDANCE_MANAGE"),
  asyncHandler(controller.pendingMyAttendanceApprovals)
);

router.put(
  "/attendance/requests/:id/action",
  auth,
  authorize("ATTENDANCE_MANAGE"),
  validate(attendanceRequestActionSchema),
  asyncHandler(controller.actionAttendanceRequest)
);

router.get(
  "/checkin-policy",
  auth,
  authorize("TIMESHEET_CHECKIN_SELF"),
  asyncHandler(controller.getCheckInPolicy)
);

router.get(
  "/online",
  auth,
  authorize("TIMESHEET_VIEW_ONLINE"),
  asyncHandler(controller.online)
);

router.get(
  "/on-leave",
  auth,
  authorize("TIMESHEET_VIEW_ALL"),
  asyncHandler(controller.onLeave)
);

// Weekly timesheets (employee)
router.post(
  "/weekly",
  auth,
  authorize("TIMESHEET_CREATE_SELF"),
  validate(createWeeklySchema),
  asyncHandler(controller.createWeekly)
);

router.get(
  "/weekly/my",
  auth,
  authorize("TIMESHEET_VIEW_SELF"),
  asyncHandler(controller.myWeekly)
);

router.put(
  "/weekly/:id",
  auth,
  authorize("TIMESHEET_EDIT_SELF"),
  validate(updateWeeklySchema),
  asyncHandler(controller.updateWeekly)
);

router.post(
  "/weekly/:id/submit",
  auth,
  authorize("TIMESHEET_SUBMIT_SELF"),
  validate(submitWeeklySchema),
  asyncHandler(controller.submitWeekly)
);

router.post(
  "/weekly/:id/recall",
  auth,
  authorize("TIMESHEET_RECALL_SELF"),
  asyncHandler(controller.recallWeekly)
);

// Weekly timesheets (admin/manager)
router.get(
  "/weekly",
  auth,
  authorize("TIMESHEET_VIEW_ALL"),
  asyncHandler(controller.listWeekly)
);

router.put(
  "/weekly/:id/action",
  auth,
  authorize("TIMESHEET_ACTION"),
  validate(actionWeeklySchema),
  asyncHandler(controller.actionWeekly)
);

module.exports = router;
