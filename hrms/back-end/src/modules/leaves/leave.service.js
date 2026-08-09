const Leave = require("./leave.model");
const Employee = require("../employees/employee.model");
const LeaveType = require("../leaveTypes/leaveType.model");
const { audit } = require("../auditLogs/auditLogs.service");
const Holiday = require("../holidays/holiday.model");
const WeekOff = require("../weekOffs/weekOff.model");
const WeekOffService = require("../weekOffs/weekOff.service");
const LeaveBalance =
  require("../leaveBalances/leaveBalance.model");
const Organization =
  require("../organizations/organization.model");
const Role = require("../roles/role.model");
const OrgSettings = require("../orgSettings/orgSettings.model");
const User = require("../users/user.model");
const sendMail = require("../../utils/sendMail");
const { createNotificationSafe } = require("../notifications/notification.service");
const {
  resolveApplicableFlow,
  buildRuntimeSteps,
  getActorApprovalContext,
  canActorApproveStep,
  resolveRecipientsForStep,
  isAdminOverrideActor
} = require("../../utils/approvalFlowEngine");
const ApprovalFlow = require("../approvalFlows/approvalFlow.model");
const {
  advanceApprovalSteps,
  getCurrentPendingStep,
  resolveCurrentPendingStep
} = require("../../utils/approvalProgress");
const {
  isValidTimeZone,
  toDateKeyInTimeZone,
  addDaysToDateKey,
  startOfDayInTimeZone,
  endOfDayInTimeZone,
  parseMonthRangeInTimeZone,
  getDayInTimeZone,
  getWeekdayForDateKey
} = require("../../utils/timezone");
const {
  toDateKeyInOrgTz,
  getApplicableLeaveDateKeys,
  analyzeLeaveDateKeys
} = require("./leavePolicy.util");

const REQUEST_APPROVER_ROLE_SLUGS = new Set([
  "manager",
  "hr",
  "admin",
  "org-admin",
  "superadmin"
]);

const parsePositiveInt = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
};

const isSameDate = (d1, d2) =>
  new Date(d1).setHours(0, 0, 0, 0) === new Date(d2).setHours(0, 0, 0, 0);

const getLeaveCycleStartYear = (leaveDate, leaveCycleStartMonth) =>
  new Date(leaveDate).getMonth() + 1 < leaveCycleStartMonth
    ? new Date(leaveDate).getFullYear() - 1
    : new Date(leaveDate).getFullYear();

const isContiguousDateKeyArray = (dateKeys = []) => {
  if (dateKeys.length <= 1) return true;
  for (let index = 1; index < dateKeys.length; index += 1) {
    if (addDaysToDateKey(dateKeys[index - 1], 1) !== dateKeys[index]) {
      return false;
    }
  }
  return true;
};

const buildRevertDateSelection = ({ leave, requestedFromDate, requestedToDate, timeZone }) => {
  const leaveDateKeys = (Array.isArray(leave?.effectiveDateKeys) ? leave.effectiveDateKeys : [])
    .filter((key) => /^\d{4}-\d{2}-\d{2}$/.test(String(key || "")))
    .sort();
  if (!leaveDateKeys.length) {
    throw new Error("This leave does not have any reversible leave days");
  }

  const requestedFromKey = toDateKeyInOrgTz(requestedFromDate, timeZone);
  const requestedToKey = toDateKeyInOrgTz(requestedToDate, timeZone);
  if (requestedFromKey > requestedToKey) {
    throw new Error("Revert from date cannot be greater than revert to date");
  }

  const selectedKeys = leaveDateKeys.filter(
    (key) => key >= requestedFromKey && key <= requestedToKey
  );
  if (!selectedKeys.length) {
    throw new Error("Select revert dates within the approved leave days");
  }

  const requestedTouchesStart = selectedKeys.every((key, index) => key === leaveDateKeys[index]);
  const requestedTouchesEnd = selectedKeys.every(
    (key, index) => key === leaveDateKeys[leaveDateKeys.length - selectedKeys.length + index]
  );
  if (selectedKeys.length !== leaveDateKeys.length && !requestedTouchesStart && !requestedTouchesEnd) {
    throw new Error("Partial leave revert is allowed only from the start or end of the approved leave");
  }

  return {
    fromDate: selectedKeys[0],
    toDate: selectedKeys[selectedKeys.length - 1],
    effectiveDateKeys: selectedKeys,
    totalDays:
      leave.duration === "half_day" && leaveDateKeys.length === 1 && selectedKeys.length === 1
        ? 0.5
        : selectedKeys.length
  };
};

const buildRemainingApprovedLeave = (leave, revertedDateKeys = []) => {
  const originalKeys = (Array.isArray(leave?.effectiveDateKeys) ? leave.effectiveDateKeys : [])
    .filter((key) => /^\d{4}-\d{2}-\d{2}$/.test(String(key || "")))
    .sort();
  const revertedSet = new Set(revertedDateKeys);
  const remainingKeys = originalKeys.filter((key) => !revertedSet.has(key));

  if (!remainingKeys.length) {
    return {
      effectiveDateKeys: [],
      totalDays: 0,
      fromDate: leave.fromDate,
      toDate: leave.toDate,
      duration: leave.duration || "full_day",
      halfDaySession: leave.halfDaySession || null,
      fullyReverted: true
    };
  }

  if (!isContiguousDateKeyArray(remainingKeys)) {
    throw new Error("Selected revert dates would split the approved leave into multiple parts, which is not supported");
  }

  return {
    effectiveDateKeys: remainingKeys,
    totalDays:
      leave.duration === "half_day" && remainingKeys.length === 1
        ? 0.5
        : remainingKeys.length,
    fromDate: startOfDayInTimeZone(remainingKeys[0], "UTC"),
    toDate: endOfDayInTimeZone(remainingKeys[remainingKeys.length - 1], "UTC"),
    duration:
      leave.duration === "half_day" && remainingKeys.length === 1
        ? "half_day"
        : "full_day",
    halfDaySession:
      leave.duration === "half_day" && remainingKeys.length === 1
        ? leave.halfDaySession || null
        : null,
    fullyReverted: false
  };
};

const applyMonthFilterToQuery = (query, monthValue, timeZone = "UTC") => {
  if (!monthValue || !/^\d{4}-\d{2}$/.test(String(monthValue))) return;
  const monthRange = parseMonthRangeInTimeZone(String(monthValue), timeZone);
  query.fromDate = { $lte: monthRange.end };
  query.toDate = { $gte: monthRange.start };
};

const getStoredOrDerivedLeaveDateKeys = ({
  leave,
  weekOffDays,
  holidaySet,
  timeZone = "Asia/Kolkata"
}) => {
  const storedKeys = Array.isArray(leave?.effectiveDateKeys)
    ? leave.effectiveDateKeys.filter((key) => /^\d{4}-\d{2}-\d{2}$/.test(String(key || "")))
    : [];
  if (storedKeys.length) return storedKeys;

  const fromDateKey = toDateKeyInOrgTz(leave.fromDate, timeZone);
  const toDateKey = toDateKeyInOrgTz(leave.toDate, timeZone);
  if ((leave.duration || "full_day") === "half_day") return [fromDateKey];

  const workingDateKeys = getApplicableLeaveDateKeys({
    fromDate: fromDateKey,
    toDate: toDateKey,
    weekOffDays,
    holidaySet,
    sandwichRuleEnabled: false,
    timeZone
  });

  const sandwichDateKeys = getApplicableLeaveDateKeys({
    fromDate: fromDateKey,
    toDate: toDateKey,
    weekOffDays,
    holidaySet,
    sandwichRuleEnabled: true,
    timeZone
  });

  const totalDays = Number(leave.totalDays || 0);
  if (Number.isFinite(totalDays) && totalDays > workingDateKeys.length && sandwichDateKeys.length) {
    return sandwichDateKeys;
  }

  return workingDateKeys;
};

const buildSandwichDescription = ({
  sandwichRuleEnabled,
  sandwichDeductedDateKeys,
  sandwichHolidayDateKeys,
  sandwichWeekOffDateKeys
}) => {
  const deductedDays = sandwichDeductedDateKeys.length;
  if (!deductedDays) {
    return sandwichRuleEnabled
      ? "Sandwich rule is enabled, but this leave did not deduct any holidays or week offs."
      : "Sandwich rule is disabled, so holidays and week offs were not deducted for this leave.";
  }

  const parts = [];
  if (sandwichHolidayDateKeys.length) {
    parts.push(`${sandwichHolidayDateKeys.length} holiday${sandwichHolidayDateKeys.length === 1 ? "" : "s"}`);
  }
  if (sandwichWeekOffDateKeys.length) {
    parts.push(`${sandwichWeekOffDateKeys.length} week off${sandwichWeekOffDateKeys.length === 1 ? "" : "s"}`);
  }
  const breakdown = parts.join(" and ");

  if (!sandwichRuleEnabled) {
    return `This leave includes ${deductedDays} deducted non-working day${deductedDays === 1 ? "" : "s"} (${breakdown}) even though sandwich rule is currently disabled.`;
  }

  return `Sandwich rule deducted ${deductedDays} non-working day${deductedDays === 1 ? "" : "s"}: ${breakdown}.`;
};

const enrichLeavesWithSandwichDetails = async ({
  leaves,
  organizationId,
  timeZone = "Asia/Kolkata"
}) => {
  if (!Array.isArray(leaves) || !leaves.length) return [];

  const employeeIds = [...new Set(
    leaves
      .map((leave) => {
        const employeeRef = leave?.employeeId;
        if (!employeeRef) return null;
        if (typeof employeeRef === "object" && employeeRef !== null) {
          return String(employeeRef._id || "");
        }
        return String(employeeRef);
      })
      .filter(Boolean)
  )];

  const [settings, employees, holidays] = await Promise.all([
    OrgSettings.findOne({ organizationId }).select("sandwichRuleEnabled"),
    employeeIds.length
      ? Employee.find({ organizationId, _id: { $in: employeeIds } }).select("_id shiftId")
      : [],
    Holiday.find({ organizationId, status: "active" }).select("_id date")
  ]);

  const sandwichRuleEnabled = Boolean(settings?.sandwichRuleEnabled);
  const holidaySet = new Set((holidays || []).map((holiday) => toDateKeyInTimeZone(holiday.date, timeZone)));
  const { employeeMap: weekOffMap } = await WeekOffService.resolveWeekOffMapForEmployees({
    organizationId,
    employees
  });

  return leaves.map((leave) => {
    const row = typeof leave?.toObject === "function" ? leave.toObject() : { ...leave };
    const employeeRef = row?.employeeId;
    const employeeId =
      typeof employeeRef === "object" && employeeRef !== null
        ? String(employeeRef._id || "")
        : String(employeeRef || "");
    const weekOffDays = weekOffMap.get(employeeId) || [];
    const effectiveDateKeys = Array.isArray(row.effectiveDateKeys)
      ? row.effectiveDateKeys.filter((key) => /^\d{4}-\d{2}-\d{2}$/.test(String(key || "")))
      : [];
    const analysis = analyzeLeaveDateKeys({
      fromDate: row.fromDate,
      toDate: row.toDate,
      weekOffDays,
      holidaySet,
      effectiveDateKeys,
      sandwichRuleEnabled,
      timeZone
    });

    return {
      ...row,
      effectiveDateKeys: analysis.effectiveDateKeys,
      sandwichRuleEnabled,
      sandwichSummary: {
        applied: analysis.sandwichDeductedDateKeys.length > 0,
        deductedDays: analysis.sandwichDeductedDateKeys.length,
        deductedDateKeys: analysis.sandwichDeductedDateKeys,
        holidayDateKeys: analysis.sandwichHolidayDateKeys,
        weekOffDateKeys: analysis.sandwichWeekOffDateKeys,
        description: buildSandwichDescription({
          sandwichRuleEnabled,
          sandwichDeductedDateKeys: analysis.sandwichDeductedDateKeys,
          sandwichHolidayDateKeys: analysis.sandwichHolidayDateKeys,
          sandwichWeekOffDateKeys: analysis.sandwichWeekOffDateKeys
        })
      }
    };
  });
};

const sendNotification = async ({ toEmail, toName, subject, message }) => {
  if (!toEmail) return;
  try {
    await sendMail("notification", toName || "User", subject, message, toEmail);
  } catch (_) {
    // non-blocking notification
  }
};

const notifyApprovalStepAssignees = async ({
  organizationId,
  step,
  actorEmployeeId = null,
  title,
  message,
  type,
  meta = {}
}) => {
  if (!step) return;
  const recipients = await resolveRecipientsForStep({ organizationId, step });
  for (const recipient of recipients) {
    await createNotificationSafe({
      organizationId,
      recipientUserId: recipient.userId,
      recipientEmployeeId: recipient.employeeId,
      actorEmployeeId,
      type,
      title,
      message,
      meta
    });
  }
};

const getActorRoleSlug = async (req) => {
  if (!req.user.activeRoleId) return "";
  const role = await Role.findOne({
    _id: req.user.activeRoleId,
    organizationId: req.user.organizationId
  }).select("slug");
  return role?.slug || "";
};

const describeApprovalStep = (step) => {
  if (!step) return "Unknown step";
  if (step.approverType === "manager") {
    return `S${step.stepNumber} Reporting Manager`;
  }
  if (step.approverType === "role") {
    return `S${step.stepNumber} Role: ${step.approverRoleSlug || "-"}`;
  }
  return `S${step.stepNumber} Specific Employee`;
};

const isValidApprovalStepShape = (step) =>
  Boolean(
    step
    && Number.isFinite(Number(step.stepNumber))
    && ["manager", "role", "employee"].includes(String(step.approverType || ""))
  );

const rebuildLeaveApprovalStepsFromFlow = async (leave) => {
  if (!leave?.approvalFlowId || !leave?.employeeId) return null;

  const [flow, subjectEmployee] = await Promise.all([
    ApprovalFlow.findOne({
      _id: leave.approvalFlowId,
      organizationId: leave.organizationId
    }),
    Employee.findOne({
      _id: leave.employeeId,
      organizationId: leave.organizationId
    }).select("_id managerId")
  ]);

  if (!flow || !subjectEmployee) return null;

  const rebuiltSteps = buildRuntimeSteps({ flow, subjectEmployee });
  const existingByStep = new Map(
    (leave.approvalSteps || [])
      .filter(isValidApprovalStepShape)
      .map((step) => [Number(step.stepNumber), step])
  );

  return rebuiltSteps.map((step) => {
    const existing = existingByStep.get(Number(step.stepNumber));
    if (!existing) return step;
    if (existing.status === "approved" || existing.status === "rejected") {
      return {
        ...step,
        status: existing.status,
        actionBy: existing.actionBy || null,
        actionAt: existing.actionAt || null,
        remarks: existing.remarks || null
      };
    }
    return step;
  });
};

const normalizeApprovalStateSnapshot = (steps = [], currentApprovalStep = null) =>
  JSON.stringify({
    currentApprovalStep: currentApprovalStep == null ? null : Number(currentApprovalStep),
    steps: (steps || []).map((step) => ({
      stepNumber: step?.stepNumber == null ? null : Number(step.stepNumber),
      approverType: step?.approverType || null,
      approverEmployeeId: step?.approverEmployeeId?._id || step?.approverEmployeeId || null,
      approverRoleSlug: step?.approverRoleSlug || null,
      status: step?.status || null,
      actionBy: step?.actionBy?._id || step?.actionBy || null,
      actionByName: step?.actionByName || null,
      actionAt: step?.actionAt ? new Date(step.actionAt).toISOString() : null,
      remarks: step?.remarks || null
    }))
  });

const toActorDisplayName = (employee, fallbackEmail = "") => {
  const fullName = `${employee?.firstName || ""} ${employee?.lastName || ""}`.trim();
  if (fullName) {
    return employee?.employeeCode ? `${fullName} (${employee.employeeCode})` : fullName;
  }
  return fallbackEmail || "Organization Admin";
};

const finalizeApprovalStepsByAdminOverride = ({
  steps = [],
  action,
  actionBy = null,
  actionByName = null,
  remarks = null
}) => {
  const normalizedAction = String(action || "").toLowerCase();
  if (!["approved", "rejected"].includes(normalizedAction)) {
    throw new Error("Invalid approval action");
  }

  const timestamp = new Date();
  const sortedSteps = [...(steps || [])]
    .map((step) => (typeof step?.toObject === "function" ? step.toObject() : { ...step }))
    .sort((a, b) => Number(a?.stepNumber || 0) - Number(b?.stepNumber || 0));

  if (!sortedSteps.length) {
    return {
      steps: [],
      finalStatus: normalizedAction,
      currentApprovalStep: null
    };
  }

  const firstOpenStepIndex = sortedSteps.findIndex(
    (step) => !["approved", "rejected"].includes(String(step?.status || ""))
  );

  const nextSteps = sortedSteps.map((step, index) => {
    const nextStep = {
      ...step,
      approverEmployeeId: step?.approverEmployeeId || null,
      approverRoleSlug: step?.approverRoleSlug || null,
      actionBy: step?.actionBy || null,
      actionByName: step?.actionByName || null,
      actionAt: step?.actionAt || null,
      remarks: step?.remarks || null
    };

    if (step?.status === "approved" || step?.status === "rejected") {
      return nextStep;
    }

    if (normalizedAction === "approved") {
      return {
        ...nextStep,
        status: "approved",
        actionBy: actionBy || null,
        actionByName: actionByName || null,
        actionAt: timestamp,
        remarks: index === firstOpenStepIndex
          ? (remarks || "Approved by organization admin")
          : (remarks || "Auto-approved by organization admin")
      };
    }

    if (index === firstOpenStepIndex) {
      return {
        ...nextStep,
        status: "rejected",
        actionBy: actionBy || null,
        actionByName: actionByName || null,
        actionAt: timestamp,
        remarks: remarks || "Rejected by organization admin"
      };
    }

    return nextStep;
  });

  return {
    steps: nextSteps,
    finalStatus: normalizedAction,
    currentApprovalStep: null
  };
};

const repairPendingLeaveApprovalState = async (leave) => {
  if (!leave || leave.status !== "pending" || !leave.approvalFlowId || !Array.isArray(leave.approvalSteps) || !leave.approvalSteps.length) {
    return leave;
  }

  const beforeSnapshot = normalizeApprovalStateSnapshot(
    leave.approvalSteps,
    leave.currentApprovalStep
  );
  const rebuiltSteps = await rebuildLeaveApprovalStepsFromFlow(leave);
  if (!rebuiltSteps?.length) return leave;

  const resolvedProgress = resolveCurrentPendingStep({
    steps: rebuiltSteps,
    currentApprovalStep: leave.currentApprovalStep
  });

  leave.approvalSteps = resolvedProgress.steps;
  leave.currentApprovalStep = resolvedProgress.currentApprovalStep;
  const afterSnapshot = normalizeApprovalStateSnapshot(
    leave.approvalSteps,
    leave.currentApprovalStep
  );

  if (beforeSnapshot !== afterSnapshot && typeof leave.markModified === "function" && typeof leave.save === "function") {
    leave.markModified("approvalSteps");
    await leave.save();
  }

  return leave;
};

const getOrganizationTimeZone = async (organizationId) => {
  const settings = await OrgSettings.findOne({ organizationId }).select("timezone");
  if (isValidTimeZone(settings?.timezone)) return settings.timezone;

  const organization = await Organization.findById(organizationId).select("timezone");
  if (isValidTimeZone(organization?.timezone)) return organization.timezone;

  return "Asia/Kolkata";
};

const getLeaveApplyWindowMeta = async ({ organizationId, timeZone = "UTC" }) => {
  const settings = await OrgSettings.findOne({ organizationId })
    .select("attendanceLockEnabled attendanceLockAfterDays attendanceLockMode attendanceLockDay payrollCutoffDay");

  if (!settings?.attendanceLockEnabled) {
    return {
      attendanceLockEnabled: false,
      attendanceLockMode: settings?.attendanceLockMode || "days_window",
      payrollCutoffDay: Number(settings?.payrollCutoffDay ?? 25),
      attendanceLockDay: Number(settings?.attendanceLockDay ?? settings?.payrollCutoffDay ?? 25),
      attendanceLockAfterDays: Number(settings?.attendanceLockAfterDays ?? 7),
      earliestAllowedDateKey: null
    };
  }

  const today = startOfDayInTimeZone(new Date(), timeZone);
  const todayKey = toDateKeyInTimeZone(today, timeZone);
  const mode = settings.attendanceLockMode || "days_window";

  if (mode === "days_window") {
    const attendanceLockAfterDays = Number(settings.attendanceLockAfterDays ?? 7);
    return {
      attendanceLockEnabled: true,
      attendanceLockMode: mode,
      payrollCutoffDay: Number(settings.payrollCutoffDay ?? 25),
      attendanceLockDay: Number(settings?.attendanceLockDay ?? settings?.payrollCutoffDay ?? 25),
      attendanceLockAfterDays,
      earliestAllowedDateKey: addDaysToDateKey(todayKey, -attendanceLockAfterDays)
    };
  }

  const attendanceLockDay = Number(settings.attendanceLockDay ?? settings.payrollCutoffDay ?? 25);
  const currentDay = getDayInTimeZone(today, timeZone);
  const [todayYear, todayMonth] = todayKey.split("-").map(Number);
  const currentMonthFirstKey = `${todayYear}-${String(todayMonth).padStart(2, "0")}-01`;
  const previousMonthYear = todayMonth === 1 ? todayYear - 1 : todayYear;
  const previousMonth = todayMonth === 1 ? 12 : todayMonth - 1;
  const previousMonthFirstKey = `${previousMonthYear}-${String(previousMonth).padStart(2, "0")}-01`;
  const earliestAllowedDateKey = currentDay > attendanceLockDay
    ? addDaysToDateKey(currentMonthFirstKey, attendanceLockDay)
    : addDaysToDateKey(previousMonthFirstKey, attendanceLockDay);

  return {
    attendanceLockEnabled: true,
    attendanceLockMode: mode,
    payrollCutoffDay: Number(settings.payrollCutoffDay ?? 25),
    attendanceLockDay,
    attendanceLockAfterDays: Number(settings.attendanceLockAfterDays ?? 7),
    earliestAllowedDateKey
  };
};

const assertLeaveApplyWindow = async ({ organizationId, fromDate, toDate, timeZone = "UTC" }) => {
  const windowMeta = await getLeaveApplyWindowMeta({ organizationId, timeZone });
  if (!windowMeta.attendanceLockEnabled) return;

  const fromDateKey = /^\d{4}-\d{2}-\d{2}$/.test(String(fromDate || ""))
    ? String(fromDate)
    : toDateKeyInTimeZone(fromDate, timeZone);
  const toDateKey = /^\d{4}-\d{2}-\d{2}$/.test(String(toDate || ""))
    ? String(toDate)
    : toDateKeyInTimeZone(toDate, timeZone);

  if (!windowMeta.earliestAllowedDateKey) return;

  if (fromDateKey < windowMeta.earliestAllowedDateKey || toDateKey < windowMeta.earliestAllowedDateKey) {
    if (windowMeta.attendanceLockMode === "payroll_cutoff") {
      throw new Error(
        `Leave cannot be applied before ${windowMeta.earliestAllowedDateKey}. Dates up to attendance lock day ${windowMeta.attendanceLockDay} are locked.`
      );
    }
    throw new Error(
      `Attendance is locked for dates older than ${windowMeta.attendanceLockAfterDays} days. Leave cannot be applied for locked dates.`
    );
  }
};

const assertRequestApproverAccess = async (req, targetEmployeeId) => {
  const actorRoleSlug = await getActorRoleSlug(req);
  if (!REQUEST_APPROVER_ROLE_SLUGS.has(actorRoleSlug)) {
    throw new Error("Only reporting manager, HR, or admin can action requests");
  }

  if (actorRoleSlug === "manager") {
    const managerEmployee = await Employee.findOne({
      userId: req.user.userId,
      organizationId: req.user.organizationId
    }).select("_id");

    if (!managerEmployee) {
      throw new Error("Access denied");
    }

    const isReport = await Employee.exists({
      organizationId: req.user.organizationId,
      _id: targetEmployeeId,
      managerId: managerEmployee._id
    });
    if (!isReport) {
      throw new Error("Access denied");
    }
  }
};

exports.applyLeave = async (req) => {

  // 1. Find employee from logged-in user
  const employee = await Employee.findOne({
    userId: req.user.userId,
    organizationId: req.user.organizationId
  });

  const fromDate = new Date(req.body.fromDate);
  const toDate = new Date(req.body.toDate);
  const duration = req.body.duration || "full_day";
  const halfDaySession = duration === "half_day" ? req.body.halfDaySession : null;

  if (fromDate > toDate) {
    throw new Error("From date cannot be greater than to date");
  }
  if (duration === "half_day" && fromDate.getTime() !== toDate.getTime()) {
    throw new Error("Half-day leave must be applied for a single date");
  }

  if (!employee) throw new Error("Employee not found");
  const lifecycleStatus = employee.employmentLifecycleStatus || "confirmed";
  if (lifecycleStatus !== "confirmed") {
    throw new Error("Only confirmed employees can apply leave");
  }

  const organizationTimeZone = await getOrganizationTimeZone(req.user.organizationId);
  const fromDateKey = toDateKeyInOrgTz(req.body.fromDate, organizationTimeZone);
  const toDateKey = toDateKeyInOrgTz(req.body.toDate, organizationTimeZone);
  await assertLeaveApplyWindow({
    organizationId: req.user.organizationId,
    fromDate: req.body.fromDate,
    toDate: req.body.toDate,
    timeZone: organizationTimeZone
  });

  /* 🔒 STEP 4A: CHECK OVERLAPPING LEAVES */
  const overlappingLeave = await Leave.findOne({
    employeeId: employee._id,
    status: { $in: ["pending", "approved"] },
    $or: [
      {
        fromDate: { $lte: req.body.toDate },
        toDate: { $gte: req.body.fromDate }
      }
    ]
  });

  if (overlappingLeave) {
    throw new Error("You already have a leave applied for these dates");
  }

  const rangeStart = startOfDayInTimeZone(fromDateKey, organizationTimeZone);
  const rangeEnd = endOfDayInTimeZone(toDateKey, organizationTimeZone);

  const [holidays, settings] = await Promise.all([
    Holiday.find({
      organizationId: req.user.organizationId,
      date: {
        $gte: rangeStart,
        $lte: rangeEnd
      },
      status: "active"
    }),
    OrgSettings.findOne({ organizationId: req.user.organizationId }).select("sandwichRuleEnabled")
  ]);

  const sandwichRuleEnabled = Boolean(settings?.sandwichRuleEnabled);
  const weekOffDays = await WeekOffService.resolveWeekOffDays({
    organizationId: req.user.organizationId,
    shiftId: employee.shiftId
  });
  const holidaySet = new Set((holidays || []).map((h) => toDateKeyInTimeZone(h.date, organizationTimeZone)));

  const validLeaveDateKeys = getApplicableLeaveDateKeys({
    fromDate: fromDateKey,
    toDate: toDateKey,
    weekOffDays,
    holidaySet,
    sandwichRuleEnabled,
    timeZone: organizationTimeZone
  });

  if (
    fromDateKey === toDateKey &&
    validLeaveDateKeys.length === 0
  ) {
    const isHoliday = holidaySet.has(fromDateKey);
    const isWeekOff = weekOffDays.includes(getWeekdayForDateKey(fromDateKey, organizationTimeZone));

    if (isHoliday) {
      throw new Error("Selected date is a holiday");
    }
    if (isWeekOff) {
      throw new Error("Selected date is a week off");
    }
    throw new Error("Selected date is not a working day");
  }

  if (validLeaveDateKeys.length === 0) {
    throw new Error("Leave cannot be applied only on holidays or week offs without any working day");
  }



  // 2. Validate leave type
  const leaveType = await LeaveType.findOne({
    _id: req.body.leaveTypeId,
    organizationId: req.user.organizationId,
    status: "active"
  });
  if (!leaveType) throw new Error("Invalid leave type");

  // 3. Calculate days
  let totalDays = validLeaveDateKeys.length;
  if (duration === "half_day") {
    if (validLeaveDateKeys.length !== 1 || validLeaveDateKeys[0] !== fromDateKey) {
      throw new Error("Half-day leave is not allowed on holidays or week offs");
    }
    totalDays = 0.5;
  }

  const org = await Organization.findById(req.user.organizationId);

  const cycleStartYear =
    fromDate.getMonth() + 1 < org.leaveCycleStartMonth
      ? fromDate.getFullYear() - 1
      : fromDate.getFullYear();

  const balance = await LeaveBalance.findOneAndUpdate(
    {
      organizationId: req.user.organizationId,
      employeeId: employee._id,
      leaveTypeId: req.body.leaveTypeId,
      cycleStartYear,
      remaining: { $gte: totalDays }
    },
    {
      $inc: {
        pending: totalDays,
        remaining: -totalDays
      }
    },
    { new: true }
  );

  if (!balance) {
    throw new Error("Insufficient leave balance");
  }


  // 4. Create leave
  let leave;
  const flowConfig = await resolveApplicableFlow({
    organizationId: req.user.organizationId,
    moduleKey: "leave",
    subjectEmployee: employee,
    preferredFlowId: employee.leaveApprovalFlowId || null,
    totalDays
  });
  const initialPendingStep = (flowConfig?.steps || []).find((s) => s.status === "pending");
  try {
    leave = await Leave.create({
      organizationId: req.user.organizationId,
      employeeId: employee._id,
      leaveTypeId: req.body.leaveTypeId,
      fromDate: req.body.fromDate,
      toDate: req.body.toDate,
      duration,
      halfDaySession,
      totalDays,
      effectiveDateKeys: validLeaveDateKeys,
      status: "pending",
      reason: req.body.reason,
      approvalFlowId: flowConfig?.flowId || null,
      approvalSteps: flowConfig?.steps || [],
      currentApprovalStep: initialPendingStep?.stepNumber || null
    });
  } catch (err) {
    await LeaveBalance.updateOne(
      {
        organizationId: req.user.organizationId,
        employeeId: employee._id,
        leaveTypeId: req.body.leaveTypeId,
        cycleStartYear
      },
      {
        $inc: {
          pending: -totalDays,
          remaining: totalDays
        }
      }
    );
    throw err;
  }

  // 5. Audit
  await audit({
    req,
    module: "leaves",
    action: "APPLY",
    entityId: leave._id,
    after: leave.toObject()
  });

  const pendingStep = getCurrentPendingStep(leave.approvalSteps || []);
  if (pendingStep) {
    const employeeName = `${employee.firstName || ""} ${employee.lastName || ""}`.trim();
    await notifyApprovalStepAssignees({
      organizationId: req.user.organizationId,
      step: pendingStep,
      actorEmployeeId: employee._id,
      type: "leave_pending_approval",
      title: "Leave approval pending",
      message: `${employeeName} applied leave from ${new Date(req.body.fromDate).toDateString()} to ${new Date(req.body.toDate).toDateString()}.`,
      meta: {
        leaveId: leave._id,
        status: leave.status,
        currentApprovalStep: leave.currentApprovalStep
      }
    });
  } else {
    const manager = employee.managerId
      ? await Employee.findById(employee.managerId).populate("userId", "email")
      : null;
    if (manager?.userId?.email) {
      const employeeName = `${employee.firstName || ""} ${employee.lastName || ""}`.trim();
      await sendNotification({
        toEmail: manager.userId.email,
        toName: manager.firstName,
        subject: "New Leave Request",
        message: `${employeeName} applied leave from ${req.body.fromDate} to ${req.body.toDate}.`
      });
    }
  }

  return leave;
};

exports.requestLeaveRevert = async (req) => {
  const employee = await Employee.findOne({
    userId: req.user.userId,
    organizationId: req.user.organizationId
  });
  if (!employee) throw new Error("Employee not found");

  const leave = await Leave.findOne({
    _id: req.params.id,
    organizationId: req.user.organizationId,
    employeeId: employee._id
  });
  if (!leave) throw new Error("Approved leave not found");
  if (leave.status !== "approved") {
    throw new Error("Only approved leave can be reverted");
  }

  const organizationTimeZone = await getOrganizationTimeZone(req.user.organizationId);
  const leaveStartDateKey = toDateKeyInOrgTz(leave.fromDate, organizationTimeZone);
  const todayDateKey = toDateKeyInOrgTz(new Date(), organizationTimeZone);
  if (leaveStartDateKey <= todayDateKey) {
    throw new Error("Leave revert request is allowed only before the leave start date");
  }

  if (leave.revertRequest?.status === "pending") {
    throw new Error("A leave revert request is already pending for this leave");
  }

  const revertSelection = buildRevertDateSelection({
    leave,
    requestedFromDate: req.body.fromDate,
    requestedToDate: req.body.toDate,
    timeZone: organizationTimeZone
  });

  leave.revertRequest = {
    fromDate: startOfDayInTimeZone(revertSelection.fromDate, organizationTimeZone),
    toDate: endOfDayInTimeZone(revertSelection.toDate, organizationTimeZone),
    effectiveDateKeys: revertSelection.effectiveDateKeys,
    totalDays: revertSelection.totalDays,
    reason: String(req.body.reason || "").trim(),
    status: "pending",
    requestedBy: employee._id,
    requestedByName: toActorDisplayName(employee, req.user.email || ""),
    requestedAt: new Date(),
    actionBy: null,
    actionByName: null,
    actionAt: null,
    rejectionReason: ""
  };
  leave.markModified("revertRequest");
  await leave.save();

  await audit({
    req,
    module: "leaves",
    action: "REQUEST_REVERT",
    entityId: leave._id,
    after: leave.toObject()
  });

  const adminUsers = await User.find({
    organizationId: req.user.organizationId,
    activeRoleSlug: { $in: ["admin", "org-admin", "superadmin"] }
  }).select("_id");
  await Promise.all(
    adminUsers.map((user) =>
      createNotificationSafe({
        organizationId: req.user.organizationId,
        recipientUserId: user._id,
        recipientEmployeeId: null,
        actorEmployeeId: employee._id,
        type: "leave_revert_request",
        title: "Leave revert request pending",
        message: `${employee.firstName || "Employee"} ${employee.lastName || ""}`.trim()
          + ` requested leave revert for ${revertSelection.fromDate} to ${revertSelection.toDate}.`,
        meta: {
          leaveId: leave._id,
          revertRequestStatus: "pending"
        }
      })
    )
  );

  return leave;
};

exports.actionLeaveRevert = async (req) => {
  const leave = await Leave.findById(req.params.id);
  if (!leave) throw new Error("Leave not found");
  if (leave.status !== "approved") {
    throw new Error("Only approved leave can be reverted");
  }
  if (!leave.revertRequest || leave.revertRequest.status !== "pending") {
    throw new Error("No pending leave revert request found");
  }

  const actor = await Employee.findOne({
    userId: req.user.userId,
    organizationId: req.user.organizationId
  });
  const actorUser = await User.findById(req.user.userId).select("email");
  const actorDisplayName = toActorDisplayName(actor, actorUser?.email || req.user.email || "");
  const actorRoleSlug = await getActorRoleSlug(req);
  if (!["admin", "org-admin", "superadmin"].includes(actorRoleSlug)) {
    throw new Error("Only organization admin can action leave revert requests");
  }

  const organizationTimeZone = await getOrganizationTimeZone(leave.organizationId);
  const leaveStartDateKey = toDateKeyInOrgTz(leave.fromDate, organizationTimeZone);
  const todayDateKey = toDateKeyInOrgTz(new Date(), organizationTimeZone);
  if (leaveStartDateKey <= todayDateKey) {
    throw new Error("Leave revert request can be actioned only before the leave start date");
  }

  if (req.body.status === "rejected") {
    leave.revertRequest.status = "rejected";
    leave.revertRequest.actionBy = actor?._id || null;
    leave.revertRequest.actionByName = actorDisplayName;
    leave.revertRequest.actionAt = new Date();
    leave.revertRequest.rejectionReason = String(req.body.rejectionReason || "").trim();
    leave.markModified("revertRequest");
    await leave.save();
    return leave;
  }

  const org = await Organization.findById(leave.organizationId);
  const cycleStartYear = getLeaveCycleStartYear(leave.fromDate, org.leaveCycleStartMonth);
  const balance = await LeaveBalance.findOne({
    organizationId: leave.organizationId,
    employeeId: leave.employeeId,
    leaveTypeId: leave.leaveTypeId,
    cycleStartYear
  });
  if (!balance) {
    throw new Error("Leave balance not found");
  }

  const revertKeys = Array.isArray(leave.revertRequest.effectiveDateKeys)
    ? leave.revertRequest.effectiveDateKeys
    : [];
  const revertDays = Number(leave.revertRequest.totalDays || 0);
  if (!revertKeys.length || !revertDays) {
    throw new Error("Invalid leave revert request");
  }

  const remainingLeave = buildRemainingApprovedLeave(leave, revertKeys);
  balance.used = Math.max(0, balance.used - revertDays);
  balance.remaining += revertDays;
  await balance.save();

  leave.revertRequest.status = "approved";
  leave.revertRequest.actionBy = actor?._id || null;
  leave.revertRequest.actionByName = actorDisplayName;
  leave.revertRequest.actionAt = new Date();
  leave.revertRequest.rejectionReason = "";

  if (remainingLeave.fullyReverted) {
    leave.status = "cancelled";
    leave.totalDays = revertDays;
    leave.actionBy = actor?._id || null;
    leave.actionByName = actorDisplayName;
    leave.actionAt = new Date();
  } else {
    leave.effectiveDateKeys = remainingLeave.effectiveDateKeys;
    leave.totalDays = remainingLeave.totalDays;
    leave.fromDate = startOfDayInTimeZone(remainingLeave.effectiveDateKeys[0], organizationTimeZone);
    leave.toDate = endOfDayInTimeZone(
      remainingLeave.effectiveDateKeys[remainingLeave.effectiveDateKeys.length - 1],
      organizationTimeZone
    );
    leave.duration = remainingLeave.duration;
    leave.halfDaySession = remainingLeave.halfDaySession;
    leave.actionBy = actor?._id || null;
    leave.actionByName = actorDisplayName;
    leave.actionAt = new Date();
  }

  leave.markModified("revertRequest");
  await leave.save();

  return leave;
};

exports.getApplyContext = async (req) => {
  const employee = await Employee.findOne({
    userId: req.user.userId,
    organizationId: req.user.organizationId
  });
  if (!employee) throw new Error("Employee not found");
  const lifecycleStatus = employee.employmentLifecycleStatus || "confirmed";

  const [holidays, leaveTypes, balances, myLeaves, settings, weekOffConfigs, organizationTimeZone] = await Promise.all([
    Holiday.find({
      organizationId: req.user.organizationId,
      status: "active",
      date: {
        $gte: new Date(new Date().getFullYear(), 0, 1),
        $lte: new Date(new Date().getFullYear() + 1, 11, 31, 23, 59, 59, 999)
      }
    }).sort({ date: 1 }),
    LeaveType.find({
      organizationId: req.user.organizationId,
      status: "active"
    }).select("_id name code"),
    LeaveBalance.find({
      organizationId: req.user.organizationId,
      employeeId: employee._id
    })
      .populate("leaveTypeId", "name code")
      .sort({ cycleStartYear: -1 }),
    Leave.find({
      organizationId: req.user.organizationId,
      employeeId: employee._id,
      status: { $in: ["pending", "approved"] }
    })
      .populate("leaveTypeId", "name code")
      .sort({ createdAt: -1 }),
    OrgSettings.findOne({ organizationId: req.user.organizationId }).select("sandwichRuleEnabled"),
    WeekOff.find({ organizationId: req.user.organizationId })
      .populate("shiftId", "name code status")
      .select("weekOffDays shiftId"),
    getOrganizationTimeZone(req.user.organizationId)
  ]);

  const leaveApplyWindow = await getLeaveApplyWindowMeta({
    organizationId: req.user.organizationId,
    timeZone: organizationTimeZone
  });

  const defaultWeekOffDays = weekOffConfigs.find((cfg) => !cfg.shiftId)?.weekOffDays || [];
  const shiftWeekOffDays =
    weekOffConfigs.find((cfg) => cfg.shiftId && String(cfg.shiftId._id || cfg.shiftId) === String(employee.shiftId))?.weekOffDays ||
    defaultWeekOffDays;
  const holidaySet = new Set((holidays || []).map((h) => toDateKeyInTimeZone(h.date, organizationTimeZone)));
  const leaveRestriction =
    lifecycleStatus !== "confirmed"
      ? {
          blocked: true,
          reason:
            lifecycleStatus === "probation"
              ? "Leave types are unavailable because you are currently on probation. You can apply for leave once your employment status changes to confirmed."
              : "Leave types are unavailable because only confirmed employees can apply for leave."
        }
      : {
          blocked: false,
          reason: ""
        };
  const enrichedMyLeaves = await enrichLeavesWithSandwichDetails({
    leaves: myLeaves.map((l) => ({
      ...l.toObject(),
      leaveTypeId: l.leaveTypeId?._id || l.leaveTypeId,
      leaveType: l.leaveTypeId?.name || "",
      effectiveDateKeys: getStoredOrDerivedLeaveDateKeys({
        leave: l,
        weekOffDays: shiftWeekOffDays,
        holidaySet,
        timeZone: organizationTimeZone
      })
    })),
    organizationId: req.user.organizationId,
    timeZone: organizationTimeZone
  });

  return {
    employeeLifecycleStatus: lifecycleStatus,
    leaveRestriction,
    weekOffDays: shiftWeekOffDays,
    weekOffConfig: {
      defaultWeekOffDays,
      employeeShiftId: employee.shiftId || null,
      employeeWeekOffDays: shiftWeekOffDays,
      shiftConfigs: weekOffConfigs
        .filter((cfg) => cfg.shiftId)
        .map((cfg) => ({
          shiftId: cfg.shiftId?._id || cfg.shiftId,
          shiftName: cfg.shiftId?.name || "",
          shiftCode: cfg.shiftId?.code || "",
          weekOffDays: cfg.weekOffDays || []
        }))
    },
    sandwichRuleEnabled: Boolean(settings?.sandwichRuleEnabled),
    leaveApplyWindow,
    holidays: holidays.map((h) => ({ _id: h._id, name: h.name, date: h.date })),
    leaveTypes: leaveRestriction.blocked ? [] : leaveTypes,
    balances: (leaveRestriction.blocked ? [] : balances).map((b) => ({
      leaveTypeId: b.leaveTypeId?._id || b.leaveTypeId,
      leaveType: b.leaveTypeId?.name || "",
      code: b.leaveTypeId?.code || "",
      cycleStartYear: b.cycleStartYear,
      total: b.total,
      used: b.used,
      pending: b.pending || 0,
      remaining: b.remaining
    })),
    myLeaves: leaveRestriction.blocked
      ? []
      : enrichedMyLeaves.map((l) => ({
          _id: l._id,
          leaveTypeId: l.leaveTypeId,
          leaveType: l.leaveType,
          fromDate: l.fromDate,
          toDate: l.toDate,
          effectiveDateKeys: l.effectiveDateKeys || [],
          duration: l.duration || "full_day",
          halfDaySession: l.halfDaySession || null,
          status: l.status,
          totalDays: l.totalDays,
          sandwichRuleEnabled: l.sandwichRuleEnabled,
          sandwichSummary: l.sandwichSummary || null
        }))
  };
};

exports.getMyLeavesRange = async (req) => {
  const employee = await Employee.findOne({
    userId: req.user.userId,
    organizationId: req.user.organizationId
  });

  if (!employee) throw new Error("Employee not found");

  const startDate = req.query.startDate ? new Date(req.query.startDate) : null;
  const endDate = req.query.endDate ? new Date(req.query.endDate) : null;

  const query = {
    organizationId: req.user.organizationId,
    employeeId: employee._id,
    status: "approved"
  };

  if (startDate && endDate) {
    query.fromDate = { $lte: endDate };
    query.toDate = { $gte: startDate };
  }

  return Leave.find(query)
    .populate("leaveTypeId", "name code")
    .sort({ fromDate: 1 });
};

exports.getMyLeaves = async (req) => {
  const employee = await Employee.findOne({
    userId: req.user.userId,
    organizationId: req.user.organizationId
  });

  const query = { employeeId: employee._id };
  const statsQuery = { ...query };
  const organizationTimeZone = req.user.organizationTimeZone || "UTC";

  applyMonthFilterToQuery(query, req.query.month, organizationTimeZone);
  applyMonthFilterToQuery(statsQuery, req.query.month, organizationTimeZone);

  if (req.query.status && req.query.status !== "all") {
    query.status = req.query.status;
  }
  if (req.query.search) {
    const typeIds = await LeaveType.find({
      organizationId: req.user.organizationId,
      name: { $regex: String(req.query.search).trim(), $options: "i" }
    }).distinct("_id");
    query.leaveTypeId = { $in: typeIds.length ? typeIds : [] };
  }

  const pageRequested = req.query.page !== undefined || req.query.limit !== undefined;
  const page = parsePositiveInt(req.query.page, 1);
  const limit = Math.min(parsePositiveInt(req.query.limit, 10), 100);
  const baseQuery = Leave.find(query)
    .populate("leaveTypeId", "name code")
    .populate("approvalFlowId", "name moduleKey minDays maxDays")
    .populate("actionBy", "firstName lastName employeeCode designationId")
    .populate("revertRequest.requestedBy", "firstName lastName employeeCode")
    .populate("revertRequest.actionBy", "firstName lastName employeeCode designationId")
    .populate("approvalSteps.approverEmployeeId", "firstName lastName employeeCode")
    .populate({
      path: "approvalSteps.actionBy",
      select: "firstName lastName employeeCode designationId",
      populate: { path: "designationId", select: "name" }
    })
    .sort({ createdAt: -1 });

  if (!pageRequested) {
    const rows = await baseQuery;
    await Promise.all(rows.map((row) => repairPendingLeaveApprovalState(row)));
    return enrichLeavesWithSandwichDetails({
      leaves: rows,
      organizationId: req.user.organizationId,
      timeZone: organizationTimeZone
    });
  }

  const [items, total] = await Promise.all([
    baseQuery.skip((page - 1) * limit).limit(limit),
    Leave.countDocuments(query)
  ]);
  await Promise.all(items.map((item) => repairPendingLeaveApprovalState(item)));
  const enrichedItems = await enrichLeavesWithSandwichDetails({
    leaves: items,
    organizationId: req.user.organizationId,
    timeZone: organizationTimeZone
  });
  const today = new Date();
  const [pending, approved, rejected, onLeaveToday] = await Promise.all([
    Leave.countDocuments({ ...statsQuery, status: "pending" }),
    Leave.countDocuments({ ...statsQuery, status: "approved" }),
    Leave.countDocuments({ ...statsQuery, status: "rejected" }),
    Leave.countDocuments({
      ...statsQuery,
      status: "approved",
      fromDate: { $lte: today },
      toDate: { $gte: today }
    })
  ]);

  return {
    items: enrichedItems,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit))
    },
    stats: {
      pending,
      approved,
      rejected,
      onLeaveToday
    }
  };
};

exports.getAllLeaves = async (req) => {
  const query = { organizationId: req.user.organizationId };
  const requestedEmployeeId = req.query.employeeId ? String(req.query.employeeId) : "";
  const organizationTimeZone = req.user.organizationTimeZone || "UTC";

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
        if (requestedEmployeeId) {
          const allowed = reportIds.some((id) => String(id) === requestedEmployeeId);
          if (!allowed) throw new Error("Access denied");
          query.employeeId = requestedEmployeeId;
        } else {
          query.employeeId = { $in: reportIds };
        }
      } else {
        query.employeeId = { $in: [] };
      }
    } else if (!["hr", "admin", "org-admin", "superadmin"].includes(String(role?.slug || ""))) {
      const employee = await Employee.findOne({
        userId: req.user.userId,
        organizationId: req.user.organizationId
      }).select("_id");

      if (!employee) {
        query.employeeId = { $in: [] };
      } else if (requestedEmployeeId) {
        if (String(employee._id) !== requestedEmployeeId) {
          throw new Error("Access denied");
        }
        query.employeeId = employee._id;
      } else {
        query.employeeId = employee._id;
      }
    }
  }

  if (requestedEmployeeId && !query.employeeId) {
    query.employeeId = requestedEmployeeId;
  }
  const statsQuery = { ...query };

  applyMonthFilterToQuery(query, req.query.month, organizationTimeZone);
  applyMonthFilterToQuery(statsQuery, req.query.month, organizationTimeZone);

  if (req.query.status && req.query.status !== "all") {
    query.status = req.query.status;
  }

  const search = String(req.query.search || "").trim();
  if (search) {
    const [employeeIds, leaveTypeIds] = await Promise.all([
      Employee.find({
        organizationId: req.user.organizationId,
        $or: [
          { firstName: { $regex: search, $options: "i" } },
          { lastName: { $regex: search, $options: "i" } },
          { employeeCode: { $regex: search, $options: "i" } }
        ]
      }).distinct("_id"),
      LeaveType.find({
        organizationId: req.user.organizationId,
        name: { $regex: search, $options: "i" }
      }).distinct("_id")
    ]);

    query.$or = [
      { employeeId: { $in: employeeIds } },
      { leaveTypeId: { $in: leaveTypeIds } }
    ];
  }

  const pageRequested = req.query.page !== undefined || req.query.limit !== undefined;
  const page = parsePositiveInt(req.query.page, 1);
  const limit = Math.min(parsePositiveInt(req.query.limit, 10), 100);
  const baseQuery = Leave.find(query)
    .populate("employeeId", "firstName lastName employeeCode")
    .populate("leaveTypeId", "name code")
    .populate("approvalFlowId", "name moduleKey minDays maxDays")
    .populate({
      path: "actionBy",
      select: "firstName lastName employeeCode designationId",
      populate: { path: "designationId", select: "name" }
    })
    .populate("revertRequest.requestedBy", "firstName lastName employeeCode")
    .populate({
      path: "revertRequest.actionBy",
      select: "firstName lastName employeeCode designationId",
      populate: { path: "designationId", select: "name" }
    })
    .populate("approvalSteps.approverEmployeeId", "firstName lastName employeeCode")
    .populate({
      path: "approvalSteps.actionBy",
      select: "firstName lastName employeeCode designationId",
      populate: { path: "designationId", select: "name" }
    })
    .sort({ createdAt: -1 });

  if (!pageRequested) {
    const rows = await baseQuery;
    await Promise.all(rows.map((row) => repairPendingLeaveApprovalState(row)));
    return enrichLeavesWithSandwichDetails({
      leaves: rows,
      organizationId: req.user.organizationId,
      timeZone: organizationTimeZone
    });
  }

  const [items, total] = await Promise.all([
    baseQuery.skip((page - 1) * limit).limit(limit),
    Leave.countDocuments(query)
  ]);
  await Promise.all(items.map((item) => repairPendingLeaveApprovalState(item)));
  const enrichedItems = await enrichLeavesWithSandwichDetails({
    leaves: items,
    organizationId: req.user.organizationId,
    timeZone: organizationTimeZone
  });
  const today = new Date();
  const [pending, approved, rejected, onLeaveToday] = await Promise.all([
    Leave.countDocuments({ ...statsQuery, status: "pending" }),
    Leave.countDocuments({ ...statsQuery, status: "approved" }),
    Leave.countDocuments({ ...statsQuery, status: "rejected" }),
    Leave.countDocuments({
      ...statsQuery,
      status: "approved",
      fromDate: { $lte: today },
      toDate: { $gte: today }
    })
  ]);

  return {
    items: enrichedItems,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit))
    },
    stats: {
      pending,
      approved,
      rejected,
      onLeaveToday
    }
  };
};

exports.getMyPendingApprovals = async (req) => {
  const actorRoleSlug = await getActorRoleSlug(req);
  if (!REQUEST_APPROVER_ROLE_SLUGS.has(actorRoleSlug)) {
    return [];
  }

  const query = {
    organizationId: req.user.organizationId,
    status: "pending"
  };

  if (actorRoleSlug === "manager") {
    const managerEmployee = await Employee.findOne({
      userId: req.user.userId,
      organizationId: req.user.organizationId
    }).select("_id");

    if (!managerEmployee) {
      return [];
    }

    const reportIds = await Employee.find({
      organizationId: req.user.organizationId,
      managerId: managerEmployee._id
    }).distinct("_id");
    query.employeeId = { $in: reportIds };
  }

  const rows = await Leave.find(query)
    .populate("employeeId", "firstName lastName employeeCode")
    .populate("leaveTypeId", "name code")
    .populate("approvalFlowId", "name moduleKey minDays maxDays")
    .populate({
      path: "actionBy",
      select: "firstName lastName employeeCode designationId",
      populate: { path: "designationId", select: "name" }
    })
    .populate("revertRequest.requestedBy", "firstName lastName employeeCode")
    .populate({
      path: "revertRequest.actionBy",
      select: "firstName lastName employeeCode designationId",
      populate: { path: "designationId", select: "name" }
    })
    .populate("approvalSteps.approverEmployeeId", "firstName lastName employeeCode")
    .populate({
      path: "approvalSteps.actionBy",
      select: "firstName lastName employeeCode designationId",
      populate: { path: "designationId", select: "name" }
    })
    .sort({ createdAt: -1 });

  await Promise.all(rows.map((row) => repairPendingLeaveApprovalState(row)));

  const actorContext = await getActorApprovalContext(req);
  return rows.filter((row) => {
    const steps = Array.isArray(row.approvalSteps) ? row.approvalSteps : [];
    if (!steps.length) return true;
    const currentStep = getCurrentPendingStep(steps);
    if (!currentStep) return false;
    return canActorApproveStep(currentStep, actorContext, { allowAdminOverride: true });
  });
};

exports.actionLeave = async (req) => {
  const leave = await Leave.findById(req.params.id);
  if (!leave) throw new Error("Leave not found");
  await repairPendingLeaveApprovalState(leave);

  // 🔒 store previous status (VERY IMPORTANT)
  const previousStatus = leave.status;

  const actor = await Employee.findOne({
    userId: req.user.userId,
    organizationId: req.user.organizationId
  });
  const actorUser = await User.findById(req.user.userId).select("email");
  const actorDisplayName = toActorDisplayName(actor, actorUser?.email || req.user.email || "");

  await assertRequestApproverAccess(req, leave.employeeId);

  const org = await Organization.findById(leave.organizationId);
  const cycleStartYear =
    new Date(leave.fromDate).getMonth() + 1 < org.leaveCycleStartMonth
      ? new Date(leave.fromDate).getFullYear() - 1
      : new Date(leave.fromDate).getFullYear();

  const balance = await LeaveBalance.findOne({
    organizationId: leave.organizationId,
    employeeId: leave.employeeId,
    leaveTypeId: leave.leaveTypeId,
    cycleStartYear
  });

  const actorContext = await getActorApprovalContext(req);
  let finalStatusToApply = req.body.status;
  let isIntermediateApproval = false;

  if (["approved", "rejected"].includes(req.body.status) && Array.isArray(leave.approvalSteps) && leave.approvalSteps.length) {
    let resolvedProgress = resolveCurrentPendingStep({
      steps: leave.approvalSteps || [],
      currentApprovalStep: leave.currentApprovalStep
    });
    if (!isValidApprovalStepShape(resolvedProgress.currentStep)) {
      const rebuiltSteps = await rebuildLeaveApprovalStepsFromFlow(leave);
      if (rebuiltSteps?.length) {
        leave.approvalSteps = rebuiltSteps;
        resolvedProgress = resolveCurrentPendingStep({
          steps: rebuiltSteps,
          currentApprovalStep: leave.currentApprovalStep
        });
      }
    }
    if (resolvedProgress.repaired) {
      leave.approvalSteps = resolvedProgress.steps;
      leave.currentApprovalStep = resolvedProgress.currentApprovalStep;
    }
    const currentStep = resolvedProgress.currentStep;
    if (!currentStep) {
      throw new Error("No pending approval step found");
    }

    const allowedByFlow = canActorApproveStep(currentStep, actorContext, { allowAdminOverride: true });
    if (allowedByFlow) {
      const isAdminOverride = isAdminOverrideActor(actorContext)
        && !canActorApproveStep(currentStep, actorContext);
      const progress = isAdminOverride
        ? finalizeApprovalStepsByAdminOverride({
            steps: resolvedProgress.steps,
            action: req.body.status,
            actionBy: actor?._id || null,
            actionByName: actorDisplayName,
            remarks: req.body.status === "rejected"
              ? req.body.rejectionReason || "Rejected by organization admin"
              : "Approved by organization admin"
          })
        : advanceApprovalSteps({
            steps: resolvedProgress.steps,
            action: req.body.status,
            actionBy: actor?._id || null,
            actionByName: actorDisplayName,
            remarks: req.body.status === "rejected" ? req.body.rejectionReason || "" : null
          });
      leave.approvalSteps = progress.steps;
      leave.currentApprovalStep = progress.currentApprovalStep;
      finalStatusToApply = progress.finalStatus;
      isIntermediateApproval = Boolean(progress.isIntermediateApproval);
    } else {
      throw new Error(`You are not the current approver for this step. Pending step: ${describeApprovalStep(currentStep)}`);
    }
  }

  if (finalStatusToApply === "approved" && !isIntermediateApproval) {
    if (leave.status === "approved") {
      throw new Error("Leave already approved");
    }
    if (!balance) {
      throw new Error("Leave balance not found");
    }

    if (previousStatus === "pending") {
      if ((balance.pending || 0) >= leave.totalDays) {
        balance.pending -= leave.totalDays;
        balance.used += leave.totalDays;
      } else {
        // Backward compatibility: old pending leaves created before reservation logic
        if (balance.remaining < leave.totalDays) {
          throw new Error("Insufficient leave balance to approve");
        }
        balance.used += leave.totalDays;
        balance.remaining -= leave.totalDays;
      }
    } else if (previousStatus === "rejected" || previousStatus === "cancelled") {
      if (balance.remaining < leave.totalDays) {
        throw new Error("Insufficient leave balance to approve");
      }
      balance.used += leave.totalDays;
      balance.remaining -= leave.totalDays;
    }

    await balance.save();

  } else if (finalStatusToApply === "rejected") {
    if (balance && previousStatus === "pending") {
      if ((balance.pending || 0) >= leave.totalDays) {
        balance.pending -= leave.totalDays;
        balance.remaining += leave.totalDays;
        await balance.save();
      }
    } else if (balance && previousStatus === "approved") {
      balance.used = Math.max(0, balance.used - leave.totalDays);
      balance.remaining += leave.totalDays;
      await balance.save();
    }
    leave.rejectionReason = req.body.rejectionReason;
  } else if (isIntermediateApproval) {
    // Approval progressed to next step; keep leave in pending state.
    finalStatusToApply = "pending";
  } else {
    throw new Error("Invalid leave action");
  }
  leave.status = finalStatusToApply;
  leave.actionBy = actor?._id;
  leave.actionByName = actorDisplayName;
  leave.actionAt = new Date();

  await leave.save();

  if (isIntermediateApproval) {
    const leaveEmployee = await Employee.findById(leave.employeeId).select("firstName lastName");
    const pendingStep = getCurrentPendingStep(leave.approvalSteps || []);
    await notifyApprovalStepAssignees({
      organizationId: leave.organizationId,
      step: pendingStep,
      actorEmployeeId: actor?._id || null,
      type: "leave_pending_approval",
      title: "Leave approval pending",
      message: `${leaveEmployee?.firstName || "Employee"} ${leaveEmployee?.lastName || ""}`.trim()
        + ` leave is waiting for your approval.`,
      meta: {
        leaveId: leave._id,
        status: leave.status,
        currentApprovalStep: leave.currentApprovalStep
      }
    });
  }

  if (!isIntermediateApproval) {
    const leaveEmployee = await Employee.findById(leave.employeeId).populate("userId", "email");
    if (leaveEmployee?.userId?._id) {
      const actorName = actor
        ? `${actor.firstName || ""} ${actor.lastName || ""}`.trim() || "Manager"
        : "Manager";
      await createNotificationSafe({
        organizationId: leave.organizationId,
        recipientUserId: leaveEmployee.userId._id,
        recipientEmployeeId: leaveEmployee._id,
        actorEmployeeId: actor?._id || null,
        type: "leave_action",
        title: `Leave ${leave.status}`,
        message: `${actorName} marked your leave (${new Date(leave.fromDate).toDateString()} to ${new Date(leave.toDate).toDateString()}) as ${leave.status}.`,
        meta: {
          leaveId: leave._id,
          status: leave.status
        }
      });
    }
    if (leaveEmployee?.userId?.email) {
      await sendNotification({
        toEmail: leaveEmployee.userId.email,
        toName: leaveEmployee.firstName,
        subject: `Leave ${leave.status}`,
        message: `Your leave request from ${new Date(leave.fromDate).toDateString()} to ${new Date(leave.toDate).toDateString()} is ${leave.status}.`
      });
    }
  }

  return leave;
};
