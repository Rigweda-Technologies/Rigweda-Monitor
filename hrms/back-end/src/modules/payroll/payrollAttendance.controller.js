const service = require("./payrollAttendance.service");
const { buildSuccessResponse } = require("../../utils/responseBuilder");

exports.generateMonthlySnapshots = async (req, res) => {
  const data = await service.generateMonthlyAttendanceSnapshots(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Payroll attendance snapshots generated successfully",
      data
    })
  );
};

exports.listMonthlySnapshots = async (req, res) => {
  const data = await service.listMonthlyAttendanceSnapshots(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Payroll attendance snapshots fetched successfully",
      data
    })
  );
};
