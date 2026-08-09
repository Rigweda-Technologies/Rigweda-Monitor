const test = require("node:test");
const assert = require("node:assert/strict");

const { __private__ } = require("../src/modules/timesheets/timesheet.service");

test("online attendance query uses indexed date keys and optional employee scoping", () => {
  const query = __private__.buildOnlineAttendanceQuery({
    organizationId: "org-1",
    todayKey: "2026-06-13",
    yesterdayKey: "2026-06-12",
    now: new Date("2026-06-13T10:00:00.000Z"),
    scopedEmployeeIds: ["employee-1", "employee-2"]
  });

  assert.deepEqual(query.organizationId, "org-1");
  assert.deepEqual(query.dateKey, { $gte: "2026-06-12", $lte: "2026-06-13" });
  assert.deepEqual(query.employeeId, { $in: ["employee-1", "employee-2"] });
  assert.deepEqual(query.checkInAt.$lte, new Date("2026-06-13T10:00:00.000Z"));
});

test("online attendance rows are filtered by current shift window", () => {
  const now = new Date("2026-06-13T10:00:00.000Z");
  const visibleRows = [
    {
      dateKey: "2026-06-13",
      date: new Date("2026-06-13T00:00:00.000Z"),
      scheduledEndAt: null
    },
    {
      dateKey: "2026-06-12",
      date: new Date("2026-06-12T00:00:00.000Z"),
      scheduledEndAt: new Date("2026-06-13T12:00:00.000Z")
    }
  ];
  const hiddenRows = [
    {
      dateKey: "2026-06-12",
      date: new Date("2026-06-12T00:00:00.000Z"),
      scheduledEndAt: new Date("2026-06-13T09:00:00.000Z")
    },
    {
      dateKey: "2026-06-11",
      date: new Date("2026-06-11T00:00:00.000Z"),
      scheduledEndAt: new Date("2026-06-13T12:00:00.000Z")
    }
  ];

  const filtered = [...visibleRows, ...hiddenRows].filter((row) =>
    __private__.isOnlineAttendanceRowVisible(row, {
      now,
      timeZone: "UTC",
      todayKey: "2026-06-13",
      yesterdayKey: "2026-06-12"
    })
  );

  assert.equal(filtered.length, 2);
  assert.equal(filtered[0].dateKey, "2026-06-13");
  assert.equal(filtered[1].dateKey, "2026-06-12");
});
