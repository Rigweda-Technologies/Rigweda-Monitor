const test = require("node:test");
const assert = require("node:assert/strict");

const { __test__ } = require("../src/modules/payroll/payrollAttendance.service");

const {
  buildDateKeys,
  buildAttendanceMap,
  buildHolidayMap,
  buildLeaveIndex,
  buildWeekOffResolver,
  normalizeSnapshotDayStatus,
  resolveAttendanceMinutes
} = __test__;

test("buildDateKeys returns full inclusive range", () => {
  const keys = buildDateKeys("2026-02-01", "2026-02-04");
  assert.deepEqual(keys, ["2026-02-01", "2026-02-02", "2026-02-03", "2026-02-04"]);
});

test("attendance and holiday maps are keyed by employee/date and date", () => {
  const timeZone = "Asia/Kolkata";
  const attendanceRows = [
    {
      _id: "a1",
      employeeId: "emp1",
      date: new Date("2026-02-04T09:00:00.000Z"),
      totalMinutes: 0,
      checkInAt: new Date("2026-02-04T03:30:00.000Z"),
      checkOutAt: new Date("2026-02-04T12:00:00.000Z")
    }
  ];
  const holidayRows = [{ _id: "h1", date: new Date("2026-02-05T00:00:00.000Z") }];

  const attendanceMap = buildAttendanceMap(attendanceRows, timeZone);
  const holidayMap = buildHolidayMap(holidayRows, timeZone);

  assert.equal(attendanceMap.has("emp1:2026-02-04"), true);
  assert.equal(attendanceMap.get("emp1:2026-02-04").totalMinutes, 510);
  assert.equal(holidayMap.has("2026-02-05"), true);
});

test("resolveAttendanceMinutes falls back to punch timestamps", () => {
  assert.equal(
    resolveAttendanceMinutes({
      totalMinutes: 0,
      checkInAt: new Date("2026-02-04T03:30:00.000Z"),
      checkOutAt: new Date("2026-02-04T12:00:00.000Z")
    }),
    510
  );
});

test("buildLeaveIndex marks paid and unpaid leaves correctly", () => {
  const leaveTypeCodeById = new Map([
    ["lt-paid", "CL"],
    ["lt-unpaid", "LOP"]
  ]);
  const leaveTypePayrollPayableById = new Map([
    ["lt-paid", true],
    ["lt-unpaid", false]
  ]);

  const leaveRows = [
    {
      _id: "leave-paid",
      employeeId: "emp1",
      leaveTypeId: "lt-paid",
      duration: "full_day",
      fromDate: new Date("2026-02-10T00:00:00.000Z"),
      toDate: new Date("2026-02-10T00:00:00.000Z")
    },
    {
      _id: "leave-unpaid-half",
      employeeId: "emp1",
      leaveTypeId: "lt-unpaid",
      duration: "half_day",
      fromDate: new Date("2026-02-11T00:00:00.000Z"),
      toDate: new Date("2026-02-11T00:00:00.000Z")
    }
  ];

  const leaveMap = buildLeaveIndex({
    rows: leaveRows,
    leaveTypeCodeById,
    leaveTypePayrollPayableById,
    unpaidCodes: new Set(["LOP"]),
    hasRequestUnpaidCodes: false,
    timeZone: "Asia/Kolkata",
    holidayKeySet: new Set(),
    weekOffDays: ["sunday"]
  });

  const paid = leaveMap.get("2026-02-10");
  const unpaidHalf = leaveMap.get("2026-02-11");

  assert.equal(paid.isPaid, true);
  assert.equal(paid.units, 1);
  assert.equal(unpaidHalf.isPaid, false);
  assert.equal(unpaidHalf.units, 0.5);
});

test("buildLeaveIndex pays configured payroll leave even when code normally means unpaid", () => {
  const leaveMap = buildLeaveIndex({
    rows: [
      {
        _id: "leave-paid-lop",
        employeeId: "emp1",
        leaveTypeId: "lt-lop",
        duration: "full_day",
        fromDate: new Date("2026-02-12T00:00:00.000Z"),
        toDate: new Date("2026-02-12T00:00:00.000Z")
      }
    ],
    leaveTypeCodeById: new Map([["lt-lop", "LOP"]]),
    leaveTypePayrollPayableById: new Map([["lt-lop", true]]),
    unpaidCodes: new Set(["LOP"]),
    hasRequestUnpaidCodes: false,
    timeZone: "Asia/Kolkata",
    holidayKeySet: new Set(),
    weekOffDays: ["sunday"]
  });

  assert.equal(leaveMap.get("2026-02-12").isPaid, true);
});

test("buildLeaveIndex treats payroll-disabled leave type as unpaid by code or name fallback", () => {
  const leaveMap = buildLeaveIndex({
    rows: [
      {
        _id: "leave-sick",
        employeeId: "emp1",
        leaveType: "Sick Leaves",
        duration: "full_day",
        fromDate: new Date("2026-02-13T00:00:00.000Z"),
        toDate: new Date("2026-02-13T00:00:00.000Z")
      }
    ],
    leaveTypeCodeById: new Map(),
    leaveTypeCodeByName: new Map([["SICK LEAVES", "SLS"]]),
    leaveTypePayrollPayableById: new Map(),
    leaveTypePayrollPayableByCode: new Map([["SLS", false]]),
    leaveTypePayrollPayableByName: new Map([["SICK LEAVES", false]]),
    unpaidCodes: new Set(["LOP"]),
    hasRequestUnpaidCodes: false,
    timeZone: "Asia/Kolkata",
    holidayKeySet: new Set(),
    weekOffDays: ["sunday"]
  });

  assert.equal(leaveMap.get("2026-02-13").isPaid, false);
  assert.equal(leaveMap.get("2026-02-13").leaveTypeCode, "SLS");
});

test("buildWeekOffResolver prefers shift-specific list and falls back to default", () => {
  const resolveWeekOffDays = buildWeekOffResolver([
    { shiftId: null, weekOffDays: ["sunday"] },
    { shiftId: "shift-a", weekOffDays: ["saturday", "sunday"] }
  ]);

  assert.deepEqual(resolveWeekOffDays("shift-a"), ["saturday", "sunday"]);
  assert.deepEqual(resolveWeekOffDays("shift-b"), ["sunday"]);
  assert.deepEqual(resolveWeekOffDays(null), ["sunday"]);
});

test("normalizeSnapshotDayStatus maps hybrid leave statuses to allowed snapshot values", () => {
  assert.equal(normalizeSnapshotDayStatus("present_paid_leave_half"), "paid_leave_half");
  assert.equal(normalizeSnapshotDayStatus("present_unpaid_leave_half"), "unpaid_leave_half");
  assert.equal(normalizeSnapshotDayStatus("paid_leave_half"), "paid_leave_half");
});
