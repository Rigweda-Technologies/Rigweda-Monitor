const Joi = require("joi");
const { DOCUMENT_CATEGORIES, DOCUMENT_TYPE_BY_KEY } = require("./organizationDocuments.catalog");

const DOCUMENT_KEYS = Object.keys(DOCUMENT_TYPE_BY_KEY);
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
];
const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024;

const uploadPayloadSchema = Joi.object({
  fileName: Joi.string().trim().max(180).required(),
  mimeType: Joi.string().valid(...ALLOWED_MIME_TYPES).required(),
  size: Joi.number().integer().min(1).max(MAX_FILE_SIZE_BYTES).required(),
  base64Data: Joi.string().required()
});

exports.MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_BYTES;
exports.ALLOWED_MIME_TYPES = ALLOWED_MIME_TYPES;

exports.listSchema = Joi.object({
  category: Joi.string().valid(...DOCUMENT_CATEGORIES).allow("").optional(),
  status: Joi.string().valid("ACTIVE", "EXPIRED", "PENDING").allow("").optional(),
  search: Joi.string().trim().max(120).allow("").optional(),
  includeHistory: Joi.boolean().truthy("true").falsy("false").default(false),
  esicApplicable: Joi.boolean().truthy("true").falsy("false").default(true)
});

exports.uploadSchema = Joi.object({
  documentKey: Joi.string().valid(...DOCUMENT_KEYS).required(),
  documentNumber: Joi.string().trim().max(80).allow("").default(""),
  expiryDate: Joi.date().iso().allow(null),
  remarks: Joi.string().trim().max(500).allow("").default(""),
  file: uploadPayloadSchema.required()
});

exports.updateMetadataSchema = Joi.object({
  documentNumber: Joi.string().trim().max(80).allow("").default(""),
  expiryDate: Joi.date().iso().allow(null),
  remarks: Joi.string().trim().max(500).allow("").default("")
});

exports.reportSchema = Joi.object({
  days: Joi.number().integer().min(1).max(365).default(30),
  esicApplicable: Joi.boolean().truthy("true").falsy("false").default(true)
});
