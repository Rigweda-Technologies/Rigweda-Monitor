const router = require("express").Router();
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const asyncHandler = require("../../middlewares/asyncHandler");
const controller = require("./agent.monitorSettings.controller");

router.get(
  "/usb/control-config",
  auth,
  authorize(["EMP_SELF_VIEW", "EMP_VIEW", "ATTENDANCE_VIEW_ALL", "ORG_SETTINGS_VIEW"]),
  asyncHandler(controller.getUsbControlConfig)
);

router.get(
  "/monitor-settings/usb/control-config",
  auth,
  authorize(["ORG_SETTINGS_VIEW", "ATTENDANCE_VIEW_ALL"]),
  asyncHandler(controller.getUsbControlConfig)
);

router.get(
  "/monitor-settings/cloudinary",
  auth,
  authorize(["ORG_SETTINGS_VIEW", "ATTENDANCE_VIEW_ALL"]),
  asyncHandler(controller.getCloudinarySettings)
);

router.get(
  "/cloudinary",
  auth,
  authorize(["ORG_SETTINGS_VIEW", "ATTENDANCE_VIEW_ALL"]),
  asyncHandler(controller.getCloudinarySettings)
);

router.put(
  "/monitor-settings/cloudinary",
  auth,
  authorize(["ORG_SETTINGS_VIEW"]),
  asyncHandler(controller.saveCloudinarySettings)
);

router.put(
  "/cloudinary",
  auth,
  authorize(["ORG_SETTINGS_VIEW"]),
  asyncHandler(controller.saveCloudinarySettings)
);

router.post(
  "/cloudinary",
  auth,
  authorize(["ORG_SETTINGS_VIEW"]),
  asyncHandler(controller.saveCloudinarySettings)
);

router.post(
  "/monitor-settings/cloudinary/test",
  auth,
  authorize(["ORG_SETTINGS_VIEW"]),
  asyncHandler(controller.testCloudinarySettings)
);

router.post(
  "/cloudinary/test",
  auth,
  authorize(["ORG_SETTINGS_VIEW"]),
  asyncHandler(controller.testCloudinarySettings)
);

router.get(
  "/monitor-settings/cloudinary/upload-config",
  auth,
  authorize(["EMP_SELF_VIEW", "EMP_VIEW", "ATTENDANCE_VIEW_ALL"]),
  asyncHandler(controller.getCloudinaryUploadConfig)
);

router.get(
  "/cloudinary/upload-config",
  auth,
  authorize(["EMP_SELF_VIEW", "EMP_VIEW", "ATTENDANCE_VIEW_ALL"]),
  asyncHandler(controller.getCloudinaryUploadConfig)
);

router.put(
  "/usb/control-config",
  auth,
  authorize(["ORG_SETTINGS_VIEW"]),
  asyncHandler(controller.saveUsbControlConfig)
);

router.put(
  "/monitor-settings/usb/control-config",
  auth,
  authorize(["ORG_SETTINGS_VIEW"]),
  asyncHandler(controller.saveUsbControlConfig)
);

module.exports = router;
