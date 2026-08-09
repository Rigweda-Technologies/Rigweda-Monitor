const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildDuplicateExpenseQuery,
  ensureEditable,
  ensureDeletable,
  ensureActionable,
  applyAction,
  applySoftDelete,
  applyRestore
} = require("../src/modules/expenses/expense.rules");

const baseExpense = () => ({
  _id: "exp-1",
  organizationId: "org-1",
  title: "Office Rent",
  vendor: "ABC Estates",
  expenseDate: new Date("2026-03-05T10:00:00.000Z"),
  amount: 50000,
  taxAmount: 9000,
  status: "pending",
  isDeleted: false
});

test("duplicate query normalizes title/vendor and day range", () => {
  const query = buildDuplicateExpenseQuery({
    organizationId: "org-1",
    title: "  Office Rent ",
    vendor: " abc estates ",
    expenseDate: "2026-03-05T14:34:00.000Z",
    amount: 50000,
    taxAmount: 9000
  });

  assert.equal(query.organizationId, "org-1");
  assert.equal(query.titleKey, "office rent");
  assert.equal(query.vendorKey, "abc estates");
  assert.equal(query.amount, 50000);
  assert.equal(query.taxAmount, 9000);
  assert.ok(query.expenseDate.$gte instanceof Date);
  assert.ok(query.expenseDate.$lte instanceof Date);
});

test("pending expense is editable/deletable/actionable", () => {
  const expense = baseExpense();
  assert.doesNotThrow(() => ensureEditable(expense));
  assert.doesNotThrow(() => ensureDeletable(expense));
  assert.doesNotThrow(() => ensureActionable(expense));
});

test("approved expense cannot be edited or deleted", () => {
  const expense = { ...baseExpense(), status: "approved" };
  assert.throws(() => ensureEditable(expense), /Only pending expenses can be edited/);
  assert.throws(() => ensureDeletable(expense), /Only pending expenses can be deleted/);
});

test("apply action approve sets final fields", () => {
  const now = new Date("2026-03-10T10:00:00.000Z");
  const updated = applyAction({
    expense: baseExpense(),
    status: "approved",
    rejectionReason: "",
    actorEmployeeId: "emp-1",
    now
  });

  assert.equal(updated.status, "approved");
  assert.equal(updated.rejectionReason, "");
  assert.equal(updated.actionBy, "emp-1");
  assert.equal(updated.actionAt, now);
});

test("apply action reject keeps rejection reason", () => {
  const updated = applyAction({
    expense: baseExpense(),
    status: "rejected",
    rejectionReason: "Invalid bill",
    actorEmployeeId: "emp-2",
    now: new Date("2026-03-10T11:00:00.000Z")
  });

  assert.equal(updated.status, "rejected");
  assert.equal(updated.rejectionReason, "Invalid bill");
});

test("soft delete and restore transition", () => {
  const deleted = applySoftDelete({
    expense: baseExpense(),
    actorEmployeeId: "emp-3",
    now: new Date("2026-03-11T10:00:00.000Z")
  });
  assert.equal(deleted.isDeleted, true);
  assert.equal(deleted.deletedBy, "emp-3");
  assert.ok(deleted.deletedAt instanceof Date);

  const restored = applyRestore({
    expense: deleted,
    actorEmployeeId: "emp-4",
    now: new Date("2026-03-12T10:00:00.000Z")
  });
  assert.equal(restored.isDeleted, false);
  assert.equal(restored.deletedBy, null);
  assert.equal(restored.deletedAt, null);
  assert.equal(restored.restoredBy, "emp-4");
  assert.ok(restored.restoredAt instanceof Date);
});
