const Organization = require("./organization.model");
const User = require("../users/user.model");
const OrgUser = require("./org-user.model");
const Role = require("../roles/role.model");
const Employee = require("../employees/employee.model");
const OrgSettings = require("../orgSettings/orgSettings.model");
const leaveBalanceService = require("../leaveBalances/leaveBalance.service");
const { seedOrgRolesAndPermissions } = require("../roles/role.seeder");
const mongoose = require("mongoose");
const { getPayrollPgPool, isPayrollDbEnabled } = require("../../config/payrollDb");

const toNameCase = (value) => {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  return text
    .split(" ")
    .map((part) =>
      part
        .split("-")
        .map((segment) =>
          segment ? `${segment.charAt(0).toUpperCase()}${segment.slice(1).toLowerCase()}` : segment
        )
        .join("-")
    )
    .join(" ");
};

const deriveNamePartsFromEmail = (email) => {
  const localPart = String(email || "").split("@")[0] || "";
  const tokens = localPart
    .split(/[._-]+/)
    .map((part) => toNameCase(part))
    .filter(Boolean);

  return {
    firstName: tokens[0] || "Organization",
    lastName: tokens.slice(1).join(" ") || "Admin"
  };
};

const generateEmployeeCode = async (organizationId) => {
  const orgSettings = await OrgSettings.findOne({ organizationId }, "employeeIdPrefix").lean();
  const envPrefix = (process.env.EMPLOYEE_ID_PREFIX || process.env.EMPLOYEE_CODE_PREFIX || "LV").trim();
  const prefix = ((orgSettings?.employeeIdPrefix || envPrefix || "LV").trim() || "LV").toUpperCase();
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const codePattern = new RegExp(`^${escapedPrefix}-(\\d+)$`, "i");
  const existingEmployees = await Employee.find({
    organizationId,
    employeeCode: { $regex: `^${escapedPrefix}-`, $options: "i" }
  }).select("employeeCode");

  let sequence = existingEmployees.reduce((max, row) => {
    const match = codePattern.exec(String(row?.employeeCode || ""));
    if (!match) return max;
    const current = Number(match[1]);
    return Number.isFinite(current) ? Math.max(max, current) : max;
  }, 0);

  while (true) {
    sequence += 1;
    const code = `${prefix}-${String(sequence).padStart(4, "0")}`;
    const exists = await Employee.findOne({ organizationId, employeeCode: code }).select("_id");
    if (!exists) return code;
  }
};

const ensureOrgAdminEmployeeRecord = async ({ organizationId, user }) => {
  if (!organizationId || !user?._id) return null;

  let employee = await Employee.findOne({
    organizationId,
    userId: user._id,
    isDeleted: false
  });
  if (employee) return employee;

  const existingEmployee = await Employee.findOne({ userId: user._id }).sort({ createdAt: -1 });
  const derivedName = deriveNamePartsFromEmail(user.email || "");
  const employeeCode = await generateEmployeeCode(organizationId);

  const payload = {
    organizationId,
    userId: user._id,
    firstName: toNameCase(existingEmployee?.firstName || derivedName.firstName || "Organization"),
    lastName: toNameCase(existingEmployee?.lastName || derivedName.lastName || "Admin"),
    employeeCode,
    departmentId: existingEmployee?.departmentId || undefined,
    designationId: existingEmployee?.designationId || undefined,
    dateOfJoining: existingEmployee?.dateOfJoining || new Date(),
    employmentType: existingEmployee?.employmentType || "full_time",
    managerId: existingEmployee?.managerId || undefined,
    shiftId: existingEmployee?.shiftId || undefined,
    phone: existingEmployee?.phone || "",
    profileCompleted: existingEmployee?.profileCompleted || false,
    profileImage: existingEmployee?.profileImage || null,
    status: existingEmployee?.status || "active",
    employmentLifecycleStatus: existingEmployee?.employmentLifecycleStatus || "confirmed"
  };

  if (existingEmployee) {
    const orgChanged = String(existingEmployee.organizationId || "") !== String(organizationId);
    existingEmployee.set(payload);
    await existingEmployee.save();
    if (orgChanged) {
      await leaveBalanceService.initializeForEmployee(existingEmployee, organizationId);
    }
    return existingEmployee;
  }

  employee = await Employee.create(payload);
  await leaveBalanceService.initializeForEmployee(employee, organizationId);
  return employee;
};

/**
 * CREATE ORGANIZATION + ASSIGN ADMIN
 */
exports.createOrganization = async ({
  name,
  code,
  timezone,
  currency,
  adminUserId,
  adminRoleId,
  creator
}) => {
  const isSuperAdmin = await isUserSuperAdmin(creator?.userId);
  if (!isSuperAdmin) {
    throw { code: 403, message: "Only SuperAdmin can create organizations" };
  }

  const org = await Organization.create({
    name,
    code,
    timezone,
    currency
  });

  await seedOrgRolesAndPermissions(org._id);

  if (!adminUserId) {
    return org;
  }

  if (creator?.userId && String(creator.userId) === String(adminUserId)) {
    throw {
      code: 400,
      message: "SuperAdmin cannot be assigned as an organization admin"
    };
  }

  const admin = await User.findById(adminUserId);
  if (!admin) {
    throw { code: 404, message: "Admin user not found" };
  }

  const adminIsSuperAdmin = await isUserSuperAdmin(admin._id);
  if (adminIsSuperAdmin) {
    throw {
      code: 400,
      message: "SuperAdmin cannot be assigned as an organization admin"
    };
  }

  let adminRole = null;
  if (adminRoleId) {
    adminRole = await Role.findOne({
      _id: adminRoleId,
      organizationId: org._id
    });
  }

  if (!adminRole) {
    adminRole = await Role.findOne({
      slug: "org-admin",
      organizationId: org._id
    });
  }

  if (!adminRole) {
    throw { code: 400, message: "Admin role not found for organization" };
  }

  if (!admin.organizationIds.includes(org._id)) {
    admin.organizationIds.push(org._id);
    admin.activeOrganizationId = org._id;
    await admin.save();
  }

  await OrgUser.create({
    userId: admin._id,
    organizationId: org._id,
    roleIds: [adminRole._id]
  });

  await ensureOrgAdminEmployeeRecord({
    organizationId: org._id,
    user: admin
  });

  return org;
};

/**
 * Get organizations visible to logged-in user
 */
exports.getOrganizations = async ({ user }) => {
  const isSuperAdmin = await isUserSuperAdmin(user.userId);
  if (isSuperAdmin) {
    return Organization.find({ code: { $ne: "SYSTEM" } })
      .sort({ createdAt: -1 });
  }

  const memberships = await OrgUser.find({
    userId: user.userId
  }).select("organizationId");

  const orgIds = memberships.map(m => m.organizationId);

  return Organization.find({
    _id: { $in: orgIds },
    status: "active"
  }).sort({ createdAt: -1 });
};

/**
 * Helper: detect SuperAdmin safely
 */
async function isUserSuperAdmin(userId) {
  const memberships = await OrgUser.find({ userId }).populate("roleIds");

  return memberships.some(m =>
    m.roleIds.some(r => ["superadmin", "super_admin"].includes(r.slug))
  );
}

exports.isUserSuperAdmin = isUserSuperAdmin;

/**
 * GET ORGANIZATION BY ID
 */
exports.getOrganizationById = async (orgId) => {
  const org = await Organization.findById(orgId);

  if (!org) {
    throw { code: 404, message: "Organization not found" };
  }

  return org;
};

/**
 * UPDATE ORGANIZATION
 */
exports.updateOrganization = async (orgId, payload) => {
  const org = await Organization.findByIdAndUpdate(
    orgId,
    payload,
    { new: true }
  );

  if (!org) {
    throw { code: 404, message: "Organization not found" };
  }

  return org;
};

/**
 * SOFT DELETE ORGANIZATION
 */
exports.deleteOrganization = async (orgId) => {
  const org = await Organization.findByIdAndUpdate(
    orgId,
    {
      status: "inactive",
      isSoftDeleted: true,
      softDeletedAt: new Date(),
      softDeletedBy: null
    },
    { new: true }
  );

  if (!org) {
    throw { code: 404, message: "Organization not found" };
  }

  return true;
};

const ORGANIZATION_LIFECYCLE_ACTIONS = new Set(["soft_delete", "restore", "hard_delete"]);

const buildSoftDeletedEmail = (email, orgCode) => {
  const safeEmail = String(email || "").trim().toLowerCase();
  const [localPartRaw, domainPartRaw] = safeEmail.split("@");
  const localPart = localPartRaw || "user";
  const domainPart = domainPartRaw || "deleted.local";
  const suffix = `${String(orgCode || "org").toLowerCase()}-${Date.now()}`;
  return `${localPart}+deleted-${suffix}@${domainPart}`;
};

const cleanUserOrgContext = (user, organizationId) => {
  const currentOrganizationIds = Array.isArray(user.organizationIds) ? user.organizationIds : [];
  const nextOrganizationIds = currentOrganizationIds.filter(
    (orgRef) => String(orgRef) !== String(organizationId)
  );
  user.organizationIds = nextOrganizationIds;

  if (String(user.activeOrganizationId || "") === String(organizationId)) {
    user.activeOrganizationId = nextOrganizationIds[0] || null;
  }

  if (Array.isArray(user.tokenList)) {
    user.tokenList = user.tokenList.filter(
      (token) => String(token?.organizationId || "") !== String(organizationId)
    );
  }
};

const assertLifecycleConfirmation = (organization, confirmationCode) => {
  const expected = String(organization?.code || "").trim().toUpperCase();
  const provided = String(confirmationCode || "").trim().toUpperCase();

  if (!expected || !provided || expected !== provided) {
    throw {
      code: 400,
      message: `Confirmation failed. Enter organization code "${organization?.code || ""}" to continue.`
    };
  }
};

const assertLifecyclePermissions = async ({ actorUserId }) => {
  const isSuperAdmin = await isUserSuperAdmin(actorUserId);
  if (!isSuperAdmin) {
    throw { code: 403, message: "Only SuperAdmin can perform organization lifecycle actions" };
  }
};

const getOrganizationForLifecycle = async (organizationId) => {
  const organization = await Organization.findById(organizationId);
  if (!organization) {
    throw { code: 404, message: "Organization not found" };
  }
  if (String(organization.code || "").toUpperCase() === "SYSTEM") {
    throw { code: 400, message: "SYSTEM organization cannot be deleted" };
  }
  return organization;
};

const getMembershipCountMap = async (userIds) => {
  if (!Array.isArray(userIds) || !userIds.length) return new Map();
  const rows = await OrgUser.aggregate([
    { $match: { userId: { $in: userIds } } },
    { $group: { _id: "$userId", count: { $sum: 1 } } }
  ]);
  const map = new Map();
  rows.forEach((row) => {
    map.set(String(row._id), Number(row.count || 0));
  });
  return map;
};

const softDeleteOrganization = async ({ organization, actorUserId }) => {
  const memberships = await OrgUser.find({ organizationId: organization._id }).select("userId");
  const userIds = [...new Set((memberships || []).map((m) => String(m.userId)).filter(Boolean))]
    .map((id) => new mongoose.Types.ObjectId(id));
  const membershipCountMap = await getMembershipCountMap(userIds);

  let renamedUsers = 0;
  let skippedUsers = 0;

  const users = await User.find({ _id: { $in: userIds } });
  for (const user of users) {
    const membershipCount = Number(membershipCountMap.get(String(user._id)) || 0);
    if (membershipCount !== 1) {
      skippedUsers += 1;
      continue;
    }

    const currentEmail = String(user.email || "").trim().toLowerCase();
    const alreadySoftDeletedForOrg =
      String(user.softDeleteMeta?.organizationId || "") === String(organization._id);
    if (alreadySoftDeletedForOrg) {
      skippedUsers += 1;
      continue;
    }

    user.softDeleteMeta = {
      organizationId: organization._id,
      originalEmail: currentEmail,
      deletedAt: new Date()
    };
    user.email = buildSoftDeletedEmail(currentEmail, organization.code);
    user.status = "inactive";
    if (String(user.activeOrganizationId || "") === String(organization._id)) {
      user.activeOrganizationId = null;
    }
    if (Array.isArray(user.tokenList)) {
      user.tokenList = user.tokenList.filter(
        (token) => String(token?.organizationId || "") !== String(organization._id)
      );
    }
    await user.save();
    renamedUsers += 1;
  }

  organization.status = "inactive";
  organization.isSoftDeleted = true;
  organization.softDeletedAt = new Date();
  organization.softDeletedBy = actorUserId || null;
  await organization.save();

  return {
    action: "soft_delete",
    organizationId: String(organization._id),
    renamedUsers,
    skippedUsers
  };
};

const restoreOrganization = async ({ organization }) => {
  const users = await User.find({
    "softDeleteMeta.organizationId": organization._id
  });

  let restoredUsers = 0;
  let conflicts = 0;

  for (const user of users) {
    const originalEmail = String(user.softDeleteMeta?.originalEmail || "").trim().toLowerCase();
    if (!originalEmail) {
      user.softDeleteMeta = { organizationId: null, originalEmail: null, deletedAt: null };
      await user.save();
      continue;
    }

    const existing = await User.findOne({
      _id: { $ne: user._id },
      email: originalEmail
    }).select("_id");

    if (existing) {
      conflicts += 1;
      continue;
    }

    user.email = originalEmail;
    if (user.status === "inactive") {
      user.status = "active";
    }
    user.softDeleteMeta = { organizationId: null, originalEmail: null, deletedAt: null };
    await user.save();
    restoredUsers += 1;
  }

  organization.status = "active";
  organization.isSoftDeleted = false;
  organization.softDeletedAt = null;
  organization.softDeletedBy = null;
  await organization.save();

  return {
    action: "restore",
    organizationId: String(organization._id),
    restoredUsers,
    conflicts
  };
};

const deletePayrollTenantData = async (organizationId) => {
  if (!isPayrollDbEnabled()) {
    return { payrollTenantDeleted: 0 };
  }

  const pool = await getPayrollPgPool();
  if (!pool) {
    return { payrollTenantDeleted: 0 };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      "DELETE FROM payroll_tenants WHERE organization_id = $1",
      [String(organizationId)]
    );
    await client.query("COMMIT");
    return { payrollTenantDeleted: Number(result.rowCount || 0) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw {
      code: 500,
      message: "Hard delete failed while deleting payroll tenant data",
      error: error?.message || error
    };
  } finally {
    client.release();
  }
};

const PAYROLL_GENERATED_CLEAR_TABLES = [
  "payroll_run_components",
  "payroll_run_employees",
  "payroll_run_audit_entries",
  "payroll_runs",
  "payroll_adjustments",
  "payroll_arrears",
  "payroll_loans",
  "payroll_reimbursements",
  "payroll_attendance_snapshot_days",
  "payroll_attendance_snapshots",
  "payroll_action_idempotency"
];

const PAYROLL_SETUP_CLEAR_TABLES = [
  "employee_payroll_revision_history",
  "employee_bank_details",
  "employee_statutory_details",
  "employee_salary_structures",
  "employee_payroll_profiles",
  "component_formulas",
  "earning_components",
  "deduction_components",
  "employer_contribution_components",
  "payroll_settings",
  "pay_periods",
  "pay_groups"
];

const quoteIdent = (value) => `"${String(value).replace(/"/g, "\"\"")}"`;

const getExistingPayrollTables = async (client, tableNames) => {
  const result = await client.query(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
    `,
    [tableNames]
  );

  return new Set(result.rows.map((row) => String(row.table_name)));
};

const clearTenantScopedPayrollTables = async ({ client, tenantId, tableNames }) => {
  const existingTables = await getExistingPayrollTables(client, tableNames);
  const summary = {};

  for (const tableName of tableNames) {
    if (!existingTables.has(tableName)) {
      summary[tableName] = 0;
      continue;
    }
    const result = await client.query(
      `DELETE FROM ${quoteIdent(tableName)} WHERE tenant_id = $1`,
      [tenantId]
    );
    summary[tableName] = Number(result.rowCount || 0);
  }

  return summary;
};

exports.clearOrganizationPayrollData = async ({
  organizationId,
  mode = "generated",
  confirmationCode,
  actorUserId
}) => {
  if (!["generated", "all"].includes(String(mode))) {
    throw { code: 400, message: "Invalid payroll clear mode. Use generated or all." };
  }

  await assertLifecyclePermissions({ actorUserId });
  const organization = await getOrganizationForLifecycle(organizationId);
  assertLifecycleConfirmation(organization, confirmationCode);

  if (!isPayrollDbEnabled()) {
    return {
      action: "clear_payroll",
      organizationId: String(organization._id),
      mode,
      payrollEnabled: false,
      payrollTenantFound: false,
      tenantId: null,
      clearedTables: {},
      clearedRowCount: 0
    };
  }

  const pool = await getPayrollPgPool();
  if (!pool) {
    throw { code: 500, message: "Payroll Postgres pool unavailable" };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const tenantResult = await client.query(
      `
        SELECT id
        FROM payroll_tenants
        WHERE organization_id = $1
        LIMIT 1
      `,
      [String(organization._id)]
    );
    const tenantId = String(tenantResult.rows[0]?.id || "").trim();

    if (!tenantId) {
      await client.query("COMMIT");
      return {
        action: "clear_payroll",
        organizationId: String(organization._id),
        mode,
        payrollEnabled: true,
        payrollTenantFound: false,
        tenantId: null,
        clearedTables: {},
        clearedRowCount: 0
      };
    }

    const tablesToClear = mode === "all"
      ? [...PAYROLL_GENERATED_CLEAR_TABLES, ...PAYROLL_SETUP_CLEAR_TABLES]
      : PAYROLL_GENERATED_CLEAR_TABLES;

    const clearedTables = await clearTenantScopedPayrollTables({
      client,
      tenantId,
      tableNames: tablesToClear
    });

    await client.query("COMMIT");

    return {
      action: "clear_payroll",
      organizationId: String(organization._id),
      organizationCode: String(organization.code || ""),
      mode,
      payrollEnabled: true,
      payrollTenantFound: true,
      tenantId,
      clearedTables,
      clearedRowCount: Object.values(clearedTables).reduce(
        (sum, count) => sum + Number(count || 0),
        0
      )
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw {
      code: 500,
      message: "Failed to clear organization payroll data",
      error: error?.message || error
    };
  } finally {
    client.release();
  }
};

const deleteOrganizationScopedMongoData = async (organizationId) => {
  const deletedByModel = {};
  const modelNames = mongoose.modelNames();

  for (const modelName of modelNames) {
    if (modelName === "organizations" || modelName === "users") continue;
    const model = mongoose.model(modelName);
    if (!model?.schema?.path("organizationId")) continue;
    const result = await model.deleteMany({ organizationId });
    deletedByModel[modelName] = Number(result?.deletedCount || 0);
  }

  return deletedByModel;
};

const detachUsersFromOrganization = async (organizationId) => {
  const users = await User.find({
    $or: [
      { organizationIds: organizationId },
      { "softDeleteMeta.organizationId": organizationId }
    ]
  });

  let detachedUsers = 0;
  let deactivatedUsers = 0;
  let deletedUsers = 0;

  for (const user of users) {
    const beforeCount = Array.isArray(user.organizationIds) ? user.organizationIds.length : 0;
    cleanUserOrgContext(user, organizationId);

    if (String(user.softDeleteMeta?.organizationId || "") === String(organizationId)) {
      user.softDeleteMeta = { organizationId: null, originalEmail: null, deletedAt: null };
    }

    const afterCount = Array.isArray(user.organizationIds) ? user.organizationIds.length : 0;
    if (beforeCount !== afterCount) {
      detachedUsers += 1;
    }
    if (afterCount === 0) {
      await User.deleteOne({ _id: user._id });
      deletedUsers += 1;
      continue;
    }

    await user.save();
  }

  return { detachedUsers, deactivatedUsers, deletedUsers };
};

const hardDeleteOrganization = async ({ organization }) => {
  const payrollStats = await deletePayrollTenantData(organization._id);
  const deletedByModel = await deleteOrganizationScopedMongoData(organization._id);
  const userCleanup = await detachUsersFromOrganization(organization._id);
  const organizationDeleteResult = await Organization.deleteOne({ _id: organization._id });

  return {
    action: "hard_delete",
    organizationId: String(organization._id),
    deletedByModel,
    payrollTenantDeleted: payrollStats.payrollTenantDeleted,
    payrollCascadeDeleted: payrollStats.payrollTenantDeleted > 0,
    detachedUsers: userCleanup.detachedUsers,
    deletedUsers: userCleanup.deletedUsers,
    deactivatedUsers: userCleanup.deactivatedUsers,
    organizationDeleted: Number(organizationDeleteResult?.deletedCount || 0) > 0
  };
};

exports.applyOrganizationLifecycleAction = async ({
  organizationId,
  action,
  confirmationCode,
  actorUserId
}) => {
  if (!ORGANIZATION_LIFECYCLE_ACTIONS.has(action)) {
    throw { code: 400, message: "Invalid action. Use soft_delete, restore, or hard_delete." };
  }

  await assertLifecyclePermissions({ actorUserId });
  const organization = await getOrganizationForLifecycle(organizationId);
  assertLifecycleConfirmation(organization, confirmationCode);

  if (action === "soft_delete") {
    return softDeleteOrganization({ organization, actorUserId });
  }
  if (action === "restore") {
    return restoreOrganization({ organization });
  }
  return hardDeleteOrganization({ organization });
};
