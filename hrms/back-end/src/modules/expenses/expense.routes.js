const router = require("express").Router();
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const validate = require("../../middlewares/validate.middleware");
const asyncHandler = require("../../middlewares/asyncHandler");
const controller = require("./expense.controller");
const {
  createExpenseSchema,
  updateExpenseSchema,
  listExpensesQuerySchema,
  actionExpenseSchema,
  updateReimbursementSchema,
  uploadReceiptSchema,
  createVendorSchema,
  updateVendorSchema
} = require("./expense.validation");

router.post(
  "/",
  auth,
  authorize("EXPENSE_MANAGE"),
  validate(createExpenseSchema),
  asyncHandler(controller.create)
);

router.get(
  "/",
  auth,
  authorize(["EXPENSE_VIEW", "EXPENSE_MANAGE"]),
  validate(listExpensesQuerySchema, "query"),
  asyncHandler(controller.list)
);

router.get(
  "/summary",
  auth,
  authorize(["EXPENSE_VIEW", "EXPENSE_MANAGE"]),
  validate(listExpensesQuerySchema, "query"),
  asyncHandler(controller.summary)
);

router.get(
  "/employees",
  auth,
  authorize(["EXPENSE_VIEW", "EXPENSE_MANAGE"]),
  asyncHandler(controller.listEmployees)
);

router.post(
  "/upload-receipt",
  auth,
  authorize("EXPENSE_MANAGE"),
  validate(uploadReceiptSchema),
  asyncHandler(controller.uploadReceipt)
);

router.get(
  "/vendors",
  auth,
  authorize(["EXPENSE_VIEW", "EXPENSE_MANAGE"]),
  asyncHandler(controller.listVendors)
);

router.post(
  "/vendors",
  auth,
  authorize("EXPENSE_MANAGE"),
  validate(createVendorSchema),
  asyncHandler(controller.createVendor)
);

router.put(
  "/vendors/:vendorId",
  auth,
  authorize("EXPENSE_MANAGE"),
  validate(updateVendorSchema),
  asyncHandler(controller.updateVendor)
);

router.delete(
  "/vendors/:vendorId",
  auth,
  authorize("EXPENSE_MANAGE"),
  asyncHandler(controller.removeVendor)
);

router.put(
  "/:id",
  auth,
  authorize("EXPENSE_MANAGE"),
  validate(updateExpenseSchema),
  asyncHandler(controller.update)
);

router.delete(
  "/:id",
  auth,
  authorize("EXPENSE_MANAGE"),
  asyncHandler(controller.remove)
);

router.put(
  "/:id/action",
  auth,
  authorize("EXPENSE_ACTION"),
  validate(actionExpenseSchema),
  asyncHandler(controller.action)
);

router.put(
  "/:id/reimbursement",
  auth,
  authorize("EXPENSE_MANAGE"),
  validate(updateReimbursementSchema),
  asyncHandler(controller.updateReimbursement)
);

router.put(
  "/:id/restore",
  auth,
  authorize("EXPENSE_MANAGE"),
  asyncHandler(controller.restore)
);

module.exports = router;
