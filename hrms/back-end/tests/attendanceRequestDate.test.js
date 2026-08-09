const test = require("node:test");
const assert = require("node:assert/strict");

const { raiseAttendanceRequestSchema } = require("../src/modules/timesheets/timesheet.validation");
const { normalizeAttendanceRequestDateKey } = require("../src/modules/timesheets/attendanceRequest.utils");

test("attendance request validation keeps date-only payload as YYYY-MM-DD", () => {
  const { error, value } = raiseAttendanceRequestSchema.validate({
    date: "2026-04-01",
    requestType: "correction",
    requestedCheckInTime: "09:15",
    requestedCheckOutTime: "",
    reason: "Correcting missed punch"
  });

  assert.equal(error, undefined);
  assert.equal(value.date, "2026-04-01");
  assert.equal(typeof value.date, "string");
});

test("attendance request date normalization preserves date keys", () => {
  assert.equal(normalizeAttendanceRequestDateKey("2026-04-01", "Asia/Kolkata"), "2026-04-01");
});
