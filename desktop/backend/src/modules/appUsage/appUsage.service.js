import { getPool } from "../../database/pool.js";
import { getEmployeeProfileFromRigweda } from "../../integrations/rigweda-api.js";

const getEmployeeName = (profile) => {
  const raw = profile?.raw || {};
  return [raw.firstName, raw.lastName].filter(Boolean).join(" ") || raw.name || raw.email || null;
};

export const appUsageService = {
  async recordSessions({ auth, events }) {
    const profile = await getEmployeeProfileFromRigweda({ token: auth.token });
    const employeeId = profile?.employeeDbId || profile?.employeeId || profile?.userId || auth.userId;

    if (!employeeId) {
      const error = new Error("Employee profile not found for the authenticated user.");
      error.statusCode = 404;
      throw error;
    }

    const organizationId = profile?.organizationId || auth.organizationId || null;
    const employeeName = getEmployeeName(profile);
    const pool = getPool();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      for (const event of events) {
        const keyNames = JSON.stringify(Array.isArray(event.keyNames) ? event.keyNames : []);
        const typedText = String(event.typedText || "");
        const keyStreamText = String(event.keyStreamText || "");
        await client.query(
          `
            INSERT INTO monitor_app_usage_sessions (
              session_id, organization_id, employee_id, employee_name, device_id, observed_at,
              app_name, process_name, started_at, ended_at, active_seconds, key_press_count, key_names, typed_text, key_stream_text, upload_status, uploaded_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'uploaded', NOW())
            ON CONFLICT (device_id, session_id) DO UPDATE SET
              organization_id = EXCLUDED.organization_id,
              employee_id = EXCLUDED.employee_id,
              employee_name = COALESCE(EXCLUDED.employee_name, monitor_app_usage_sessions.employee_name),
              observed_at = EXCLUDED.observed_at,
              app_name = EXCLUDED.app_name,
              process_name = EXCLUDED.process_name,
              started_at = EXCLUDED.started_at,
              ended_at = EXCLUDED.ended_at,
              active_seconds = EXCLUDED.active_seconds,
              key_press_count = EXCLUDED.key_press_count,
              key_names = EXCLUDED.key_names,
              typed_text = EXCLUDED.typed_text,
              key_stream_text = EXCLUDED.key_stream_text,
              upload_status = 'uploaded',
              last_error = NULL,
              uploaded_at = NOW()
          `,
          [
            event.sessionId,
            organizationId,
            String(employeeId),
            employeeName,
            event.deviceId,
            event.observedAt,
            event.appName,
            event.processName,
            event.startedAt,
            event.endedAt,
            Number(event.activeSeconds || 0),
            Number(event.keyPressCount || 0),
            keyNames,
            typedText,
            keyStreamText,
          ]
        );
      }

      await client.query("COMMIT");
      return {
        received: events.length,
        employeeId: String(employeeId),
        organizationId,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
};
