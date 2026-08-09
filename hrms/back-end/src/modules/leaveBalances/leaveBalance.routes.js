const router = require("express").Router();
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const asyncHandler = require("../../middlewares/asyncHandler");
const validate = require("../../middlewares/validate.middleware");
const controller = require("./leaveBalance.controller");
const {
  adjustAllEmployeeLeaveBalanceSchema,
  adjustEmployeeLeaveBalanceSchema,
  employeeLeaveBalanceParamsSchema
} = require("./leaveBalance.validation");

// ✅ EMPLOYEE – own balance (SAFE PATH)
router.get(
  "/my",
  auth,
  authorize("LEAVE_VIEW_SELF"),
  asyncHandler(controller.getMyLeaveBalance)
);

// ✅ HR / MANAGER – employee balance
router.get(
  "/employee/:employeeId",
  auth,
  authorize("LEAVE_VIEW_ALL"),
  validate(employeeLeaveBalanceParamsSchema, "params"),
  asyncHandler(controller.getEmployeeLeaveBalance)
);

router.post(
  "/employee/:employeeId/adjust",
  auth,
  authorize("LEAVE_VIEW_ALL"),
  validate(employeeLeaveBalanceParamsSchema, "params"),
  validate(adjustEmployeeLeaveBalanceSchema),
  asyncHandler(controller.adjustEmployeeLeaveBalance)
);

router.post(
  "/adjust-all",
  auth,
  authorize("LEAVE_VIEW_ALL"),
  validate(adjustAllEmployeeLeaveBalanceSchema),
  asyncHandler(controller.adjustAllEmployeeLeaveBalance)
);

module.exports = router;
