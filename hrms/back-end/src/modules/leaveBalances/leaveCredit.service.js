const LeaveBalance = require("./leaveBalance.model");
const LeaveType = require("../leaveTypes/leaveType.model");
const Employee = require("../employees/employee.model");
const Organization = require("../organizations/organization.model");
const OrgSettings = require("../orgSettings/orgSettings.model");

const roundTwo = (value) => Math.round(value * 100) / 100;
const roundToHalfDay = (value) => roundTwo(Math.round(Number(value || 0) * 2) / 2);

const getCycleStartDate = (date, startMonth) => {
  const d = new Date(date);
  const year = d.getMonth() + 1 < startMonth ? d.getFullYear() - 1 : d.getFullYear();
  return new Date(year, startMonth - 1, 1);
};

const monthsBetween = (from, to) =>
  (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());

const getPeriodInfo = (date, frequency, cycleStartMonth) => {
  const now = new Date(date);
  now.setHours(0, 0, 0, 0);

  if (frequency === "monthly") {
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    return { periodStart, periodsPerYear: 12 };
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

exports.applyLeaveCreditsForOrg = async (organizationId, date = new Date()) => {
  const org = await Organization.findById(organizationId);
  if (!org) return;

  const settings = await OrgSettings.findOne({ organizationId });
  const frequency = settings?.leaveCreditFrequency || "monthly";

  const { periodStart, periodsPerYear } = getPeriodInfo(
    date,
    frequency,
    org.leaveCycleStartMonth
  );

  // Only credit after period has started
  if (date < periodStart) return;

  // Prevent over-crediting old balances missing lastCreditedAt (created before current period)
  await LeaveBalance.updateMany(
    {
      organizationId,
      lastCreditedAt: { $exists: false },
      createdAt: { $lt: periodStart }
    },
    { $set: { lastCreditedAt: periodStart } }
  );

  const cycleStartYear = periodStart.getMonth() + 1 < org.leaveCycleStartMonth
    ? periodStart.getFullYear() - 1
    : periodStart.getFullYear();

  const [leaveTypes, employees] = await Promise.all([
    LeaveType.find({ organizationId, status: "active" }),
    Employee.find({ organizationId, status: "active" })
  ]);

  if (!leaveTypes.length || !employees.length) return;

  const bulkOps = [];

  for (const lt of leaveTypes) {
    const creditPerPeriod = roundToHalfDay(lt.daysPerYear / periodsPerYear);

    for (const emp of employees) {
      bulkOps.push({
        updateOne: {
          filter: {
            organizationId,
            employeeId: emp._id,
            leaveTypeId: lt._id,
            cycleStartYear,
            $or: [
              { lastCreditedAt: { $exists: false } },
              { lastCreditedAt: { $lt: periodStart } }
            ]
          },
          update: {
            $setOnInsert: {
              total: 0,
              used: 0,
              pending: 0,
              remaining: 0
            },
            $inc: {
              total: creditPerPeriod,
              remaining: creditPerPeriod
            },
            $set: {
              lastCreditedAt: periodStart
            }
          },
          upsert: true
        }
      });
    }
  }

  if (bulkOps.length > 0) {
    await LeaveBalance.bulkWrite(bulkOps, { ordered: false });
  }
};
