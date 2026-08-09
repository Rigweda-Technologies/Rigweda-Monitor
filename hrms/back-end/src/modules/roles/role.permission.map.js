const Role = require("./role.model");
const Permission = require("../permissions/permission.model");

const PAYROLL_ALL_PERMISSIONS = [
  "PAYROLL_CONFIG_MANAGE",
  "PAYROLL_RUN_CREATE",
  "PAYROLL_RUN_VIEW",
  "PAYROLL_RUN_SUBMIT",
  "PAYROLL_RUN_APPROVE",
  "PAYROLL_RUN_LOCK",
  "PAYROLL_RUN_REOPEN",
  "PAYROLL_PAYSLIP_VIEW",
  "PAYROLL_REPORT_VIEW"
];

const ROLE_PERMISSION_MAP = {
  super_admin: ["*"],

  admin: [
    "USER_CREATE",
    "USER_VIEW",
    "EMP_CREATE",
    "EMP_UPDATE",
    "EMP_DELETE",
    "EMP_VIEW",
    "DEPT_CREATE",
    "DEPT_UPDATE",
    "DEPT_DELETE",
    "DEPT_VIEW",
    "ROLE_CREATE",
    "ROLE_UPDATE",
    "ROLE_VIEW",
    "ATTENDANCE_VIEW_ALL",
    "ATTENDANCE_VIEW_SELF",
    "ATTENDANCE_MANAGE",
    "NOTIFICATION_VIEW_SELF",
    "NOTIFICATION_MANAGE_SELF",
    "SHIFT_VIEW",
    "SHIFT_MANAGE",
    "SHIFT_VIEW_SELF",
    "EXPENSE_VIEW",
    "EXPENSE_MANAGE",
    "EXPENSE_ACTION"
  ],
  "org-admin": ["*"],

  hr: [
    "EMP_CREATE",
    "EMP_UPDATE",
    "EMP_VIEW",
    "DEPT_VIEW",
    ...PAYROLL_ALL_PERMISSIONS
  ],

  manager: [
    "EMP_VIEW",
    "EMP_SELF_VIEW",
    "ATTENDANCE_VIEW_ALL",
    "NOTIFICATION_VIEW_SELF",
    "NOTIFICATION_MANAGE_SELF",
    "EXPENSE_VIEW",
    "EXPENSE_ACTION"
  ],

  employee: [
    "EMP_ORG_TREE_VIEW",
    "EMP_SELF_VIEW",
    "ATTENDANCE_VIEW_SELF",
    "NOTIFICATION_VIEW_SELF",
    "NOTIFICATION_MANAGE_SELF"
  ]
};

exports.mapPermissionsToRoles = async (organizationId) => {
  const roles = await Role.find({ organizationId });
  const permissions = await Permission.find({ organizationId });

  for (const role of roles) {
    const allowedCodes = ROLE_PERMISSION_MAP[role.slug];
    if (!allowedCodes) continue;

    const permIds =
      allowedCodes[0] === "*"
        ? permissions.map(p => p._id)
        : permissions
            .filter(p => allowedCodes.includes(p.code))
            .map(p => p._id);

    role.permissionIds = permIds;
    await role.save();
  }
};
