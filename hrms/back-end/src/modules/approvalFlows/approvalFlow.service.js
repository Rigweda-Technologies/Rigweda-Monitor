const ApprovalFlow = require("./approvalFlow.model");
const Employee = require("../employees/employee.model");
const Role = require("../roles/role.model");

const normalizeSteps = (steps = []) =>
  [...steps]
    .map((s) => ({
      stepNumber: Number(s.stepNumber),
      approverType: s.approverType,
      roleSlug: s.approverType === "role" ? String(s.roleSlug || "").trim() : null,
      employeeId: s.approverType === "employee" ? s.employeeId : null
    }))
    .sort((a, b) => a.stepNumber - b.stepNumber);

const validateDaysRange = (minDays, maxDays) => {
  if (minDays == null) {
    throw new Error("Min days is required");
  }
  if (maxDays == null) return;
  if (Number(minDays) > Number(maxDays)) {
    throw new Error("minDays cannot be greater than maxDays");
  }
};

const normalizeRange = (flowLike = {}) => ({
  min: flowLike.minDays == null ? Number.NEGATIVE_INFINITY : Number(flowLike.minDays),
  max: flowLike.maxDays == null ? Number.POSITIVE_INFINITY : Number(flowLike.maxDays)
});

const rangesOverlap = (a, b) => a.min <= b.max && b.min <= a.max;
const isDefaultRange = (flowLike = {}) => flowLike.minDays == null && flowLike.maxDays == null;

const validateSteps = async (organizationId, steps = []) => {
  if (!Array.isArray(steps) || !steps.length) {
    throw new Error("At least one approval step is required");
  }

  const numbers = steps.map((s) => Number(s.stepNumber));
  const unique = new Set(numbers);
  if (unique.size !== numbers.length) {
    throw new Error("Step numbers must be unique");
  }
  const sorted = [...numbers].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i += 1) {
    if (sorted[i] !== i + 1) {
      throw new Error("Step numbers must be continuous starting from 1");
    }
  }

  const employeeIds = [...new Set(steps
    .filter((s) => s.approverType === "employee")
    .map((s) => s.employeeId)
    .filter(Boolean)
    .map((id) => id.toString()))];

  if (employeeIds.length) {
    const count = await Employee.countDocuments({
      _id: { $in: employeeIds },
      organizationId,
      status: "active"
    });
    if (count !== employeeIds.length) {
      throw new Error("One or more employee approvers are invalid or inactive");
    }
  }

  const roleSlugs = [...new Set(steps
    .filter((s) => s.approverType === "role")
    .map((s) => s.roleSlug)
    .filter(Boolean))];
  if (roleSlugs.length) {
    const foundCount = await Role.countDocuments({
      organizationId,
      slug: { $in: roleSlugs }
    });
    if (foundCount !== roleSlugs.length) {
      throw new Error("One or more role approvers are invalid");
    }
  }
};

const validateActiveOverlap = async ({
  organizationId,
  moduleKey,
  minDays,
  maxDays,
  isActive,
  excludeId = null
}) => {
  if (!isActive) return;
  const currentRange = normalizeRange({ minDays, maxDays });
  const query = {
    organizationId,
    moduleKey,
    isActive: true
  };
  if (excludeId) {
    query._id = { $ne: excludeId };
  }

  const flows = await ApprovalFlow.find(query).select("name minDays maxDays");
  for (const flow of flows) {
    if (isDefaultRange({ minDays, maxDays }) || isDefaultRange(flow)) {
      if (isDefaultRange({ minDays, maxDays }) && isDefaultRange(flow)) {
        throw new Error(`Default active flow already exists as "${flow.name}"`);
      }
      continue;
    }

    const existingRange = normalizeRange(flow);
    if (rangesOverlap(currentRange, existingRange)) {
      throw new Error(`Active range overlaps with flow "${flow.name}"`);
    }
  }
};

exports.createFlow = async (req) => {
  validateDaysRange(req.body.minDays, req.body.maxDays);
  const steps = normalizeSteps(req.body.steps || []);
  await validateSteps(req.user.organizationId, steps);
  await validateActiveOverlap({
    organizationId: req.user.organizationId,
    moduleKey: req.body.moduleKey,
    minDays: req.body.minDays ?? null,
    maxDays: req.body.maxDays ?? null,
    isActive: Boolean(req.body.isActive)
  });
  const flow = await ApprovalFlow.create({
    organizationId: req.user.organizationId,
    moduleKey: req.body.moduleKey,
    name: req.body.name,
    isActive: Boolean(req.body.isActive),
    minDays: req.body.minDays ?? null,
    maxDays: req.body.maxDays ?? null,
    steps
  });
  return flow;
};

exports.listFlows = async (req) => {
  const query = {
    organizationId: req.user.organizationId
  };
  if (req.query.moduleKey) query.moduleKey = req.query.moduleKey;
  return ApprovalFlow.find(query)
    .populate("steps.employeeId", "firstName lastName employeeCode")
    .sort({ moduleKey: 1, createdAt: -1 });
};

exports.updateFlow = async (req) => {
  const existing = await ApprovalFlow.findOne({
    _id: req.params.id,
    organizationId: req.user.organizationId
  });
  if (!existing) throw new Error("Approval flow not found");

  const update = { ...req.body };
  const nextModuleKey = update.moduleKey || existing.moduleKey;
  const nextMinDays = Object.prototype.hasOwnProperty.call(update, "minDays")
    ? update.minDays
    : existing.minDays;
  const nextMaxDays = Object.prototype.hasOwnProperty.call(update, "maxDays")
    ? update.maxDays
    : existing.maxDays;
  const nextIsActive = Object.prototype.hasOwnProperty.call(update, "isActive")
    ? Boolean(update.isActive)
    : Boolean(existing.isActive);
  const nextSteps = Array.isArray(update.steps)
    ? normalizeSteps(update.steps)
    : normalizeSteps(existing.steps || []);

  validateDaysRange(nextMinDays, nextMaxDays);
  await validateSteps(req.user.organizationId, nextSteps);
  await validateActiveOverlap({
    organizationId: req.user.organizationId,
    moduleKey: nextModuleKey,
    minDays: nextMinDays,
    maxDays: nextMaxDays,
    isActive: nextIsActive,
    excludeId: existing._id
  });

  if (Array.isArray(update.steps)) {
    update.steps = nextSteps;
  }

  const flow = await ApprovalFlow.findOneAndUpdate(
    {
      _id: req.params.id,
      organizationId: req.user.organizationId
    },
    update,
    { new: true }
  ).populate("steps.employeeId", "firstName lastName employeeCode");

  if (!flow) throw new Error("Approval flow not found");
  return flow;
};

exports.removeFlow = async (req) => {
  const flow = await ApprovalFlow.findOne({
    _id: req.params.id,
    organizationId: req.user.organizationId
  });
  if (!flow) throw new Error("Approval flow not found");

  if (!flow.isActive) {
    return flow;
  }

  flow.isActive = false;
  await flow.save();
  return flow;
};
