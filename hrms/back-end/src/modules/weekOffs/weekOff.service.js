const WeekOff = require("./weekOff.model");
const toShiftKey = (shiftId) => (shiftId ? String(shiftId) : "default");

const normalizeShiftId = (value) => {
  if (!value || value === "default" || value === "null") return null;
  return value;
};

exports.upsert = async (req) => {
  const { weekOffDays } = req.body;
  const shiftId = normalizeShiftId(req.body.shiftId);

  const config = await WeekOff.findOneAndUpdate(
    { organizationId: req.user.organizationId, shiftId },
    { weekOffDays, shiftId },
    { upsert: true, new: true }
  );

  return config;
};

exports.get = async (req) => {
  const shiftId = normalizeShiftId(req.query.shiftId);

  if (shiftId) {
    const exact = await WeekOff.findOne({
      organizationId: req.user.organizationId,
      shiftId
    });
    if (exact) return exact;
  }

  return WeekOff.findOne({
    organizationId: req.user.organizationId,
    shiftId: null
  });
};

exports.getAll = async (req) => {
  return WeekOff.find({
    organizationId: req.user.organizationId
  })
    .populate("shiftId", "name code status")
    .sort({ shiftId: 1, createdAt: -1 });
};

exports.resolveWeekOffDays = async ({ organizationId, shiftId = null }) => {
  const normalizedShiftId = normalizeShiftId(shiftId);
  const query = {
    organizationId,
    $or: [{ shiftId: null }]
  };
  if (normalizedShiftId) {
    query.$or.unshift({ shiftId: normalizedShiftId });
  }
  const configs = await WeekOff.find(query).select("shiftId weekOffDays");
  const byShift = configs.find((c) => c.shiftId && String(c.shiftId) === String(normalizedShiftId));
  if (byShift) return byShift.weekOffDays || [];
  const fallback = configs.find((c) => !c.shiftId);
  return fallback?.weekOffDays || [];
};

exports.resolveWeekOffMapForEmployees = async ({ organizationId, employees = [] }) => {
  const configs = await WeekOff.find({ organizationId }).select("shiftId weekOffDays");
  const defaultDays = (configs.find((c) => !c.shiftId)?.weekOffDays || []);
  const shiftDayMap = new Map();
  configs.forEach((cfg) => {
    if (cfg.shiftId) {
      shiftDayMap.set(toShiftKey(cfg.shiftId), cfg.weekOffDays || []);
    }
  });

  const employeeMap = new Map();
  employees.forEach((emp) => {
    const days = shiftDayMap.get(toShiftKey(emp.shiftId)) || defaultDays;
    employeeMap.set(String(emp._id), days);
  });

  return { defaultDays, employeeMap };
};
