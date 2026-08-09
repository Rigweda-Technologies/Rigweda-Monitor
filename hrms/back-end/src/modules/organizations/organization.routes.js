const router = require("express").Router();
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const validate = require("../../middlewares/validate.middleware");
const asyncHandler = require("../../middlewares/asyncHandler");

const controller = require("./organization.controller");
const {
  createOrganizationSchema,
  updateOrganizationSchema,
  organizationLifecycleSchema,
  organizationPayrollClearSchema
} = require("./organization.validation");

/**
 * CREATE ORGANIZATION
 * SuperAdmin / OrgAdmin
 */
router.post(
  "/",
  auth,
  authorize("ORG_MANAGE"),
  validate(createOrganizationSchema),
  asyncHandler(controller.create)
);

/**
 * UPDATE ORGANIZATION
 */
router.put(
  "/:id",
  auth,
  authorize("ORG_MANAGE"),
  validate(updateOrganizationSchema),
  asyncHandler(controller.update)
);

/**
 * GET ORGANIZATION BY ID
 */
router.get(
  "/:id",
  auth,
  authorize("ORG_VIEW"),
  asyncHandler(controller.getById)
);

/**
 * LIST ORGANIZATIONS
 */
router.get(
  "/",
  auth,
  authorize("ORG_VIEW"),
  asyncHandler(controller.list)
);

/**
 * DELETE (SOFT) ORGANIZATION
 */
router.delete(
  "/:id",
  auth,
  authorize("ORG_MANAGE"),
  asyncHandler(controller.deleteById)
);

/**
 * ORGANIZATION LIFECYCLE ACTION
 * SuperAdmin only (validated in service)
 */
router.post(
  "/:id/lifecycle",
  auth,
  authorize("ORG_MANAGE"),
  validate(organizationLifecycleSchema),
  asyncHandler(controller.lifecycleAction)
);

router.post(
  "/:id/payroll-clear",
  auth,
  authorize("ORG_MANAGE"),
  validate(organizationPayrollClearSchema),
  asyncHandler(controller.clearPayrollData)
);

module.exports = router;
