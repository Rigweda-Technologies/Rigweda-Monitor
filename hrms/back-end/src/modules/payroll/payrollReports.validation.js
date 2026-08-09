const Joi = require("joi");

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const baseReportQuerySchema = Joi.object({
  runId: Joi.string().pattern(uuidPattern).optional(),
  month: Joi.string().pattern(/^\d{4}-\d{2}$/).optional(),
  payGroupId: Joi.string().pattern(uuidPattern).optional(),
  includeUnfinalized: Joi.boolean().default(false)
}).or("runId", "month");

exports.payrollRegisterQuerySchema = baseReportQuerySchema;
exports.bankTransferQuerySchema = baseReportQuerySchema.keys({
  exportFormat: Joi.string().valid("json", "csv").default("json")
});
exports.deductionSummaryQuerySchema = baseReportQuerySchema;
exports.employerContributionSummaryQuerySchema = baseReportQuerySchema;
exports.costCenterTotalsQuerySchema = baseReportQuerySchema;
