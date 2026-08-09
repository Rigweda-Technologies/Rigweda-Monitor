const Employee = require("./employee.model");
const OrgUser = require("../organizations/org-user.model");
const Role = require("../roles/role.model");
const { createNotificationSafe } = require("../notifications/notification.service");

const TARGET_ROLE_SLUGS = [
  "teamlead",
  "team-lead",
  "team_lead",
  "lead",
  "manager",
  "admin",
  "org-admin",
  "super_admin",
  "superadmin"
];

const getStartOfToday = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
};

const getRecipientsForEmployee = async (employee) => {
  const recipients = new Set();

  if (employee.managerId) {
    const manager = await Employee.findById(employee.managerId).select("userId");
    if (manager?.userId) {
      recipients.add(String(manager.userId));
    }
  }

  const roleRows = await Role.find({
    organizationId: employee.organizationId,
    slug: { $in: TARGET_ROLE_SLUGS }
  }).select("_id");

  const roleIds = roleRows.map((row) => row._id);
  if (roleIds.length) {
    const memberships = await OrgUser.find({
      organizationId: employee.organizationId,
      roleIds: { $in: roleIds }
    }).select("userId");

    memberships.forEach((membership) => {
      if (membership.userId) {
        recipients.add(String(membership.userId));
      }
    });
  }

  return Array.from(recipients);
};

exports.notifyProbationCompleted = async () => {
  const today = getStartOfToday();
  const employees = await Employee.find({
    isDeleted: false,
    employmentLifecycleStatus: "probation",
    probationEndDate: { $lte: today },
    probationCompletionNotifiedAt: null
  }).select("organizationId managerId userId firstName lastName employeeCode probationEndDate");

  for (const employee of employees) {
    const recipientUserIds = await getRecipientsForEmployee(employee);
    if (!recipientUserIds.length) {
      employee.probationCompletionNotifiedAt = new Date();
      await employee.save();
      continue;
    }

    const recipientEmployees = await Employee.find({
      organizationId: employee.organizationId,
      userId: { $in: recipientUserIds },
      isDeleted: false
    }).select("userId");
    const recipientEmployeeByUserId = new Map(
      recipientEmployees.map((row) => [String(row.userId), row._id])
    );

    const employeeName = `${employee.firstName || ""} ${employee.lastName || ""}`.trim();
    const probationDate = employee.probationEndDate
      ? new Date(employee.probationEndDate).toDateString()
      : "today";

    for (const recipientUserId of recipientUserIds) {
      if (recipientUserId === String(employee.userId)) continue;
      await createNotificationSafe({
        organizationId: employee.organizationId,
        recipientUserId,
        recipientEmployeeId: recipientEmployeeByUserId.get(recipientUserId) || null,
        actorEmployeeId: employee._id,
        type: "probation_completed",
        title: "Probation completed",
        message: `${employeeName} (${employee.employeeCode}) completed probation on ${probationDate}.`,
        meta: {
          employeeId: employee._id,
          employeeCode: employee.employeeCode,
          probationEndDate: employee.probationEndDate
        }
      });
    }

    employee.probationCompletionNotifiedAt = new Date();
    await employee.save();
  }

  return employees.length;
};
