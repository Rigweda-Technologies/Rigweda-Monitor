const test = require("node:test");
const assert = require("node:assert/strict");

const { __test__ } = require("../src/modules/payroll/payrollApi.service");

test("salary revisions stay editable until their effective-to date passes", () => {
  const currentDate = new Date("2026-06-30T00:00:00.000Z");

  assert.equal(
    __test__.isRevisionEditableByDate("2026-06-30", currentDate),
    true
  );
  assert.equal(
    __test__.isRevisionEditableByDate("2026-06-29", currentDate),
    false
  );
  assert.equal(
    __test__.isRevisionEditableByDate(null, currentDate),
    true
  );
});
