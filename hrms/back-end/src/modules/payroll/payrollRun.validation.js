const Joi = require("joi");

const objectIdPattern = /^[0-9a-fA-F]{24}$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

exports.computePayrollRunParamsSchema = Joi.object({
  runId: Joi.string().pattern(uuidPattern).required()
});

exports.computePayrollRunBodySchema = Joi.object({
  employeeIds: Joi.array().items(Joi.string().pattern(objectIdPattern)).optional(),
  forceRecompute: Joi.boolean().default(false),
  async: Joi.boolean().default(false)
});
