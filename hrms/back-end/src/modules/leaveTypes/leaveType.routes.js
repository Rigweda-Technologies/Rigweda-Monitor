const router = require("express").Router();
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const validate = require("../../middlewares/validate.middleware");
const asyncHandler = require("../../middlewares/asyncHandler");
const controller = require("./leaveType.controller");
const { createLeaveTypeSchema, updateLeaveTypeSchema } = require("./leaveType.validation");

router.post("/", auth, authorize("LEAVE_TYPE_MANAGE"), validate(createLeaveTypeSchema), asyncHandler(controller.create));
router.get("/", auth, authorize("LEAVE_TYPE_VIEW"), asyncHandler(controller.list));
router.put("/:id",auth,authorize("LEAVE_TYPE_MANAGE"),validate(updateLeaveTypeSchema),asyncHandler(controller.update));
router.delete("/:id",auth,authorize("LEAVE_TYPE_MANAGE"),asyncHandler(controller.deleteById));

module.exports = router;