const Attendance = require("../timesheets/timesheetAttendance.model");
const Employee = require("../employees/employee.model");

const parsePositiveInt = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
};

const parseBooleanQuery = (value) => {
  if (value === true || value === false) return value;
  const text = String(value || "").trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(text)) return true;
  if (["0", "false", "no", "n"].includes(text)) return false;
  return null;
};

const startOfDay = (value) => {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
};

const endOfDay = (value) => {
  const d = new Date(value);
  d.setHours(23, 59, 59, 999);
  return d;
};

exports.getScreenshots = async (req) => {
  const organizationId = req.user.organizationId;
  const employeeId = String(req.query.employeeId || "").trim();
  const dateFrom = String(req.query.dateFrom || "").trim();
  const dateTo = String(req.query.dateTo || "").trim();
  const onlyWithImage = parseBooleanQuery(req.query.onlyWithImage);
  const page = parsePositiveInt(req.query.page, 1);
  const limit = Math.min(parsePositiveInt(req.query.limit, 50), 200);

  const query = { organizationId };

  if (employeeId) {
    query.employeeId = employeeId;
  }

  if (dateFrom || dateTo) {
    query.date = {};
    if (dateFrom) query.date.$gte = startOfDay(dateFrom);
    if (dateTo) query.date.$lte = endOfDay(dateTo);
  }

  const rows = await Attendance.find(query)
    .select(
      "employeeId organizationId date dateKey status checkInAt checkInIp checkInSelfieProvided checkInSelfieImage checkInDeviceId checkOutAt checkOutIp checkOutSelfieProvided checkOutSelfieImage checkOutDeviceId shiftName shiftCode createdAt updatedAt"
    )
    .populate("employeeId", "firstName lastName employeeCode")
    .sort({ date: -1, updatedAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

  const items = [];

  for (const row of rows) {
    const employee = row.employeeId || {};
    const employeeName = [employee.firstName, employee.lastName].filter(Boolean).join(" ").trim() || null;

    const addItem = ({ action, capturedAt, imageUrl, selfieProvided, deviceId, ip }) => {
      if (onlyWithImage === true && !imageUrl) return;
      if (onlyWithImage === false && imageUrl) return;

      items.push({
        screenshotId: `${row._id}-${action}`,
        attendanceId: row._id,
        organizationId: row.organizationId,
        employeeId: employee._id || row.employeeId,
        employeeName,
        employeeCode: employee.employeeCode || null,
        date: row.date,
        dateKey: row.dateKey,
        action,
        capturedAt: capturedAt || row.createdAt || row.updatedAt,
        imageUrl: imageUrl || null,
        selfieProvided: Boolean(selfieProvided),
        deviceId: deviceId || null,
        ip: ip || null,
        status: row.status || null,
        shiftName: row.shiftName || null,
        shiftCode: row.shiftCode || null
      });
    };

    addItem({
      action: "check_in",
      capturedAt: row.checkInAt,
      imageUrl: row.checkInSelfieImage,
      selfieProvided: row.checkInSelfieProvided,
      deviceId: row.checkInDeviceId,
      ip: row.checkInIp
    });

    addItem({
      action: "check_out",
      capturedAt: row.checkOutAt,
      imageUrl: row.checkOutSelfieImage,
      selfieProvided: row.checkOutSelfieProvided,
      deviceId: row.checkOutDeviceId,
      ip: row.checkOutIp
    });
  }

  return { items, page, limit, count: items.length };
};
