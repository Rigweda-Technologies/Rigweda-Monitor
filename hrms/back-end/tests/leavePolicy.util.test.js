const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getApplicableLeaveDateKeys,
  analyzeLeaveDateKeys
} = require("../src/modules/leaves/leavePolicy.util");

test("sandwich-disabled excludes weekends from long leave ranges", () => {
  const applicable = getApplicableLeaveDateKeys({
    fromDate: "2026-06-01",
    toDate: "2026-06-20",
    weekOffDays: [0, 6],
    holidaySet: new Set(),
    sandwichRuleEnabled: false,
    timeZone: "Asia/Kolkata"
  });

  assert.equal(applicable.length, 15);
  assert.equal(applicable.includes("2026-06-06"), false);
  assert.equal(applicable.includes("2026-06-20"), false);
});

test("sandwich-enabled deducts only internal non-working blocks with leave siblings on both sides", () => {
  const applicable = getApplicableLeaveDateKeys({
    fromDate: "2026-06-05",
    toDate: "2026-06-09",
    weekOffDays: [0, 6],
    holidaySet: new Set(),
    sandwichRuleEnabled: true,
    timeZone: "Asia/Kolkata"
  });

  assert.deepEqual(applicable, [
    "2026-06-05",
    "2026-06-06",
    "2026-06-07",
    "2026-06-08",
    "2026-06-09"
  ]);
});

test("sandwich-enabled does not deduct when non-working days have leave on only one sibling side", () => {
  const applicable = getApplicableLeaveDateKeys({
    fromDate: "2026-06-05",
    toDate: "2026-06-07",
    weekOffDays: [0, 6],
    holidaySet: new Set(),
    sandwichRuleEnabled: true,
    timeZone: "Asia/Kolkata"
  });

  assert.deepEqual(applicable, ["2026-06-05"]);
});

test("analysis classifies deducted sandwich holidays and week offs separately", () => {
  const analysis = analyzeLeaveDateKeys({
    fromDate: "2026-06-11",
    toDate: "2026-06-15",
    weekOffDays: [0, 6],
    holidaySet: new Set(["2026-06-12"]),
    effectiveDateKeys: ["2026-06-11", "2026-06-12", "2026-06-13", "2026-06-14", "2026-06-15"],
    sandwichRuleEnabled: false,
    timeZone: "Asia/Kolkata"
  });

  assert.deepEqual(analysis.sandwichHolidayDateKeys, ["2026-06-12"]);
  assert.deepEqual(analysis.sandwichWeekOffDateKeys, ["2026-06-13", "2026-06-14"]);
  assert.deepEqual(analysis.workingDateKeys, ["2026-06-11", "2026-06-15"]);
});
