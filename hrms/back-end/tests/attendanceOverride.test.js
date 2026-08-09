const test = require("node:test");
const assert = require("node:assert/strict");

const { __private__ } = require("../src/modules/timesheets/timesheet.service");

test("no-op override is detected when absent is saved without any punches", () => {
  assert.equal(
    __private__.isNoOpAttendanceOverride({
      existingAttendance: null,
      targetStatus: "absent"
    }),
    true
  );

  assert.equal(
    __private__.isNoOpAttendanceOverride({
      existingAttendance: {
        checkInAt: null,
        checkOutAt: null
      },
      targetStatus: "absent"
    }),
    true
  );
});

test("override is allowed when attendance has punches or when target status is present", () => {
  assert.equal(
    __private__.isNoOpAttendanceOverride({
      existingAttendance: {
        checkInAt: new Date("2026-04-13T04:00:00.000Z"),
        checkOutAt: null
      },
      targetStatus: "absent"
    }),
    false
  );

  assert.equal(
    __private__.isNoOpAttendanceOverride({
      existingAttendance: null,
      targetStatus: "present"
    }),
    false
  );
});

test("no-op override is detected when present is saved for an already present day", () => {
  assert.equal(
    __private__.isNoOpAttendanceOverride({
      existingAttendance: {
        checkInAt: new Date("2026-04-13T01:00:00.000Z"),
        checkOutAt: new Date("2026-04-13T10:30:00.000Z"),
        totalMinutes: 570
      },
      targetStatus: "present",
      minHalfDayHours: 4,
      minWorkHoursPerDay: 8
    }),
    true
  );

  assert.equal(
    __private__.isNoOpAttendanceOverride({
      existingAttendance: {
        checkInAt: new Date("2026-04-13T01:00:00.000Z"),
        checkOutAt: new Date("2026-04-13T05:00:00.000Z"),
        totalMinutes: 240
      },
      targetStatus: "present",
      minHalfDayHours: 4,
      minWorkHoursPerDay: 8
    }),
    false
  );
});

test("half-day override is detected as no-op only for an already half-day day", () => {
  assert.equal(
    __private__.isNoOpAttendanceOverride({
      existingAttendance: {
        checkInAt: new Date("2026-04-13T01:00:00.000Z"),
        checkOutAt: new Date("2026-04-13T05:00:00.000Z"),
        totalMinutes: 240
      },
      targetStatus: "half_day_present",
      minHalfDayHours: 4,
      minWorkHoursPerDay: 8
    }),
    true
  );

  assert.equal(
    __private__.isNoOpAttendanceOverride({
      existingAttendance: {
        checkInAt: new Date("2026-04-13T01:00:00.000Z"),
        checkOutAt: new Date("2026-04-13T10:30:00.000Z"),
        totalMinutes: 570
      },
      targetStatus: "half_day_present",
      minHalfDayHours: 4,
      minWorkHoursPerDay: 8
    }),
    false
  );
});

test("half-day override records configured half-day minutes", () => {
  const update = __private__.buildAttendanceOverrideUpdate({
    status: "half_day_present",
    actorEmployeeId: null,
    shift: {
      _id: "shift1",
      name: "General",
      code: "GEN",
      startTime: "09:00",
      endTime: "18:00"
    },
    scheduledStartAt: new Date("2026-04-13T03:30:00.000Z"),
    scheduledEndAt: new Date("2026-04-13T12:30:00.000Z"),
    shiftMinutes: 540,
    minHalfDayHours: 4
  });

  assert.equal(update.totalMinutes, 240);
  assert.equal(update.earlyCheckoutByMinutes, 300);
  assert.equal(update.checkOutAt.toISOString(), "2026-04-13T07:30:00.000Z");
});

test("overtime is only counted after exceeding configured daily hours", () => {
  assert.equal(__private__.resolveOvertimeMinutes(480, 8), 0);
  assert.equal(__private__.resolveOvertimeMinutes(500, 8), 20);
  assert.equal(__private__.resolveOvertimeMinutes(450, 8), 0);
  assert.equal(__private__.resolveOvertimeMinutes(540, 9), 0);
});

test("approved partial WFH counts as half day even with a higher organization threshold", () => {
  const status = __private__.resolveAttendanceMatrixStatus(
    {
      checkInAt: new Date("2026-07-26T04:00:00.000Z"),
      checkOutAt: new Date("2026-07-26T08:30:00.000Z"),
      totalMinutes: 270,
      workFromHomePortion: "first_half"
    },
    {
      minHalfDayHours: 5,
      minWorkHoursPerDay: 9,
      now: new Date("2026-07-27T00:00:00.000Z")
    }
  );

  assert.equal(status, "half_day_present");
});
