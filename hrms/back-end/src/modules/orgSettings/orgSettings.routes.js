const router = require("express").Router();
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const validate = require("../../middlewares/validate.middleware");
const asyncHandler = require("../../middlewares/asyncHandler");

const controller = require("./orgSettings.controller");
const { upsertOrgSettingsSchema } = require("./orgSettings.validation");

router.get(
  "/",
  auth,
  authorize("ORG_SETTINGS_VIEW"),
  asyncHandler(controller.get)
);

router.post(
  "/",
  auth,
  authorize("ORG_SETTINGS_MANAGE"),
  validate(upsertOrgSettingsSchema),
  asyncHandler(controller.upsert)
);

module.exports = router;
