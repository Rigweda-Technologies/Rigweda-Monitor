const Joi = require("joi");

const objectIdPattern = /^[0-9a-fA-F]{24}$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

exports.getRunPayslipParamsSchema = Joi.object({
  runId: Joi.string().pattern(uuidPattern).required(),
  employeeExternalId: Joi.string().pattern(objectIdPattern).required()
});

exports.getMonthlyPayslipQuerySchema = Joi.object({
  month: Joi.string().pattern(/^\d{4}-\d{2}$/).required(),
  employeeExternalId: Joi.string().pattern(objectIdPattern).required()
});

exports.getMyMonthlyPayslipQuerySchema = Joi.object({
  month: Joi.string().pattern(/^\d{4}-\d{2}$/).required()
});

exports.getMyRunPayslipParamsSchema = Joi.object({
  runId: Joi.string().pattern(uuidPattern).required()
});
