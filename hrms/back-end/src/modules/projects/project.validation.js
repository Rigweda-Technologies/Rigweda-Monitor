const Joi = require("joi");
const { buildNameSchema, buildEmailSchema, buildPhoneSchema } = require("../../utils/joiValidators");
const objectId = Joi.string().hex().length(24);
const fileUploadSchema = Joi.object({
  fileName: Joi.string().required(),
  mimeType: Joi.string().required(),
  base64Data: Joi.string().required()
});

exports.createProjectSchema = Joi.object({
  projectName: Joi.string().trim().min(2).max(120).required(),
  logoUrl: Joi.string().uri().allow("").optional(),
  clientName: buildNameSchema({ required: true }),
  clientCompany: Joi.string().trim().max(120).allow("").optional(),
  clientEmail: buildEmailSchema({ allowEmpty: true }),
  clientPhone: buildPhoneSchema({ allowEmpty: true }),
  clientAddress: Joi.string().trim().max(500).allow("").optional(),
  actualAmount: Joi.number().min(0).required(),
  discountedAmount: Joi.number().min(0).required(),
  paidAmount: Joi.number().min(0).optional(),
  paidTo: objectId.required(),
  status: Joi.string().valid("active", "on_hold", "completed", "cancelled").optional(),
  startDate: Joi.date().allow(null).optional(),
  expectedEndDate: Joi.date().allow(null).optional(),
  notes: Joi.string().trim().max(1000).allow("").optional(),
  mouUpload: fileUploadSchema.optional(),
  documentationUpload: fileUploadSchema.optional()
});

exports.updateProjectSchema = Joi.object({
  projectName: Joi.string().trim().min(2).max(120).optional(),
  logoUrl: Joi.string().uri().allow("").optional(),
  clientName: buildNameSchema(),
  clientCompany: Joi.string().trim().max(120).allow("").optional(),
  clientEmail: buildEmailSchema({ allowEmpty: true }),
  clientPhone: buildPhoneSchema({ allowEmpty: true }),
  clientAddress: Joi.string().trim().max(500).allow("").optional(),
  actualAmount: Joi.number().min(0).optional(),
  discountedAmount: Joi.number().min(0).optional(),
  paidAmount: Joi.number().min(0).optional(),
  paidTo: objectId.allow(null, "").optional(),
  status: Joi.string().valid("active", "on_hold", "completed", "cancelled").optional(),
  startDate: Joi.date().allow(null).optional(),
  expectedEndDate: Joi.date().allow(null).optional(),
  notes: Joi.string().trim().max(1000).allow("").optional(),
  mouUpload: fileUploadSchema.optional(),
  documentationUpload: fileUploadSchema.optional()
});

exports.listProjectsQuerySchema = Joi.object({
  status: Joi.string().valid("active", "on_hold", "completed", "cancelled", "all").optional(),
  search: Joi.string().trim().allow("").optional()
});
