const ApprovalFlow = require("../modules/approvalFlows/approvalFlow.model");
const Employee = require("../modules/employees/employee.model");
const Role = require("../modules/roles/role.model");
const OrgUser = require("../modules/organizations/org-user.model");

const normalizeRoleKey = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-");

const roleMatchesStep = (stepRoleValue, actorRoleSlug, actorRoleName) => {
  const normalizedStepRole = normalizeRoleKey(stepRoleValue);
  if (!normalizedStepRole) return false;

  const normalizedActorSlug = normalizeRoleKey(actorRoleSlug);
  const normalizedActorName = normalizeRoleKey(actorRoleName);

  return Boolean(
    normalizedActorSlug && normalizedStepRole === normalizedActorSlug
    || normalizedActorName && normalizedStepRole === normalizedActorName
  );
};

const ADMIN_OVERRIDE_ROLE_SLUGS = new Set(["admin", "org-admin", "superadmin"]);

const findRoleForStep = async ({ organizationId, roleValue }) => {
  const normalizedRoleValue = normalizeRoleKey(roleValue);
  if (!organizationId || !normalizedRoleValue) return null;

  const roles = await Role.find({ organizationId }).select("_id slug name");
  return roles.find((role) =>
    roleMatchesStep(normalizedRoleValue, role.slug, role.name)
  ) || null;
};

const buildRuntimeSteps = ({ flow, subjectEmployee }) => {
  const steps = [];
  for (const s of flow.steps || []) {
    let approverEmployeeId = null;
    let approverRoleSlug = null;

    if (s.approverType === "manager") {
      if (!subjectEmployee?.managerId) {
        throw new Error("Manager is not assigned for this employee");
      }
      approverEmployeeId = subjectEmployee.managerId;
    } else if (s.approverType === "employee") {
      approverEmployeeId = s.employeeId || null;
    } else if (s.approverType === "role") {
      approverRoleSlug = s.roleSlug || null;
    }

    steps.push({
      stepNumber: s.stepNumber,
      approverType: s.approverType,
      approverEmployeeId,
      approverRoleSlug,
      status: "queued",
      actionBy: null,
      actionAt: null,
      remarks: null
    });
  }

  steps.sort((a, b) => a.stepNumber - b.stepNumber);
  if (steps.length) {
    steps[0].status = "pending";
  }
  return steps;
};

exports.buildRuntimeSteps = buildRuntimeSteps;

const isDefaultRange = (flow = {}) => flow.minDays == null && flow.maxDays == null;

const rangeSize = (flow = {}) => {
  const min = flow.minDays == null ? Number.NEGATIVE_INFINITY : Number(flow.minDays);
  const max = flow.maxDays == null ? Number.POSITIVE_INFINITY : Number(flow.maxDays);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return Number.POSITIVE_INFINITY;
  return max - min;
};

const compareFlowPriority = (a, b) => {
  if (isDefaultRange(a) !== isDefaultRange(b)) {
    return isDefaultRange(a) ? 1 : -1;
  }
  const sizeDiff = rangeSize(a) - rangeSize(b);
  if (sizeDiff !== 0) return sizeDiff;
  return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
};

exports.resolveApplicableFlow = async ({
  organizationId,
  moduleKey,
  subjectEmployee,
  preferredFlowId = null,
  totalDays = null
}) => {
  let flow = null;

  if (preferredFlowId) {
    flow = await ApprovalFlow.findOne({
      _id: preferredFlowId,
      organizationId,
      moduleKey,
      isActive: true
    });
    if (!flow) {
      throw new Error("Assigned approval flow is missing, inactive, or invalid for this module");
    }
  }

  if (!flow) {
    const flows = await ApprovalFlow.find({
      organizationId,
      moduleKey,
      isActive: true
    });

    flow = flows.sort(compareFlowPriority).find((f) => {
      if (totalDays == null) return true;
      const minOk = f.minDays == null || Number(totalDays) >= Number(f.minDays);
      const maxOk = f.maxDays == null || Number(totalDays) <= Number(f.maxDays);
      return minOk && maxOk;
    });
  }

  if (!flow) return null;

  return {
    flowId: flow._id,
    steps: buildRuntimeSteps({ flow, subjectEmployee })
  };
};

exports.getActorApprovalContext = async (req) => {
  const [actorEmployee, actorRole] = await Promise.all([
    Employee.findOne({
      userId: req.user.userId,
      organizationId: req.user.organizationId
    }).select("_id"),
    req.user.activeRoleId
      ? Role.findOne({
          _id: req.user.activeRoleId,
          organizationId: req.user.organizationId
        }).select("_id slug name")
      : null
  ]);

  return {
    actorEmployeeId: actorEmployee?._id || null,
    actorRoleId: actorRole?._id || null,
    actorRoleSlug: actorRole?.slug || null,
    actorRoleName: actorRole?.name || null
  };
};

exports.isAdminOverrideActor = (actorContext) =>
  Boolean(
    actorContext
    && ADMIN_OVERRIDE_ROLE_SLUGS.has(normalizeRoleKey(actorContext.actorRoleSlug))
  );

exports.canActorApproveStep = (step, actorContext, options = {}) => {
  const allowAdminOverride = Boolean(options.allowAdminOverride);
  if (!step || !actorContext) return false;
  if (allowAdminOverride && exports.isAdminOverrideActor(actorContext)) {
    return true;
  }
  if (step.approverType === "manager" || step.approverType === "employee") {
    if (!step.approverEmployeeId || !actorContext.actorEmployeeId) return false;
    return step.approverEmployeeId.toString() === actorContext.actorEmployeeId.toString();
  }
  if (step.approverType === "role") {
    return roleMatchesStep(
      step.approverRoleSlug,
      actorContext.actorRoleSlug,
      actorContext.actorRoleName
    );
  }
  return false;
};

exports.resolveRecipientsForStep = async ({ organizationId, step }) => {
  if (!organizationId || !step) return [];

  if (step.approverType === "employee" || step.approverType === "manager") {
    if (!step.approverEmployeeId) return [];
    const employee = await Employee.findOne({
      _id: step.approverEmployeeId,
      organizationId,
      status: "active"
    }).select("_id userId firstName lastName employeeCode");
    if (!employee?.userId) return [];
    return [{
      employeeId: employee._id,
      userId: employee.userId,
      firstName: employee.firstName,
      lastName: employee.lastName,
      employeeCode: employee.employeeCode || null
    }];
  }

  if (step.approverType === "role") {
    if (!step.approverRoleSlug) return [];
    const role = await findRoleForStep({
      organizationId,
      roleValue: step.approverRoleSlug
    });
    if (!role?._id) return [];

    const orgUsers = await OrgUser.find({
      organizationId,
      roleIds: role._id
    }).select("userId");
    const userIds = [...new Set(orgUsers.map((u) => u.userId?.toString()).filter(Boolean))];
    if (!userIds.length) return [];

    const employees = await Employee.find({
      organizationId,
      status: "active",
      userId: { $in: userIds }
    }).select("_id userId firstName lastName employeeCode");

    return employees
      .filter((e) => e.userId)
      .map((e) => ({
        employeeId: e._id,
        userId: e.userId,
        firstName: e.firstName,
        lastName: e.lastName,
        employeeCode: e.employeeCode || null
      }));
  }

  return [];
};
