const Joi = require("joi");
const mongoose = require("mongoose");
const { buildNameSchema } = require("../../utils/joiValidators");

const objectId = Joi.string().custom((value, helpers) => {
  if (!mongoose.Types.ObjectId.isValid(value)) return helpers.error("any.invalid");
  return value;
});

const stepSchema = Joi.object({
  stepNumber: Joi.number().integer().min(1).required(),
  approverType: Joi.string().valid("manager", "role", "employee").required(),
  roleSlug: Joi.when("approverType", {
    is: "role",
    then: Joi.string().trim().min(2).required(),
    otherwise: Joi.optional().allow(null, "")
  }),
  employeeId: Joi.when("approverType", {
    is: "employee",
    then: objectId.required(),
    otherwise: Joi.optional().allow(null, "")
  })
});

exports.createApprovalFlowSchema = Joi.object({
  moduleKey: Joi.string().valid("leave", "attendance_request").required(),
  name: buildNameSchema({ required: true }),
  isActive: Joi.boolean().default(true),
  minDays: Joi.number().min(0).required(),
  maxDays: Joi.number().min(0).allow(null),
  steps: Joi.array().items(stepSchema).min(1).required()
});

exports.updateApprovalFlowSchema = Joi.object({
  moduleKey: Joi.string().valid("leave", "attendance_request").optional(),
  name: buildNameSchema(),
  isActive: Joi.boolean().optional(),
  minDays: Joi.number().min(0).optional(),
  maxDays: Joi.number().min(0).allow(null),
  steps: Joi.array().items(stepSchema).min(1).optional()
});
