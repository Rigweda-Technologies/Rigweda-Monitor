const router = require("express").Router();
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const validate = require("../../middlewares/validate.middleware");
const asyncHandler = require("../../middlewares/asyncHandler");

const {
  createDesignationSchema,
  updateDesignationSchema
} = require("./designation.validation");

const controller = require("./designation.controller");

router.post("/", auth, authorize("DESIG_CREATE"), validate(createDesignationSchema), asyncHandler(controller.create));
router.put("/:id", auth, authorize("DESIG_UPDATE"), validate(updateDesignationSchema), asyncHandler(controller.update));
router.delete("/:id", auth, authorize("DESIG_DELETE"), asyncHandler(controller.remove));
router.get("/", auth, authorize("DESIG_VIEW"), asyncHandler(controller.list));

module.exports = router;
