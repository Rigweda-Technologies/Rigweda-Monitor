const router = require("express").Router();
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const asyncHandler = require("../../middlewares/asyncHandler");
const controller = require("./agent.monitorUploads.controller");
const settingsController = require("./agent.monitorSettings.controller");

router.get(
  "/cloudinary/upload-config",
  auth,
  authorize(["EMP_SELF_VIEW", "EMP_VIEW", "ATTENDANCE_VIEW_ALL"]),
  asyncHandler(settingsController.getCloudinaryUploadConfig)
);

router.post(
  "/screenshot-batches/uploads",
  auth,
  authorize(["EMP_SELF_VIEW", "EMP_VIEW"]),
  asyncHandler(controller.createUploadSession)
);

router.post(
  "/screenshot-batches/:batchId/complete",
  auth,
  authorize(["EMP_SELF_VIEW", "EMP_VIEW"]),
  asyncHandler(controller.completeUploadSession)
);

module.exports = router;
