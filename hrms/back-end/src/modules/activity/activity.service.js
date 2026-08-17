const fs = require("fs");
const path = require("path");
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

const ACTIVE_PRESENCE_WINDOW_SECONDS = 75;
const AWAY_PRESENCE_WINDOW_SECONDS = 5 * 60;
const ACTIVE_WINDOW_MS = ACTIVE_PRESENCE_WINDOW_SECONDS * 1000;
const AWAY_WINDOW_MS = AWAY_PRESENCE_WINDOW_SECONDS * 1000;

const getOrganizationTimeZone = async (organizationId) => {
  const settings = await OrgSettings.findOne({ organizationId }).select("timezone").lean();
  if (isValidTimeZone(settings?.timezone)) return settings.timezone;

  const organization = await Organization.findById(organizationId).select("timezone").lean();
  if (isValidTimeZone(organization?.timezone)) return organization.timezone;
  return "Asia/Kolkata";
};

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

const LOG_LINE_RE = /^\s*\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/;
const LOG_PREFIX_RE = /Keyboard app usage|App usage|Foreground app usage|Traceback \(most recent call last\):|During handling of the above exception|ConnectionRefusedError|URLError|TimeoutError|OSError|^File "/;

const KEY_TOKEN_ALIASES = new Map([
  ["SPACE", "SPACE"],
  ["TAB", "TAB"],
  ["ENTER", "ENTER"],
  ["RETURN", "ENTER"],
  ["BACKSPACE", "BACKSPACE"],
  ["DELETE", "DELETE"],
  ["DEL", "DELETE"],
  ["ESC", "ESC"],
  ["ESCAPE", "ESC"],
  ["LEFT", "LEFT"],
  ["RIGHT", "RIGHT"],
  ["UP", "UP"],
  ["DOWN", "DOWN"],
  ["HOME", "HOME"],
  ["END", "END"],
  ["PAGEUP", "PAGEUP"],
  ["PAGEDOWN", "PAGEDOWN"],
  ["INSERT", "INSERT"],
  ["CTRL", "CTRL"],
  ["CONTROL", "CTRL"],
  ["SHIFT", "SHIFT"],
  ["ALT", "ALT"],
  ["META", "META"],
  ["WINDOWS", "META"],
  ["CMD", "META"],
  ["CAPSLOCK", "CAPSLOCK"],
  ["CAPS", "CAPSLOCK"],
  ["NUMLOCK", "NUMLOCK"],
  ["SCROLLLOCK", "SCROLLLOCK"]
]);

const normalizeKeyToken = (rawToken) => {
  const token = String(rawToken || "")
    .trim()
    .replace(/^KEY\./i, "")
    .replace(/_L$|_R$/i, "")
    .replace(/LEFT$|RIGHT$/i, "")
    .replace(/^LEFT_|^RIGHT_/i, "")
    .replace(/__+/g, "_")
    .trim();

  if (!token) return "";

  const normalized = token.toUpperCase();
  if (KEY_TOKEN_ALIASES.has(normalized)) {
    return KEY_TOKEN_ALIASES.get(normalized);
  }
  if (/^F\d{1,2}$/.test(normalized)) return normalized;
  if (/^VK_[A-Z0-9_]+$/.test(normalized)) return normalized;
  return token;
};

const reconstructTypedText = (value) => {
  const text = String(value || "");
  if (!text) return "";

  const buffer = [];
  let cursor = 0;

  const insertText = (chunk) => {
    const chars = Array.from(String(chunk || ""));
    if (!chars.length) return;
    buffer.splice(cursor, 0, ...chars);
    cursor += chars.length;
  };

  const removeBeforeCursor = () => {
    if (cursor <= 0) return;
    buffer.splice(cursor - 1, 1);
    cursor -= 1;
  };

  const removeAtCursor = () => {
    if (cursor < 0 || cursor >= buffer.length) return;
    buffer.splice(cursor, 1);
  };

  const moveCursor = (delta) => {
    cursor = Math.max(0, Math.min(buffer.length, cursor + delta));
  };

  const applyToken = (token) => {
    const normalized = normalizeKeyToken(token);
    if (!normalized) return;

    switch (normalized) {
      case "SPACE":
        insertText(" ");
        return;
      case "TAB":
        insertText("\t");
        return;
      case "ENTER":
        insertText("\n");
        return;
      case "BACKSPACE":
        removeBeforeCursor();
        return;
      case "DELETE":
        removeAtCursor();
        return;
      case "LEFT":
        moveCursor(-1);
        return;
      case "RIGHT":
        moveCursor(1);
        return;
      case "HOME":
        cursor = 0;
        return;
      case "END":
        cursor = buffer.length;
        return;
      case "CTRL":
      case "SHIFT":
      case "ALT":
      case "META":
      case "CAPSLOCK":
      case "NUMLOCK":
      case "SCROLLLOCK":
      case "ESC":
        return;
      default:
        insertText(normalized);
    }
  };

  const looksLikeCommaSeparatedKeys =
    text.includes(",") &&
    /(?:^|[, ]+)(SPACE|BACKSPACE|ENTER|TAB|CTRL|SHIFT|ALT|META|CAPSLOCK|LEFT|RIGHT|UP|DOWN|HOME|END|DELETE|DEL)\b/i.test(text);

  if (looksLikeCommaSeparatedKeys) {
    for (const part of text.split(",")) {
      const token = part.trim();
      if (!token) continue;
      applyToken(token);
    }
    return buffer.join("").trimEnd();
  }

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (char === "[") {
      const closing = text.indexOf("]", index + 1);
      if (closing !== -1) {
        applyToken(text.slice(index + 1, closing));
        index = closing;
        continue;
      }
    }

    if (char === "\r") {
      continue;
    }
    if (char === "\b") {
      removeBeforeCursor();
      continue;
    }
    if (char === "\t") {
      insertText("\t");
      continue;
    }
    if (char === "\n") {
      insertText("\n");
      continue;
    }

    insertText(char);
  }

  return buffer.join("").trimEnd();
};

const cleanUserText = (value) => {
  const text = String(value || "");
  if (!text) return "";

  const lines = text.split(/\r?\n/);
  const keptLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (keptLines.length > 0 && keptLines[keptLines.length - 1] !== "") {
        keptLines.push("");
      }
      continue;
    }

    if (LOG_LINE_RE.test(trimmed) || LOG_PREFIX_RE.test(trimmed)) {
      continue;
    }

    if (/^=+$/.test(trimmed) || trimmed === "---" || trimmed === "----") {
      continue;
    }

    keptLines.push(line);
  }

  return reconstructTypedText(keptLines.join("\n").trimEnd());
};

const toMillis = (value) => {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
};

const clampInterval = (startMs, endMs, dayStartMs, dayEndMs) => {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  const start = Math.max(startMs, dayStartMs);
  const end = Math.min(endMs, dayEndMs);
  if (end <= start) return null;
  return { start, end };
};

const mergeIntervals = (intervals) => {
  const sorted = intervals
    .filter((interval) => interval && Number.isFinite(interval.start) && Number.isFinite(interval.end) && interval.end > interval.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const merged = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (!last || interval.start > last.end) {
      merged.push({ start: interval.start, end: interval.end });
      continue;
    }

    last.end = Math.max(last.end, interval.end);
  }
  return merged;
};

const sumMergedIntervalSeconds = (intervals) => {
  const totalMs = mergeIntervals(intervals).reduce((total, interval) => total + Math.max(interval.end - interval.start, 0), 0);
  return Math.max(Math.round(totalMs / 1000), 0);
};

exports.listEmployees = async ({ organizationId, date }) => {
  const timeZone = await getOrganizationTimeZone(organizationId);
  const normalizedDate = toDateKeyInTimeZone(date || new Date(), timeZone);
  const dayStart = startOfDayInTimeZone(normalizedDate, timeZone);
  const dayEnd = endOfDayInTimeZone(normalizedDate, timeZone);
  const dayStartMs = toMillis(dayStart) ?? 0;
  const dayEndMs = toMillis(dayEnd) ?? Date.now();
  const nowMs = Date.now();
  const pool = await getMonitorPgPool();
  const [activityResult, sessionResult] = await Promise.all([
    pool.query(
      `
        SELECT
          employee_id AS "employeeId",
          employee_name AS "employeeName",
          status,
          observed_at AS "observedAt",
          active_seconds AS "activeSeconds",
          idle_seconds AS "idleSeconds"
        FROM monitor_activity_events
        WHERE organization_id = $1
          AND observed_at >= $2
          AND observed_at <= $3
        ORDER BY observed_at ASC
      `,
      [String(organizationId), dayStart, dayEnd]
    ),
    pool.query(
      `
        SELECT
          employee_id AS "employeeId",
          employee_name AS "employeeName",
          started_at AS "startedAt",
          ended_at AS "endedAt",
          active_seconds AS "activeSeconds"
        FROM monitor_app_usage_sessions
        WHERE organization_id = $1
          AND started_at <= $3
          AND ended_at >= $2
        ORDER BY started_at ASC, ended_at ASC
      `,
      [String(organizationId), dayStart, dayEnd]
    )
  ]);

  const rows = [
    ...activityResult.rows.map((row) => ({ ...row, source: "activity" })),
    ...sessionResult.rows.map((row) => ({ ...row, source: "session" }))
  ].sort((a, b) => {
    const aTime = toMillis(a.observedAt || a.endedAt || a.startedAt) ?? 0;
    const bTime = toMillis(b.observedAt || b.endedAt || b.startedAt) ?? 0;
    return aTime - bTime;
  });

  const employeeIds = Array.from(new Set(rows.map((row) => String(row.employeeId)).filter(Boolean)));
  const employeeMap = await getEmployeeMap({ organizationId, employeeIds });

  const groupedRows = new Map();

  for (const row of rows) {
    const employee = employeeMap.get(String(row.employeeId)) || {};
    const canonicalEmployeeId = employee.employeeId || String(row.employeeId);
    const current = groupedRows.get(canonicalEmployeeId) || {
      employeeId: canonicalEmployeeId,
      employeeName: row.employeeName || employee.name || null,
      employeeCode: employee.code || null,
      status: "offline",
      lastSeenAt: null,
      lastActiveAt: null,
      productiveIntervals: [],
      presenceIntervals: []
    };

    current.employeeName = current.employeeName || row.employeeName || employee.name || null;
    current.employeeCode = current.employeeCode || employee.code || null;

    if (row.source === "activity") {
      const observedMs = toMillis(row.observedAt);
      const activeSeconds = Math.max(Number(row.activeSeconds || 0), 0);
      const idleSeconds = Math.max(Number(row.idleSeconds || 0), 0);
      const status = String(row.status || "").toLowerCase();

      if (observedMs) {
        current.lastSeenAt = Math.max(current.lastSeenAt || 0, observedMs);
      }

      if (observedMs && activeSeconds > 0) {
        const activeInterval = clampInterval(observedMs - activeSeconds * 1000, observedMs, dayStartMs, dayEndMs);
        if (activeInterval) {
          current.productiveIntervals.push(activeInterval);
          current.presenceIntervals.push(activeInterval);
          current.lastActiveAt = Math.max(current.lastActiveAt || 0, observedMs);
        }
      }

      if (observedMs && idleSeconds > 0) {
        const idleInterval = clampInterval(observedMs - idleSeconds * 1000, observedMs, dayStartMs, dayEndMs);
        if (idleInterval) {
          current.presenceIntervals.push(idleInterval);
        }
      }

      if (status === "active" && observedMs) {
        current.lastActiveAt = Math.max(current.lastActiveAt || 0, observedMs);
      }
    } else {
      const startedMs = toMillis(row.startedAt);
      const endedMs = toMillis(row.endedAt) || startedMs;
      const activeSeconds = Math.max(Number(row.activeSeconds || 0), 0);
      const interval = clampInterval(startedMs || 0, endedMs || 0, dayStartMs, dayEndMs);
      if (interval) {
        current.productiveIntervals.push(interval);
        current.presenceIntervals.push(interval);
      } else if (startedMs && activeSeconds > 0) {
        const fallbackInterval = clampInterval(startedMs, startedMs + activeSeconds * 1000, dayStartMs, dayEndMs);
        if (fallbackInterval) {
          current.productiveIntervals.push(fallbackInterval);
          current.presenceIntervals.push(fallbackInterval);
        }
      }

      if (endedMs) {
        current.lastSeenAt = Math.max(current.lastSeenAt || 0, endedMs);
        current.lastActiveAt = Math.max(current.lastActiveAt || 0, endedMs);
      }
    }

    groupedRows.set(canonicalEmployeeId, current);
  }

  const employees = Array.from(groupedRows.values()).map((item) => {
    const productiveSeconds = sumMergedIntervalSeconds(item.productiveIntervals);
    const totalSeconds = sumMergedIntervalSeconds(item.presenceIntervals);
    const idleSeconds = Math.max(totalSeconds - productiveSeconds, 0);
    const lastSeenMs = item.lastSeenAt || 0;
    const lastActiveMs = item.lastActiveAt || 0;
    let status = "offline";

    if (lastActiveMs && nowMs - lastActiveMs <= ACTIVE_WINDOW_MS) {
      status = "online";
    } else if (lastSeenMs && nowMs - lastSeenMs <= AWAY_WINDOW_MS) {
      status = "away";
    }

    return {
      employeeId: item.employeeId,
      employeeName: item.employeeName,
      employeeCode: item.employeeCode,
      status,
      lastSeenAt: item.lastSeenAt ? new Date(item.lastSeenAt).toISOString() : null,
      productiveSeconds,
      idleSeconds,
      totalSeconds
    };
  });

  return {
    date: normalizedDate,
    timezone: timeZone,
    employees: employees.sort((a, b) => {
      const statusRank = { online: 0, away: 1, offline: 2 };
      if (a.status !== b.status) return (statusRank[a.status] ?? 3) - (statusRank[b.status] ?? 3);
      return String(a.employeeName || "").localeCompare(String(b.employeeName || ""));
    })
  };
};

exports.listAppUsage = async ({ organizationId, date, limit = 15, offset = 0, appName = "", processName = "" }) => {
  const timeZone = await getOrganizationTimeZone(organizationId);
  const normalizedDate = toDateKeyInTimeZone(date || new Date(), timeZone);
  const dayStart = startOfDayInTimeZone(normalizedDate, timeZone);
  const dayEnd = endOfDayInTimeZone(normalizedDate, timeZone);
  const pool = await getMonitorPgPool();
  const safeLimit = Math.max(Math.min(Number(limit) || 15, 1000), 1);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  const queryArgs = [String(organizationId), dayStart, dayEnd];
  const filters = [];

  if (String(appName || "").trim()) {
    queryArgs.push(String(appName).trim());
    filters.push(`AND app_name = $${queryArgs.length}`);
  }

  if (String(processName || "").trim()) {
    queryArgs.push(String(processName).trim());
    filters.push(`AND process_name = $${queryArgs.length}`);
  }

  const filterSql = filters.length > 0 ? `\n        ${filters.join("\n        ")}` : "";

  const { rows: appRows } = await pool.query(
    `
      SELECT
        employee_id AS "employeeId",
        employee_name AS "employeeName",
        app_name AS "appName",
        process_name AS "processName",
        COALESCE(SUM(active_seconds), 0)::integer AS "totalSeconds",
        COALESCE(SUM(key_press_count), 0)::integer AS "keyPressCount",
        COUNT(*)::integer AS "sessionCount"
      FROM monitor_app_usage_sessions
      WHERE organization_id = $1
        AND started_at >= $2
        AND started_at <= $3${filterSql}
      GROUP BY employee_id, employee_name, app_name, process_name
      ORDER BY COALESCE(SUM(active_seconds), 0) DESC, MAX(started_at) DESC, app_name ASC, process_name ASC
    `,
    queryArgs
  );

  const { rows: countRows } = await pool.query(
    `
      SELECT COUNT(*)::integer AS total
      FROM monitor_app_usage_sessions
      WHERE organization_id = $1
        AND started_at >= $2
        AND started_at <= $3${filterSql}
    `,
    queryArgs
  );

  const sessionLimitIndex = queryArgs.length + 1;
  const sessionOffsetIndex = queryArgs.length + 2;
  const { rows: sessionRows } = await pool.query(
    `
      SELECT
        session_id AS "sessionId",
        employee_id AS "employeeId",
        device_id AS "deviceId",
        app_name AS "appName",
        process_name AS "processName",
        observed_at AS "observedAt",
        started_at AS "startedAt",
        ended_at AS "endedAt",
        active_seconds AS "activeSeconds",
        COALESCE(key_press_count, 0) AS "keyPressCount",
        COALESCE(key_names, '[]'::jsonb) AS "keyNames",
        COALESCE(typed_text, '') AS "typedText",
        COALESCE(key_stream_text, '') AS "keyStreamText"
      FROM monitor_app_usage_sessions
      WHERE organization_id = $1
        AND started_at >= $2
        AND started_at <= $3${filterSql}
      ORDER BY started_at DESC, session_id DESC
      LIMIT $${sessionLimitIndex} OFFSET $${sessionOffsetIndex}
    `,
    [...queryArgs, safeLimit, safeOffset]
  );

  const employeeIds = Array.from(
    new Set([
      ...appRows.map((row) => String(row.employeeId)).filter(Boolean),
      ...sessionRows.map((row) => String(row.employeeId)).filter(Boolean)
    ])
  );
  const employeeMap = await getEmployeeMap({ organizationId, employeeIds });
  const groupedEmployees = new Map();

  for (const row of appRows) {
    const employee = employeeMap.get(String(row.employeeId)) || {};
    const canonicalEmployeeId = employee.employeeId || String(row.employeeId);
      const current = groupedEmployees.get(canonicalEmployeeId) || {
        employeeId: canonicalEmployeeId,
        employeeName: row.employeeName || employee.name || null,
        employeeCode: employee.code || null,
        totalSeconds: 0,
        totalKeyPresses: 0,
        sessionCount: 0,
        apps: new Map()
      };

      current.employeeName = current.employeeName || employee.name || null;
      current.employeeCode = current.employeeCode || employee.code || null;
      current.totalSeconds += Number(row.totalSeconds || 0);
      current.totalKeyPresses += Number(row.keyPressCount || 0);
      current.sessionCount += Number(row.sessionCount || 0);

    const appKey = `${row.appName}::${row.processName}`;
      const appCurrent = current.apps.get(appKey) || {
        appName: row.appName,
        processName: row.processName,
        totalSeconds: 0,
        keyPressCount: 0,
        sessionCount: 0
      };
      appCurrent.totalSeconds += Number(row.totalSeconds || 0);
      appCurrent.keyPressCount += Number(row.keyPressCount || 0);
      appCurrent.sessionCount += Number(row.sessionCount || 0);
      current.apps.set(appKey, appCurrent);

    groupedEmployees.set(canonicalEmployeeId, current);
  }

  const employees = Array.from(groupedEmployees.values())
    .map((item) => ({
      employeeId: item.employeeId,
      employeeName: item.employeeName,
      employeeCode: item.employeeCode,
      totalSeconds: item.totalSeconds,
      totalKeyPresses: item.totalKeyPresses,
      sessionCount: item.sessionCount,
      apps: Array.from(item.apps.values()).sort((a, b) => b.totalSeconds - a.totalSeconds || a.appName.localeCompare(b.appName))
    }))
    .sort((a, b) => b.totalSeconds - a.totalSeconds || String(a.employeeName || "").localeCompare(String(b.employeeName || "")));

  const sessions = sessionRows.map((row) => {
    const employee = employeeMap.get(String(row.employeeId)) || {};
    return {
      sessionId: row.sessionId,
      employeeId: employee.employeeId || String(row.employeeId),
      employeeName: employee.name || null,
      employeeCode: employee.code || null,
      deviceId: row.deviceId,
      appName: row.appName,
      processName: row.processName,
      observedAt: row.observedAt,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      activeSeconds: Number(row.activeSeconds || 0),
      keyPressCount: Number(row.keyPressCount || 0),
      keyNames: Array.isArray(row.keyNames) ? row.keyNames : [],
      typedText: cleanUserText(row.typedText),
      keyStreamText: cleanUserText(row.keyStreamText)
    };
  });

  const totalSessions = Number(countRows[0]?.total || 0);

  return {
    date: normalizedDate,
    timezone: timeZone,
    employees,
    sessions,
    sessionPage: {
      total: totalSessions,
      limit: safeLimit,
      offset: safeOffset,
      returned: sessions.length,
      hasMore: safeOffset + sessions.length < totalSessions
    }
  };
};

exports.listAppKeyUsage = async ({ organizationId, date }) => {
  const timeZone = await getOrganizationTimeZone(organizationId);
  const normalizedDate = toDateKeyInTimeZone(date || new Date(), timeZone);
  const dayStart = startOfDayInTimeZone(normalizedDate, timeZone);
  const dayEnd = endOfDayInTimeZone(normalizedDate, timeZone);
  const pool = await getMonitorPgPool();
  const { rows } = await pool.query(
    `
      SELECT
        employee_id AS "employeeId",
        employee_name AS "employeeName",
        app_name AS "appName",
        process_name AS "processName",
        active_seconds AS "activeSeconds",
        key_press_count AS "keyPressCount",
        COALESCE(key_names, '[]'::jsonb) AS "keyNames",
        COALESCE(typed_text, '') AS "typedText",
        COALESCE(key_stream_text, '') AS "keyStreamText"
      FROM monitor_app_usage_sessions
      WHERE organization_id = $1
        AND started_at >= $2
        AND started_at <= $3
      ORDER BY started_at DESC
    `,
    [String(organizationId), dayStart, dayEnd]
  );

  const employeeIds = Array.from(new Set(rows.map((row) => String(row.employeeId)).filter(Boolean)));
  const employeeMap = await getEmployeeMap({ organizationId, employeeIds });

  const grouped = new Map();

  for (const row of rows) {
    const employee = employeeMap.get(String(row.employeeId)) || {};
    const canonicalEmployeeId = employee.employeeId || String(row.employeeId);
    const key = `${canonicalEmployeeId}::${row.appName}::${row.processName}`;
    const current = grouped.get(key) || {
      employeeId: canonicalEmployeeId,
      employeeName: row.employeeName || employee.name || null,
      employeeCode: employee.code || null,
      appName: row.appName,
      processName: row.processName,
      totalSeconds: 0,
      keyPressCount: 0,
      sessionCount: 0,
      typedTexts: [],
      keyStreamTexts: [],
      keyNames: new Set(),
    };

    current.totalSeconds += Number(row.activeSeconds || 0);
    current.keyPressCount += Number(row.keyPressCount || 0);
    current.sessionCount += 1;

    const typedText = String(row.typedText || "");
    if (typedText.length > 0) {
      current.typedTexts.push(typedText);
    }

    const keyStreamText = String(row.keyStreamText || "");
    if (keyStreamText.length > 0) {
      current.keyStreamTexts.push(keyStreamText);
    }

    const keyNamesArray = Array.isArray(row.keyNames) ? row.keyNames : [];
    for (const name of keyNamesArray) {
      if (typeof name === "string" && name) {
        current.keyNames.add(name);
      }
    }

    grouped.set(key, current);
  }

  const appKeys = Array.from(grouped.values())
    .map((item) => ({
      employeeId: item.employeeId,
      employeeName: item.employeeName,
      employeeCode: item.employeeCode,
      appName: item.appName,
      processName: item.processName,
      totalSeconds: item.totalSeconds,
      keyPressCount: item.keyPressCount,
      sessionCount: item.sessionCount,
      typedText: cleanUserText(item.typedTexts.slice(0, 5).join("\n\n")),
      keyStreamText: cleanUserText(item.keyStreamTexts.slice(0, 5).join("\n\n")),
      keyNames: Array.from(item.keyNames).sort(),
    }))
    .sort((a, b) => b.keyPressCount - a.keyPressCount || b.totalSeconds - a.totalSeconds || String(a.employeeName || "").localeCompare(String(b.employeeName || "")));

  return {
    date: normalizedDate,
    timezone: timeZone,
    appKeys
  };
};

exports.listBrowserHistory = async ({ organizationId, date, limit = 50, offset = 0, employeeId = "", browser = "" }) => {
  const timeZone = await getOrganizationTimeZone(organizationId);
  const normalizedDate = toDateKeyInTimeZone(date || new Date(), timeZone);
  const dayStart = startOfDayInTimeZone(normalizedDate, timeZone);
  const dayEnd = endOfDayInTimeZone(normalizedDate, timeZone);
  const pool = await getMonitorPgPool();
  const safeLimit = Math.max(Math.min(Number(limit) || 50, 500), 1);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  const queryArgs = [String(organizationId), dayStart, dayEnd];
  const filters = [];

  if (String(employeeId || "").trim()) {
    queryArgs.push(String(employeeId).trim());
    filters.push(`AND employee_id = $${queryArgs.length}`);
  }

  if (String(browser || "").trim()) {
    queryArgs.push(`%${String(browser).trim().toLowerCase()}%`);
    filters.push(`AND LOWER(browser) LIKE $${queryArgs.length}`);
  }

  const filterSql = filters.length > 0 ? `\n        ${filters.join("\n        ")}` : "";

  const { rows: countRows } = await pool.query(
    `
      SELECT COUNT(*)::integer AS total
      FROM monitor_browser_history
      WHERE organization_id = $1
        AND observed_at >= $2
        AND observed_at <= $3${filterSql}
    `,
    queryArgs
  );

  const { rows } = await pool.query(
    `
      SELECT
        entry_id AS "entryId",
        employee_id AS "employeeId",
        employee_name AS "employeeName",
        device_id AS "deviceId",
        observed_at AS "observedAt",
        browser,
        url,
        title,
        active_window_title AS "activeWindowTitle",
        duration_ms AS "durationMs"
      FROM monitor_browser_history
      WHERE organization_id = $1
        AND observed_at >= $2
        AND observed_at <= $3${filterSql}
      ORDER BY observed_at DESC, entry_id DESC
      LIMIT $${queryArgs.length + 1}
      OFFSET $${queryArgs.length + 2}
    `,
    [...queryArgs, safeLimit, safeOffset]
  );

  const employeeIds = Array.from(
    new Set(rows.map((row) => String(row.employeeId)).filter(Boolean))
  );
  const employeeMap = await getEmployeeMap({ organizationId, employeeIds });

  const historiesWithIds = rows.map((row) => {
    const employee = employeeMap.get(String(row.employeeId)) || {};
    return {
      id: row.entryId,
      employeeId: employee.employeeId || String(row.employeeId),
      employeeName: employee.name || row.employeeName || null,
      employeeCode: employee.code || null,
      deviceId: row.deviceId,
      browser: row.browser,
      url: row.url,
      title: row.title,
      timestamp: row.observedAt,
      duration: Number(row.durationMs || 0),
      activeWindowTitle: row.activeWindowTitle || null
    };
  });

  return {
    date: normalizedDate,
    timezone: timeZone,
    histories: historiesWithIds,
    total: Number(countRows[0]?.total || 0)
  };
};
