const Permission = require("./permission.model");

const PERMISSIONS = [
  // 👤 Users
  { code: "USER_CREATE", name: "Create User", module: "Users" },
  { code: "USER_VIEW", name: "View Users", module: "Users" },

  // 👥 Employees
  { code: "EMP_CREATE", name: "Create Employee", module: "Employees" },
  { code: "EMP_UPDATE", name: "Update Employee", module: "Employees" },
  { code: "EMP_DELETE", name: "Delete Employee", module: "Employees" },
  { code: "EMP_VIEW", name: "View Employees", module: "Employees" },
  { code: "EMP_ORG_TREE_VIEW", name: "View Organization Tree", module: "Employees" },
  { code: "EMP_SELF_VIEW", name: "View Own Profile", module: "Employees" },

  // 🏢 Departments
  { code: "DEPT_CREATE", name: "Create Department", module: "Departments" },
  { code: "DEPT_UPDATE", name: "Update Department", module: "Departments" },
  { code: "DEPT_DELETE", name: "Delete Department", module: "Departments" },
  { code: "DEPT_VIEW", name: "View Departments", module: "Departments" },
  { code: "DEPT_RESTORE", name: "Restore Department", module: "Departments" },

  // 🔐 Roles
  { code: "ROLE_CREATE", name: "Create Role", module: "Roles" },
  { code: "ROLE_UPDATE", name: "Update Role", module: "Roles" },
  { code: "ROLE_DELETE", name: "Delete Role", module: "Roles" },
  { code: "ROLE_VIEW", name: "View Roles", module: "Roles" },

  // 🏢 Organizations
  { code: "ORG_CREATE", name: "Create Organization", module: "Organizations" },
  { code: "ORG_UPDATE", name: "Update Organization", module: "Organizations" },
  { code: "ORG_VIEW", name: "View Organizations", module: "Organizations" },

  // 📅 Attendance
  { code: "ATTENDANCE_VIEW_ALL", name: "View Attendance All", module: "Attendance" },
  { code: "ATTENDANCE_VIEW_SELF", name: "View Attendance Self", module: "Attendance" },
  { code: "ATTENDANCE_MANAGE", name: "Manage Attendance", module: "Attendance" },

  // 🔔 Notifications
  { code: "NOTIFICATION_VIEW_SELF", name: "View Notifications Self", module: "Notifications" },
  { code: "NOTIFICATION_MANAGE_SELF", name: "Manage Notifications Self", module: "Notifications" },
  { code: "SHIFT_VIEW", name: "View Shifts", module: "Shifts" },
  { code: "SHIFT_MANAGE", name: "Manage Shifts", module: "Shifts" },
  { code: "SHIFT_VIEW_SELF", name: "View Shift Self", module: "Shifts" },

  // 💰 Payroll
  { code: "PAYROLL_CONFIG_MANAGE", name: "Manage Payroll Config", module: "Payroll" },
  { code: "PAYROLL_RUN_CREATE", name: "Create Payroll Runs", module: "Payroll" },
  { code: "PAYROLL_RUN_VIEW", name: "View Payroll Runs", module: "Payroll" },
  { code: "PAYROLL_RUN_SUBMIT", name: "Submit Payroll Run", module: "Payroll" },
  { code: "PAYROLL_RUN_APPROVE", name: "Approve Payroll Run", module: "Payroll" },
  { code: "PAYROLL_RUN_LOCK", name: "Lock Payroll Run", module: "Payroll" },
  { code: "PAYROLL_RUN_REOPEN", name: "Reopen Payroll Run", module: "Payroll" },
  { code: "PAYROLL_PAYSLIP_VIEW", name: "View Payslips", module: "Payroll" },
  { code: "PAYROLL_REPORT_VIEW", name: "View Payroll Reports", module: "Payroll" },

  // 📁 Organization Documents
  { code: "ORG_DOCUMENT_VIEW", name: "View Organization Documents", module: "Organization Documents" },
  { code: "ORG_DOCUMENT_UPLOAD", name: "Upload Organization Documents", module: "Organization Documents" },
  { code: "ORG_DOCUMENT_DELETE", name: "Delete Organization Documents", module: "Organization Documents" },
  { code: "ORG_DOCUMENT_REPORT_VIEW", name: "View Organization Document Reports", module: "Organization Documents" },

];

exports.seedPermissions = async (organizationId) => {
  for (const perm of PERMISSIONS) {
    const exists = await Permission.findOne({
      organizationId,
      code: perm.code
    });

    if (!exists) {
      await Permission.create({
        organizationId,
        ...perm
      });
    }
  }
};
