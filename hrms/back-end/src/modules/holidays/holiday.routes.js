const router = require("express").Router();
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const validate = require("../../middlewares/validate.middleware");
const asyncHandler = require("../../middlewares/asyncHandler");

const controller = require("./holiday.controller");
const {
  createHolidaySchema,
  updateHolidaySchema
} = require("./holiday.validation");

router.post(
  "/",
  auth,
  authorize("HOLIDAY_MANAGE"),
  validate(createHolidaySchema),
  asyncHandler(controller.create)
);

router.get(
  "/",
  auth,
  authorize(["HOLIDAY_VIEW", "LEAVE_VIEW_SELF", "LEAVE_APPLY"]),
  asyncHandler(controller.list)
);

router.put(
  "/:id",
  auth,
  authorize("HOLIDAY_MANAGE"),
  validate(updateHolidaySchema),
  asyncHandler(controller.update)
);

router.delete(
  "/:id",
  auth,
  authorize("HOLIDAY_MANAGE"),
  asyncHandler(controller.remove)
);

module.exports = router;
