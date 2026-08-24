const router = require("express").Router();
const auth = require("../../middlewares/auth.middleware");
const asyncHandler = require("../../middlewares/asyncHandler");
const controller = require("./monitorUpdates.controller");

router.get("/releases", auth, asyncHandler(controller.listReleases));
router.post("/releases", auth, asyncHandler(controller.createRelease));
router.patch("/releases/:releaseId", auth, asyncHandler(controller.activateRelease));
router.get("/update/latest", auth, asyncHandler(controller.getLatest));
router.post("/update/status", auth, asyncHandler(controller.postStatus));

module.exports = router;
