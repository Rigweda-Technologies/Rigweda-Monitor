const Joi = require("joi");

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

exports.runIdParamSchema = Joi.object({
  runId: Joi.string().pattern(uuidPattern).required()
});

exports.submitForApprovalSchema = Joi.object({
  remarks: Joi.string().trim().max(1000).allow("", null)
});

exports.approveRunSchema = Joi.object({
  remarks: Joi.string().trim().max(1000).allow("", null)
});

exports.rejectRunSchema = Joi.object({
  reason: Joi.string().trim().min(3).max(1000).required()
});

exports.lockRunSchema = Joi.object({
  remarks: Joi.string().trim().max(1000).allow("", null)
});

exports.reopenRunSchema = Joi.object({
  reason: Joi.string().trim().min(3).max(1000).required()
});
