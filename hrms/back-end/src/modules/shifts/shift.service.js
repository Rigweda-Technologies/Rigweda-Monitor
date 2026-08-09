const Shift = require("./shift.model");
const Employee = require("../employees/employee.model");

exports.createShift = async (req) => {
  const payload = {
    organizationId: req.user.organizationId,
    name: req.body.name,
    code: String(req.body.code || "").toUpperCase(),
    startTime: req.body.startTime,
    endTime: req.body.endTime,
    graceMinutes: Number(req.body.graceMinutes || 0),
    status: req.body.status || "active"
  };

  const exists = await Shift.findOne({
    organizationId: req.user.organizationId,
    code: payload.code
  });
  if (exists) {
    throw new Error("Shift code already exists");
  }

  return Shift.create(payload);
};

exports.listShifts = async (req) => {
  return Shift.find({
    organizationId: req.user.organizationId
  }).sort({ createdAt: -1 });
};

exports.updateShift = async (req) => {
  const update = { ...req.body };
  if (update.code) {
    update.code = String(update.code).toUpperCase();
    const exists = await Shift.findOne({
      organizationId: req.user.organizationId,
      code: update.code,
      _id: { $ne: req.params.id }
    });
    if (exists) {
      throw new Error("Shift code already exists");
    }
  }

  const shift = await Shift.findOneAndUpdate(
    {
      _id: req.params.id,
      organizationId: req.user.organizationId
    },
    update,
    { new: true }
  );
  if (!shift) throw new Error("Shift not found");
  return shift;
};

exports.removeShift = async (req) => {
  const shift = await Shift.findOne({
    _id: req.params.id,
    organizationId: req.user.organizationId
  });
  if (!shift) throw new Error("Shift not found");
  if (shift.status === "inactive") {
    return shift;
  }
  shift.status = "inactive";
  await shift.save();
  return shift;
};

exports.getMyShift = async (req) => {
  const employee = await Employee.findOne({
    userId: req.user.userId,
    organizationId: req.user.organizationId
  }).populate("shiftId");

  if (!employee) throw new Error("Employee not found");
  return employee.shiftId || null;
};
