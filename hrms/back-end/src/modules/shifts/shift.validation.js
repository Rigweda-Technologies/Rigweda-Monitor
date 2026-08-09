const Joi = require("joi");
const mongoose = require("mongoose");
const { buildNameSchema, buildCodeSchema } = require("../../utils/joiValidators");

const objectId = Joi.string().custom((value, helpers) => {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    return helpers.error("any.invalid");
  }
  return value;
});

const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

exports.createShiftSchema = Joi.object({
  name: buildNameSchema({ max: 80, required: true }),
  code: buildCodeSchema({ max: 20, required: true }),
  startTime: Joi.string().pattern(timeRegex).required(),
  endTime: Joi.string().pattern(timeRegex).required(),
  graceMinutes: Joi.number().integer().min(0).max(180).default(0),
  status: Joi.string().valid("active", "inactive").default("active")
});

exports.updateShiftSchema = Joi.object({
  name: buildNameSchema({ max: 80 }),
  code: buildCodeSchema({ max: 20 }),
  startTime: Joi.string().pattern(timeRegex).optional(),
  endTime: Joi.string().pattern(timeRegex).optional(),
  graceMinutes: Joi.number().integer().min(0).max(180).optional(),
  status: Joi.string().valid("active", "inactive").optional()
});

exports.shiftIdParamSchema = Joi.object({
  id: objectId.required()
});
