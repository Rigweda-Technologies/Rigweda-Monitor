const router = require("express").Router();
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const validate = require("../../middlewares/validate.middleware");
const asyncHandler = require("../../middlewares/asyncHandler");

const {
  createDepartmentSchema,
  updateDepartmentSchema
} = require("./department.validation");

const controller = require("./department.controller");

router.post("/", auth, authorize("DEPT_CREATE"), validate(createDepartmentSchema), asyncHandler(controller.create));
router.put("/:id", auth, authorize("DEPT_UPDATE"), validate(updateDepartmentSchema), asyncHandler(controller.update));
router.delete("/:id", auth, authorize("DEPT_DELETE"), asyncHandler(controller.remove));
router.get("/:id", auth, authorize("DEPT_VIEW"), asyncHandler(controller.getById));
router.get("/", auth, authorize("DEPT_VIEW"), asyncHandler(controller.list));

// router.patch("/:id/restore", auth, authorize("DEPT_RESTORE"), asyncHandler(controller.restore));

module.exports = router;
