import { getPool } from "../../database/pool.js";

export const activityModel = {
  async saveEvents({ organizationId, employeeId, employeeName, events }) {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      let inserted = 0;
      for (const event of events) {
        const result = await client.query(
          `INSERT INTO monitor_activity_events (
            id, organization_id, employee_id, employee_name, device_id, observed_at,
            status, active_seconds, idle_seconds
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (device_id, id) DO NOTHING`,
          [
            event.eventId,
            organizationId || null,
            employeeId,
            employeeName || null,
            event.deviceId,
            event.observedAt,
            event.status,
            event.activeSeconds,
            event.idleSeconds,
          ]
        );
        inserted += result.rowCount;

        await client.query(
          `INSERT INTO monitor_device_presence (
            device_id, organization_id, employee_id, employee_name, status, last_seen_at
          ) VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (device_id) DO UPDATE SET
            organization_id = EXCLUDED.organization_id,
            employee_id = EXCLUDED.employee_id,
            employee_name = COALESCE(EXCLUDED.employee_name, monitor_device_presence.employee_name),
            status = CASE
              WHEN EXCLUDED.last_seen_at >= monitor_device_presence.last_seen_at THEN EXCLUDED.status
              ELSE monitor_device_presence.status
            END,
            last_seen_at = GREATEST(monitor_device_presence.last_seen_at, EXCLUDED.last_seen_at),
            updated_at = NOW()`,
          [event.deviceId, organizationId || null, employeeId, employeeName || null, event.status, event.observedAt]
        );
      }
      await client.query("COMMIT");
      return { inserted, duplicateCount: events.length - inserted };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async listEmployees({ organizationId, date }) {
    const { rows } = await getPool().query(
      `WITH daily AS (
        SELECT employee_id, MAX(employee_name) AS employee_name,
          COALESCE(SUM(active_seconds), 0)::integer AS productive_seconds
        FROM monitor_activity_events
        WHERE ($1::text IS NULL OR organization_id = $1)
          AND observed_at >= $2::date
          AND observed_at < ($2::date + INTERVAL '1 day')
        GROUP BY employee_id
      ), presence AS (
        SELECT employee_id, MAX(employee_name) AS employee_name,
          BOOL_OR(status = 'active' AND last_seen_at >= NOW() - INTERVAL '3 minutes') AS is_active,
          MAX(last_seen_at) AS last_seen_at
        FROM monitor_device_presence
        WHERE ($1::text IS NULL OR organization_id = $1)
        GROUP BY employee_id
      )
      SELECT COALESCE(p.employee_id, d.employee_id) AS "employeeId",
        COALESCE(p.employee_name, d.employee_name) AS "employeeName",
        CASE WHEN COALESCE(p.is_active, false) THEN 'active' ELSE 'offline' END AS status,
        p.last_seen_at AS "lastSeenAt",
        COALESCE(d.productive_seconds, 0) AS "productiveSeconds"
      FROM daily d FULL OUTER JOIN presence p ON p.employee_id = d.employee_id
      ORDER BY status DESC, "employeeName" NULLS LAST, "employeeId"`,
      [organizationId || null, date]
    );
    return rows;
  },
};
