const router = require("express").Router();
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const asyncHandler = require("../../middlewares/asyncHandler");
const controller = require("./permission.controller");

router.get(
  "/",
  auth,
  authorize("PERMISSION_VIEW"),
  asyncHandler(controller.list)
);

module.exports = router;