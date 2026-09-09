const router = require("express").Router();
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const validate = require("../../middlewares/validate.middleware");
const asyncHandler = require("../../middlewares/asyncHandler");

const controller = require("./orgSettings.controller");
const { upsertOrgSettingsSchema, updateThemeSchema } = require("./orgSettings.validation");

// Every authenticated organization member can read its appearance.
router.get("/theme", auth, asyncHandler(controller.getTheme));
router.post(
  "/theme",
  auth,
  authorize("ORG_SETTINGS_MANAGE"),
  validate(updateThemeSchema),
  asyncHandler(controller.updateTheme)
);

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
