const Employee = require("../employees/employee.model");
const { getMonitorPgPool } = require("../../config/monitorDb");

let healthTableReady;

const ensureHealthTable = async () => {
  if (!healthTableReady) {
    healthTableReady = (async () => {
      const pool = await getMonitorPgPool();
      await pool.query(`
        CREATE TABLE IF NOT EXISTS monitor_device_health (
          id BIGSERIAL PRIMARY KEY,
          organization_id TEXT,
          employee_id TEXT NOT NULL,
          employee_name TEXT,
          employee_code TEXT,
          device_id TEXT NOT NULL,
          hostname TEXT,
          platform TEXT,
          platform_version TEXT,
          agent_version TEXT,
          cpu_model TEXT,
          cpu_core_count INTEGER,
          cpu_percent NUMERIC,
          memory_total_bytes BIGINT,
          memory_used_bytes BIGINT,
          memory_percent NUMERIC,
          disks JSONB NOT NULL DEFAULT '[]'::jsonb,
          temperature_c NUMERIC,
          battery_percent NUMERIC,
          battery_charging BOOLEAN,
          uptime_seconds BIGINT,
          last_seen_at TIMESTAMPTZ NOT NULL,
          reported_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (organization_id, device_id)
        )
      `);
      await pool.query(`
        ALTER TABLE monitor_device_health
        ADD COLUMN IF NOT EXISTS employee_code TEXT
      `);
      await pool.query(`
        ALTER TABLE monitor_device_health
        ADD COLUMN IF NOT EXISTS cpu_core_count INTEGER
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_monitor_device_health_org_seen
        ON monitor_device_health (organization_id, last_seen_at DESC)
      `);
    })().catch((error) => {
      healthTableReady = null;
      throw error;
    });
  }
  await healthTableReady;
};

const clamp = (value, minimum, maximum) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(Math.max(number, minimum), maximum);
};

const positiveNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};

const normalizeDisk = (disk) => ({
  mount: String(disk?.mount || "").trim(),
  filesystem: String(disk?.filesystem || "").trim() || null,
  totalBytes: positiveNumber(disk?.totalBytes),
  usedBytes: positiveNumber(disk?.usedBytes),
  freeBytes: positiveNumber(disk?.freeBytes),
  usedPercent: clamp(disk?.usedPercent, 0, 100)
});

exports.saveHealth = async ({ req, payload }) => {
  const employee = await Employee.findOne({
    userId: req.user.userId,
    organizationId: req.user.organizationId,
    isDeleted: false
  }).select("_id firstName lastName employeeCode").lean();

  if (!employee) {
    throw Object.assign(new Error("The authenticated user is not linked to an employee."), { code: 403 });
  }

  await ensureHealthTable();
  const reportedAt = payload.reportedAt ? new Date(payload.reportedAt) : new Date();
  const disks = (Array.isArray(payload.disks) ? payload.disks : [])
    .filter((disk) => String(disk?.mount || "").trim())
    .slice(0, 20)
    .map(normalizeDisk);
  const employeeName = [employee.firstName, employee.lastName].filter(Boolean).join(" ").trim() || null;
  const pool = await getMonitorPgPool();
  const { rows } = await pool.query(
    `INSERT INTO monitor_device_health (
      organization_id, employee_id, employee_name, employee_code, device_id, hostname, platform,
      platform_version, agent_version, cpu_model, cpu_core_count, cpu_percent, memory_total_bytes,
      memory_used_bytes, memory_percent, disks, temperature_c, battery_percent,
      battery_charging, uptime_seconds, last_seen_at, reported_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb,
      $17, $18, $19, $20, $21, $22)
    ON CONFLICT (organization_id, device_id) DO UPDATE SET
      employee_id = EXCLUDED.employee_id,
      employee_name = EXCLUDED.employee_name,
      employee_code = EXCLUDED.employee_code,
      hostname = EXCLUDED.hostname,
      platform = EXCLUDED.platform,
      platform_version = EXCLUDED.platform_version,
      agent_version = EXCLUDED.agent_version,
      cpu_model = EXCLUDED.cpu_model,
      cpu_core_count = EXCLUDED.cpu_core_count,
      cpu_percent = EXCLUDED.cpu_percent,
      memory_total_bytes = EXCLUDED.memory_total_bytes,
      memory_used_bytes = EXCLUDED.memory_used_bytes,
      memory_percent = EXCLUDED.memory_percent,
      disks = EXCLUDED.disks,
      temperature_c = EXCLUDED.temperature_c,
      battery_percent = EXCLUDED.battery_percent,
      battery_charging = EXCLUDED.battery_charging,
      uptime_seconds = EXCLUDED.uptime_seconds,
      last_seen_at = EXCLUDED.last_seen_at,
      reported_at = EXCLUDED.reported_at,
      updated_at = NOW()
    RETURNING *`,
    [
      req.user.organizationId || null,
      String(employee._id),
      employeeName,
      employee.employeeCode || null,
      payload.deviceId,
      payload.hostname || null,
      payload.platform || null,
      payload.platformVersion || null,
      payload.agentVersion || null,
      payload.cpuModel || null,
      positiveNumber(payload.cpuCoreCount),
      clamp(payload.cpuPercent, 0, 100),
      positiveNumber(payload.memoryTotalBytes),
      positiveNumber(payload.memoryUsedBytes),
      clamp(payload.memoryPercent, 0, 100),
      JSON.stringify(disks),
      clamp(payload.temperatureC, -50, 150),
      clamp(payload.batteryPercent, 0, 100),
      typeof payload.batteryCharging === "boolean" ? payload.batteryCharging : null,
      positiveNumber(payload.uptimeSeconds),
      reportedAt,
      reportedAt
    ]
  );

  return mapHealthRow(rows[0]);
};

exports.listHealth = async ({ organizationId }) => {
  await ensureHealthTable();
  const pool = await getMonitorPgPool();
  const { rows } = await pool.query(
    `WITH ranked_health AS (
       SELECT
         monitor_device_health.*,
         ROW_NUMBER() OVER (
           PARTITION BY COALESCE(
             NULLIF(employee_id, ''),
             NULLIF(employee_code, ''),
             NULLIF(device_id, '')
           )
           ORDER BY last_seen_at DESC, updated_at DESC, id DESC
         ) AS snapshot_rank
       FROM monitor_device_health
       WHERE ($1::text IS NULL OR organization_id = $1)
     )
     SELECT *
     FROM ranked_health
     WHERE snapshot_rank = 1
     ORDER BY last_seen_at DESC, updated_at DESC, id DESC`,
    [organizationId || null]
  );
  return rows.map(mapHealthRow);
};

const mapHealthRow = (row) => ({
  id: String(row.id),
  organizationId: row.organization_id,
  employeeId: row.employee_id,
  employee: row.employee_id ? {
    id: row.employee_id,
    name: row.employee_name || null,
    code: row.employee_code || null
  } : null,
  deviceId: row.device_id,
  hostname: row.hostname,
  platform: row.platform,
  platformVersion: row.platform_version,
  agentVersion: row.agent_version,
  cpuModel: row.cpu_model,
  cpuCoreCount: row.cpu_core_count === null ? null : Number(row.cpu_core_count),
  cpuPercent: row.cpu_percent === null ? null : Number(row.cpu_percent),
  memoryTotalBytes: row.memory_total_bytes === null ? null : Number(row.memory_total_bytes),
  memoryUsedBytes: row.memory_used_bytes === null ? null : Number(row.memory_used_bytes),
  memoryPercent: row.memory_percent === null ? null : Number(row.memory_percent),
  disks: row.disks || [],
  temperatureC: row.temperature_c === null ? null : Number(row.temperature_c),
  batteryPercent: row.battery_percent === null ? null : Number(row.battery_percent),
  batteryCharging: row.battery_charging,
  uptimeSeconds: row.uptime_seconds === null ? null : Number(row.uptime_seconds),
  lastSeenAt: row.last_seen_at,
  reportedAt: row.reported_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});
