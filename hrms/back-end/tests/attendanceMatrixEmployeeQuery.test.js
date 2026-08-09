const test = require("node:test");
const assert = require("node:assert/strict");

const { __private__ } = require("../src/modules/timesheets/timesheet.service");

test("attendance matrix includes resigned employees through their last working month", () => {
  const organizationId = "org-1";
  const aprilStart = new Date("2026-03-31T18:30:00.000Z");

  const query = __private__.buildAttendanceMatrixEmployeeQuery({
    organizationId,
    monthStart: aprilStart
  });

  assert.equal(query.organizationId, organizationId);
  assert.deepEqual(query.$and[0], {
    $or: [
      { status: "active" },
      {
        status: "resigned",
        lastWorkingDay: { $ne: null, $gte: aprilStart }
      }
    ]
  });
});

test("attendance matrix preserves search and employee scope with lifecycle filtering", () => {
  const scopedEmployeeIds = ["employee-1"];
  const query = __private__.buildAttendanceMatrixEmployeeQuery({
    organizationId: "org-1",
    monthStart: new Date("2026-04-30T18:30:00.000Z"),
    scopedEmployeeIds,
    search: "EMP001"
  });

  assert.deepEqual(query._id, { $in: scopedEmployeeIds });
  assert.equal(query.$and.length, 2);
  assert.equal(query.$and[1].$or.length, 3);
  assert.ok(query.$and[1].$or[2].employeeCode instanceof RegExp);
});
