const { getMonitorPgPool } = require("../../config/monitorDb");
const Employee = require("../employees/employee.model");

const ACTIVE_PRESENCE_WINDOW_SECONDS = 75;

const getEmployeeMap = async ({ organizationId, employeeIds }) => {
  if (!employeeIds.length) return new Map();

  try {
    const employees = await Employee.find({
      _id: { $in: employeeIds },
      organizationId
    })
      .select("firstName lastName employeeCode")
      .lean();

    return new Map(
      employees.map((employee) => [
        String(employee._id),
        {
          name: [employee.firstName, employee.lastName].filter(Boolean).join(" ").trim() || null,
          code: employee.employeeCode || null
        }
      ])
    );
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

  return rows.map((row) => {
    const employee = employeeMap.get(String(row.employeeId)) || {};
    return {
      ...row,
      employeeName: row.employeeName || employee.name || null,
      employeeCode: employee.code || null
    };
  });
};
