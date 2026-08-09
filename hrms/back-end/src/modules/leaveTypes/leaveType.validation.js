const Joi = require("joi");
const { buildNameSchema, buildCodeSchema } = require("../../utils/joiValidators");

const createLeaveTypeSchema = Joi.object({
  name: buildNameSchema({ required: true }),
  code: buildCodeSchema({ max: 5, required: true }),
  description: Joi.string().allow(""),
  daysPerYear: Joi.number().min(0).required(),
  isCarryForward: Joi.boolean().default(false),
  includeInPayroll: Joi.boolean().default(true),
  maxCarryForward: Joi.number().min(0).allow(null),
  status: Joi.string().optional().valid("active", "inactive").default("active")
});

const updateLeaveTypeSchema = Joi.object({
  name: buildNameSchema(),
  code: buildCodeSchema({ max: 5 }),
  description: Joi.string().allow(""),
  daysPerYear: Joi.number().min(0),
  isCarryForward: Joi.boolean(),
  includeInPayroll: Joi.boolean(),
  maxCarryForward: Joi.number().min(0).allow(null),
  status: Joi.string().valid("active", "inactive")
});

module.exports = { createLeaveTypeSchema, updateLeaveTypeSchema };
