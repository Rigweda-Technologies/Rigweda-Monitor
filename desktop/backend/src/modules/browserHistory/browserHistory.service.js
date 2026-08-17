import crypto from "node:crypto";
import { getEmployeeProfileFromRigweda } from "../../integrations/rigweda-api.js";
import { getPool } from "../../database/pool.js";

const normalizeText = (value) => String(value || "").trim();

const resolveEmployeeName = (profile) => {
  const raw = profile?.raw || {};
  return [raw.firstName, raw.lastName].filter(Boolean).join(" ") || raw.name || raw.email || null;
};

const normalizeDurationMs = (value) => {
  const duration = Number(value || 0);
  if (!Number.isFinite(duration) || duration < 0) return 0;
  return Math.min(Math.round(duration), 86_400_000);
};

const normalizeObservedAt = (value) => {
  const timestamp = new Date(String(value || ""));
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error("Each browser history entry must include a valid observedAt timestamp.");
  }
  return timestamp.toISOString();
};

const buildEntryId = (entry) =>
  crypto
    .createHash("sha256")
    .update(
      [
        normalizeText(entry.deviceId),
        normalizeText(entry.browser),
        normalizeObservedAt(entry.observedAt),
        normalizeText(entry.url),
        normalizeText(entry.title),
        normalizeText(entry.activeWindowTitle),
        String(normalizeDurationMs(entry.durationMs))
      ].join("|")
    )
    .digest("hex");

export const browserHistoryService = {
  async saveEntries({ auth, entries, deviceId }) {
    const profile = await getEmployeeProfileFromRigweda({ token: auth.token });
    const employeeId = profile?.employeeDbId || profile?.employeeId || profile?.userId || auth.userId;

    if (!employeeId) {
      const error = new Error("Employee profile not found for the authenticated user.");
      error.statusCode = 404;
      throw error;
    }

    const resolvedDeviceId = normalizeText(deviceId);
    if (!resolvedDeviceId) {
      const error = new Error("deviceId is required.");
      error.statusCode = 400;
      throw error;
    }

    const pool = getPool();
    const client = await pool.connect();
    const employeeName = resolveEmployeeName(profile);
    const organizationId = profile?.organizationId || auth.organizationId || null;

    try {
      await client.query("BEGIN");
      let inserted = 0;

      for (const entry of entries) {
        const entryId = buildEntryId({ ...entry, deviceId: resolvedDeviceId });
        const observedAt = normalizeObservedAt(entry.observedAt);
        const result = await client.query(
          `INSERT INTO monitor_browser_history (
            entry_id, organization_id, employee_id, employee_name, device_id,
            observed_at, browser, url, title, active_window_title, duration_ms
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (device_id, entry_id) DO NOTHING`,
          [
            entryId,
            organizationId,
            String(employeeId),
            employeeName,
            resolvedDeviceId,
            observedAt,
            normalizeText(entry.browser).toLowerCase(),
            normalizeText(entry.url),
            normalizeText(entry.title),
            normalizeText(entry.activeWindowTitle) || null,
            normalizeDurationMs(entry.durationMs),
          ]
        );
        inserted += result.rowCount;
      }

      await client.query("COMMIT");
      return { inserted, duplicateCount: entries.length - inserted };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
};
