const Joi = require("joi");

const objectIdPattern = /^[0-9a-fA-F]{24}$/;

exports.generateSnapshotSchema = Joi.object({
  month: Joi.string().pattern(/^\d{4}-\d{2}$/).required(),
  employeeIds: Joi.array()
    .items(Joi.string().pattern(objectIdPattern))
    .min(1)
    .optional(),
  forceRebuild: Joi.boolean().default(false),
  includeInactiveEmployees: Joi.boolean().default(false),
  unpaidLeaveTypeCodes: Joi.array()
    .items(Joi.string().trim().uppercase().min(2).max(20))
    .default(["LOP", "LWP", "LWOP", "ULOP", "UNPAID"])
});

exports.listSnapshotsQuerySchema = Joi.object({
  month: Joi.string().pattern(/^\d{4}-\d{2}$/).required(),
  employeeId: Joi.string().pattern(objectIdPattern).optional()
});
