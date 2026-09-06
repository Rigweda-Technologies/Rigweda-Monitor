import { getPool } from "../../database/pool.js";

const ACTIVE_PRESENCE_WINDOW_SECONDS = 75;
const FRESH_EVENT_WINDOW_SECONDS = 120;
const DEFAULT_ACTIVITY_TIMEZONE = "Asia/Kolkata";

const isValidTimeZone = (timeZone) => {
  try {
    if (!timeZone || typeof timeZone !== "string") return false;
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
};

const toDateKeyInTimeZone = (dateValue, timeZone = DEFAULT_ACTIVITY_TIMEZONE) => {
  const date = new Date(dateValue);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const safeTimeZone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_ACTIVITY_TIMEZONE;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(safeDate);
  const getPart = (type) => parts.find((part) => part.type === type)?.value;
  return `${getPart("year")}-${getPart("month")}-${getPart("day")}`;
};

const buildDailyKey = ({ organizationId, employeeId, activityDate }) =>
  `${organizationId || ""}:${employeeId}:${activityDate}`;

export const activityModel = {
  async saveEvents({ organizationId, employeeId, employeeName, events, activityTimeZone }) {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      let saved = 0;
      let duplicateCount = 0;
      for (const event of events) {
        const activityDate = toDateKeyInTimeZone(event.observedAt, activityTimeZone);
        const dailyKey = buildDailyKey({ organizationId, employeeId, activityDate });
        const result = await client.query(
          `INSERT INTO monitor_activity_events (
            id, daily_key, organization_id, employee_id, employee_name, device_id,
            activity_date, observed_at, status, active_seconds, idle_seconds, event_ids
          ) VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9, $10, $11, ARRAY[$1])
          ON CONFLICT (daily_key) WHERE daily_key IS NOT NULL DO UPDATE SET
            employee_name = COALESCE(EXCLUDED.employee_name, monitor_activity_events.employee_name),
            device_id = CASE
              WHEN EXCLUDED.observed_at >= monitor_activity_events.observed_at THEN EXCLUDED.device_id
              ELSE monitor_activity_events.device_id
            END,
            observed_at = GREATEST(monitor_activity_events.observed_at, EXCLUDED.observed_at),
            status = CASE
              WHEN EXCLUDED.observed_at >= monitor_activity_events.observed_at THEN EXCLUDED.status
              ELSE monitor_activity_events.status
            END,
            active_seconds = CASE
              WHEN monitor_activity_events.event_ids @> ARRAY[EXCLUDED.id] THEN monitor_activity_events.active_seconds
              ELSE monitor_activity_events.active_seconds + EXCLUDED.active_seconds
            END,
            idle_seconds = CASE
              WHEN monitor_activity_events.event_ids @> ARRAY[EXCLUDED.id] THEN monitor_activity_events.idle_seconds
              ELSE monitor_activity_events.idle_seconds + EXCLUDED.idle_seconds
            END,
            event_ids = CASE
              WHEN monitor_activity_events.event_ids @> ARRAY[EXCLUDED.id] THEN monitor_activity_events.event_ids
              ELSE array_append(monitor_activity_events.event_ids, EXCLUDED.id)
            END
          WHERE NOT (monitor_activity_events.event_ids @> ARRAY[EXCLUDED.id])
          RETURNING xmax = 0 AS inserted`,
          [
            event.eventId,
            dailyKey,
            organizationId || null,
            employeeId,
            employeeName || null,
            event.deviceId,
            activityDate,
            event.observedAt,
            event.status,
            event.activeSeconds,
            event.idleSeconds,
          ]
        );
        if (result.rowCount > 0) {
          saved += 1;
        } else {
          duplicateCount += 1;
        }

        await client.query(
          `INSERT INTO monitor_device_presence (
            device_id, organization_id, employee_id, employee_name, status, last_seen_at
          ) VALUES (
            $1, $2, $3, $4, $5,
            CASE
              WHEN $6::timestamptz BETWEEN NOW() - ($7::integer * INTERVAL '1 second') AND NOW() + INTERVAL '1 minute'
              THEN NOW()
              ELSE $6::timestamptz
            END
          )
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
          [
            event.deviceId,
            organizationId || null,
            employeeId,
            employeeName || null,
            event.status,
            event.observedAt,
            FRESH_EVENT_WINDOW_SECONDS,
          ]
        );
      }
      await client.query("COMMIT");
      return { inserted: saved, saved, duplicateCount };
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
          BOOL_OR(status = 'active' AND last_seen_at >= NOW() - ($3::integer * INTERVAL '1 second')) AS is_active,
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
      [organizationId || null, date, ACTIVE_PRESENCE_WINDOW_SECONDS]
    );
    return rows;
  },
};
