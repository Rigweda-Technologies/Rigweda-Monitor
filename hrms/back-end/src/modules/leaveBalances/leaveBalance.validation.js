const Joi = require("joi");
const mongoose = require("mongoose");

const objectId = Joi.string().custom((value, helpers) => {
  if (!mongoose.Types.ObjectId.isValid(value)) return helpers.error("any.invalid");
  return value;
});

exports.adjustEmployeeLeaveBalanceSchema = Joi.object({
  balanceId: objectId.optional(),
  leaveTypeId: objectId.optional(),
  leaveTypeName: Joi.string().trim().min(2).max(120).optional(),
  days: Joi.number().precision(2).not(0).required(),
  note: Joi.string().trim().max(500).allow("", null).optional()
}).or("balanceId", "leaveTypeId", "leaveTypeName");

exports.employeeLeaveBalanceParamsSchema = Joi.object({
  employeeId: objectId.required()
});

exports.adjustAllEmployeeLeaveBalanceSchema = Joi.object({
  leaveTypeId: objectId.optional(),
  leaveTypeName: Joi.string().trim().min(2).max(120).optional(),
  days: Joi.number().precision(2).not(0).required(),
  note: Joi.string().trim().max(500).allow("", null).optional()
}).or("leaveTypeId", "leaveTypeName");
