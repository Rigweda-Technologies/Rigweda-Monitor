const router = require("express").Router();
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const asyncHandler = require("../../middlewares/asyncHandler");
const roleValidator = require("./role.validator");
const controller = require("./role.controller");
const roleSwitchController = require("./role.switch.controller");
const validate = require("../../middlewares/validate.middleware");


router.post("/", auth, authorize("ROLE_CREATE"), validate(roleValidator.createRoleSchema), asyncHandler(controller.create));
router.put("/:id", auth, authorize("ROLE_UPDATE"), validate(roleValidator.updateRoleSchema), asyncHandler(controller.update));
router.delete("/:id", auth, authorize("ROLE_DELETE"), asyncHandler(controller.remove));
router.get("/", auth, authorize("ROLE_VIEW"), asyncHandler(controller.list));
router.get("/:id", auth, authorize("ROLE_VIEW"), asyncHandler(controller.getById));
router.post("/switch", auth, validate(roleValidator.switchRoleSchema), asyncHandler(roleSwitchController.switchRole));

module.exports = router;
