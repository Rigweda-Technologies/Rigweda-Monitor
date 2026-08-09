const router = require("express").Router();
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const validate = require("../../middlewares/validate.middleware");
const asyncHandler = require("../../middlewares/asyncHandler");
const controller = require("./organizationDocuments.controller");
const {
  listSchema,
  uploadSchema,
  updateMetadataSchema,
  reportSchema
} = require("./organizationDocuments.validation");

router.get(
  "/catalog",
  auth,
  authorize(["ORG_DOCUMENT_VIEW", "ORG_SETTINGS_VIEW", "PAYROLL_REPORT_VIEW"]),
  validate(listSchema, "query"),
  asyncHandler(controller.catalog)
);

router.get(
  "/summary",
  auth,
  authorize(["ORG_DOCUMENT_VIEW", "ORG_SETTINGS_VIEW", "PAYROLL_REPORT_VIEW"]),
  validate(reportSchema, "query"),
  asyncHandler(controller.summary)
);

router.get(
  "/reports/missing",
  auth,
  authorize(["ORG_DOCUMENT_VIEW", "ORG_DOCUMENT_REPORT_VIEW", "PAYROLL_REPORT_VIEW"]),
  validate(reportSchema, "query"),
  asyncHandler(controller.missing)
);

router.get(
  "/reports/expiring-soon",
  auth,
  authorize(["ORG_DOCUMENT_VIEW", "ORG_DOCUMENT_REPORT_VIEW", "PAYROLL_REPORT_VIEW"]),
  validate(reportSchema, "query"),
  asyncHandler(controller.expiringSoon)
);

router.get(
  "/",
  auth,
  authorize(["ORG_DOCUMENT_VIEW", "ORG_SETTINGS_VIEW", "PAYROLL_REPORT_VIEW"]),
  validate(listSchema, "query"),
  asyncHandler(controller.list)
);

router.post(
  "/upload",
  auth,
  authorize(["ORG_DOCUMENT_UPLOAD", "ORG_SETTINGS_MANAGE", "PAYROLL_CONFIG_MANAGE"]),
  validate(uploadSchema),
  asyncHandler(controller.upload)
);

router.patch(
  "/:id",
  auth,
  authorize(["ORG_DOCUMENT_UPLOAD", "ORG_SETTINGS_MANAGE", "PAYROLL_CONFIG_MANAGE"]),
  validate(updateMetadataSchema),
  asyncHandler(controller.updateMetadata)
);

router.get(
  "/:id/access",
  auth,
  authorize(["ORG_DOCUMENT_VIEW", "ORG_SETTINGS_VIEW", "PAYROLL_REPORT_VIEW"]),
  asyncHandler(controller.access)
);

router.get(
  "/:id/preview",
  auth,
  authorize(["ORG_DOCUMENT_VIEW", "ORG_SETTINGS_VIEW", "PAYROLL_REPORT_VIEW"]),
  asyncHandler(controller.preview)
);

router.get(
  "/:id/download",
  auth,
  authorize(["ORG_DOCUMENT_VIEW", "ORG_SETTINGS_VIEW", "PAYROLL_REPORT_VIEW"]),
  asyncHandler(controller.download)
);

router.delete(
  "/:id",
  auth,
  authorize(["ORG_DOCUMENT_DELETE", "ORG_SETTINGS_MANAGE", "PAYROLL_CONFIG_MANAGE"]),
  asyncHandler(controller.deleteById)
);

module.exports = router;
