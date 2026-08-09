const Joi = require("joi");

const localDateSchema = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/);

const entrySchema = Joi.object({
  date: Joi.date().required(),
  hours: Joi.number().min(0).max(24).required(),
  notes: Joi.string().allow("").max(500).optional()
});

exports.createWeeklySchema = Joi.object({
  weekStart: Joi.date().optional(),
  entries: Joi.array().items(entrySchema).optional()
});

exports.checkInSchema = Joi.object({
  clientIp: Joi.string().trim().allow("", null).optional(),
  publicIp: Joi.string().trim().allow("", null).optional(),
  ipAddress: Joi.string().trim().allow("", null).optional(),
  deviceId: Joi.string().trim().allow("", null).optional(),
  accuracy: Joi.number().min(0).optional(),
  latitude: Joi.number().min(-90).max(90).optional(),
  longitude: Joi.number().min(-180).max(180).optional(),
  selfieImage: Joi.string().max(5 * 1024 * 1024).allow("").optional()
});

exports.checkOutSchema = Joi.object({
  clientIp: Joi.string().trim().allow("", null).optional(),
  publicIp: Joi.string().trim().allow("", null).optional(),
  ipAddress: Joi.string().trim().allow("", null).optional(),
  deviceId: Joi.string().trim().allow("", null).optional(),
  accuracy: Joi.number().min(0).optional(),
  latitude: Joi.number().min(-90).max(90).optional(),
  longitude: Joi.number().min(-180).max(180).optional(),
  selfieImage: Joi.string().max(5 * 1024 * 1024).allow("").optional()
});

exports.updateWeeklySchema = Joi.object({
  entries: Joi.array().items(entrySchema).required(),
  weekStart: Joi.date().optional()
});

exports.submitWeeklySchema = Joi.object({
  weekStart: Joi.date().optional(),
  entries: Joi.array().items(entrySchema).optional()
});

exports.actionWeeklySchema = Joi.object({
  status: Joi.string().valid("approved", "rejected").required(),
  rejectionReason: Joi.when("status", {
    is: "rejected",
    then: Joi.string().min(3).required(),
    otherwise: Joi.optional()
  })
});

exports.overrideAttendanceSchema = Joi.object({
  date: Joi.date().required(),
  status: Joi.string().valid("present", "half_day_present", "absent").required()
});

exports.bulkOverrideAttendanceSchema = Joi.object({
  date: localDateSchema.optional(),
  startDate: localDateSchema.optional(),
  endDate: localDateSchema.optional(),
  includeNonWorkingDays: Joi.boolean().default(true),
  status: Joi.string().valid("present", "half_day_present", "absent").required(),
  employeeIds: Joi.array().items(Joi.string().required()).min(1).required()
}).custom((value, helpers) => {
  const hasSingleDate = Boolean(value.date);
  const hasRangeDate = Boolean(value.startDate || value.endDate);

  if (hasSingleDate && hasRangeDate) {
    return helpers.message({ custom: "Provide either date or startDate/endDate, not both" });
  }
  if (!hasSingleDate && (!value.startDate || !value.endDate)) {
    return helpers.message({ custom: "Provide date or both startDate and endDate" });
  }
  if (value.startDate && value.endDate) {
    const start = new Date(`${value.startDate}T00:00:00.000Z`);
    const end = new Date(`${value.endDate}T00:00:00.000Z`);
    const dayCount = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
    if (dayCount < 1) {
      return helpers.message({ custom: "endDate must be on or after startDate" });
    }
    if (dayCount > 30) {
      return helpers.message({ custom: "Bulk attendance can cover at most 30 days" });
    }
  }
  return value;
});

exports.customBulkOverrideAttendanceSchema = Joi.object({
  updates: Joi.array().items(Joi.object({
    employeeId: Joi.string().required(),
    date: localDateSchema.required(),
    status: Joi.string().valid("present", "absent").required()
  })).min(1).max(3000).required(),
  includeNonWorkingDays: Joi.boolean().default(true)
}).custom((value, helpers) => {
  const distinctDates = new Set(value.updates.map((update) => update.date));
  if (distinctDates.size > 30) {
    return helpers.message({ custom: "Customized attendance can cover at most 30 dates" });
  }
  return value;
});

exports.lockAttendanceMonthSchema = Joi.object({
  month: Joi.string().pattern(/^\d{4}-\d{2}$/).required()
});

exports.attendanceRequestDefaultsSchema = Joi.object({
  date: localDateSchema.required(),
  requestType: Joi.string().valid("work_from_home").optional(),
  dayPortion: Joi.string().valid("full_day", "first_half", "second_half").default("full_day")
});

exports.raiseAttendanceRequestSchema = Joi.object({
  date: localDateSchema.required(),
  requestType: Joi.string().valid("missed_checkout", "correction", "work_from_home").required(),
  dayPortion: Joi.when("requestType", {
    is: "work_from_home",
    then: Joi.string().valid("full_day", "first_half", "second_half").default("full_day"),
    otherwise: Joi.string().valid("full_day").default("full_day")
  }),
  requestedCheckInTime: Joi.string().pattern(/^([01]\d|2[0-3]):([0-5]\d)$/).allow(null, ""),
  requestedCheckOutTime: Joi.string().pattern(/^([01]\d|2[0-3]):([0-5]\d)$/).allow(null, ""),
  reason: Joi.string().trim().min(3).max(500).required()
});

exports.attendanceRequestActionSchema = Joi.object({
  status: Joi.string().valid("approved", "rejected").required(),
  rejectionReason: Joi.when("status", {
    is: "rejected",
    then: Joi.string().trim().min(3).required(),
    otherwise: Joi.optional()
  })
});
