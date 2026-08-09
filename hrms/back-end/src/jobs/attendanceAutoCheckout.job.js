const cron = require("node-cron");
const Attendance = require("../modules/timesheets/timesheetAttendance.model");
const { upsertTimesheetHours } = require("../modules/timesheets/timesheet.service");

const startOfDay = (value) => {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
};

const endOfDay = (value) => {
  const d = new Date(value);
  d.setHours(23, 59, 59, 999);
  return d;
};

cron.schedule("59 23 * * *", async () => {
  try {
    const now = new Date();
    const today = startOfDay(now);
    const dayEnd = endOfDay(now);

    const openAttendances = await Attendance.find({
      date: today,
      checkInAt: { $ne: null },
      checkOutAt: null
    });

    for (const attendance of openAttendances) {
      const totalMinutes = Math.max(
        0,
        Math.round((dayEnd.getTime() - attendance.checkInAt.getTime()) / 60000)
      );

      attendance.checkOutAt = dayEnd;
      attendance.totalMinutes = totalMinutes;
      attendance.status = "checked_out";
      await attendance.save();

      const hoursWorked = Number((totalMinutes / 60).toFixed(2));
      await upsertTimesheetHours({
        organizationId: attendance.organizationId,
        employeeId: attendance.employeeId,
        dateValue: today,
        hoursWorked
      });
    }
  } catch (err) {
    console.error("❌ Auto checkout job failed:", err);
  }
});
