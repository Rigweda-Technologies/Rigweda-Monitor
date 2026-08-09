const test = require("node:test");
const assert = require("node:assert/strict");

const { __private__ } = require("../src/modules/timesheets/timesheet.service");

test("attendance rows normalize the attendance date to the actual punch day", () => {
  const row = {
    _id: "attendance-1",
    employeeId: "employee-1",
    date: new Date("2026-04-04T18:30:00.000Z"),
    checkInAt: new Date("2026-04-06T04:40:33.132Z"),
    checkOutAt: new Date("2026-04-06T13:04:55.392Z"),
    shiftStartTime: "09:30",
    shiftEndTime: "18:30",
    totalMinutes: 0
  };

  const mergedRows = __private__.mergeAttendanceRowsByEmployeeDay([row], "Asia/Kolkata");

  assert.equal(mergedRows.length, 1);
  assert.equal(__private__.getAttendanceRowDayKey(mergedRows[0], "Asia/Kolkata"), "2026-04-06");
  assert.equal(mergedRows[0].date.toISOString(), "2026-04-05T18:30:00.000Z");
});
