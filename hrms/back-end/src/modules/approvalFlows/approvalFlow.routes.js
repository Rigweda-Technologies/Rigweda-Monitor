const router = require("express").Router();
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const validate = require("../../middlewares/validate.middleware");
const asyncHandler = require("../../middlewares/asyncHandler");
const controller = require("./approvalFlow.controller");
const { createApprovalFlowSchema, updateApprovalFlowSchema } = require("./approvalFlow.validation");

router.post(
  "/",
  auth,
  authorize("APPROVAL_FLOW_MANAGE"),
  validate(createApprovalFlowSchema),
  asyncHandler(controller.create)
);

router.get(
  "/",
  auth,
  authorize("APPROVAL_FLOW_VIEW"),
  asyncHandler(controller.list)
);

router.put(
  "/:id",
  auth,
  authorize("APPROVAL_FLOW_MANAGE"),
  validate(updateApprovalFlowSchema),
  asyncHandler(controller.update)
);

router.delete(
  "/:id",
  auth,
  authorize("APPROVAL_FLOW_MANAGE"),
  asyncHandler(controller.remove)
);

module.exports = router;

