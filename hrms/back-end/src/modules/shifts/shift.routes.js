const router = require("express").Router();
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const validate = require("../../middlewares/validate.middleware");
const asyncHandler = require("../../middlewares/asyncHandler");
const controller = require("./shift.controller");
const { createShiftSchema, updateShiftSchema, shiftIdParamSchema } = require("./shift.validation");

router.post(
  "/",
  auth,
  authorize("SHIFT_MANAGE"),
  validate(createShiftSchema),
  asyncHandler(controller.create)
);

router.get(
  "/",
  auth,
  authorize("SHIFT_VIEW"),
  asyncHandler(controller.list)
);

router.get(
  "/my",
  auth,
  authorize("SHIFT_VIEW_SELF"),
  asyncHandler(controller.myShift)
);

router.put(
  "/:id",
  auth,
  authorize("SHIFT_MANAGE"),
  validate(shiftIdParamSchema, "params"),
  validate(updateShiftSchema),
  asyncHandler(controller.update)
);

router.delete(
  "/:id",
  auth,
  authorize("SHIFT_MANAGE"),
  validate(shiftIdParamSchema, "params"),
  asyncHandler(controller.remove)
);

module.exports = router;

