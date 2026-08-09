const Joi = require("joi");
const { getDefaultMaxActiveLoginsPerUser } = require("../../utils/orgSettingsDefaults");

const uploadSchema = Joi.object({
  fileName: Joi.string().required(),
  mimeType: Joi.string().required(),
  base64Data: Joi.string().required()
});

exports.upsertOrgSettingsSchema = Joi.object({
  leaveCreditFrequency: Joi.string().valid("monthly", "quarterly", "yearly").required(),
  leaveTypeCreditMode: Joi.string().valid("current_month_onwards", "full_year").required(),
  sandwichRuleEnabled: Joi.boolean().default(false),
  attendanceLockEnabled: Joi.boolean().default(true),
  attendanceLockAfterDays: Joi.number().integer().min(0).max(365).default(7),
  attendanceLockMode: Joi.string().valid("days_window", "payroll_cutoff").default("payroll_cutoff"),
  attendanceLockDay: Joi.number().integer().min(1).max(31).default(25),
  timezone: Joi.string().required(),
  logoUpload: uploadSchema.optional(),
  payrollCutoffDay: Joi.number().integer().min(1).max(31).default(25),
  payrollSalaryPayDay: Joi.number().integer().min(1).max(31).default(30),
  payrollEnabled: Joi.boolean().default(false),
  minWorkHoursPerDay: Joi.number().min(0).max(24).required(),
  minHalfDayHours: Joi.number().min(0).max(24).max(Joi.ref("minWorkHoursPerDay")).required(),
  attendanceIpEnabled: Joi.boolean().default(false),
  attendanceAllowedIp: Joi.string().trim().allow("").default(""),
  attendanceSelfieRequired: Joi.boolean().default(false),
  attendanceMultiPunchEnabled: Joi.boolean().default(false),
  attendanceGeoFenceEnabled: Joi.boolean().default(false),
  attendanceGeoLatitude: Joi.number().min(-90).max(90).allow(null),
  attendanceGeoLongitude: Joi.number().min(-180).max(180).allow(null),
  attendanceGeoRadiusMeters: Joi.number().integer().min(10).max(100000).default(200),
  attendanceDevBypassEnabled: Joi.boolean().default(false),
  probationPeriodDays: Joi.number().integer().min(0).max(3650).default(90),
  noticePeriodDays: Joi.number().integer().min(0).max(3650).default(30),
  employeeIdPrefix: Joi.string().trim().max(10).allow("").default(""),
  maxActiveLoginsPerUser: Joi.number().integer().min(1).max(20).default(getDefaultMaxActiveLoginsPerUser())
});
