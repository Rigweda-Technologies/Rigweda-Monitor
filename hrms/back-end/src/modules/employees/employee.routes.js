const router = require("express").Router();

const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const validate = require("../../middlewares/validate.middleware");
const asyncHandler = require("../../middlewares/asyncHandler");

const {
  createEmployeeByHrSchema,
  completeProfileSchema,
  listEmployeesQuerySchema,
  updateEmployeeSchema,
  lifecycleActionSchema,
  bulkUpdateEmployeesSchema
} = require("./employee.validation");

const controller = require("./employee.controller");

/**
 * HR / ADMIN creates employee (onboarding)
 */
router.post(
  "/",
  auth,
  authorize("EMP_CREATE"),
  validate(createEmployeeByHrSchema),
  asyncHandler(controller.createByHr)
);

/**
 * Employee completes own profile (first login)
 */
router.put(
  "/me/profile",
  auth,
  authorize("EMP_SELF_EDIT"),
  validate(completeProfileSchema),
  asyncHandler(controller.completeMyProfile)
);

router.get(
  "/",
  auth,
  authorize(["EMP_VIEW", "EMP_ORG_TREE_VIEW"]),
  validate(listEmployeesQuerySchema, "query"),
  asyncHandler(controller.listByOrganization)
);

router.get(
  "/export",
  auth,
  authorize("EMP_VIEW"),
  validate(listEmployeesQuerySchema, "query"),
  asyncHandler(controller.exportCsv)
);

router.get(
  "/next-code",
  auth,
  authorize("EMP_CREATE"),
  asyncHandler(controller.getNextEmployeeCode)
);

router.get("/leave-types", auth, asyncHandler(controller.getEmployeeleaves));

router.get(
  "/upcoming-events",
  auth,
  authorize(["EMP_VIEW", "EMP_SELF_VIEW"]),
  asyncHandler(controller.upcomingEvents)
);

router.get(
  "/me",
  auth,
  authorize("EMP_SELF_VIEW"),
  asyncHandler(controller.getMe)
);

router.put(
  "/bulk-update",
  auth,
  authorize("EMP_UPDATE"),
  validate(bulkUpdateEmployeesSchema),
  asyncHandler(controller.bulkUpdate)
);

router.get(
  "/:id",
  auth,
  authorize("EMP_VIEW"),
  asyncHandler(controller.getById)
);

router.put(
  "/:id",
  auth,
  authorize("EMP_UPDATE"),
  validate(updateEmployeeSchema),
  asyncHandler(controller.updateByHr)
);

router.put(
  "/:id/lifecycle-action",
  auth,
  authorize(["EMP_UPDATE", "EMP_VIEW"]),
  validate(lifecycleActionSchema),
  asyncHandler(controller.lifecycleAction)
);

router.put(
  "/:id/reopen-profile",
  auth,
  authorize("EMP_UPDATE"),
  asyncHandler(controller.reopenProfileCompletion)
);

router.delete(
  "/:id",
  auth,
  authorize("EMP_DELETE"),
  asyncHandler(controller.remove)
);

module.exports = router;
