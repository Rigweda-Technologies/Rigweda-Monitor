const router = require("express").Router();
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const asyncHandler = require("../../middlewares/asyncHandler");
const controller = require("./agent.controller");
const monitorSettingsController = require("./agent.monitorSettings.controller");
const screenshotsRoutes = require("./agent.screenshots.routes");
const monitorSettingsRoutes = require("./agent.monitorSettings.routes");
const monitorUploadsRoutes = require("./agent.monitorUploads.routes");

router.get("/me", auth, authorize("EMP_SELF_VIEW"), asyncHandler(controller.getMe));
router.get(
  "/usb/control-config",
  auth,
  authorize(["EMP_SELF_VIEW", "EMP_VIEW", "ATTENDANCE_VIEW_ALL", "ORG_SETTINGS_VIEW"]),
  asyncHandler(monitorSettingsController.getUsbControlConfig)
);
router.put(
  "/usb/control-config",
  auth,
  authorize("ORG_SETTINGS_VIEW"),
  asyncHandler(monitorSettingsController.saveUsbControlConfig)
);
router.use("/", screenshotsRoutes);
router.use("/", monitorSettingsRoutes);
router.use("/", monitorUploadsRoutes);

module.exports = router;
