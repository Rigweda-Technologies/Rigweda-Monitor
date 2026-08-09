const service = require("./payrollApi.service");
const { buildSuccessResponse } = require("../../utils/responseBuilder");
const runService = require("./payrollRun.service");
const { enqueuePayrollRunComputeJob } = require("./payrollJob.service");
const { executeIdempotentPayrollAction } = require("./payrollIdempotency.service");

exports.getSettings = async (req, res) => {
  const data = await service.getSettings(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Payroll settings fetched successfully",
      data
    })
  );
};

exports.listPayGroups = async (req, res) => {
  const data = await service.listPayGroups(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Pay groups fetched successfully",
      data
    })
  );
};

exports.getPayGroup = async (req, res) => {
  const data = await service.getPayGroup(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Pay group fetched successfully",
      data
    })
  );
};

exports.createPayGroup = async (req, res) => {
  const data = await service.createPayGroup(req);
  return res.status(201).json(
    buildSuccessResponse({
      message: "Pay group created successfully",
      data
    })
  );
};

exports.updatePayGroup = async (req, res) => {
  const data = await service.updatePayGroup(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Pay group updated successfully",
      data
    })
  );
};

exports.archivePayGroup = async (req, res) => {
  const data = await service.archivePayGroup(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Pay group archived successfully",
      data
    })
  );
};

exports.upsertSettings = async (req, res) => {
  const data = await service.upsertSettings(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Payroll settings saved successfully",
      data
    })
  );
};

exports.getPayrollSetupBootstrap = async (req, res) => {
  const data = await service.getPayrollSetupBootstrap(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Payroll setup bootstrap fetched successfully",
      data
    })
  );
};

exports.savePayrollSetup = async (req, res) => {
  const data = await service.savePayrollSetup(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Payroll setup saved successfully",
      data
    })
  );
};

exports.createSalaryComponent = async (req, res) => {
  const data = await service.createSalaryComponent(req);
  return res.status(201).json(
    buildSuccessResponse({
      message: "Salary component created successfully",
      data
    })
  );
};

exports.listSalaryComponents = async (req, res) => {
  const data = await service.listSalaryComponents(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Salary components fetched successfully",
      data
    })
  );
};

exports.getSalaryComponentById = async (req, res) => {
  const data = await service.getSalaryComponentById(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Salary component fetched successfully",
      data
    })
  );
};

exports.updateSalaryComponent = async (req, res) => {
  const data = await service.updateSalaryComponent(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Salary component updated successfully",
      data
    })
  );
};

exports.deleteSalaryComponent = async (req, res) => {
  const data = await service.deleteSalaryComponent(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Salary component archived successfully",
      data
    })
  );
};

exports.createEmployeeProfile = async (req, res) => {
  const data = await service.createEmployeeProfile(req);
  return res.status(201).json(
    buildSuccessResponse({
      message: "Employee payroll profile created successfully",
      data
    })
  );
};

exports.listEmployeeProfiles = async (req, res) => {
  const data = await service.listEmployeeProfiles(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Employee payroll profiles fetched successfully",
      data
    })
  );
};

exports.getEmployeeProfile = async (req, res) => {
  const data = await service.getEmployeeProfile(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Employee payroll profile fetched successfully",
      data
    })
  );
};

exports.updateEmployeeProfile = async (req, res) => {
  const data = await service.updateEmployeeProfile(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Employee payroll profile updated successfully",
      data
    })
  );
};

exports.deleteEmployeeProfile = async (req, res) => {
  const data = await service.deleteEmployeeProfile(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Employee payroll profile deleted successfully",
      data
    })
  );
};

exports.upsertBankDetail = async (req, res) => {
  const data = await service.upsertBankDetail(req);
  return res.status(201).json(
    buildSuccessResponse({
      message: "Bank detail saved successfully",
      data
    })
  );
};

exports.lookupBankByAccount = async (req, res) => {
  const data = await service.lookupBankByAccount(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Bank details lookup by account completed",
      data
    })
  );
};

exports.lookupBankByIfsc = async (req, res) => {
  const data = await service.lookupBankByIfsc(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Bank details lookup by IFSC completed",
      data
    })
  );
};

exports.upsertStatutoryDetail = async (req, res) => {
  const data = await service.upsertStatutoryDetail(req);
  return res.status(201).json(
    buildSuccessResponse({
      message: "Statutory detail saved successfully",
      data
    })
  );
};

exports.createSalaryStructure = async (req, res) => {
  const data = await service.createSalaryStructure(req);
  return res.status(201).json(
    buildSuccessResponse({
      message: "Salary structure created successfully",
      data
    })
  );
};

exports.updateSalaryStructure = async (req, res) => {
  const data = await service.updateSalaryStructure(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Salary structure updated successfully",
      data
    })
  );
};

exports.deleteSalaryStructure = async (req, res) => {
  const data = await service.deleteSalaryStructure(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Salary structure archived successfully",
      data
    })
  );
};

exports.createRun = async (req, res) => {
  const data = await executeIdempotentPayrollAction({
    req,
    actionKey: "payroll_run_create",
    resolver: async () => service.createPayrollRun(req)
  });
  return res.status(201).json(
    buildSuccessResponse({
      message: "Payroll run created successfully",
      data
    })
  );
};

exports.listRuns = async (req, res) => {
  const data = await service.listPayrollRuns(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Payroll runs fetched successfully",
      data
    })
  );
};

exports.getRun = async (req, res) => {
  const data = await service.getPayrollRun(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Payroll run fetched successfully",
      data
    })
  );
};

exports.previewRun = async (req, res) => {
  const data = await service.previewPayrollRun(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Payroll run preview generated successfully",
      data
    })
  );
};

exports.getRunEmployeeBreakdown = async (req, res) => {
  const data = await service.getRunEmployeeBreakdown(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Payroll employee breakdown fetched successfully",
      data
    })
  );
};

exports.recomputeRun = async (req, res) => {
  req.body = {
    ...(req.body || {}),
    forceRecompute: true
  };

  const runId = String(req.params.runId);
  const asyncRequested =
    req.body?.async === true || process.env.PAYROLL_COMPUTE_ASYNC_DEFAULT === "true";

  const data = await executeIdempotentPayrollAction({
    req,
    actionKey: "payroll_run_recompute",
    runId,
    resolver: async () => {
      if (asyncRequested) {
        return enqueuePayrollRunComputeJob(req);
      }
      req.body = {
        ...(req.body || {}),
        _executionMode: "sync"
      };
      return runService.computePayrollRun(req);
    }
  });

  return res.status(asyncRequested ? 202 : 200).json(
    buildSuccessResponse({
      message: asyncRequested
        ? "Payroll run queued for async recompute"
        : "Payroll run recomputed successfully",
      data
    })
  );
};
