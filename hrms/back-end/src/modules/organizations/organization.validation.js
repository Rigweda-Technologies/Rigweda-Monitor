const Joi = require("joi");
const { buildNameSchema, buildCodeSchema } = require("../../utils/joiValidators");

exports.createOrganizationSchema = Joi.object({
  name: buildNameSchema({ required: true }),
  code: buildCodeSchema({ required: true }),
  timezone: Joi.string().required(),
  currency: Joi.string().required(),
  adminUserId: Joi.string().optional(),
  adminRoleId: Joi.string().optional()
});

exports.updateOrganizationSchema = Joi.object({
  name: buildNameSchema(),
  code: buildCodeSchema(),
  timezone: Joi.string().optional(),
  currency: Joi.string().optional(),
  status: Joi.string().valid("active", "inactive").optional()
});

exports.organizationLifecycleSchema = Joi.object({
  action: Joi.string().valid("soft_delete", "restore", "hard_delete").required(),
  confirmationCode: Joi.string().trim().required()
});

exports.organizationPayrollClearSchema = Joi.object({
  mode: Joi.string().valid("generated", "all").default("generated"),
  confirmationCode: Joi.string().trim().required()
});
