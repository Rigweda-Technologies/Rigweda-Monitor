const Employee = require("../employees/employee.model");
const User = require("../users/user.model");

exports.findCurrentAgentProfile = async ({ userId, organizationId }) => {
  const user = await User.findById(userId).select("_id email displayName status").lean();
  if (!user) {
    return null;
  }

  const employee = await Employee.findOne({
    userId,
    organizationId,
    isDeleted: false
  })
    .select("_id firstName lastName employeeCode departmentId designationId profileImage status employmentLifecycleStatus")
    .lean();

  return {
    user,
    employee: employee || null
  };
};
