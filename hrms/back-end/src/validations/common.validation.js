const Joi = require("joi");

exports.objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/);

exports.phone = Joi.string()
  .pattern(/^[0-9+\-() ]{7,20}$/)
  .messages({
    "string.pattern.base": "Invalid phone number"
  });

exports.employmentType = Joi.string().valid(
  "full_time",
  "part_time",
  "contract"
);
