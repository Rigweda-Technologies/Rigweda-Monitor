const service = require("./expense.service");
const { buildSuccessResponse } = require("../../utils/responseBuilder");
const {
  withCache,
  buildRequestCacheKey,
  invalidateCacheNamespace
} = require("../../utils/cache");

const EXPENSE_LIST_NAMESPACE = "expenses:list";
const EXPENSE_SUMMARY_NAMESPACE = "expenses:summary";
const EXPENSE_VENDOR_NAMESPACE = "expenses:vendors";

const invalidateExpenseCaches = async () => {
  await Promise.all([
    invalidateCacheNamespace(EXPENSE_LIST_NAMESPACE),
    invalidateCacheNamespace(EXPENSE_SUMMARY_NAMESPACE),
    invalidateCacheNamespace(EXPENSE_VENDOR_NAMESPACE)
  ]);
};

exports.create = async (req, res) => {
  const data = await service.createExpense(req);
  await invalidateExpenseCaches();
  res.status(201).json(buildSuccessResponse({ message: "Expense created", data }));
};

exports.list = async (req, res) => {
  const key = buildRequestCacheKey(req);
  const data = await withCache({
    namespace: EXPENSE_LIST_NAMESPACE,
    key,
    ttlSeconds: Number(process.env.CACHE_TTL_EXPENSE_LIST || 60),
    producer: () => service.listExpenses(req)
  });
  res.status(200).json(buildSuccessResponse({ data }));
};

exports.summary = async (req, res) => {
  const key = buildRequestCacheKey(req);
  const data = await withCache({
    namespace: EXPENSE_SUMMARY_NAMESPACE,
    key,
    ttlSeconds: Number(process.env.CACHE_TTL_EXPENSE_SUMMARY || 120),
    producer: () => service.getSummary(req)
  });
  res.status(200).json(buildSuccessResponse({ data }));
};

exports.listEmployees = async (req, res) => {
  const data = await service.listExpenseEmployees(req);
  res.status(200).json(buildSuccessResponse({ data }));
};

exports.update = async (req, res) => {
  const data = await service.updateExpense(req);
  await invalidateExpenseCaches();
  res.status(200).json(buildSuccessResponse({ message: "Expense updated", data }));
};

exports.remove = async (req, res) => {
  const data = await service.removeExpense(req);
  await invalidateExpenseCaches();
  res.status(200).json(buildSuccessResponse({ message: "Expense deleted", data }));
};

exports.restore = async (req, res) => {
  const data = await service.restoreExpense(req);
  await invalidateExpenseCaches();
  res.status(200).json(buildSuccessResponse({ message: "Expense restored", data }));
};

exports.action = async (req, res) => {
  const data = await service.actionExpense(req);
  await invalidateExpenseCaches();
  res.status(200).json(buildSuccessResponse({ message: `Expense ${req.body.status}`, data }));
};

exports.updateReimbursement = async (req, res) => {
  const data = await service.updateReimbursement(req);
  await invalidateExpenseCaches();
  res.status(200).json(buildSuccessResponse({ message: "Reimbursement updated", data }));
};

exports.uploadReceipt = async (req, res) => {
  const data = await service.uploadReceipt(req);
  res.status(200).json(buildSuccessResponse({ message: "Receipt uploaded", data }));
};

exports.listVendors = async (req, res) => {
  const key = buildRequestCacheKey(req);
  const data = await withCache({
    namespace: EXPENSE_VENDOR_NAMESPACE,
    key,
    ttlSeconds: Number(process.env.CACHE_TTL_EXPENSE_VENDORS || 300),
    producer: () => service.listVendors(req)
  });
  res.status(200).json(buildSuccessResponse({ data }));
};

exports.createVendor = async (req, res) => {
  const data = await service.createVendor(req);
  await invalidateExpenseCaches();
  res.status(201).json(buildSuccessResponse({ message: "Vendor created", data }));
};

exports.updateVendor = async (req, res) => {
  const data = await service.updateVendor(req);
  await invalidateExpenseCaches();
  res.status(200).json(buildSuccessResponse({ message: "Vendor updated", data }));
};

exports.removeVendor = async (req, res) => {
  const data = await service.removeVendor(req);
  await invalidateExpenseCaches();
  res.status(200).json(buildSuccessResponse({ message: "Vendor deleted", data }));
};
