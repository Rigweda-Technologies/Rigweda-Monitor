const service = require("./payrollValidation.service");
const { buildSuccessResponse } = require("../../utils/responseBuilder");

exports.validateRun = async (req, res) => {
  const data = await service.validatePayrollRun(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Payroll run validation completed",
      data
    })
  );
};
