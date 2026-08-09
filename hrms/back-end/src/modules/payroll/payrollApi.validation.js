const Joi = require("joi");
const { buildNameSchema, buildCodeSchema } = require("../../utils/joiValidators");

const objectIdPattern = /^[0-9a-fA-F]{24}$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const metadataSchema = Joi.object().unknown(true).default({});
const bulkComponentSchema = Joi.object({
  id: Joi.string().pattern(uuidPattern).allow(null, ""),
  scope: Joi.string().valid("earning", "deduction", "employer_contribution").required(),
  code: buildCodeSchema({ max: 60, required: false, allowEmpty: true }),
  name: buildNameSchema({ required: true }),
  displayName: Joi.string().trim().max(120).allow("", null),
  description: Joi.string().max(1000).allow("", null),
  calculationMode: Joi.string().valid("fixed", "percentage", "formula", "slab").required(),
  taxable: Joi.boolean(),
  priority: Joi.number().integer().min(1).max(500),
  pfApplicable: Joi.boolean(),
  esiApplicable: Joi.boolean(),
  prorateWithAttendance: Joi.boolean(),
  isStatutory: Joi.boolean(),
  employeeShareOnly: Joi.boolean(),
  contributesToCtc: Joi.boolean(),
  linkedDeductionCode: Joi.string().trim().uppercase().max(60).allow("", null),
  capAmount: Joi.number().min(0).allow(null),
  roundingPolicy: Joi.string().valid("nearest_rupee", "floor_rupee", "exact"),
  effectiveFrom: Joi.date().required(),
  effectiveTo: Joi.date().allow(null),
  isActive: Joi.boolean(),
  metadata: metadataSchema
});

const bulkRemovedComponentSchema = Joi.object({
  id: Joi.string().pattern(uuidPattern).required(),
  scope: Joi.string().valid("earning", "deduction", "employer_contribution").required()
});

exports.bulkPayrollSetupSchema = Joi.object({
  payGroupId: Joi.string().pattern(uuidPattern).required(),
  payGroup: Joi.object({
    code: buildCodeSchema({ max: 50, required: false, allowEmpty: true }),
    name: buildNameSchema({ required: true }),
    description: Joi.string().trim().max(1000).allow("", null),
    payFrequency: Joi.string().valid("monthly", "semi_monthly", "weekly").required(),
    salaryPayDay: Joi.number().integer().min(1).max(31).required(),
    workWeekDays: Joi.number().integer().min(1).max(7).default(6),
    isActive: Joi.boolean().default(true),
    metadata: metadataSchema
  }).required(),
  settings: Joi.object({
    countryCode: Joi.string().length(2).uppercase(),
    stateCode: Joi.string().length(2).uppercase(),
    attendanceSource: Joi.string().trim().min(3).max(40),
    attendanceLockMode: Joi.string().valid("days_window", "payroll_cutoff"),
    attendanceLockAfterDays: Joi.number().integer().min(0).max(60),
    roundingPolicy: Joi.string().valid("nearest_rupee", "floor_rupee", "exact"),
    defaultWorkingDays: Joi.number().integer().min(1).max(31),
    lopCalculationMethod: Joi.string().valid("calendar_days", "working_days"),
    enableProration: Joi.boolean(),
    enableArrears: Joi.boolean(),
    enableReimbursements: Joi.boolean(),
    enableLoanDeductions: Joi.boolean(),
    metadata: metadataSchema
  }).required(),
  components: Joi.array().items(bulkComponentSchema).default([]),
  removedComponents: Joi.array().items(bulkRemovedComponentSchema).default([])
}).required();

exports.updateSettingsSchema = Joi.object({
  defaultPayGroupId: Joi.string().pattern(uuidPattern).allow(null),
  countryCode: Joi.string().length(2).uppercase(),
  stateCode: Joi.string().length(2).uppercase(),
  attendanceSource: Joi.string().trim().min(3).max(40),
  attendanceLockMode: Joi.string().valid("days_window", "payroll_cutoff"),
  attendanceLockAfterDays: Joi.number().integer().min(0).max(60),
  roundingPolicy: Joi.string().valid("nearest_rupee", "floor_rupee", "exact"),
  defaultWorkingDays: Joi.number().integer().min(1).max(31),
  lopCalculationMethod: Joi.string().valid("calendar_days", "working_days"),
  enableProration: Joi.boolean(),
  enableArrears: Joi.boolean(),
  enableReimbursements: Joi.boolean(),
  enableLoanDeductions: Joi.boolean(),
  metadata: metadataSchema
}).min(1);

exports.setupBootstrapQuerySchema = Joi.object({
  payGroupId: Joi.string().pattern(uuidPattern)
});

exports.listPayGroupsQuerySchema = Joi.object({
  includeInactive: Joi.boolean().default(false)
});

exports.payGroupIdParamSchema = Joi.object({
  payGroupId: Joi.string().pattern(uuidPattern).required()
});

exports.createPayGroupSchema = Joi.object({
  code: buildCodeSchema({ max: 50, required: true }),
  name: buildNameSchema({ required: true }),
  description: Joi.string().trim().max(1000).allow("", null),
  payFrequency: Joi.string().valid("monthly", "semi_monthly", "weekly").required(),
  cutoffDay: Joi.number().integer().min(1).max(31).allow(null),
  salaryPayDay: Joi.number().integer().min(1).max(31).required(),
  workWeekDays: Joi.number().integer().min(1).max(7).default(6),
  isActive: Joi.boolean().default(true),
  metadata: metadataSchema
});

exports.updatePayGroupSchema = Joi.object({
  code: buildCodeSchema({ max: 50 }),
  name: buildNameSchema(),
  description: Joi.string().trim().max(1000).allow("", null),
  payFrequency: Joi.string().valid("monthly", "semi_monthly", "weekly"),
  cutoffDay: Joi.number().integer().min(1).max(31).allow(null),
  salaryPayDay: Joi.number().integer().min(1).max(31),
  workWeekDays: Joi.number().integer().min(1).max(7),
  isActive: Joi.boolean(),
  metadata: metadataSchema
}).min(1);

exports.componentIdParamSchema = Joi.object({
  id: Joi.string().pattern(uuidPattern).required()
});

exports.componentScopeQuerySchema = Joi.object({
  scope: Joi.string().valid("earning", "deduction", "employer_contribution").required()
});

exports.createSalaryComponentSchema = Joi.object({
  scope: Joi.string()
    .valid("earning", "deduction", "employer_contribution")
    .required(),
  code: buildCodeSchema({ max: 60, required: false, allowEmpty: true }),
  name: buildNameSchema({ required: true }),
  displayName: Joi.string().trim().max(120).allow("", null),
  description: Joi.string().max(1000).allow("", null),
  calculationMode: Joi.string().valid("fixed", "percentage", "formula", "slab").required(),
  taxable: Joi.boolean().default(true),
  priority: Joi.number().integer().min(1).max(500).default(100),
  pfApplicable: Joi.boolean(),
  esiApplicable: Joi.boolean(),
  prorateWithAttendance: Joi.boolean(),
  isStatutory: Joi.boolean(),
  employeeShareOnly: Joi.boolean(),
  contributesToCtc: Joi.boolean(),
  linkedDeductionCode: Joi.string().trim().uppercase().max(60).allow("", null),
  capAmount: Joi.number().min(0).allow(null),
  roundingPolicy: Joi.string().valid("nearest_rupee", "floor_rupee", "exact").default("nearest_rupee"),
  effectiveFrom: Joi.date().required(),
  effectiveTo: Joi.date().allow(null),
  metadata: metadataSchema
});

exports.updateSalaryComponentSchema = Joi.object({
  code: buildCodeSchema({ max: 60 }),
  name: buildNameSchema(),
  displayName: Joi.string().trim().max(120).allow("", null),
  description: Joi.string().max(1000).allow("", null),
  calculationMode: Joi.string().valid("fixed", "percentage", "formula", "slab"),
  taxable: Joi.boolean(),
  priority: Joi.number().integer().min(1).max(500),
  pfApplicable: Joi.boolean(),
  esiApplicable: Joi.boolean(),
  prorateWithAttendance: Joi.boolean(),
  isStatutory: Joi.boolean(),
  employeeShareOnly: Joi.boolean(),
  contributesToCtc: Joi.boolean(),
  linkedDeductionCode: Joi.string().trim().uppercase().max(60).allow("", null),
  capAmount: Joi.number().min(0).allow(null),
  roundingPolicy: Joi.string().valid("nearest_rupee", "floor_rupee", "exact"),
  effectiveFrom: Joi.date(),
  effectiveTo: Joi.date().allow(null),
  isActive: Joi.boolean(),
  metadata: metadataSchema
}).min(1);

exports.listSalaryComponentsQuerySchema = Joi.object({
  scope: Joi.string().valid("earning", "deduction", "employer_contribution"),
  includeInactive: Joi.boolean().default(false),
  code: buildCodeSchema({ max: 60 }),
  payGroupId: Joi.string().pattern(uuidPattern)
});

exports.profileIdParamSchema = Joi.object({
  profileId: Joi.string().pattern(uuidPattern).required()
});

exports.salaryStructureIdParamSchema = Joi.object({
  salaryStructureId: Joi.string().pattern(uuidPattern).required()
});

exports.createEmployeePayrollProfileSchema = Joi.object({
  employeeExternalId: Joi.string().pattern(objectIdPattern).required(),
  employeeCode: Joi.string().trim().max(64).allow("", null),
  payGroupId: Joi.string().pattern(uuidPattern).allow(null),
  payrollStatus: Joi.string().valid("active", "on_hold", "exited").default("active"),
  defaultPaymentMode: Joi.string().valid("bank_transfer", "cash", "cheque", "upi").default("bank_transfer"),
  taxRegime: Joi.string().valid("old", "new").default("new"),
  dateOfJoining: Joi.date().allow(null),
  dateOfExit: Joi.date().allow(null),
  costCenterCode: Joi.string().trim().max(60).allow("", null),
  locationCode: Joi.string().trim().max(60).allow("", null),
  metadata: metadataSchema
});

exports.updateEmployeePayrollProfileSchema = Joi.object({
  employeeCode: Joi.string().trim().max(64).allow("", null),
  payGroupId: Joi.string().pattern(uuidPattern).allow(null),
  payrollStatus: Joi.string().valid("active", "on_hold", "exited"),
  defaultPaymentMode: Joi.string().valid("bank_transfer", "cash", "cheque", "upi"),
  taxRegime: Joi.string().valid("old", "new"),
  dateOfJoining: Joi.date().allow(null),
  dateOfExit: Joi.date().allow(null),
  costCenterCode: Joi.string().trim().max(60).allow("", null),
  locationCode: Joi.string().trim().max(60).allow("", null),
  metadata: metadataSchema
}).min(1);

exports.listEmployeeProfilesQuerySchema = Joi.object({
  payrollStatus: Joi.string().valid("active", "on_hold", "exited"),
  employeeExternalId: Joi.string().pattern(objectIdPattern),
  payGroupId: Joi.string().pattern(uuidPattern),
  includeLatest: Joi.boolean().default(false),
  limit: Joi.number().integer().min(1).max(200).default(50),
  offset: Joi.number().integer().min(0).default(0)
});

exports.bankAccountLookupQuerySchema = Joi.object({
  accountNumber: Joi.string().trim().min(6).max(64).required()
});

exports.ifscLookupParamSchema = Joi.object({
  ifscCode: Joi.string().trim().uppercase().length(11).required()
});

exports.upsertBankDetailSchema = Joi.object({
  accountHolderName: Joi.string().trim().max(140).allow("", null),
  bankName: Joi.string().trim().max(140).allow("", null),
  branchName: Joi.string().trim().max(140).allow("", null),
  accountNumber: Joi.string().trim().max(64).allow("", null),
  ifscCode: Joi.string().trim().uppercase().max(11).allow("", null),
  accountType: Joi.string().valid("savings", "current", "salary", "other").default("savings"),
  paymentMode: Joi.string().valid("bank_transfer", "cash", "cheque", "upi").default("bank_transfer"),
  upiId: Joi.string().trim().max(120).allow("", null),
  isPrimary: Joi.boolean().default(true),
  isVerified: Joi.boolean().default(false),
  effectiveFrom: Joi.date().required(),
  effectiveTo: Joi.date().allow(null),
  metadata: metadataSchema
});

exports.upsertStatutoryDetailSchema = Joi.object({
  pan: Joi.string().trim().uppercase().length(10).allow("", null),
  aadhaar: Joi.string().trim().length(12).allow("", null),
  uan: Joi.string().trim().length(12).allow("", null),
  esicNumber: Joi.string().trim().max(20).allow("", null),
  pfMember: Joi.boolean().default(true),
  epsEligible: Joi.boolean().default(true),
  esiEligible: Joi.boolean().default(false),
  professionalTaxApplicable: Joi.boolean().default(true),
  lwfApplicable: Joi.boolean().default(false),
  taxRegime: Joi.string().valid("old", "new").default("new"),
  declarationSubmitted: Joi.boolean().default(false),
  effectiveFrom: Joi.date().required(),
  effectiveTo: Joi.date().allow(null),
  metadata: metadataSchema
});

exports.createSalaryStructureSchema = Joi.object({
  structureCode: buildCodeSchema({ max: 60, required: true }),
  structureName: buildNameSchema({ required: true }),
  annualCtc: Joi.number().min(0).required(),
  monthlyGross: Joi.number().min(0).allow(null),
  basicPay: Joi.number().min(0).allow(null),
  variablePay: Joi.number().min(0).allow(null).default(0),
  isCurrent: Joi.boolean().default(true),
  revisionReason: Joi.string().trim().max(1000).allow("", null),
  effectiveFrom: Joi.date().required(),
  effectiveTo: Joi.date().allow(null),
  metadata: metadataSchema
});

exports.updateSalaryStructureSchema = Joi.object({
  structureName: buildNameSchema(),
  annualCtc: Joi.number().min(0),
  monthlyGross: Joi.number().min(0).allow(null),
  basicPay: Joi.number().min(0).allow(null),
  variablePay: Joi.number().min(0).allow(null),
  isCurrent: Joi.boolean(),
  revisionReason: Joi.string().trim().max(1000).allow("", null),
  effectiveFrom: Joi.date(),
  effectiveTo: Joi.date().allow(null),
  metadata: metadataSchema
}).min(1);

exports.createPayrollRunSchema = Joi.object({
  payGroupId: Joi.string().pattern(uuidPattern).required(),
  payMonth: Joi.string().pattern(/^\d{4}-\d{2}$/).required(),
  runType: Joi.string()
    .valid("regular", "off_cycle", "final_settlement", "supplementary")
    .default("regular"),
  runName: Joi.string().trim().max(140).optional(),
  runCode: Joi.string().trim().uppercase().max(80).optional(),
  payPeriodId: Joi.string().pattern(uuidPattern).allow(null),
  employeeIds: Joi.array().items(Joi.string().pattern(objectIdPattern)).optional(),
  metadata: metadataSchema
});

exports.listPayrollRunsQuerySchema = Joi.object({
  payMonth: Joi.string().pattern(/^\d{4}-\d{2}$/).optional(),
  status: Joi.string()
    .valid(
      "draft",
      "validating",
      "validation_failed",
      "ready_for_approval",
      "approved",
      "locked",
      "paid",
      "cancelled"
    )
    .optional(),
  payGroupId: Joi.string().pattern(uuidPattern).optional(),
  limit: Joi.number().integer().min(1).max(200).default(50),
  offset: Joi.number().integer().min(0).default(0)
});

exports.runIdParamSchema = Joi.object({
  runId: Joi.string().pattern(uuidPattern).required()
});

exports.employeeBreakdownQuerySchema = Joi.object({
  search: Joi.string().trim().allow("", null),
  limit: Joi.number().integer().min(1).max(1000).default(500)
});

exports.previewRunBodySchema = Joi.object({
  includeComponents: Joi.boolean().default(true),
  includeEmployees: Joi.boolean().default(true),
  limitEmployees: Joi.number().integer().min(1).max(500).default(100)
});
