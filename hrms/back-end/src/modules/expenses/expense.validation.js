const Joi = require("joi");
const { buildNameSchema } = require("../../utils/joiValidators");
const objectId = Joi.string().hex().length(24);

const category = Joi.string().valid(
  "assets",
  "office_rent",
  "utilities",
  "software",
  "travel",
  "maintenance",
  "salary",
  "marketing",
  "other"
);

const paymentMode = Joi.string().valid(
  "cash",
  "bank_transfer",
  "card",
  "upi",
  "cheque",
  "other"
);
const reimbursementMethod = Joi.string().valid("none", "payroll");
const reimbursementStatus = Joi.string().valid("not_applicable", "pending", "queued", "paid");

exports.createExpenseSchema = Joi.object({
  category: category.required(),
  title: Joi.string().trim().min(2).max(120).required(),
  vendorId: objectId.allow(null).optional(),
  vendor: Joi.string().trim().allow("").max(120).optional(),
  expenseDate: Joi.date().required(),
  amount: Joi.number().min(0).required(),
  taxAmount: Joi.number().min(0).optional(),
  paymentMode: paymentMode.optional(),
  reimbursementMethod: reimbursementMethod.optional(),
  purchasedBy: objectId.allow(null).optional(),
  reimbursementAmount: Joi.number().min(0).optional(),
  reimbursementPayrollMonth: Joi.string().trim().max(20).allow("").optional(),
  reimbursementNote: Joi.string().trim().max(500).allow("").optional(),
  notes: Joi.string().trim().allow("").max(1000).optional(),
  receiptUrl: Joi.string().trim().allow("").max(500).optional()
});

exports.updateExpenseSchema = Joi.object({
  category: category.optional(),
  title: Joi.string().trim().min(2).max(120).optional(),
  vendorId: objectId.allow(null).optional(),
  vendor: Joi.string().trim().allow("").max(120).optional(),
  expenseDate: Joi.date().optional(),
  amount: Joi.number().min(0).optional(),
  taxAmount: Joi.number().min(0).optional(),
  paymentMode: paymentMode.optional(),
  reimbursementMethod: reimbursementMethod.optional(),
  purchasedBy: objectId.allow(null).optional(),
  reimbursementAmount: Joi.number().min(0).optional(),
  reimbursementPayrollMonth: Joi.string().trim().max(20).allow("").optional(),
  reimbursementNote: Joi.string().trim().max(500).allow("").optional(),
  notes: Joi.string().trim().allow("").max(1000).optional(),
  receiptUrl: Joi.string().trim().allow("").max(500).optional()
});

exports.actionExpenseSchema = Joi.object({
  status: Joi.string().valid("approved", "rejected").required(),
  rejectionReason: Joi.when("status", {
    is: "rejected",
    then: Joi.string().trim().min(3).max(500).required(),
    otherwise: Joi.optional()
  })
});

exports.uploadReceiptSchema = Joi.object({
  fileName: Joi.string().trim().min(1).max(255).required(),
  fileData: Joi.string().trim().min(10).required()
});

exports.createVendorSchema = Joi.object({
  name: buildNameSchema({ required: true }),
  isActive: Joi.boolean().optional()
});

exports.updateVendorSchema = Joi.object({
  name: buildNameSchema(),
  isActive: Joi.boolean().optional()
});

exports.listExpensesQuerySchema = Joi.object({
  category: Joi.string().optional(),
  status: Joi.string().optional(),
  includeDeleted: Joi.string().valid("true", "false").optional(),
  startDate: Joi.date().optional(),
  endDate: Joi.date().optional(),
  employeeId: objectId.optional(),
  reimbursementStatus: reimbursementStatus.optional(),
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(200).optional()
});

exports.updateReimbursementSchema = Joi.object({
  reimbursementStatus: Joi.string().valid("pending", "queued", "paid").required(),
  reimbursementPayrollMonth: Joi.string().trim().max(20).allow("").optional(),
  reimbursementNote: Joi.string().trim().max(500).allow("").optional()
});
