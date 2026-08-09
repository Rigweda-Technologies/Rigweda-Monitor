const Expense = require("./expense.model");
const ExpenseVendor = require("./expenseVendor.model");
const Employee = require("../employees/employee.model");
const path = require("path");
const { audit } = require("../auditLogs/auditLogs.service");
const { uploadDataUri } = require("../../config/cloudinary");
const {
  dayStart,
  dayEnd,
  normalizeText,
  buildDuplicateExpenseQuery,
  ensureEditable,
  ensureDeletable,
  ensureActionable,
  applyAction,
  applySoftDelete,
  applyRestore
} = require("./expense.rules");

const ALLOWED_RECEIPT_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp"
]);
const ALLOWED_RECEIPT_EXT = new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp"]);
const MIME_BY_EXT = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

const getActorEmployeeId = async (req) => {
  const employee = await Employee.findOne({
    userId: req.user.userId,
    organizationId: req.user.organizationId
  }).select("_id");
  return employee?._id || null;
};

const resolveVendorPayload = async ({ organizationId, vendorId, vendorName }) => {
  if (vendorId) {
    const vendor = await ExpenseVendor.findOne({
      _id: vendorId,
      organizationId,
      isActive: true
    }).select("_id name nameKey");
    if (!vendor) {
      throw new Error("Vendor not found or inactive");
    }
    return {
      vendorId: vendor._id,
      vendor: vendor.name,
      vendorKey: vendor.nameKey
    };
  }

  const vendor = vendorName || "";
  return {
    vendorId: null,
    vendor,
    vendorKey: normalizeText(vendor)
  };
};

const parseReceiptInput = ({ fileName, fileData }) => {
  if (!fileName || !String(fileName).trim()) {
    throw new Error("File name is required");
  }
  if (!fileData || !String(fileData).trim()) {
    throw new Error("File data is required");
  }

  const rawData = String(fileData).trim();
  const dataUriMatch = rawData.match(/^data:([^;]+);base64,(.+)$/);
  const mimeType = dataUriMatch ? dataUriMatch[1].toLowerCase() : "";
  const base64 = dataUriMatch ? dataUriMatch[2] : rawData;
  const extension = path.extname(String(fileName).toLowerCase());

  if (!ALLOWED_RECEIPT_EXT.has(extension)) {
    throw new Error("Unsupported receipt file type");
  }
  if (mimeType && !ALLOWED_RECEIPT_MIME.has(mimeType)) {
    throw new Error("Unsupported receipt MIME type");
  }

  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length) {
    throw new Error("Invalid file data");
  }
  const maxBytes = 5 * 1024 * 1024;
  if (buffer.length > maxBytes) {
    throw new Error("Receipt file exceeds 5MB");
  }

  const normalizedMime = mimeType || MIME_BY_EXT[extension];
  if (!normalizedMime) {
    throw new Error("Unsupported receipt MIME type");
  }

  const normalizedDataUri = dataUriMatch
    ? `data:${normalizedMime};base64,${base64}`
    : `data:${normalizedMime};base64,${base64}`;

  return { extension, dataUri: normalizedDataUri };
};

exports.createExpense = async (req) => {
  const actorEmployeeId = await getActorEmployeeId(req);
  const vendorPayload = await resolveVendorPayload({
    organizationId: req.user.organizationId,
    vendorId: req.body.vendorId,
    vendorName: req.body.vendor || ""
  });
  const reimbursementMethod = req.body.reimbursementMethod || "none";
  const reimbursementAmount =
    req.body.reimbursementAmount !== undefined
      ? Number(req.body.reimbursementAmount || 0)
      : Number(req.body.amount || 0) + Number(req.body.taxAmount || 0);
  const purchasedBy =
    reimbursementMethod === "payroll"
      ? (req.body.purchasedBy || actorEmployeeId || null)
      : null;
  if (reimbursementMethod === "payroll" && !purchasedBy) {
    throw new Error("Purchased by employee is required for payroll reimbursement");
  }

  const payload = {
    organizationId: req.user.organizationId,
    category: req.body.category,
    title: req.body.title,
    titleKey: normalizeText(req.body.title),
    vendorId: vendorPayload.vendorId,
    vendor: vendorPayload.vendor,
    vendorKey: vendorPayload.vendorKey,
    expenseDate: dayStart(req.body.expenseDate),
    amount: Number(req.body.amount || 0),
    taxAmount: Number(req.body.taxAmount || 0),
    paymentMode: req.body.paymentMode || "bank_transfer",
    reimbursementMethod,
    purchasedBy,
    reimbursementStatus: reimbursementMethod === "payroll" ? "pending" : "not_applicable",
    reimbursementAmount: reimbursementMethod === "payroll" ? reimbursementAmount : 0,
    reimbursementPayrollMonth: req.body.reimbursementPayrollMonth || "",
    reimbursementNote: req.body.reimbursementNote || "",
    notes: req.body.notes || "",
    receiptUrl: req.body.receiptUrl || "",
    status: "pending",
    createdBy: actorEmployeeId,
    updatedBy: actorEmployeeId
  };

  const duplicate = await Expense.findOne(
    buildDuplicateExpenseQuery({
      organizationId: req.user.organizationId,
      title: payload.title,
      vendor: payload.vendor,
      expenseDate: payload.expenseDate,
      amount: payload.amount,
      taxAmount: payload.taxAmount
    })
  ).select("_id");
  if (duplicate) {
    throw new Error("Duplicate expense exists for same title/vendor/date/amount");
  }

  const expense = await Expense.create(payload);
  await audit({
    req,
    module: "expenses",
    action: "CREATE",
    entityId: expense._id,
    after: expense.toObject()
  });
  return expense;
};

exports.listExpenses = async (req) => {
  const query = {
    organizationId: req.user.organizationId,
    isDeleted: false
  };
  const includeDeleted = String(req.query.includeDeleted || "false") === "true";
  if (includeDeleted) {
    delete query.isDeleted;
  }

  if (req.query.category && req.query.category !== "all") {
    query.category = req.query.category;
  }
  if (req.query.status && req.query.status !== "all") {
    query.status = req.query.status;
  }
  if (req.query.startDate || req.query.endDate) {
    query.expenseDate = {};
    if (req.query.startDate) {
      query.expenseDate.$gte = dayStart(req.query.startDate);
    }
    if (req.query.endDate) {
      query.expenseDate.$lte = dayEnd(req.query.endDate);
    }
  }
  if (req.query.employeeId) {
    query.$or = [{ purchasedBy: req.query.employeeId }, { createdBy: req.query.employeeId }];
  }
  if (req.query.reimbursementStatus) {
    query.reimbursementStatus = req.query.reimbursementStatus;
  }

  const pageNum = Math.max(1, Number(req.query.page || 1));
  const limitNum = Math.min(200, Math.max(1, Number(req.query.limit || 100)));
  const skip = (pageNum - 1) * limitNum;
  const pageRequested = req.query.page !== undefined || req.query.limit !== undefined;
  const baseQuery = Expense.find(query)
    .populate("purchasedBy", "firstName lastName employeeCode")
    .populate("createdBy", "firstName lastName employeeCode")
    .populate("updatedBy", "firstName lastName employeeCode")
    .populate("actionBy", "firstName lastName employeeCode")
    .populate("deletedBy", "firstName lastName employeeCode")
    .populate("restoredBy", "firstName lastName employeeCode")
    .populate("reimbursedBy", "firstName lastName employeeCode")
    .populate("vendorId", "name isActive")
    .sort({ expenseDate: -1, createdAt: -1 })
    .lean();

  if (!pageRequested) {
    return baseQuery.skip(skip).limit(limitNum);
  }

  const [items, total] = await Promise.all([
    baseQuery.skip(skip).limit(limitNum),
    Expense.countDocuments(query)
  ]);

  return {
    items,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.max(1, Math.ceil(total / limitNum))
    }
  };
};

exports.getSummary = async (req) => {
  const query = {
    organizationId: req.user.organizationId,
    isDeleted: false
  };

  if (req.query.category && req.query.category !== "all") {
    query.category = req.query.category;
  }
  if (req.query.status && req.query.status !== "all") {
    query.status = req.query.status;
  }

  if (req.query.startDate || req.query.endDate) {
    query.expenseDate = {};
    if (req.query.startDate) {
      query.expenseDate.$gte = dayStart(req.query.startDate);
    }
    if (req.query.endDate) {
      query.expenseDate.$lte = dayEnd(req.query.endDate);
    }
  }
  if (req.query.employeeId) {
    query.$or = [{ purchasedBy: req.query.employeeId }, { createdBy: req.query.employeeId }];
  }
  if (req.query.reimbursementStatus) {
    query.reimbursementStatus = req.query.reimbursementStatus;
  }

  const [totals] = await Expense.aggregate([
    { $match: query },
    {
      $group: {
        _id: null,
        totalAmount: { $sum: "$amount" },
        totalTax: { $sum: "$taxAmount" },
        count: { $sum: 1 },
        netSpend: { $sum: { $add: ["$amount", "$taxAmount"] } }
      }
    }
  ]);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  const monthQuery = {
    organizationId: req.user.organizationId,
    isDeleted: false,
    expenseDate: {
      $gte: monthStart,
      $lte: monthEnd
    }
  };
  if (req.query.category && req.query.category !== "all") {
    monthQuery.category = req.query.category;
  }
  if (req.query.status && req.query.status !== "all") {
    monthQuery.status = req.query.status;
  }
  if (req.query.employeeId) {
    monthQuery.$or = [{ purchasedBy: req.query.employeeId }, { createdBy: req.query.employeeId }];
  }
  if (req.query.reimbursementStatus) {
    monthQuery.reimbursementStatus = req.query.reimbursementStatus;
  }

  const [thisMonth] = await Expense.aggregate([
    { $match: monthQuery },
    {
      $group: {
        _id: null,
        totalAmount: { $sum: "$amount" },
        totalTax: { $sum: "$taxAmount" },
        count: { $sum: 1 },
        netSpend: { $sum: { $add: ["$amount", "$taxAmount"] } }
      }
    }
  ]);

  const byCategory = await Expense.aggregate([
    { $match: query },
    {
      $group: {
        _id: "$category",
        totalAmount: { $sum: "$amount" },
        totalTax: { $sum: "$taxAmount" },
        count: { $sum: 1 }
      }
    },
    { $sort: { totalAmount: -1 } }
  ]);

  const byVendor = await Expense.aggregate([
    { $match: query },
    {
      $group: {
        _id: {
          vendorKey: { $ifNull: ["$vendorKey", ""] },
          vendor: { $ifNull: ["$vendor", ""] }
        },
        totalAmount: { $sum: "$amount" },
        totalTax: { $sum: "$taxAmount" },
        count: { $sum: 1 }
      }
    },
    {
      $project: {
        _id: 0,
        vendor: {
          $cond: [
            { $eq: ["$_id.vendorKey", ""] },
            "Unspecified",
            "$_id.vendor"
          ]
        },
        vendorKey: "$_id.vendorKey",
        totalAmount: 1,
        totalTax: 1,
        count: 1,
        netSpend: { $add: ["$totalAmount", "$totalTax"] }
      }
    },
    { $sort: { netSpend: -1, vendor: 1 } }
  ]);

  return {
    totals: totals || { totalAmount: 0, totalTax: 0, count: 0, netSpend: 0 },
    thisMonth: thisMonth || { totalAmount: 0, totalTax: 0, count: 0, netSpend: 0 },
    byCategory: byCategory.map((row) => ({
      category: row._id,
      totalAmount: row.totalAmount,
      totalTax: row.totalTax,
      count: row.count
    })),
    byVendor
  };
};

exports.updateExpense = async (req) => {
  const existing = await Expense.findOne({
    _id: req.params.id,
    organizationId: req.user.organizationId,
    isDeleted: false
  });
  if (!existing) throw new Error("Expense not found");

  const actorEmployeeId = await getActorEmployeeId(req);
  const before = existing.toObject();
  ensureEditable(existing);

  const hasVendorPayload = req.body.vendorId !== undefined || req.body.vendor !== undefined;
  const vendorPayload = hasVendorPayload
    ? await resolveVendorPayload({
      organizationId: req.user.organizationId,
      vendorId: req.body.vendorId,
      vendorName: req.body.vendor
    })
    : {
      vendorId: existing.vendorId || null,
      vendor: existing.vendor || "",
      vendorKey: normalizeText(existing.vendor || "")
    };

  const nextTitle = req.body.title !== undefined ? req.body.title : existing.title;
  const nextVendor = vendorPayload.vendor;
  const nextDate = req.body.expenseDate !== undefined ? req.body.expenseDate : existing.expenseDate;
  const nextAmount = req.body.amount !== undefined ? Number(req.body.amount || 0) : Number(existing.amount || 0);
  const nextTax = req.body.taxAmount !== undefined ? Number(req.body.taxAmount || 0) : Number(existing.taxAmount || 0);

  const duplicate = await Expense.findOne(
    buildDuplicateExpenseQuery({
      organizationId: req.user.organizationId,
      title: nextTitle,
      vendor: nextVendor,
      expenseDate: nextDate,
      amount: nextAmount,
      taxAmount: nextTax,
      excludeId: existing._id
    })
  ).select("_id");
  if (duplicate) {
    throw new Error("Duplicate expense exists for same title/vendor/date/amount");
  }

  if (req.body.category !== undefined) existing.category = req.body.category;
  if (req.body.title !== undefined) existing.title = req.body.title;
  if (req.body.title !== undefined) existing.titleKey = normalizeText(req.body.title);
  if (hasVendorPayload) existing.vendorId = vendorPayload.vendorId;
  if (hasVendorPayload) existing.vendor = vendorPayload.vendor;
  if (hasVendorPayload) existing.vendorKey = vendorPayload.vendorKey;
  if (req.body.expenseDate !== undefined) existing.expenseDate = dayStart(req.body.expenseDate);
  if (req.body.amount !== undefined) existing.amount = Number(req.body.amount || 0);
  if (req.body.taxAmount !== undefined) existing.taxAmount = Number(req.body.taxAmount || 0);
  if (req.body.paymentMode !== undefined) existing.paymentMode = req.body.paymentMode;
  if (req.body.reimbursementMethod !== undefined) {
    existing.reimbursementMethod = req.body.reimbursementMethod;
  }
  if (req.body.purchasedBy !== undefined) {
    existing.purchasedBy = req.body.purchasedBy || null;
  }
  if (req.body.reimbursementAmount !== undefined) {
    existing.reimbursementAmount = Number(req.body.reimbursementAmount || 0);
  }
  if (req.body.reimbursementPayrollMonth !== undefined) {
    existing.reimbursementPayrollMonth = req.body.reimbursementPayrollMonth || "";
  }
  if (req.body.reimbursementNote !== undefined) {
    existing.reimbursementNote = req.body.reimbursementNote || "";
  }
  if (req.body.notes !== undefined) existing.notes = req.body.notes || "";
  if (req.body.receiptUrl !== undefined) existing.receiptUrl = req.body.receiptUrl || "";

  if (existing.reimbursementMethod === "payroll") {
    if (!existing.purchasedBy) {
      existing.purchasedBy = actorEmployeeId || null;
    }
    existing.reimbursementStatus =
      existing.reimbursementStatus === "not_applicable" ? "pending" : existing.reimbursementStatus;
    if (!Number(existing.reimbursementAmount || 0)) {
      existing.reimbursementAmount = Number(existing.amount || 0) + Number(existing.taxAmount || 0);
    }
  } else {
    existing.purchasedBy = null;
    existing.reimbursementStatus = "not_applicable";
    existing.reimbursementAmount = 0;
    existing.reimbursementPayrollMonth = "";
    existing.reimbursementNote = "";
    existing.reimbursedBy = null;
    existing.reimbursedAt = null;
  }
  existing.updatedBy = actorEmployeeId;

  await existing.save();
  await audit({
    req,
    module: "expenses",
    action: "UPDATE",
    entityId: existing._id,
    before,
    after: existing.toObject()
  });
  return existing;
};

exports.removeExpense = async (req) => {
  const expense = await Expense.findOne({
    _id: req.params.id,
    organizationId: req.user.organizationId
  });
  if (!expense) throw new Error("Expense not found");
  ensureDeletable(expense);
  const actorEmployeeId = await getActorEmployeeId(req);
  const afterSoftDelete = applySoftDelete({
    expense: expense.toObject(),
    actorEmployeeId
  });
  expense.isDeleted = true;
  expense.deletedAt = afterSoftDelete.deletedAt;
  expense.deletedBy = actorEmployeeId;
  await expense.save();

  await audit({
    req,
    module: "expenses",
    action: "DELETE",
    entityId: expense._id,
    before: expense.toObject()
  });
  return expense;
};

exports.listExpenseEmployees = async (req) => {
  return Employee.find({
    organizationId: req.user.organizationId,
    isDeleted: false
  })
    .select("firstName lastName employeeCode")
    .sort({ firstName: 1, lastName: 1 });
};

exports.updateReimbursement = async (req) => {
  const expense = await Expense.findOne({
    _id: req.params.id,
    organizationId: req.user.organizationId,
    isDeleted: false
  });
  if (!expense) throw new Error("Expense not found");

  const actorEmployeeId = await getActorEmployeeId(req);
  const before = expense.toObject();

  if (expense.reimbursementMethod !== "payroll") {
    throw new Error("This expense is not marked for payroll reimbursement");
  }
  if (!expense.purchasedBy) {
    throw new Error("Purchased by employee is required");
  }

  const nextStatus = req.body.reimbursementStatus;
  expense.reimbursementStatus = nextStatus;
  if (req.body.reimbursementPayrollMonth !== undefined) {
    expense.reimbursementPayrollMonth = req.body.reimbursementPayrollMonth || "";
  }
  if (req.body.reimbursementNote !== undefined) {
    expense.reimbursementNote = req.body.reimbursementNote || "";
  }
  if (nextStatus === "paid") {
    expense.reimbursedBy = actorEmployeeId;
    expense.reimbursedAt = new Date();
  }
  expense.updatedBy = actorEmployeeId;
  await expense.save();

  await audit({
    req,
    module: "expenses",
    action: "REIMBURSEMENT_UPDATE",
    entityId: expense._id,
    before,
    after: expense.toObject()
  });

  return expense;
};

exports.restoreExpense = async (req) => {
  const expense = await Expense.findOne({
    _id: req.params.id,
    organizationId: req.user.organizationId
  });
  if (!expense) throw new Error("Expense not found");
  const actorEmployeeId = await getActorEmployeeId(req);
  const before = expense.toObject();
  const afterRestore = applyRestore({
    expense: expense.toObject(),
    actorEmployeeId
  });

  const duplicate = await Expense.findOne(
    buildDuplicateExpenseQuery({
      organizationId: req.user.organizationId,
      title: expense.title,
      vendor: expense.vendor,
      expenseDate: expense.expenseDate,
      amount: expense.amount,
      taxAmount: expense.taxAmount,
      excludeId: expense._id
    })
  ).select("_id");
  if (duplicate) {
    throw new Error("Cannot restore due to active duplicate expense");
  }

  expense.isDeleted = false;
  expense.deletedAt = null;
  expense.deletedBy = null;
  expense.restoredAt = afterRestore.restoredAt;
  expense.restoredBy = actorEmployeeId;
  await expense.save();

  await audit({
    req,
    module: "expenses",
    action: "RESTORE",
    entityId: expense._id,
    before,
    after: expense.toObject()
  });
  return expense;
};

exports.actionExpense = async (req) => {
  const expense = await Expense.findOne({
    _id: req.params.id,
    organizationId: req.user.organizationId,
    isDeleted: false
  });
  if (!expense) throw new Error("Expense not found");
  ensureActionable(expense);

  const actorEmployeeId = await getActorEmployeeId(req);
  const before = expense.toObject();

  const next = applyAction({
    expense: expense.toObject(),
    status: req.body.status,
    rejectionReason: req.body.rejectionReason,
    actorEmployeeId
  });

  expense.status = next.status;
  expense.rejectionReason = next.rejectionReason;
  expense.actionBy = next.actionBy;
  expense.actionAt = next.actionAt;
  expense.updatedBy = next.updatedBy;
  await expense.save();

  await audit({
    req,
    module: "expenses",
    action: "ACTION",
    entityId: expense._id,
    before,
    after: expense.toObject()
  });

  return expense;
};

exports.uploadReceipt = async (req) => {
  const { fileName, fileData } = req.body || {};
  const { extension, dataUri } = parseReceiptInput({ fileName, fileData });
  const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const folder = `upanaya/${req.user.organizationId}/expenses/receipts`;
  const uploadResult = await uploadDataUri(dataUri, {
    folder,
    public_id: `receipt-${uniqueName}`,
    resource_type: extension === ".pdf" ? "raw" : "image"
  });

  return {
    fileName: uploadResult?.public_id || `receipt-${uniqueName}`,
    receiptUrl: uploadResult?.secure_url || ""
  };
};

exports.listVendors = async (req) => {
  return ExpenseVendor.find({
    organizationId: req.user.organizationId
  })
    .populate("createdBy", "firstName lastName employeeCode")
    .populate("updatedBy", "firstName lastName employeeCode")
    .sort({ isActive: -1, name: 1 });
};

exports.createVendor = async (req) => {
  const actorEmployeeId = await getActorEmployeeId(req);
  const name = String(req.body.name || "").trim();
  const nameKey = normalizeText(name);
  const existing = await ExpenseVendor.findOne({
    organizationId: req.user.organizationId,
    nameKey
  }).select("_id");
  if (existing) {
    throw new Error("Vendor with same name already exists");
  }

  const vendor = await ExpenseVendor.create({
    organizationId: req.user.organizationId,
    name,
    nameKey,
    isActive: req.body.isActive !== undefined ? Boolean(req.body.isActive) : true,
    createdBy: actorEmployeeId,
    updatedBy: actorEmployeeId
  });

  await audit({
    req,
    module: "expense_vendors",
    action: "CREATE",
    entityId: vendor._id,
    after: vendor.toObject()
  });
  return vendor;
};

exports.updateVendor = async (req) => {
  const vendor = await ExpenseVendor.findOne({
    _id: req.params.vendorId,
    organizationId: req.user.organizationId
  });
  if (!vendor) throw new Error("Vendor not found");

  const actorEmployeeId = await getActorEmployeeId(req);
  const before = vendor.toObject();
  const nextName = req.body.name !== undefined ? String(req.body.name || "").trim() : vendor.name;
  const nextNameKey = normalizeText(nextName);

  if (!nextName) {
    throw new Error("Vendor name is required");
  }

  const duplicate = await ExpenseVendor.findOne({
    organizationId: req.user.organizationId,
    nameKey: nextNameKey,
    _id: { $ne: vendor._id }
  }).select("_id");
  if (duplicate) {
    throw new Error("Vendor with same name already exists");
  }

  vendor.name = nextName;
  vendor.nameKey = nextNameKey;
  if (req.body.isActive !== undefined) {
    vendor.isActive = Boolean(req.body.isActive);
  }
  vendor.updatedBy = actorEmployeeId;
  await vendor.save();

  // Keep expense text in sync for vendor-based analytics and duplicate checks.
  if (before.name !== vendor.name) {
    await Expense.updateMany(
      {
        organizationId: req.user.organizationId,
        vendorId: vendor._id
      },
      {
        $set: {
          vendor: vendor.name,
          vendorKey: vendor.nameKey
        }
      }
    );
  }

  await audit({
    req,
    module: "expense_vendors",
    action: "UPDATE",
    entityId: vendor._id,
    before,
    after: vendor.toObject()
  });

  return vendor;
};

exports.removeVendor = async (req) => {
  const vendor = await ExpenseVendor.findOne({
    _id: req.params.vendorId,
    organizationId: req.user.organizationId
  });
  if (!vendor) throw new Error("Vendor not found");

  const activeExpense = await Expense.findOne({
    organizationId: req.user.organizationId,
    isDeleted: false,
    $or: [{ vendorId: vendor._id }, { vendorKey: vendor.nameKey }]
  }).select("_id");
  if (activeExpense) {
    throw new Error("Vendor is used in expenses and cannot be deleted");
  }

  await vendor.deleteOne();
  await audit({
    req,
    module: "expense_vendors",
    action: "DELETE",
    entityId: vendor._id,
    before: vendor.toObject()
  });

  return { _id: vendor._id };
};
