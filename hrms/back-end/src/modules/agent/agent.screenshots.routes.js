const router = require("express").Router();
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const asyncHandler = require("../../middlewares/asyncHandler");
const controller = require("./agent.screenshots.controller");

router.get("/screenshots", auth, authorize("ATTENDANCE_VIEW_ALL"), asyncHandler(controller.listScreenshots));

module.exports = router;
