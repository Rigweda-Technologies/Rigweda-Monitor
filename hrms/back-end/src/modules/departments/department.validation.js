const Joi = require("joi");
const mongoose = require("mongoose");
const { buildNameSchema, buildCodeSchema } = require("../../utils/joiValidators");

const objectId = Joi.string().custom((v, h) => {
  if (!mongoose.Types.ObjectId.isValid(v)) return h.error("any.invalid");
  return v;
});

exports.createDepartmentSchema = Joi.object({
  name: buildNameSchema({ required: true }),
  code: buildCodeSchema({ required: true }),
  managerId: Joi.string().optional().allow(null, ""),
  status: Joi.string().valid("active", "inactive").default("active"),
  // organizationId: objectId.required(),
});

exports.updateDepartmentSchema = Joi.object({
  name: buildNameSchema(),
  code: buildCodeSchema(),
  managerId: Joi.string().optional().allow(null, ""),
  status: Joi.string().valid("active", "inactive").required()
});
