const router = require("express").Router();
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const validate = require("../../middlewares/validate.middleware");
const asyncHandler = require("../../middlewares/asyncHandler");
const idempotencyKey = require("../../middlewares/idempotencyKey.middleware");
const controller = require("./payrollAttendance.controller");
const payrollRunController = require("./payrollRun.controller");
const payrollValidationController = require("./payrollValidation.controller");
const payrollApiController = require("./payrollApi.controller");
const payrollApprovalController = require("./payrollApproval.controller");
const payslipController = require("./payslip.controller");
const payrollReportsController = require("./payrollReports.controller");
const {
  generateSnapshotSchema,
  listSnapshotsQuerySchema
} = require("./payrollAttendance.validation");
const {
  computePayrollRunParamsSchema,
  computePayrollRunBodySchema
} = require("./payrollRun.validation");
const {
  validatePayrollRunParamsSchema,
  validatePayrollRunBodySchema
} = require("./payrollValidation.validation");
const {
  updateSettingsSchema,
  setupBootstrapQuerySchema,
  bulkPayrollSetupSchema,
  listPayGroupsQuerySchema,
  payGroupIdParamSchema,
  createPayGroupSchema,
  updatePayGroupSchema,
  componentIdParamSchema,
  componentScopeQuerySchema,
  createSalaryComponentSchema,
  updateSalaryComponentSchema,
  listSalaryComponentsQuerySchema,
  profileIdParamSchema,
  salaryStructureIdParamSchema,
  createEmployeePayrollProfileSchema,
  updateEmployeePayrollProfileSchema,
  listEmployeeProfilesQuerySchema,
  bankAccountLookupQuerySchema,
  ifscLookupParamSchema,
  upsertBankDetailSchema,
  upsertStatutoryDetailSchema,
  createSalaryStructureSchema,
  updateSalaryStructureSchema,
  createPayrollRunSchema,
  listPayrollRunsQuerySchema,
  runIdParamSchema,
  employeeBreakdownQuerySchema,
  previewRunBodySchema
} = require("./payrollApi.validation");
const {
  runIdParamSchema: approvalRunIdParamSchema,
  submitForApprovalSchema,
  approveRunSchema,
  rejectRunSchema,
  lockRunSchema,
  reopenRunSchema
} = require("./payrollApproval.validation");
const {
  getRunPayslipParamsSchema,
  getMonthlyPayslipQuerySchema,
  getMyMonthlyPayslipQuerySchema,
  getMyRunPayslipParamsSchema
} = require("./payslip.validation");
const {
  payrollRegisterQuerySchema,
  bankTransferQuerySchema,
  deductionSummaryQuerySchema,
  employerContributionSummaryQuerySchema,
  costCenterTotalsQuerySchema
} = require("./payrollReports.validation");

const payrollActionIdempotency = idempotencyKey({
  enforce: process.env.PAYROLL_IDEMPOTENCY_REQUIRED === "true"
});

router.get(
  "/settings",
  auth,
  authorize(["PAYROLL_CONFIG_MANAGE"]),
  asyncHandler(payrollApiController.getSettings)
);

router.get(
  "/pay-groups",
  auth,
  authorize(["PAYROLL_CONFIG_MANAGE"]),
  validate(listPayGroupsQuerySchema, "query"),
  asyncHandler(payrollApiController.listPayGroups)
);

router.get(
  "/pay-groups/:payGroupId",
  auth,
  authorize(["PAYROLL_CONFIG_MANAGE"]),
  validate(payGroupIdParamSchema, "params"),
  asyncHandler(payrollApiController.getPayGroup)
);

router.post(
  "/pay-groups",
  auth,
  authorize(["PAYROLL_CONFIG_MANAGE"]),
  validate(createPayGroupSchema),
  asyncHandler(payrollApiController.createPayGroup)
);

router.put(
  "/pay-groups/:payGroupId",
  auth,
  authorize(["PAYROLL_CONFIG_MANAGE"]),
  validate(payGroupIdParamSchema, "params"),
  validate(updatePayGroupSchema),
  asyncHandler(payrollApiController.updatePayGroup)
);

router.delete(
  "/pay-groups/:payGroupId",
  auth,
  authorize(["PAYROLL_CONFIG_MANAGE"]),
  validate(payGroupIdParamSchema, "params"),
  asyncHandler(payrollApiController.archivePayGroup)
);

router.put(
  "/settings",
  auth,
  authorize(["PAYROLL_CONFIG_MANAGE"]),
  validate(updateSettingsSchema),
  asyncHandler(payrollApiController.upsertSettings)
);

router.get(
  "/setup/bootstrap",
  auth,
  authorize(["PAYROLL_CONFIG_MANAGE"]),
  validate(setupBootstrapQuerySchema, "query"),
  asyncHandler(payrollApiController.getPayrollSetupBootstrap)
);

router.post(
  "/setup/save",
  auth,
  authorize(["PAYROLL_CONFIG_MANAGE"]),
  validate(bulkPayrollSetupSchema),
  asyncHandler(payrollApiController.savePayrollSetup)
);

router.post(
  "/salary-components",
  auth,
  authorize(["PAYROLL_CONFIG_MANAGE"]),
  validate(createSalaryComponentSchema),
  asyncHandler(payrollApiController.createSalaryComponent)
);

router.get(
  "/salary-components",
  auth,
  authorize(["PAYROLL_CONFIG_MANAGE"]),
  validate(listSalaryComponentsQuerySchema, "query"),
  asyncHandler(payrollApiController.listSalaryComponents)
);

router.get(
  "/salary-components/:id",
  auth,
  authorize(["PAYROLL_CONFIG_MANAGE"]),
  validate(componentIdParamSchema, "params"),
  validate(componentScopeQuerySchema, "query"),
  asyncHandler(payrollApiController.getSalaryComponentById)
);

router.put(
  "/salary-components/:id",
  auth,
  authorize(["PAYROLL_CONFIG_MANAGE"]),
  validate(componentIdParamSchema, "params"),
  validate(componentScopeQuerySchema, "query"),
  validate(updateSalaryComponentSchema),
  asyncHandler(payrollApiController.updateSalaryComponent)
);

router.delete(
  "/salary-components/:id",
  auth,
  authorize(["PAYROLL_CONFIG_MANAGE"]),
  validate(componentIdParamSchema, "params"),
  validate(componentScopeQuerySchema, "query"),
  asyncHandler(payrollApiController.deleteSalaryComponent)
);

router.post(
  "/employee-profiles",
  auth,
  authorize(["PAYROLL_CONFIG_MANAGE"]),
  validate(createEmployeePayrollProfileSchema),
  asyncHandler(payrollApiController.createEmployeeProfile)
);

router.get(
  "/employee-profiles",
  auth,
  authorize(["PAYROLL_CONFIG_MANAGE"]),
  validate(listEmployeeProfilesQuerySchema, "query"),
  asyncHandler(payrollApiController.listEmployeeProfiles)
);

router.get(
  "/bank-details/lookup/by-account",
  auth,
  authorize(["PAYROLL_CONFIG_MANAGE"]),
  validate(bankAccountLookupQuerySchema, "query"),
  asyncHandler(payrollApiController.lookupBankByAccount)
);

router.get(
  "/bank-details/lookup/by-ifsc/:ifscCode",
  auth,
  authorize(["PAYROLL_CONFIG_MANAGE"]),
  validate(ifscLookupParamSchema, "params"),
  asyncHandler(payrollApiController.lookupBankByIfsc)
);

router.get(
  "/employee-profiles/:profileId",
  auth,
  authorize(["PAYROLL_CONFIG_MANAGE"]),
  validate(profileIdParamSchema, "params"),
  asyncHandler(payrollApiController.getEmployeeProfile)
);

router.put(
  "/employee-profiles/:profileId",
  auth,
  authorize(["PAYROLL_CONFIG_MANAGE"]),
  validate(profileIdParamSchema, "params"),
  validate(updateEmployeePayrollProfileSchema),
  asyncHandler(payrollApiController.updateEmployeeProfile)
);

router.delete(
  "/employee-profiles/:profileId",
  auth,
  authorize(["PAYROLL_CONFIG_MANAGE"]),
  validate(profileIdParamSchema, "params"),
  asyncHandler(payrollApiController.deleteEmployeeProfile)
);

router.post(
  "/employee-profiles/:profileId/bank-details",
  auth,
  authorize(["PAYROLL_CONFIG_MANAGE"]),
  validate(profileIdParamSchema, "params"),
  validate(upsertBankDetailSchema),
  asyncHandler(payrollApiController.upsertBankDetail)
);

router.post(
  "/employee-profiles/:profileId/statutory-details",
  auth,
  authorize(["PAYROLL_CONFIG_MANAGE"]),
  validate(profileIdParamSchema, "params"),
  validate(upsertStatutoryDetailSchema),
  asyncHandler(payrollApiController.upsertStatutoryDetail)
);

router.post(
  "/employee-profiles/:profileId/salary-structures",
  auth,
  authorize(["PAYROLL_CONFIG_MANAGE"]),
  validate(profileIdParamSchema, "params"),
  validate(createSalaryStructureSchema),
  asyncHandler(payrollApiController.createSalaryStructure)
);

router.put(
  "/salary-structures/:salaryStructureId",
  auth,
  authorize(["PAYROLL_CONFIG_MANAGE"]),
  validate(salaryStructureIdParamSchema, "params"),
  validate(updateSalaryStructureSchema),
  asyncHandler(payrollApiController.updateSalaryStructure)
);

router.delete(
  "/salary-structures/:salaryStructureId",
  auth,
  authorize(["PAYROLL_CONFIG_MANAGE"]),
  validate(salaryStructureIdParamSchema, "params"),
  asyncHandler(payrollApiController.deleteSalaryStructure)
);

router.post(
  "/runs",
  auth,
  authorize(["PAYROLL_RUN_CREATE"]),
  payrollActionIdempotency,
  validate(createPayrollRunSchema),
  asyncHandler(payrollApiController.createRun)
);

router.get(
  "/runs",
  auth,
  authorize([
    "PAYROLL_RUN_CREATE",
    "PAYROLL_RUN_APPROVE",
    "PAYROLL_RUN_LOCK",
    "PAYROLL_REPORT_VIEW",
    "PAYROLL_RUN_VIEW"
  ]),
  validate(listPayrollRunsQuerySchema, "query"),
  asyncHandler(payrollApiController.listRuns)
);

router.get(
  "/runs/:runId",
  auth,
  authorize([
    "PAYROLL_RUN_CREATE",
    "PAYROLL_RUN_APPROVE",
    "PAYROLL_RUN_LOCK",
    "PAYROLL_REPORT_VIEW",
    "PAYROLL_RUN_VIEW"
  ]),
  validate(runIdParamSchema, "params"),
  asyncHandler(payrollApiController.getRun)
);

router.post(
  "/runs/:runId/preview",
  auth,
  authorize([
    "PAYROLL_RUN_CREATE",
    "PAYROLL_RUN_APPROVE",
    "PAYROLL_RUN_LOCK",
    "PAYROLL_REPORT_VIEW",
    "PAYROLL_RUN_VIEW"
  ]),
  validate(runIdParamSchema, "params"),
  validate(previewRunBodySchema),
  asyncHandler(payrollApiController.previewRun)
);

router.get(
  "/runs/:runId/employee-breakdown",
  auth,
  authorize([
    "PAYROLL_RUN_CREATE",
    "PAYROLL_RUN_APPROVE",
    "PAYROLL_RUN_LOCK",
    "PAYROLL_REPORT_VIEW",
    "PAYROLL_RUN_VIEW"
  ]),
  validate(runIdParamSchema, "params"),
  validate(employeeBreakdownQuerySchema, "query"),
  asyncHandler(payrollApiController.getRunEmployeeBreakdown)
);

router.post(
  "/attendance-snapshots/generate",
  auth,
  authorize(["PAYROLL_RUN_CREATE"]),
  validate(generateSnapshotSchema),
  asyncHandler(controller.generateMonthlySnapshots)
);

router.get(
  "/attendance-snapshots",
  auth,
  authorize(["PAYROLL_RUN_CREATE", "PAYROLL_REPORT_VIEW"]),
  validate(listSnapshotsQuerySchema, "query"),
  asyncHandler(controller.listMonthlySnapshots)
);

router.post(
  "/runs/:runId/compute",
  auth,
  authorize(["PAYROLL_RUN_CREATE"]),
  payrollActionIdempotency,
  validate(computePayrollRunParamsSchema, "params"),
  validate(computePayrollRunBodySchema),
  asyncHandler(payrollRunController.computeRun)
);

router.post(
  "/runs/:runId/recompute",
  auth,
  authorize(["PAYROLL_RUN_CREATE"]),
  payrollActionIdempotency,
  validate(runIdParamSchema, "params"),
  validate(computePayrollRunBodySchema),
  asyncHandler(payrollApiController.recomputeRun)
);

router.post(
  "/runs/:runId/submit",
  auth,
  authorize(["PAYROLL_RUN_CREATE", "PAYROLL_RUN_SUBMIT"]),
  payrollActionIdempotency,
  validate(approvalRunIdParamSchema, "params"),
  validate(submitForApprovalSchema),
  asyncHandler(payrollApprovalController.submitForApproval)
);

router.post(
  "/runs/:runId/approve",
  auth,
  authorize(["PAYROLL_RUN_APPROVE"]),
  payrollActionIdempotency,
  validate(approvalRunIdParamSchema, "params"),
  validate(approveRunSchema),
  asyncHandler(payrollApprovalController.approveRun)
);

router.post(
  "/runs/:runId/reject",
  auth,
  authorize(["PAYROLL_RUN_APPROVE"]),
  payrollActionIdempotency,
  validate(approvalRunIdParamSchema, "params"),
  validate(rejectRunSchema),
  asyncHandler(payrollApprovalController.rejectRun)
);

router.post(
  "/runs/:runId/lock",
  auth,
  authorize(["PAYROLL_RUN_LOCK"]),
  payrollActionIdempotency,
  validate(approvalRunIdParamSchema, "params"),
  validate(lockRunSchema),
  asyncHandler(payrollApprovalController.lockRun)
);

router.post(
  "/runs/:runId/reopen",
  auth,
  authorize(["PAYROLL_RUN_REOPEN"]),
  payrollActionIdempotency,
  validate(approvalRunIdParamSchema, "params"),
  validate(reopenRunSchema),
  asyncHandler(payrollApprovalController.reopenRun)
);

router.get(
  "/runs/:runId/audit",
  auth,
  authorize(["PAYROLL_REPORT_VIEW", "PAYROLL_RUN_VIEW"]),
  validate(approvalRunIdParamSchema, "params"),
  asyncHandler(payrollApprovalController.listAuditEntries)
);

router.get(
  "/runs/:runId/payslips/:employeeExternalId",
  auth,
  authorize(["PAYROLL_PAYSLIP_VIEW"]),
  validate(getRunPayslipParamsSchema, "params"),
  asyncHandler(payslipController.getPayslipByRun)
);

router.get(
  "/payslips/monthly",
  auth,
  authorize(["PAYROLL_PAYSLIP_VIEW"]),
  validate(getMonthlyPayslipQuerySchema, "query"),
  asyncHandler(payslipController.getPayslipByMonth)
);

router.get(
  "/payslips/my/monthly",
  auth,
  authorize(["EMP_SELF_VIEW", "TIMESHEET_VIEW_SELF", "LEAVE_VIEW_SELF"]),
  validate(getMyMonthlyPayslipQuerySchema, "query"),
  asyncHandler(payslipController.getMyPayslipByMonth)
);

router.get(
  "/payslips/my/months",
  auth,
  authorize(["EMP_SELF_VIEW", "TIMESHEET_VIEW_SELF", "LEAVE_VIEW_SELF"]),
  asyncHandler(payslipController.listMyPayslipMonths)
);

router.get(
  "/payslips/my/runs",
  auth,
  authorize(["EMP_SELF_VIEW", "TIMESHEET_VIEW_SELF", "LEAVE_VIEW_SELF"]),
  asyncHandler(payslipController.listMyPayslipRuns)
);

router.get(
  "/payslips/my/runs/:runId",
  auth,
  authorize(["EMP_SELF_VIEW", "TIMESHEET_VIEW_SELF", "LEAVE_VIEW_SELF"]),
  validate(getMyRunPayslipParamsSchema, "params"),
  asyncHandler(payslipController.getMyPayslipByRun)
);

router.get(
  "/reports/payroll-register",
  auth,
  authorize(["PAYROLL_REPORT_VIEW"]),
  validate(payrollRegisterQuerySchema, "query"),
  asyncHandler(payrollReportsController.payrollRegister)
);

router.get(
  "/reports/bank-transfer-export",
  auth,
  authorize(["PAYROLL_REPORT_VIEW"]),
  validate(bankTransferQuerySchema, "query"),
  asyncHandler(payrollReportsController.bankTransferExport)
);

router.get(
  "/reports/deduction-summary",
  auth,
  authorize(["PAYROLL_REPORT_VIEW"]),
  validate(deductionSummaryQuerySchema, "query"),
  asyncHandler(payrollReportsController.deductionSummary)
);

router.get(
  "/reports/employer-contribution-summary",
  auth,
  authorize(["PAYROLL_REPORT_VIEW"]),
  validate(employerContributionSummaryQuerySchema, "query"),
  asyncHandler(payrollReportsController.employerContributionSummary)
);

router.get(
  "/reports/cost-center-totals",
  auth,
  authorize(["PAYROLL_REPORT_VIEW"]),
  validate(costCenterTotalsQuerySchema, "query"),
  asyncHandler(payrollReportsController.costCenterTotals)
);

router.post(
  "/runs/:runId/validate",
  auth,
  authorize(["PAYROLL_RUN_CREATE"]),
  validate(validatePayrollRunParamsSchema, "params"),
  validate(validatePayrollRunBodySchema),
  asyncHandler(payrollValidationController.validateRun)
);

module.exports = router;
