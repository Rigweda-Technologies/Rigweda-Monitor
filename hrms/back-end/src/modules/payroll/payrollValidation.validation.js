const Joi = require("joi");

const objectIdPattern = /^[0-9a-fA-F]{24}$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

exports.validatePayrollRunParamsSchema = Joi.object({
  runId: Joi.string().pattern(uuidPattern).required()
});

exports.validatePayrollRunBodySchema = Joi.object({
  employeeIds: Joi.array().items(Joi.string().pattern(objectIdPattern)).optional(),
  strictMode: Joi.boolean().default(false)
});
