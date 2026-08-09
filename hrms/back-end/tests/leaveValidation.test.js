const test = require("node:test");
const assert = require("node:assert/strict");

const { applyLeaveSchema } = require("../src/modules/leaves/leave.validation");

const validPayload = {
  leaveTypeId: "507f1f77bcf86cd799439011",
  fromDate: "2026-03-10",
  toDate: "2026-03-10",
  duration: "full_day"
};

test("applyLeaveSchema accepts valid textual reason", () => {
  const { error } = applyLeaveSchema.validate({
    ...validPayload,
    reason: "Medical appointment"
  });

  assert.equal(error, undefined);
});

test("applyLeaveSchema rejects numeric-only reason", () => {
  const { error } = applyLeaveSchema.validate({
    ...validPayload,
    reason: "123456"
  });

  assert.ok(error);
});

test("applyLeaveSchema rejects symbol-heavy invalid reason", () => {
  const { error } = applyLeaveSchema.validate({
    ...validPayload,
    reason: "@@@###"
  });

  assert.ok(error);
});
