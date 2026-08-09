const service = require("./leaveBalance.service");
const { buildSuccessResponse } = require("../../utils/responseBuilder");
const Role = require("../roles/role.model");
const Employee = require("../employees/employee.model");

// /me
exports.getMyLeaveBalance = async (req, res) => {
  const data = await service.getEmployeeBalance(
    req.user.organizationId,
    req.user.userId,        // ✅ USE TOKEN userId AS STRING
    "USER",
    { includeInactive: false }
  );

  return res.status(200).json(
    buildSuccessResponse({ data })
  );
};

// /employee/:employeeId
exports.getEmployeeLeaveBalance = async (req, res) => {
  if (req.user.activeRoleId) {
    const role = await Role.findOne({
      _id: req.user.activeRoleId,
      organizationId: req.user.organizationId
    }).select("slug");

    if (role?.slug === "manager") {
      const managerEmployee = await Employee.findOne({
        userId: req.user.userId,
        organizationId: req.user.organizationId
      }).select("_id");

      if (managerEmployee) {
        const reportIds = await Employee.find({
          organizationId: req.user.organizationId,
          managerId: managerEmployee._id
        }).distinct("_id");
        const isReport = reportIds.some(
          (id) => id.toString() === req.params.employeeId.toString()
        );
        if (!isReport) {
          throw new Error("Access denied");
        }
      }
    }
  }

  const data = await service.getEmployeeBalance(
    req.user.organizationId,
    req.params.employeeId,
    "EMPLOYEE"
  );

  return res.status(200).json(
    buildSuccessResponse({ data })
  );
};

exports.adjustEmployeeLeaveBalance = async (req, res) => {
  const data = await service.adjustEmployeeBalance(req);

  return res.status(200).json(
    buildSuccessResponse({
      message: "Leave balance adjusted successfully",
      data
    })
  );
};

exports.adjustAllEmployeeLeaveBalance = async (req, res) => {
  const data = await service.adjustAllEmployeeBalances(req);

  return res.status(200).json(
    buildSuccessResponse({
      message: "Leave balance adjusted for all employees successfully",
      data
    })
  );
};
