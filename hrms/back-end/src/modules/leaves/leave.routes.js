const router = require("express").Router();
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const validate = require("../../middlewares/validate.middleware");
const asyncHandler = require("../../middlewares/asyncHandler");

const controller = require("./leave.controller");
const {
  applyLeaveSchema,
  leaveActionSchema,
  leaveRevertRequestSchema,
  leaveRevertActionSchema
} = require("./leave.validation");

// Employee applies leave
router.post(
  "/apply",
  auth,
  authorize("LEAVE_APPLY"),
  validate(applyLeaveSchema),
  asyncHandler(controller.apply)
);

// Employee views own leaves
router.get(
  "/my",
  auth,
  authorize("LEAVE_VIEW_SELF"),
  asyncHandler(controller.myLeaves)
);

router.get(
  "/my-range",
  auth,
  authorize("LEAVE_VIEW_SELF"),
  asyncHandler(controller.myLeavesRange)
);

router.get(
  "/apply-context",
  auth,
  authorize("LEAVE_APPLY"),
  asyncHandler(controller.applyContext)
);

// HR / Manager views all leaves
router.get(
  "/",
  auth,
  authorize("LEAVE_VIEW_ALL"),
  asyncHandler(controller.list)
);

router.get(
  "/pending/my-approvals",
  auth,
  authorize("LEAVE_ACTION"),
  asyncHandler(controller.pendingMyApprovals)
);

// Approve / Reject
router.put(
  "/:id/action",
  auth,
  authorize("LEAVE_ACTION"),
  validate(leaveActionSchema),
  asyncHandler(controller.action)
);

router.post(
  "/:id/revert-request",
  auth,
  authorize("LEAVE_VIEW_SELF"),
  validate(leaveRevertRequestSchema),
  asyncHandler(controller.requestRevert)
);

router.put(
  "/:id/revert-request/action",
  auth,
  authorize("LEAVE_ACTION"),
  validate(leaveRevertActionSchema),
  asyncHandler(controller.revertAction)
);

module.exports = router;
