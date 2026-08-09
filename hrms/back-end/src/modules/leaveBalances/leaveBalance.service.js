const LeaveBalance = require("./leaveBalance.model");
const LeaveType = require("../leaveTypes/leaveType.model");
const Organization = require("../organizations/organization.model");
const Employee = require("../employees/employee.model");
const OrgSettings = require("../orgSettings/orgSettings.model");
const { audit } = require("../auditLogs/auditLogs.service");

/**
 * Get leave cycle start year based on org configuration
 */
const getCycleStartYear = (date, startMonth) => {
  return date.getMonth() + 1 < startMonth
    ? date.getFullYear() - 1
    : date.getFullYear();
};

/**
 * Round value to 2 decimals
 */
const roundTwo = (value) => Math.round(value * 100) / 100;
const roundToHalfDay = (value) => roundTwo(Math.round(Number(value || 0) * 2) / 2);
const normalizeBalanceToHalfDay = async (balance) => {
  const nextTotal = roundToHalfDay(balance.total);
  const nextUsed = roundToHalfDay(balance.used);
  const nextPending = roundToHalfDay(balance.pending || 0);
  const nextRemaining = roundToHalfDay(nextTotal - nextUsed - nextPending);

  if (
    balance.total === nextTotal &&
    balance.used === nextUsed &&
    (balance.pending || 0) === nextPending &&
    balance.remaining === nextRemaining
  ) {
    return balance;
  }

  balance.total = nextTotal;
  balance.used = nextUsed;
  balance.pending = nextPending;
  balance.remaining = nextRemaining;
  await balance.save();
  return balance;
};

const escapeRegex = (value = "") => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const resolveLeaveType = async ({ organizationId, leaveTypeId, leaveTypeName }) => {
  if (leaveTypeId) {
    const byId = await LeaveType.findOne({
      _id: leaveTypeId,
      organizationId
    }).select("_id name code");
    if (byId) return byId;
  }

  const normalizedName = String(leaveTypeName || "").trim();
  if (!normalizedName) return null;

  const byExactName = await LeaveType.findOne({
    organizationId,
    name: normalizedName
  }).select("_id name code");
  if (byExactName) return byExactName;

  const labelMatch = normalizedName.match(/^(.*?)(?:\s*\(([^)]+)\))?$/);
  const parsedName = labelMatch?.[1]?.trim() || "";
  const parsedCode = labelMatch?.[2]?.trim() || "";

  if (parsedCode) {
    const byCode = await LeaveType.findOne({
      organizationId,
      code: new RegExp(`^${escapeRegex(parsedCode)}$`, "i")
    }).select("_id name code");
    if (byCode) return byCode;
  }

  if (parsedName) {
    const byParsedName = await LeaveType.findOne({
      organizationId,
      name: new RegExp(`^${escapeRegex(parsedName)}$`, "i")
    }).select("_id name code");
    if (byParsedName) return byParsedName;
  }

  return null;
};

const getCycleStartDate = (date, startMonth) => {
  const d = new Date(date);
  const year = d.getMonth() + 1 < startMonth ? d.getFullYear() - 1 : d.getFullYear();
  return new Date(year, startMonth - 1, 1);
};

const monthsBetween = (from, to) =>
  (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());

const getCycleEndDate = (date, startMonth) => {
  const cycleStart = getCycleStartDate(date, startMonth);
  return new Date(cycleStart.getFullYear() + 1, cycleStart.getMonth(), 0);
};

const getRemainingPeriods = (date, frequency, cycleStartMonth) => {
  const now = new Date(date);
  const cycleEnd = getCycleEndDate(now, cycleStartMonth);

  if (frequency === "monthly") {
    const monthsLeft = monthsBetween(now, cycleEnd) + 1;
    return { remainingPeriods: monthsLeft, totalPeriods: 12 };
  }

  if (frequency === "quarterly") {
    const { periodStart } = getPeriodInfo(now, frequency, cycleStartMonth);
    const monthsLeft = monthsBetween(periodStart, cycleEnd) + 1;
    const remainingPeriods = Math.ceil(monthsLeft / 3);
    return { remainingPeriods, totalPeriods: 4 };
  }

  const monthsLeft = monthsBetween(now, cycleEnd) + 1;
  return { remainingPeriods: monthsLeft, totalPeriods: 12 };
};

const getPeriodInfo = (date, frequency, cycleStartMonth) => {
  const now = new Date(date);
  now.setHours(0, 0, 0, 0);

  if (frequency === "monthly") {
    return { periodStart: new Date(now.getFullYear(), now.getMonth(), 1), periodsPerYear: 12 };
  }

  const cycleStart = getCycleStartDate(now, cycleStartMonth);
  if (frequency === "yearly") {
    return { periodStart: cycleStart, periodsPerYear: 1 };
  }

  const offsetMonths = monthsBetween(cycleStart, now);
  const quarterIndex = Math.floor(offsetMonths / 3);
  const periodStart = new Date(
    cycleStart.getFullYear(),
    cycleStart.getMonth() + quarterIndex * 3,
    1
  );
  return { periodStart, periodsPerYear: 4 };
};

/**
 * Initialize leave balance when employee is created
 */
exports.initializeForEmployee = async (employee, organizationId) => {
  // 1️⃣ fetch organization (for leave cycle)
  const org = await Organization.findById(organizationId);
  if (!org) return;

  const settings = await OrgSettings.findOne({ organizationId });
  const frequency = settings?.leaveCreditFrequency || "monthly";
  // 2️⃣ determine leave cycle year
  const doj = new Date(employee.dateOfJoining);
  const cycleStartYear = getCycleStartYear(
    doj,
    org.leaveCycleStartMonth
  );

  const { periodStart, periodsPerYear } = getPeriodInfo(
    doj,
    frequency,
    org.leaveCycleStartMonth
  );
  const { remainingPeriods, totalPeriods } = getRemainingPeriods(
    doj,
    frequency,
    org.leaveCycleStartMonth
  );

  // 3️⃣ fetch active leave types
  const leaveTypes = await LeaveType.find({
    organizationId,
    status: "active"
  });

  if (!leaveTypes.length) return;

  // 4️⃣ prepare bulk insert
  const bulkOps = leaveTypes.map((lt) => {
    const creditPerPeriod = lt.daysPerYear / periodsPerYear;
    let total = creditPerPeriod * remainingPeriods;

    if (frequency === "yearly") {
      total = (lt.daysPerYear / totalPeriods) * remainingPeriods;
    }

    if (frequency === "monthly") {
      const joinDay = doj.getDate();
      if (joinDay > 15) total -= creditPerPeriod / 2;
    }
    total = roundToHalfDay(total);

    return {
      updateOne: {
        filter: {
          organizationId,
          employeeId: employee._id,
          leaveTypeId: lt._id,
          cycleStartYear
        },
        update: {
          $setOnInsert: {
            total,
            used: 0,
            pending: 0,
            remaining: total,
            lastCreditedAt: periodStart
          }
        },
        upsert: true
      }
    };
  });

  // 5️⃣ create leave balances
  await LeaveBalance.bulkWrite(bulkOps);
};

/**
 * Initialize leave balance for all employees when a new leave type is created
 */
exports.initializeForNewLeaveType = async (leaveType, organizationId) => {
  const org = await Organization.findById(organizationId);
  if (!org) return;

  const settings = await OrgSettings.findOne({ organizationId });
  const frequency = settings?.leaveCreditFrequency || "monthly";
  const leaveTypeCreditMode = settings?.leaveTypeCreditMode || "current_month_onwards";
  const now = new Date();

  const employees = await Employee.find({ organizationId });
  if (!employees.length) return;

  const bulkOps = employees.map((employee) => {
    const doj = new Date(employee.dateOfJoining || new Date());
    const referenceDate =
      leaveTypeCreditMode === "full_year"
        ? now
        : (doj > now ? doj : now);
    const cycleStartYear = getCycleStartYear(referenceDate, org.leaveCycleStartMonth);
    const { periodStart, periodsPerYear } = getPeriodInfo(
      referenceDate,
      frequency,
      org.leaveCycleStartMonth
    );
    const { remainingPeriods, totalPeriods } = getRemainingPeriods(
      referenceDate,
      frequency,
      org.leaveCycleStartMonth
    );

    const creditPerPeriod = leaveType.daysPerYear / periodsPerYear;
    let total = roundToHalfDay(leaveType.daysPerYear);
    if (leaveTypeCreditMode === "current_month_onwards") {
      total = creditPerPeriod * remainingPeriods;
      if (frequency === "yearly") {
        total = (leaveType.daysPerYear / totalPeriods) * remainingPeriods;
      }
      total = roundToHalfDay(total);
    }

    return {
      updateOne: {
        filter: {
          organizationId,
          employeeId: employee._id,
          leaveTypeId: leaveType._id,
          cycleStartYear
        },
        update: {
          $setOnInsert: {
            total,
            used: 0,
            pending: 0,
            remaining: total,
            lastCreditedAt: periodStart
          }
        },
        upsert: true
      }
    };
  });

  await LeaveBalance.bulkWrite(bulkOps);
};


exports.getEmployeeBalance = async (organizationId, id, type = "USER", options = {}) => {
  const includeInactive = options.includeInactive !== false;

  let employeeQuery = { organizationId };

  if (type === "EMPLOYEE") {
    // employeeId comes from URL → real ObjectId
    employeeQuery._id = id;
  } else {
    // userId comes from token → STRING is OK
    employeeQuery.userId = id;
  }

  const employee = await Employee.findOne(employeeQuery);

  if (!employee) {
    throw new Error("Employee not found");
  }

  const balances = await LeaveBalance.find({
    organizationId,
    employeeId: employee._id
  }).populate("leaveTypeId", "name code status");

  await Promise.all(balances.map((balance) => normalizeBalanceToHalfDay(balance)));

  return balances
    .filter((b) => b.leaveTypeId && (includeInactive || b.leaveTypeId.status !== "inactive"))
    .map((b) => ({
      _id: b._id,
      leaveTypeId: b.leaveTypeId._id,
      leaveType: b.leaveTypeId.name,
      code: b.leaveTypeId.code,
      status: b.leaveTypeId.status,
      total: b.total,
      used: b.used,
      pending: b.pending || 0,
      remaining: b.remaining
    }));
};

exports.adjustEmployeeBalance = async (req) => {
  const { organizationId, userId } = req.user;
  const { employeeId } = req.params;
  const { balanceId, leaveTypeId, leaveTypeName, days, note } = req.body;

  const employee = await Employee.findOne({
    _id: employeeId,
    organizationId
  }).select("_id firstName lastName employeeCode");

  if (!employee) {
    throw { code: 404, message: "Employee not found" };
  }

  let balance = null;
  let leaveType = null;

  if (balanceId) {
    balance = await LeaveBalance.findOne({
      _id: balanceId,
      organizationId,
      employeeId: employee._id
    })
      .populate("leaveTypeId", "name code")
      .sort({ cycleStartYear: -1 });

    if (balance?.leaveTypeId) {
      leaveType = {
        _id: balance.leaveTypeId._id,
        name: balance.leaveTypeId.name,
        code: balance.leaveTypeId.code
      };
    }
  }

  if (!leaveType) {
    leaveType = await resolveLeaveType({ organizationId, leaveTypeId, leaveTypeName });
  }

  if (!leaveType) {
    throw { code: 404, message: "Leave type not found" };
  }

  if (!balance) {
    balance = await LeaveBalance.findOne({
      organizationId,
      employeeId: employee._id,
      leaveTypeId: leaveType._id
    }).sort({ cycleStartYear: -1 });
  }

  if (!balance) {
    throw { code: 404, message: "Leave balance not found for the selected employee and leave type" };
  }

  const before = balance.toObject();
  const configuredTotal = roundTwo(Number(days));
  const usedAndPending = roundTwo(Number(balance.used || 0) + Number(balance.pending || 0));
  const nextTotal = configuredTotal;
  const nextRemaining = roundTwo(configuredTotal - usedAndPending);

  if (nextTotal < usedAndPending) {
    throw {
      code: 400,
      message: `Configured total cannot be less than used + pending (${usedAndPending})`
    };
  }

  if (nextRemaining < 0) {
    throw { code: 400, message: "Adjusted remaining leave cannot be negative" };
  }

  balance.total = nextTotal;
  balance.remaining = nextRemaining;
  await balance.save();

  await audit({
    req,
    module: "leave_balances",
    action: "UPDATE",
    entityId: balance._id,
    before,
    after: balance.toObject()
  });

  return {
    employee: {
      _id: employee._id,
      name: `${employee.firstName || ""} ${employee.lastName || ""}`.trim() || employee.employeeCode || "Employee",
      employeeCode: employee.employeeCode || ""
    },
    leaveType: {
      _id: leaveType._id,
      name: leaveType.name,
      code: leaveType.code
    },
    balance: {
      _id: balance._id,
      total: balance.total,
      used: balance.used,
      pending: balance.pending || 0,
      remaining: balance.remaining,
      cycleStartYear: balance.cycleStartYear
    },
    adjustmentDays: configuredTotal
  };
};

exports.adjustAllEmployeeBalances = async (req) => {
  const { organizationId } = req.user;
  const { leaveTypeId, leaveTypeName, days, note } = req.body;

  const leaveType = await resolveLeaveType({ organizationId, leaveTypeId, leaveTypeName });

  if (!leaveType) {
    throw { code: 404, message: "Leave type not found" };
  }

  const balances = await LeaveBalance.find({
    organizationId,
    leaveTypeId: leaveType._id
  }).sort({ cycleStartYear: -1 });

  if (!balances.length) {
    throw { code: 404, message: "No leave balances found for the selected leave type" };
  }

  const employeeIds = [...new Set(balances.map((balance) => String(balance.employeeId)))];
  const employees = await Employee.find({
    _id: { $in: employeeIds },
    organizationId
  }).select("_id firstName lastName employeeCode");
  const employeeMap = new Map(employees.map((employee) => [String(employee._id), employee]));

  const configuredTotal = roundTwo(Number(days));
  const results = [];

  for (const balance of balances) {
    const employee = employeeMap.get(String(balance.employeeId));
    if (!employee) continue;

    const before = balance.toObject();
    const usedAndPending = roundTwo(Number(balance.used || 0) + Number(balance.pending || 0));
    const nextTotal = configuredTotal;
    const nextRemaining = roundTwo(configuredTotal - usedAndPending);

    if (nextTotal < usedAndPending) {
      throw {
        code: 400,
        message: `Configured total cannot be less than used + pending (${usedAndPending}) for ${employee.employeeCode || employee.firstName || "an employee"}`
      };
    }

    if (nextRemaining < 0) {
      throw {
        code: 400,
        message: `Adjusted remaining leave cannot be negative for ${employee.employeeCode || employee.firstName || "an employee"}`
      };
    }

    balance.total = nextTotal;
    balance.remaining = nextRemaining;
    await balance.save();

    await audit({
      req,
      module: "leave_balances",
      action: "UPDATE",
      entityId: balance._id,
      before,
      after: balance.toObject()
    });

    results.push({
      employee: {
        _id: employee._id,
        name: `${employee.firstName || ""} ${employee.lastName || ""}`.trim() || employee.employeeCode || "Employee",
        employeeCode: employee.employeeCode || ""
      },
      leaveType: {
        _id: leaveType._id,
        name: leaveType.name,
        code: leaveType.code
      },
      balance: {
        _id: balance._id,
        total: balance.total,
        used: balance.used,
        pending: balance.pending || 0,
        remaining: balance.remaining,
        cycleStartYear: balance.cycleStartYear
      },
      adjustmentDays: configuredTotal
    });
  }

  return {
    leaveType: {
      _id: leaveType._id,
      name: leaveType.name,
      code: leaveType.code
    },
    count: results.length,
    items: results
  };
};
