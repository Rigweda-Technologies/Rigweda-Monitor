const router = require("express").Router();
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const asyncHandler = require("../../middlewares/asyncHandler");
const controller = require("./agent.controller");
const screenshotsRoutes = require("./agent.screenshots.routes");
const monitorSettingsRoutes = require("./agent.monitorSettings.routes");
const monitorUploadsRoutes = require("./agent.monitorUploads.routes");
const healthRoutes = require("./agent.health.routes");

router.get("/me", auth, authorize("EMP_SELF_VIEW"), asyncHandler(controller.getMe));
router.use("/", screenshotsRoutes);
router.use("/", monitorSettingsRoutes);
router.use("/", monitorUploadsRoutes);
router.use("/", healthRoutes);

module.exports = router;
