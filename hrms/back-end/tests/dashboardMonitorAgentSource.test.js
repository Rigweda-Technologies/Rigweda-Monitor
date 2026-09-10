const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("compact employee dashboard source includes userId for monitor agent matching", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/modules/employees/employee.service.js"),
    "utf8"
  );

  assert.match(
    source,
    /\.select\("_id firstName lastName employeeCode userId dateOfJoining status employmentLifecycleStatus departmentId designationId shiftId"\)/,
    "compact employee queries must include userId so dashboard monitor-agent rows can map to HRMS employees"
  );
});
