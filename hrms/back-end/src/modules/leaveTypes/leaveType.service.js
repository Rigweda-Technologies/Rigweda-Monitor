const LeaveType = require("./leaveType.model");
const { initializeForNewLeaveType } = require("../leaveBalances/leaveBalance.service");

exports.createLeaveType = async (req) => {
  const {
    name,
    code,
    description,
    daysPerYear,
    isCarryForward,
    includeInPayroll,
    maxCarryForward,
    status
  } = req.body;
  const organizationId = req.user.organizationId;
  const exists = await LeaveType.findOne({
    organizationId,
    code: code
  });
  if (exists)
    throw { code: 400, message: "Leave type code already exists for this org" };

  const leaveType = await LeaveType.create({
    name,
    code,
    description,
    daysPerYear,
    isCarryForward,
    includeInPayroll,
    maxCarryForward: isCarryForward ? maxCarryForward ?? null : null,
    status,
    organizationId
  });

  await initializeForNewLeaveType(leaveType, organizationId);
  return leaveType;
};

exports.getLeaveTypesByOrg = async (organizationId) => {
  return await LeaveType.find({ organizationId });
};

exports.getEmployeeleaves = async (req) => {
  return await LeaveType.find({ organizationId: req.user?.organizationId, status: "active" });
};

/**
 * UPDATE LEAVE TYPE
 * This handles both general info changes and manual status toggling
 */
exports.updateLeaveType = async (id, payload) => {
  const leaveType = await LeaveType.findByIdAndUpdate(
    id,
    payload,
    { new: true, runValidators: true }
  );

  if (!leaveType) {
    throw { code: 404, message: "Leave type not found" };
  }

  return leaveType;
};

/**
 * SOFT DELETE
 * Explicitly sets status to 'inactive'
 */
exports.deleteLeaveType = async (id) => {
  const leaveType = await LeaveType.findById(id);

  if (!leaveType) {
    throw { code: 404, message: "Leave type not found" };
  }

  if (leaveType.status === "inactive") {
    return leaveType;
  }

  leaveType.status = "inactive";
  await leaveType.save();
  return leaveType;
};
