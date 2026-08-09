const normalizeText = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const dayStart = (value) => {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
};

const dayEnd = (value) => {
  const d = new Date(value);
  d.setHours(23, 59, 59, 999);
  return d;
};

const ensurePendingAndActive = (expense, operationLabel) => {
  if (!expense) throw new Error("Expense not found");
  if (expense.isDeleted) throw new Error("Expense is deleted");
  if (expense.status !== "pending") {
    throw new Error(`Only pending expenses can be ${operationLabel}`);
  }
};

exports.normalizeText = normalizeText;
exports.dayStart = dayStart;
exports.dayEnd = dayEnd;

exports.buildDuplicateExpenseQuery = ({
  organizationId,
  title,
  vendor,
  expenseDate,
  amount,
  taxAmount,
  excludeId = null
}) => {
  const query = {
    organizationId,
    isDeleted: false,
    titleKey: normalizeText(title),
    vendorKey: normalizeText(vendor),
    amount: Number(amount || 0),
    taxAmount: Number(taxAmount || 0),
    expenseDate: {
      $gte: dayStart(expenseDate),
      $lte: dayEnd(expenseDate)
    }
  };
  if (excludeId) {
    query._id = { $ne: excludeId };
  }
  return query;
};

exports.ensureEditable = (expense) => ensurePendingAndActive(expense, "edited");
exports.ensureDeletable = (expense) => ensurePendingAndActive(expense, "deleted");
exports.ensureActionable = (expense) => ensurePendingAndActive(expense, "actioned");

exports.applyAction = ({ expense, status, rejectionReason, actorEmployeeId, now = new Date() }) => {
  const clone = { ...expense };
  clone.status = status;
  clone.rejectionReason = status === "rejected" ? rejectionReason || "" : "";
  clone.actionBy = actorEmployeeId || null;
  clone.actionAt = now;
  clone.updatedBy = actorEmployeeId || null;
  return clone;
};

exports.applySoftDelete = ({ expense, actorEmployeeId, now = new Date() }) => {
  if (expense.isDeleted) throw new Error("Expense already deleted");
  const clone = { ...expense };
  clone.isDeleted = true;
  clone.deletedAt = now;
  clone.deletedBy = actorEmployeeId || null;
  return clone;
};

exports.applyRestore = ({ expense, actorEmployeeId, now = new Date() }) => {
  if (!expense.isDeleted) throw new Error("Expense is not deleted");
  const clone = { ...expense };
  clone.isDeleted = false;
  clone.deletedAt = null;
  clone.deletedBy = null;
  clone.restoredAt = now;
  clone.restoredBy = actorEmployeeId || null;
  return clone;
};
