const router = require("express").Router();
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const validate = require("../../middlewares/validate.middleware");
const asyncHandler = require("../../middlewares/asyncHandler");

const controller = require("./weekOff.controller");
const { upsertWeekOffSchema } = require("./weekOff.validation");

// Create / Update week off
router.post(
  "/",
  auth,
  authorize("WEEK_OFF_MANAGE"),
  validate(upsertWeekOffSchema),
  asyncHandler(controller.upsert)
);

router.get(
  "/all",
  auth,
  authorize("WEEK_OFF_VIEW"),
  asyncHandler(controller.getAll)
);

// Get week off
router.get(
  "/",
  auth,
  authorize("WEEK_OFF_VIEW"),
  asyncHandler(controller.get)
);

module.exports = router;
