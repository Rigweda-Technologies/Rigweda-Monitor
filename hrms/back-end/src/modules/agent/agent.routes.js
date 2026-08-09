const router = require("express").Router();
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const asyncHandler = require("../../middlewares/asyncHandler");
const controller = require("./agent.controller");

router.get("/me", auth, authorize("EMP_SELF_VIEW"), asyncHandler(controller.getMe));

module.exports = router;
