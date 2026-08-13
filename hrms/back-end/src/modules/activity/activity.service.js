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

exports.listEmployees = async ({ organizationId, date }) => {
  const timeZone = await getOrganizationTimeZone(organizationId);
  const normalizedDate = toDateKeyInTimeZone(date || new Date(), timeZone);
  const dayStart = startOfDayInTimeZone(normalizedDate, timeZone);
  const dayEnd = endOfDayInTimeZone(normalizedDate, timeZone);
  const pool = await getMonitorPgPool();
  const { rows } = await pool.query(
    `WITH daily AS (
      SELECT employee_id, MAX(employee_name) AS employee_name,
        COALESCE(SUM(active_seconds), 0)::integer AS productive_seconds
      FROM monitor_activity_events
      WHERE organization_id = $1
        AND observed_at >= $2
        AND observed_at <= $3
      GROUP BY employee_id
    ), presence AS (
      SELECT employee_id, MAX(employee_name) AS employee_name,
        BOOL_OR(status = 'active' AND last_seen_at >= NOW() - ($4::integer * INTERVAL '1 second')) AS is_active,
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
    [String(organizationId), dayStart, dayEnd, ACTIVE_PRESENCE_WINDOW_SECONDS]
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

  return {
    date: normalizedDate,
    timezone: timeZone,
    employees: Array.from(groupedRows.values()).sort((a, b) => {
      if (a.status !== b.status) return a.status === "active" ? -1 : 1;
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
