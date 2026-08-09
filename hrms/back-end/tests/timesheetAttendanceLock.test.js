const test = require("node:test");
const assert = require("node:assert/strict");

const mockModule = (modulePath, exportsValue) => {
  const resolved = require.resolve(modulePath);
  const original = require.cache[resolved];
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: exportsValue
  };

  return () => {
    if (original) require.cache[resolved] = original;
    else delete require.cache[resolved];
  };
};

const loadTimesheetService = (settings) => {
  const restores = [];
  const servicePath = require.resolve("../src/modules/timesheets/timesheet.service");

  restores.push(
    mockModule("../src/modules/orgSettings/orgSettings.model", {
      findOne: () => ({
        select: () => Promise.resolve(settings)
      })
    })
  );

  delete require.cache[servicePath];
  const service = require("../src/modules/timesheets/timesheet.service");

  return {
    service,
    restore: () => {
      delete require.cache[servicePath];
      for (const restore of restores.reverse()) restore();
    }
  };
};

test("attendance lock day unlocks previous month attendance before cutoff day", async () => {
  const settings = {
    attendanceLockEnabled: true,
    attendanceLockMode: "payroll_cutoff",
    attendanceLockAfterDays: 7,
    attendanceLockDay: 9,
    payrollCutoffDay: 25
  };
  const { service, restore } = loadTimesheetService(settings);
  const realDate = Date;

  class MockDate extends realDate {
    constructor(...args) {
      if (args.length === 0) {
        return new realDate("2026-06-06T12:00:00+05:30");
      }
      return new realDate(...args);
    }

    static now() {
      return new realDate("2026-06-06T12:00:00+05:30").getTime();
    }

    static parse(value) {
      return realDate.parse(value);
    }

    static UTC(...args) {
      return realDate.UTC(...args);
    }
  }

  try {
    global.Date = MockDate;
    await assert.doesNotReject(
      () => service.__private__.validateAttendanceEditWindow("org-1", "2026-05-07", "Asia/Kolkata")
    );

    const windowMeta = service.__private__.getAttendanceLockWindowMeta(
      settings,
      "Asia/Kolkata",
      new realDate("2026-06-06T12:00:00+05:30")
    );
    assert.equal(windowMeta.attendanceLockDay, 9);
    assert.equal(windowMeta.lockedThroughDateKey, null);
  } finally {
    global.Date = realDate;
    restore();
  }
});

test("attendance lock day locks previous month attendance on and after cutoff day", async () => {
  const settings = {
    attendanceLockEnabled: true,
    attendanceLockMode: "payroll_cutoff",
    attendanceLockAfterDays: 7,
    attendanceLockDay: 9,
    payrollCutoffDay: 25
  };
  const { service, restore } = loadTimesheetService(settings);
  const realDate = Date;

  class MockDate extends realDate {
    constructor(...args) {
      if (args.length === 0) {
        return new realDate("2026-06-10T12:00:00+05:30");
      }
      return new realDate(...args);
    }

    static now() {
      return new realDate("2026-06-10T12:00:00+05:30").getTime();
    }

    static parse(value) {
      return realDate.parse(value);
    }

    static UTC(...args) {
      return realDate.UTC(...args);
    }
  }

  try {
    global.Date = MockDate;
    await assert.rejects(
      () => service.__private__.validateAttendanceEditWindow("org-1", "2026-05-07", "Asia/Kolkata"),
      /Attendance is locked through payroll cutoff date 2026-06-09/
    );

    const windowMeta = service.__private__.getAttendanceLockWindowMeta(
      settings,
      "Asia/Kolkata",
      new realDate("2026-06-10T12:00:00+05:30")
    );
    assert.equal(windowMeta.attendanceLockDay, 9);
    assert.equal(windowMeta.lockedThroughDateKey, "2026-06-09");
  } finally {
    global.Date = realDate;
    restore();
  }
});

test("attendance override takes priority over leave in display status", async () => {
  const { service, restore } = loadTimesheetService({});

  try {
    assert.equal(
      service.__private__.resolveAttendanceDisplayStatus({
        isHoliday: false,
        isWeekOff: false,
        isOnLeave: true,
        leaveType: "SICK",
        leaveDuration: "full_day",
        attendanceStatus: "half_day_present",
        hasAttendanceOverride: true,
        isFuture: false,
        snapshotGenerated: false
      }),
      "Half Day"
    );

    assert.equal(
      service.__private__.resolveAttendanceDisplayStatus({
        isHoliday: false,
        isWeekOff: false,
        isOnLeave: true,
        leaveType: "SICK",
        leaveDuration: "full_day",
        attendanceStatus: "present",
        hasAttendanceOverride: true,
        isFuture: false,
        snapshotGenerated: false
      }),
      "Present"
    );
  } finally {
    restore();
  }
});

test("approved half-day leave combines with corrected half-day attendance", async () => {
  const { service, restore } = loadTimesheetService({});

  try {
    assert.equal(
      service.__private__.resolveAttendanceDisplayStatus({
        isHoliday: false,
        isWeekOff: false,
        isOnLeave: true,
        leaveType: "SICK",
        leaveDuration: "half_day",
        attendanceStatus: "half_day_present",
        hasAttendanceOverride: true,
        isFuture: false,
        snapshotGenerated: false
      }),
      "Present + Leave"
    );
  } finally {
    restore();
  }
});
