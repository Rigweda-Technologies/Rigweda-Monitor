const Joi = require("joi");
const { buildNameSchema } = require("../../utils/joiValidators");

exports.createHolidaySchema = Joi.object({
  name: buildNameSchema({ min: 3, required: true }),
  date: Joi.date().required(),
  status: Joi.string().valid("active", "inactive").default("active")
});

exports.updateHolidaySchema = Joi.object({
  name: buildNameSchema({ min: 3 }),
  date: Joi.date().optional(),
  status: Joi.string().valid("active", "inactive").optional()
});
