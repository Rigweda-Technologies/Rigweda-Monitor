const service = require("./payslip.service");
const { buildSuccessResponse } = require("../../utils/responseBuilder");

exports.getPayslipByRun = async (req, res) => {
  const data = await service.getPayslipByRun(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Payslip generated successfully",
      data
    })
  );
};

exports.getPayslipByMonth = async (req, res) => {
  const data = await service.getPayslipByMonth(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Monthly payslip fetched successfully",
      data
    })
  );
};

exports.getMyPayslipByMonth = async (req, res) => {
  const data = await service.getMyPayslipByMonth(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Employee monthly payslip fetched successfully",
      data
    })
  );
};

exports.listMyPayslipMonths = async (req, res) => {
  const data = await service.listMyPayslipMonths(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Employee payslip months fetched successfully",
      data
    })
  );
};

exports.listMyPayslipRuns = async (req, res) => {
  const data = await service.listMyPayslipRuns(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Employee payslip runs fetched successfully",
      data
    })
  );
};

exports.getMyPayslipByRun = async (req, res) => {
  const data = await service.getMyPayslipByRun(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Employee run payslip fetched successfully",
      data
    })
  );
};
