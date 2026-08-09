const LeaveBalance = require("../leaveBalances/leaveBalance.model");
const LeaveType = require("../leaveTypes/leaveType.model");
const Organization = require("../organizations/organization.model");

/**
 * Run carry forward for ONE organization
 */
exports.runCarryForwardForOrg = async (organizationId) => {

  const org = await Organization.findById(organizationId);
  if (!org) return;

  const startMonth = org.leaveCycleStartMonth;

  // Determine previous & new cycle
  const now = new Date();
  const newCycleYear =
    now.getMonth() + 1 >= startMonth
      ? now.getFullYear()
      : now.getFullYear() - 1;

  const prevCycleYear = newCycleYear - 1;

  // Get carry-forward-enabled leave types
  const leaveTypes = await LeaveType.find({
    organizationId,
    isCarryForward: true,
    status: "active"
  });

  if (!leaveTypes.length) return;

  for (const lt of leaveTypes) {

    const balances = await LeaveBalance.find({
      organizationId,
      leaveTypeId: lt._id,
      cycleStartYear: prevCycleYear
    });

    for (const bal of balances) {

      let carryAmount = bal.remaining;

      // Apply max cap
      if (lt.maxCarryForward !== null) {
        carryAmount = Math.min(
          carryAmount,
          lt.maxCarryForward
        );
      }

      if (carryAmount <= 0) continue;

      // Find or create new cycle balance
      const newBal = await LeaveBalance.findOne({
        organizationId,
        employeeId: bal.employeeId,
        leaveTypeId: lt._id,
        cycleStartYear: newCycleYear
      });

      if (newBal) {
        // Add to existing balance
        newBal.total += carryAmount;
        newBal.remaining += carryAmount;
        await newBal.save();
      } else {
        // Create fresh balance
        await LeaveBalance.create({
          organizationId,
          employeeId: bal.employeeId,
          leaveTypeId: lt._id,
          cycleStartYear: newCycleYear,
          total: carryAmount,
          used: 0,
          remaining: carryAmount
        });
      }
    }
  }
};
