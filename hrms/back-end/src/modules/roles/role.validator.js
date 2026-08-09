const Joi = require("joi");
const mongoose = require("mongoose");
const { buildNameSchema, buildSlugSchema } = require("../../utils/joiValidators");

/* -------------------------------------------------------------------------- */
/*                               COMMON HELPERS                                */
/* -------------------------------------------------------------------------- */

const objectId = Joi.string().custom((value, helpers) => {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    return helpers.error("any.invalid");
  }
  return value;
}, "ObjectId validation");

/* -------------------------------------------------------------------------- */
/*                               CREATE ROLE                                   */
/* -------------------------------------------------------------------------- */

exports.createRoleSchema = Joi.object({
  name: buildNameSchema({ max: 50, required: true }),
  slug: buildSlugSchema({ required: true }),

  permissionIds: Joi.array()
    .items(objectId)
    .optional(),

  isSystemRole: Joi.boolean().optional()
});

/* -------------------------------------------------------------------------- */
/*                               UPDATE ROLE                                   */
/* -------------------------------------------------------------------------- */

exports.updateRoleSchema = Joi.object({
  name: buildNameSchema({ max: 50 }),

  permissionIds: Joi.array()
    .items(objectId)
    .min(1)
    .optional(),

  status: Joi.string()
    .valid("active", "inactive")
    .optional()
});

/* -------------------------------------------------------------------------- */
/*                               ROLE SWITCH                                   */
/* -------------------------------------------------------------------------- */

exports.switchRoleSchema = Joi.object({
  roleId: objectId.required()
}).required();
