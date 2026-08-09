const Joi = require("joi");

const NAME_REGEX = /^[A-Za-z ]+$/;
const CODE_REGEX = /^[A-Z0-9_-]+$/;
const SLUG_REGEX = /^[a-z0-9_]+$/;

const buildNameSchema = ({
  min = 2,
  max = 120,
  required = false,
  allowEmpty = false,
  allowAmpersand = false,
  allowHyphen = false
} = {}) => {
  const allowDesignationSymbols = allowAmpersand || allowHyphen;
  const pattern = allowDesignationSymbols ? /^[A-Za-z &-]+$/ : NAME_REGEX;
  const patternMessage = allowDesignationSymbols
    ? "Only letters, spaces, & and - are allowed"
    : "Only letters and spaces are allowed";
  let schema = Joi.string()
    .trim()
    .min(min)
    .max(max)
    .pattern(pattern)
    .messages({
      "string.pattern.base": patternMessage
    });

  if (allowEmpty) {
    schema = schema.allow("");
  }

  return required ? schema.required() : schema.optional();
};

const buildCodeSchema = ({
  min = 2,
  max = 20,
  required = false,
  allowEmpty = false
} = {}) => {
  let schema = Joi.string()
    .trim()
    .uppercase()
    .min(min)
    .max(max)
    .pattern(CODE_REGEX)
    .messages({
      "string.pattern.base": "Only A-Z, 0-9, _ and - are allowed"
    });

  if (allowEmpty) {
    schema = schema.allow("");
  }

  return required ? schema.required() : schema.optional();
};

const buildSlugSchema = ({
  min = 2,
  max = 50,
  required = false,
  allowEmpty = false
} = {}) => {
  let schema = Joi.string()
    .trim()
    .lowercase()
    .min(min)
    .max(max)
    .pattern(SLUG_REGEX)
    .messages({
      "string.pattern.base": "Slug can contain only lowercase letters, numbers and underscores"
    });

  if (allowEmpty) {
    schema = schema.allow("");
  }

  return required ? schema.required() : schema.optional();
};

const buildEmailSchema = ({
  required = false,
  allowEmpty = false,
  max = 254
} = {}) => {
  let schema = Joi.string().trim().lowercase().email().max(max);
  if (allowEmpty) {
    schema = schema.allow("");
  }
  return required ? schema.required() : schema.optional();
};

const buildPhoneSchema = ({
  min = 10,
  max = 15,
  indianMobile = false,
  required = false,
  allowEmpty = false
} = {}) => {
  const regex = indianMobile ? /^[6-9]\d{9}$/ : new RegExp(`^\\d{${min},${max}}$`);
  let schema = Joi.string()
    .trim()
    .pattern(regex)
    .messages({
      "string.pattern.base": indianMobile
        ? "Phone must be a valid 10-digit Indian mobile number"
        : `Phone must be ${min}-${max} digits`
    });
  if (allowEmpty) {
    schema = schema.allow("");
  }
  return required ? schema.required() : schema.optional();
};

module.exports = {
  buildNameSchema,
  buildCodeSchema,
  buildSlugSchema,
  buildEmailSchema,
  buildPhoneSchema
};
