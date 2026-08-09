const service = require("./payrollApproval.service");
const { buildSuccessResponse } = require("../../utils/responseBuilder");
const { executeIdempotentPayrollAction } = require("./payrollIdempotency.service");

exports.submitForApproval = async (req, res) => {
  const data = await executeIdempotentPayrollAction({
    req,
    actionKey: "payroll_run_submit",
    runId: req.params.runId,
    resolver: async () => service.submitForApproval(req)
  });
  return res.status(200).json(
    buildSuccessResponse({
      message: "Payroll run submitted for approval",
      data
    })
  );
};

exports.approveRun = async (req, res) => {
  const data = await executeIdempotentPayrollAction({
    req,
    actionKey: "payroll_run_approve",
    runId: req.params.runId,
    resolver: async () => service.approveRun(req)
  });
  return res.status(200).json(
    buildSuccessResponse({
      message: "Payroll run approved successfully",
      data
    })
  );
};

exports.rejectRun = async (req, res) => {
  const data = await executeIdempotentPayrollAction({
    req,
    actionKey: "payroll_run_reject",
    runId: req.params.runId,
    resolver: async () => service.rejectRun(req)
  });
  return res.status(200).json(
    buildSuccessResponse({
      message: "Payroll run rejected and moved back for correction",
      data
    })
  );
};

exports.lockRun = async (req, res) => {
  const data = await executeIdempotentPayrollAction({
    req,
    actionKey: "payroll_run_lock",
    runId: req.params.runId,
    resolver: async () => service.lockRun(req)
  });
  return res.status(200).json(
    buildSuccessResponse({
      message: "Payroll run locked successfully",
      data
    })
  );
};

exports.reopenRun = async (req, res) => {
  const data = await executeIdempotentPayrollAction({
    req,
    actionKey: "payroll_run_reopen",
    runId: req.params.runId,
    resolver: async () => service.reopenRun(req)
  });
  return res.status(200).json(
    buildSuccessResponse({
      message: "Payroll run reopened to draft",
      data
    })
  );
};

exports.listAuditEntries = async (req, res) => {
  const data = await service.listRunAuditEntries(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Payroll run audit trail fetched successfully",
      data
    })
  );
};
