const service = require("./payrollReports.service");
const { buildSuccessResponse } = require("../../utils/responseBuilder");

exports.payrollRegister = async (req, res) => {
  const data = await service.getPayrollRegister(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Payroll register generated successfully",
      data
    })
  );
};

exports.bankTransferExport = async (req, res) => {
  const data = await service.getBankTransferExport(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Bank transfer export generated successfully",
      data
    })
  );
};

exports.deductionSummary = async (req, res) => {
  const data = await service.getDeductionSummary(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Deduction summary generated successfully",
      data
    })
  );
};

exports.employerContributionSummary = async (req, res) => {
  const data = await service.getEmployerContributionSummary(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Employer contribution summary generated successfully",
      data
    })
  );
};

exports.costCenterTotals = async (req, res) => {
  const data = await service.getCostCenterTotals(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Cost center payroll totals generated successfully",
      data
    })
  );
};
