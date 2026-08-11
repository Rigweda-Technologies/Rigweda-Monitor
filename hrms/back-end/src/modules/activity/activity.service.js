const { getMonitorPgPool } = require("../../config/monitorDb");
const Employee = require("../employees/employee.model");

const ACTIVE_PRESENCE_WINDOW_SECONDS = 75;

const getEmployeeMap = async ({ organizationId, employeeIds }) => {
  if (!employeeIds.length) return new Map();

  try {
    const employees = await Employee.find({
      organizationId,
      $or: [
        { _id: { $in: employeeIds } },
        { employeeCode: { $in: employeeIds } },
        { userId: { $in: employeeIds } }
      ]
    })
      .select("firstName lastName employeeCode userId")
      .lean();

    const map = new Map();
    for (const employee of employees) {
      const details = {
        name: [employee.firstName, employee.lastName].filter(Boolean).join(" ").trim() || null,
        code: employee.employeeCode || null,
        employeeId: String(employee._id),
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
  } catch {
    return new Map();
  }
};

exports.listEmployees = async ({ organizationId, date }) => {
  const pool = await getMonitorPgPool();
  const { rows } = await pool.query(
    `WITH daily AS (
      SELECT employee_id, MAX(employee_name) AS employee_name,
        COALESCE(SUM(active_seconds), 0)::integer AS productive_seconds
      FROM monitor_activity_events
      WHERE organization_id = $1
        AND observed_at >= $2::date
        AND observed_at < ($2::date + INTERVAL '1 day')
      GROUP BY employee_id
    ), presence AS (
      SELECT employee_id, MAX(employee_name) AS employee_name,
        BOOL_OR(status = 'active' AND last_seen_at >= NOW() - ($3::integer * INTERVAL '1 second')) AS is_active,
        MAX(last_seen_at) AS last_seen_at
      FROM monitor_device_presence
      WHERE organization_id = $1
      GROUP BY employee_id
    )
    SELECT COALESCE(p.employee_id, d.employee_id) AS "employeeId",
      COALESCE(p.employee_name, d.employee_name) AS "employeeName",
      CASE WHEN COALESCE(p.is_active, false) THEN 'active' ELSE 'offline' END AS status,
      p.last_seen_at AS "lastSeenAt",
      COALESCE(d.productive_seconds, 0) AS "productiveSeconds"
    FROM daily d FULL OUTER JOIN presence p ON p.employee_id = d.employee_id
    ORDER BY status DESC, "employeeName" NULLS LAST, "employeeId"`,
    [String(organizationId), date, ACTIVE_PRESENCE_WINDOW_SECONDS]
  );

  const employeeIds = Array.from(new Set(rows.map((row) => String(row.employeeId)).filter(Boolean)));
  const employeeMap = await getEmployeeMap({ organizationId, employeeIds });

  const groupedRows = new Map();

  for (const row of rows) {
    const employee = employeeMap.get(String(row.employeeId)) || {};
    const canonicalEmployeeId = employee.employeeId || String(row.employeeId);
    const key = canonicalEmployeeId;
    const current = groupedRows.get(key) || {
      employeeId: canonicalEmployeeId,
      employeeName: row.employeeName || employee.name || null,
      employeeCode: employee.code || null,
      status: "offline",
      lastSeenAt: null,
      productiveSeconds: 0
    };

    const rowLastSeen = row.lastSeenAt ? new Date(row.lastSeenAt).getTime() : 0;
    const currentLastSeen = current.lastSeenAt ? new Date(current.lastSeenAt).getTime() : 0;

    current.employeeName = current.employeeName || row.employeeName || employee.name || null;
    current.employeeCode = current.employeeCode || employee.code || null;
    current.productiveSeconds += Number(row.productiveSeconds || 0);
    if (row.status === "active") {
      current.status = "active";
    }
    if (row.lastSeenAt && rowLastSeen >= currentLastSeen) {
      current.lastSeenAt = row.lastSeenAt;
    }

    groupedRows.set(key, current);
  }

  return Array.from(groupedRows.values()).sort((a, b) => {
    if (a.status !== b.status) return a.status === "active" ? -1 : 1;
    return String(a.employeeName || "").localeCompare(String(b.employeeName || ""));
  });
};
