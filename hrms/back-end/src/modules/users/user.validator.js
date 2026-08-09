const Joi = require("joi");
const { buildNameSchema, buildEmailSchema } = require("../../utils/joiValidators");

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/);

exports.switchOrgSchema = Joi.object({
  organizationId: Joi.string().required()
});

exports.loginSchema = Joi.object({
  email: Joi.string().trim().lowercase().email().max(255).required(),
  password: Joi.string().required()
})
  .required()
  .messages({
    "any.required": "Email and password are required",
  });

exports.loginWithSelfieSchema = Joi.object({
  email: Joi.string().trim().lowercase().email().max(255).required(),
  password: Joi.string().required(),
  selfieImage: Joi.string().trim().min(32).required(),
  livenessSelfieImage: Joi.string().trim().min(32).required()
})
  .required()
  .messages({
    "any.required": "Email, password and selfie image are required",
  });

exports.createUserSchema = Joi.object({
  email: buildEmailSchema({ required: true }),
  password: Joi.string().min(6).required(),
  roleIds: Joi.array().items(Joi.string()).min(1).required(),

  firstName: buildNameSchema({ required: true }),
  lastName: buildNameSchema({ required: true }),
  departmentId: objectId.optional().allow(null,""),
  designationId: objectId.optional().allow(null,""),
  employmentType: Joi.string().valid("full_time", "part_time", "contract").required(),
  dateOfJoining: Joi.date().required(),
  managerId: objectId.optional().allow(null,""),
  shiftId: objectId.optional().allow(null,"")
});

exports.switchOrgSchema = Joi.object({
  organizationId: Joi.string().required(),
  // roleId: Joi.string().optional()
});

exports.sendOTPUserSchema = Joi.object({
  email: buildEmailSchema({ required: true })
});

exports.validateOTPSchema = Joi.object({
  email: buildEmailSchema({ required: true }),

  otp: Joi.string()
    .length(6)
    .required()
});

exports.resetPasswordSchema = Joi.object({
  email: buildEmailSchema({ required: true }),
  password: Joi.string()
    .min(6)
    .required(),
  confirmPassword: Joi.any()
    .valid(Joi.ref("password"))
    .required()
    .messages({
      "any.only": "Confirm password must match password"
    })
});

exports.verifyOtpOnlySchema = Joi.object({
  otp: Joi.string()
    .length(6)
    .required()
});

exports.updatePasswordAuthSchema = Joi.object({
  password: Joi.string()
    .min(6)
    .required(),
  confirmPassword: Joi.any()
    .valid(Joi.ref("password"))
    .required()
    .messages({
      "any.only": "Confirm password must match password"
    })
});
