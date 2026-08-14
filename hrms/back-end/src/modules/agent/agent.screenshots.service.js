const { getMonitorPgPool } = require("../../config/monitorDb");
const Employee = require("../employees/employee.model");
const OrgSettings = require("../orgSettings/orgSettings.model");
const Organization = require("../organizations/organization.model");
const {
  isValidTimeZone,
  toDateKeyInTimeZone,
  startOfDayInTimeZone,
  endOfDayInTimeZone
} = require("../../utils/timezone");

const getOrganizationTimeZone = async (organizationId) => {
  const settings = await OrgSettings.findOne({ organizationId }).select("timezone").lean();
  if (isValidTimeZone(settings?.timezone)) return settings.timezone;

  const organization = await Organization.findById(organizationId).select("timezone").lean();
  if (isValidTimeZone(organization?.timezone)) return organization.timezone;
  return "Asia/Kolkata";
};

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

const parseHour = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 23) return null;
  return parsed;
};

const getEmployeeMap = async ({ organizationId, employeeIds }) => {
  if (!employeeIds.length) return new Map();
  let employees = [];
  try {
    employees = await Employee.find({
      organizationId,
      $or: [
        { _id: { $in: employeeIds } },
        { employeeCode: { $in: employeeIds } },
        { userId: { $in: employeeIds } }
      ]
    })
      .select("firstName lastName employeeCode userId")
      .lean();
  } catch {
    employees = [];
  }

  const map = new Map();
  for (const employee of employees) {
    const details = {
      name: [employee.firstName, employee.lastName].filter(Boolean).join(" ").trim() || null,
      code: employee.employeeCode || null,
      employeeId: String(employee._id)
    };
    map.set(String(employee._id), details);
    if (employee.employeeCode) {
      map.set(String(employee.employeeCode), details);
    }
    if (employee.userId) {
      map.set(String(employee.userId), details);
    }
  }

  return map;
};

const resolveEmployeeAliases = async ({ organizationId, employeeId }) => {
  if (!employeeId) return [];
  try {
    const employee = await Employee.findOne({
      organizationId,
      $or: [
        { _id: employeeId },
        { employeeCode: employeeId },
        { userId: employeeId }
      ]
    })
      .select("_id employeeCode userId")
      .lean();

    if (!employee) return [employeeId];

    return Array.from(
      new Set([
        String(employee._id),
        employee.employeeCode ? String(employee.employeeCode) : null,
        employee.userId ? String(employee.userId) : null,
        employeeId
      ].filter(Boolean))
    );
  } catch {
    return [employeeId];
  }
};

exports.getScreenshots = async (req) => {
  const organizationId = String(req.user.organizationId || "");
  const employeeId = String(req.query.employeeId || "").trim();
  const date = String(req.query.date || "").trim();
  const dateFrom = String(req.query.dateFrom || "").trim();
  const dateTo = String(req.query.dateTo || "").trim();
  const hour = parseHour(req.query.hour);
  const onlyWithImage = parseBooleanQuery(req.query.onlyWithImage);
  const page = parsePositiveInt(req.query.page, 1);
  const limit = Math.min(parsePositiveInt(req.query.limit, 20), 200);
  const offset = (page - 1) * limit;
  const timeZone = await getOrganizationTimeZone(organizationId);

  const where = ["organization_id = $1"];
  const values = [organizationId];

  if (employeeId) {
    const employeeAliases = await resolveEmployeeAliases({ organizationId, employeeId });
    if (employeeAliases.length === 1) {
      values.push(employeeAliases[0]);
      where.push(`employee_id = $${values.length}`);
    } else {
      const aliasClauses = [];
      for (const alias of employeeAliases) {
        values.push(alias);
        aliasClauses.push(`employee_id = $${values.length}`);
      }
      where.push(`(${aliasClauses.join(" OR ")})`);
    }
  }

  if (date) {
    const dayStart = startOfDayInTimeZone(date, timeZone);
    const dayEnd = endOfDayInTimeZone(date, timeZone);
    values.push(dayStart);
    where.push(`captured_at >= $${values.length}`);
    values.push(dayEnd);
    where.push(`captured_at <= $${values.length}`);
  } else {
    if (dateFrom) {
      values.push(startOfDayInTimeZone(dateFrom, timeZone));
      where.push(`captured_at >= $${values.length}`);
    }
    if (dateTo) {
      values.push(endOfDayInTimeZone(dateTo, timeZone));
      where.push(`captured_at <= $${values.length}`);
    }
  }

  if (hour !== null) {
    values.push(hour);
    values.push(timeZone);
    where.push(`EXTRACT(HOUR FROM captured_at AT TIME ZONE $${values.length})::integer = $${values.length - 1}`);
  }

  if (onlyWithImage === true) {
    where.push("cloudinary_url IS NOT NULL");
    where.push("upload_status = 'uploaded'");
  } else if (onlyWithImage === false) {
    where.push("(cloudinary_url IS NULL OR upload_status <> 'uploaded')");
  }

  const pool = await getMonitorPgPool();
  const baseWhere = where.join(" AND ");
  const totalResult = await pool.query(
    `SELECT COUNT(*)::integer AS total FROM monitor_screenshots WHERE ${baseWhere}`,
    values
  );

  const rowsResult = await pool.query(
    `
      SELECT
        id, batch_id, organization_id, employee_id, device_id, client_screenshot_id,
        captured_at, original_file_name, mime_type, width, height, size_bytes,
        cloudinary_folder, cloudinary_public_id, cloudinary_asset_id, cloudinary_url,
        upload_status, processing_status, created_at, uploaded_at
      FROM monitor_screenshots
      WHERE ${baseWhere}
      ORDER BY captured_at ASC, created_at ASC, id ASC
      LIMIT $${values.length + 1}
      OFFSET $${values.length + 2}
    `,
    [...values, limit, offset]
  );

  const employeeIds = Array.from(new Set(rowsResult.rows.map((row) => String(row.employee_id)).filter(Boolean)));
  const employeeMap = await getEmployeeMap({ organizationId, employeeIds });

  const items = rowsResult.rows.map((row) => {
    const employee = employeeMap.get(String(row.employee_id)) || {};
    return {
      screenshotId: row.id,
      attendanceId: null,
      organizationId: row.organization_id,
      employeeId: row.employee_id,
      employeeName: employee.name || null,
      employeeCode: employee.code || null,
      date: row.captured_at,
      dateKey: row.captured_at ? toDateKeyInTimeZone(row.captured_at, timeZone) : null,
      action: "screenshot",
      capturedAt: row.captured_at,
      imageUrl: row.cloudinary_url || null,
      selfieProvided: Boolean(row.cloudinary_url),
      deviceId: row.device_id || null,
      ip: null,
      status: row.upload_status || null,
      shiftName: null,
      shiftCode: null,
      source: "monitor_db",
      publicId: row.cloudinary_public_id || null,
      processingStatus: row.processing_status || null
    };
  });

  return {
    items,
    page,
    limit,
    count: items.length,
    total: Number(totalResult.rows[0]?.total || 0),
    timezone: timeZone,
    source: "monitor_db"
  };
};
