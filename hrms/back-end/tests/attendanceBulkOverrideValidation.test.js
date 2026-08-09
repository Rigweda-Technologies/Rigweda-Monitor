const test = require("node:test");
const assert = require("node:assert/strict");

const {
  bulkOverrideAttendanceSchema,
  customBulkOverrideAttendanceSchema
} = require("../src/modules/timesheets/timesheet.validation");
const {
  __private__: { resolveBulkAttendanceSkipReason }
} = require("../src/modules/timesheets/timesheet.service");

const basePayload = {
  employeeIds: ["507f1f77bcf86cd799439011"],
  status: "present"
};

test("bulk attendance accepts an inclusive range of up to 30 days", () => {
  const result = bulkOverrideAttendanceSchema.validate({
    ...basePayload,
    startDate: "2026-07-01",
    endDate: "2026-07-30"
  });

  assert.equal(result.error, undefined);
});

test("bulk attendance rejects a range longer than 30 days", () => {
  const result = bulkOverrideAttendanceSchema.validate({
    ...basePayload,
    startDate: "2026-07-01",
    endDate: "2026-07-31"
  });

  assert.match(result.error?.message || "", /at most 30 days/);
});

test("bulk attendance keeps the legacy single-date payload valid", () => {
  const result = bulkOverrideAttendanceSchema.validate({
    ...basePayload,
    date: "2026-07-01"
  });

  assert.equal(result.error, undefined);
  assert.equal(result.value.includeNonWorkingDays, true);
});

test("bulk attendance requires a complete, ordered date range", () => {
  const missingEnd = bulkOverrideAttendanceSchema.validate({
    ...basePayload,
    startDate: "2026-07-01"
  });
  const reversed = bulkOverrideAttendanceSchema.validate({
    ...basePayload,
    startDate: "2026-07-02",
    endDate: "2026-07-01"
  });

  assert.match(missingEnd.error?.message || "", /both startDate and endDate/);
  assert.match(reversed.error?.message || "", /on or after startDate/);
});

test("bulk attendance identifies protected holiday, week-off, and leave dates", () => {
  const common = {
    holidayDateKeys: new Set(["2026-07-01"]),
    weekOffDays: [0],
    approvedLeaves: [{
      fromDate: new Date("2026-07-06T00:00:00.000Z"),
      toDate: new Date("2026-07-07T00:00:00.000Z")
    }],
    organizationTimeZone: "UTC"
  };

  assert.equal(resolveBulkAttendanceSkipReason({ ...common, dateKey: "2026-07-01" }), "holiday");
  assert.equal(resolveBulkAttendanceSkipReason({ ...common, dateKey: "2026-07-05" }), "weekOff");
  assert.equal(resolveBulkAttendanceSkipReason({ ...common, dateKey: "2026-07-06" }), "approvedLeave");
  assert.equal(resolveBulkAttendanceSkipReason({ ...common, dateKey: "2026-07-08" }), null);
});

test("customized bulk attendance accepts arbitrary dates and present/absent values", () => {
  const result = customBulkOverrideAttendanceSchema.validate({
    updates: [
      { employeeId: basePayload.employeeIds[0], date: "2026-07-01", status: "present" },
      { employeeId: basePayload.employeeIds[0], date: "2026-07-03", status: "absent" },
      { employeeId: basePayload.employeeIds[0], date: "2026-07-05", status: "present" }
    ],
    includeNonWorkingDays: false
  });

  assert.equal(result.error, undefined);
});

test("customized bulk attendance rejects more than 30 distinct dates", () => {
  const updates = Array.from({ length: 31 }, (_, index) => ({
    employeeId: basePayload.employeeIds[0],
    date: `2026-07-${String(index + 1).padStart(2, "0")}`,
    status: "present"
  }));
  const result = customBulkOverrideAttendanceSchema.validate({ updates });

  assert.match(result.error?.message || "", /at most 30 dates/);
});
