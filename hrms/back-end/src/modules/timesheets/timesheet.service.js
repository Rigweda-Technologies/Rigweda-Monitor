const Timesheet = require("./timesheet.model");
const mongoose = require("mongoose");
const Attendance = require("./timesheetAttendance.model");
const AttendanceRequest = require("./attendanceRequest.model");
const Employee = require("../employees/employee.model");
const Leave = require("../leaves/leave.model");
const { audit } = require("../auditLogs/auditLogs.service");
const Role = require("../roles/role.model");
const OrgSettings = require("../orgSettings/orgSettings.model");
const Organization = require("../organizations/organization.model");
const WeekOffService = require("../weekOffs/weekOff.service");
const Holiday = require("../holidays/holiday.model");
const AuditLog = require("../auditLogs/auditLogs.model");
const sendMail = require("../../utils/sendMail");
const { createNotificationSafe } = require("../notifications/notification.service");
const Shift = require("../shifts/shift.model");
const payrollAttendanceService = require("../payroll/payrollAttendance.service");
const { normalizeAttendanceRequestDateKey } = require("./attendanceRequest.utils");
const {
  resolveApplicableFlow,
  buildRuntimeSteps,
  getActorApprovalContext,
  canActorApproveStep,
  resolveRecipientsForStep
} = require("../../utils/approvalFlowEngine");
const ApprovalFlow = require("../approvalFlows/approvalFlow.model");
const {
  advanceApprovalSteps,
  getCurrentPendingStep,
  resolveCurrentPendingStep
} = require("../../utils/approvalProgress");
const {
  isValidTimeZone,
  toDateKeyInTimeZone,
  addDaysToDateKey,
  zonedDateTimeToUtc,
  startOfDayInTimeZone,
  endOfDayInTimeZone,
  parseMonthRangeInTimeZone,
  getDayInTimeZone,
  getWeekdayForDateKey
} = require("../../utils/timezone");
const { analyzeLeaveDateKeys } = require("../leaves/leavePolicy.util");
const { emitAttendanceUpdate } = require("../../realtime/socket");
const { getMonitorPgPool } = require("../../config/monitorDb");

const REQUEST_APPROVER_ROLE_SLUGS = new Set([
  "manager",
  "hr",
  "admin",
  "org-admin",
  "superadmin"
]);

const ATTENDANCE_SELFIE_VIEW_ROLE_SLUGS = new Set(["hr", "org-admin"]);
const ATTENDANCE_HOURS_SOURCES = new Set(["monitor_agent", "manual", "biometric", "access_card"]);
const FACEPP_COMPARE_URL = process.env.FACEPP_COMPARE_URL || "https://api-us.faceplusplus.com/facepp/v3/compare";
const FACE_MATCH_MIN_CONFIDENCE = Number(process.env.FACE_MATCH_MIN_CONFIDENCE || 70);

const getMonitorAttendanceHours = async ({ organizationId, start, end, timeZone, employees }) => {
  const pool = await getMonitorPgPool();
  const employeeMap = new Map();
  for (const employee of employees || []) {
    const details = String(employee._id);
    employeeMap.set(details, details);
    if (employee.employeeCode) employeeMap.set(String(employee.employeeCode), details);
    if (employee.userId) employeeMap.set(String(employee.userId), details);
  }

  const { rows } = await pool.query(
     `WITH activity_daily AS (
       SELECT employee_id,
         to_char((observed_at AT TIME ZONE $4)::date, 'YYYY-MM-DD') AS date_key,
         COALESCE(SUM(active_seconds + idle_seconds), 0)::bigint AS total_seconds,
         MAX(observed_at) AS last_observed_at
       FROM monitor_activity_events
       WHERE organization_id = $1 AND observed_at >= $2 AND observed_at <= $3
       GROUP BY employee_id, (observed_at AT TIME ZONE $4)::date
     ),
     session_daily AS (
       SELECT employee_id,
         to_char((started_at AT TIME ZONE $4)::date, 'YYYY-MM-DD') AS date_key,
         MIN(started_at) AS first_seen_at,
         MAX(ended_at) AS last_seen_at
       FROM monitor_app_usage_sessions
       WHERE organization_id = $1 AND started_at <= $3 AND ended_at >= $2
       GROUP BY employee_id, (started_at AT TIME ZONE $4)::date
     )
     SELECT COALESCE(activity_daily.employee_id, session_daily.employee_id) AS employee_id,
       COALESCE(activity_daily.date_key, session_daily.date_key) AS date_key,
       COALESCE(activity_daily.total_seconds, 0)::bigint AS total_seconds,
       CASE
         WHEN session_daily.first_seen_at IS NOT NULL
          AND session_daily.last_seen_at IS NOT NULL
          AND session_daily.first_seen_at < session_daily.last_seen_at
         THEN session_daily.first_seen_at
         WHEN activity_daily.last_observed_at IS NOT NULL AND COALESCE(activity_daily.total_seconds, 0) > 0
         THEN activity_daily.last_observed_at - (COALESCE(activity_daily.total_seconds, 0)::text || ' seconds')::interval
         ELSE session_daily.first_seen_at
       END AS first_seen_at,
       COALESCE(session_daily.last_seen_at, activity_daily.last_observed_at) AS last_seen_at
     FROM activity_daily
     FULL OUTER JOIN session_daily
       ON activity_daily.employee_id = session_daily.employee_id
      AND activity_daily.date_key = session_daily.date_key`,
    [String(organizationId), start, end, timeZone]
  );

  return new Map(rows.map((row) => {
    const employeeId = employeeMap.get(String(row.employee_id));
    return [`${employeeId || row.employee_id}|${row.date_key}`, {
      employeeId: employeeId || String(row.employee_id),
      totalMinutes: Math.max(0, Math.round(Number(row.total_seconds || 0) / 60)),
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at
    }];
  }));
};

const getAttendanceHoursSource = async (organizationId) => {
  const settings = await OrgSettings.findOne({ organizationId })
    .select("attendanceHoursSource")
    .lean();
  return ATTENDANCE_HOURS_SOURCES.has(settings?.attendanceHoursSource)
    ? settings.attendanceHoursSource
    : "manual";
};

const assertManualAttendanceEnabled = async (organizationId) => {
  const attendanceHoursSource = await getAttendanceHoursSource(organizationId);
  if (attendanceHoursSource === "monitor_agent") {
    throwHttpError(409, "Manual attendance is disabled because attendance is sourced from the Monitor agent.");
  }
};

const buildMonitorAttendanceList = async ({ organizationId, start, end, timeZone, employees }) => {
  const monitorHours = await getMonitorAttendanceHours({
    organizationId,
    start,
    end,
    timeZone,
    employees
  });

  return Array.from(monitorHours.values())
    .filter((row) => Number(row.totalMinutes || 0) > 0 || row.firstSeenAt || row.lastSeenAt)
    .map((row) => ({
      _id: null,
      organizationId,
      employeeId: row.employeeId,
      date: startOfDayInTimeZone(row.dateKey, timeZone),
      checkInAt: row.firstSeenAt ? new Date(row.firstSeenAt).toISOString() : null,
      checkOutAt: row.lastSeenAt ? new Date(row.lastSeenAt).toISOString() : null,
      totalMinutes: row.totalMinutes,
      status: "present",
      hoursSource: "monitor_agent",
      lateByMinutes: 0,
      earlyLoginByMinutes: 0,
      earlyCheckoutByMinutes: 0,
      overtimeMinutes: 0,
      missedCheckout: false,
      overriddenBy: null,
      overriddenAt: null
    }))
    .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime());
};

const parseDateValue = (value) => {
  if (value instanceof Date) return new Date(value);
  if (typeof value === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]) - 1;
      const day = Number(match[3]);
      return new Date(year, month, day);
    }
  }
  return new Date(value);
};

const startOfDay = (value) => {
  const d = parseDateValue(value);
  d.setHours(0, 0, 0, 0);
  return d;
};

const endOfDay = (value) => {
  const d = new Date(value);
  d.setHours(23, 59, 59, 999);
  return d;
};

const getWeekStart = (value, weekStartDay = 1) => {
  const d = startOfDay(value);
  const day = d.getDay();
  const diff = (day - weekStartDay + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d;
};

const getWeekEnd = (weekStart) => {
  const d = startOfDay(weekStart);
  d.setDate(d.getDate() + 6);
  return d;
};

const parsePositiveInt = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
};

const escapeRegex = (value = "") => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildWeekDates = (weekStart) => {
  const dates = [];
  for (let i = 0; i < 7; i += 1) {
    const d = startOfDay(weekStart);
    d.setDate(d.getDate() + i);
    dates.push(d);
  }
  return dates;
};

const toDateKey = (value) => {
  const d = startOfDay(value);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const buildAttendanceActivityHistory = (history, attendance) => {
  const normalizedHistory = history.map((entry) => ({
    action: entry.action,
    createdAt: entry.createdAt,
    actor: entry.userId?.email || "Unknown",
    before: entry.before || null,
    after: entry.after || null
  }));

  const hasCheckInEvent = normalizedHistory.some((entry) => entry.action === "CHECK_IN");
  const hasCheckOutEvent = normalizedHistory.some((entry) => entry.action === "CHECK_OUT");

  if (!hasCheckInEvent && attendance?.checkInAt) {
    normalizedHistory.push({
      action: "CHECK_IN",
      createdAt: attendance.checkInAt,
      actor: "Employee",
      before: null,
      after: null
    });
  }

  if (!hasCheckOutEvent && attendance?.checkOutAt) {
    normalizedHistory.push({
      action: "CHECK_OUT",
      createdAt: attendance.checkOutAt,
      actor: "Employee",
      before: null,
      after: null
    });
  }

  return normalizedHistory.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
};

const toEmployeeDisplayName = (employee) => {
  if (!employee) return null;
  const name = `${employee.firstName || ""} ${employee.lastName || ""}`.trim();
  return name || employee.employeeCode || null;
};

const resolveActionEmployeeFromRequest = (requestLike) => {
  if (!requestLike) return null;
  if (requestLike.actionBy) return requestLike.actionBy;
  const approvedSteps = Array.isArray(requestLike.approvalSteps)
    ? requestLike.approvalSteps.filter((step) => step?.status === "approved" && step?.actionBy)
    : [];
  if (!approvedSteps.length) return null;
  const latestApprovedStep = approvedSteps
    .slice()
    .sort((left, right) => new Date(right.actionAt || 0).getTime() - new Date(left.actionAt || 0).getTime())[0];
  return latestApprovedStep?.actionBy || null;
};

const resolveActionAtFromRequest = (requestLike) => {
  if (!requestLike) return null;
  if (requestLike.actionAt) return requestLike.actionAt;
  const approvedSteps = Array.isArray(requestLike.approvalSteps)
    ? requestLike.approvalSteps.filter((step) => step?.status === "approved" && step?.actionAt)
    : [];
  if (!approvedSteps.length) return null;
  return approvedSteps
    .slice()
    .sort((left, right) => new Date(right.actionAt || 0).getTime() - new Date(left.actionAt || 0).getTime())[0]
    ?.actionAt || null;
};

const eachDateBetween = (from, to) => {
  const dates = [];
  const start = startOfDay(from);
  const end = startOfDay(to);
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
};

const parseTimeToMinutes = (timeString) => {
  if (!timeString || !/^\d{2}:\d{2}$/.test(timeString)) return null;
  const [hh, mm] = timeString.split(":").map(Number);
  return hh * 60 + mm;
};

const extractBase64Payload = (value = "") => {
  if (!value || typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("data:")) {
    const commaIndex = trimmed.indexOf(",");
    return commaIndex >= 0 ? trimmed.slice(commaIndex + 1) : "";
  }
  return trimmed;
};

const compareFacesWithFacePP = async ({ profileImageUrl, selfieImage }) => {
  const apiKey = process.env.FACEPP_API_KEY;
  const apiSecret = process.env.FACEPP_API_SECRET;
  if (!apiKey || !apiSecret) {
    throwHttpError(503, "Selfie face verification is not configured. Contact admin.");
  }

  const selfieBase64 = extractBase64Payload(selfieImage);
  if (!selfieBase64) {
    throwHttpError(400, "Invalid selfie image payload");
  }

  const body = new URLSearchParams();
  body.set("api_key", apiKey);
  body.set("api_secret", apiSecret);
  body.set("image_url1", profileImageUrl);
  body.set("image_base64_2", selfieBase64);

  let responseJson;
  try {
    const response = await fetch(FACEPP_COMPARE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });
    responseJson = await response.json();
  } catch (_) {
    throwHttpError(502, "Face verification service is unreachable");
  }

  if (responseJson?.error_message) {
    throwHttpError(400, `Face verification failed: ${responseJson.error_message}`);
  }

  const confidence = Number(responseJson?.confidence || 0);
  const passed = confidence >= FACE_MATCH_MIN_CONFIDENCE;
  return { passed, confidence };
};

const buildAttendanceMatrixEmployeeQuery = ({ organizationId, monthStart, scopedEmployeeIds, search }) => {
  const employeeQuery = {
    organizationId,
    $and: [
      {
        $or: [
          { status: "active" },
          {
            status: "resigned",
            lastWorkingDay: { $ne: null, $gte: monthStart }
          }
        ]
      }
    ]
  };

  const trimmedSearch = String(search || "").trim();
  if (trimmedSearch) {
    const searchRegex = new RegExp(escapeRegex(trimmedSearch), "i");
    employeeQuery.$and.push({
      $or: [
        { firstName: searchRegex },
        { lastName: searchRegex },
        { employeeCode: searchRegex }
      ]
    });
  }

  if (Array.isArray(scopedEmployeeIds)) {
    employeeQuery._id = { $in: scopedEmployeeIds };
  }

  return employeeQuery;
};

const buildScheduledDateTime = (dateValue, minutesFromMidnight) => {
  const d = startOfDay(dateValue);
  d.setMinutes(minutesFromMidnight);
  return d;
};

const getDefaultShift = () => ({
  _id: null,
  name: "General Shift",
  code: "GEN",
  startTime: "09:00",
  endTime: "18:00",
  graceMinutes: 0
});

const getOrganizationTimeZone = async (organizationId) => {
  const settings = await OrgSettings.findOne({ organizationId }).select("timezone");
  if (isValidTimeZone(settings?.timezone)) return settings.timezone;

  const organization = await Organization.findById(organizationId).select("timezone");
  if (isValidTimeZone(organization?.timezone)) return organization.timezone;

  return "Asia/Kolkata";
};

const resolveShiftSchedule = async (organizationId, employeeId, dateValue, timeZone = "UTC") => {
  const employee = await Employee.findOne({
    _id: employeeId,
    organizationId
  }).select("shiftId");

  let shift = null;
  if (employee?.shiftId) {
    shift = await Shift.findOne({
      _id: employee.shiftId,
      organizationId,
      status: "active"
    }).select("name code startTime endTime graceMinutes");
  }

  const effectiveShift = shift || getDefaultShift();
  const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(String(dateValue || ""))
    ? String(dateValue)
    : toDateKeyInTimeZone(dateValue, timeZone);
  const startMinutes = parseTimeToMinutes(effectiveShift.startTime);
  const endMinutes = parseTimeToMinutes(effectiveShift.endTime);

  const scheduledStartAt = zonedDateTimeToUtc(dateKey, effectiveShift.startTime, timeZone);
  let scheduledEndAt = zonedDateTimeToUtc(dateKey, effectiveShift.endTime, timeZone);

  // Overnight shift support, e.g. 22:00 -> 06:00
  if (endMinutes <= startMinutes) {
    scheduledEndAt = new Date(scheduledEndAt.getTime() + (24 * 60 * 60 * 1000));
  }

  return {
    shift: effectiveShift,
    scheduledStartAt,
    scheduledEndAt
  };
};

const resolveCheckInSchedule = async (organizationId, employeeId, now, timeZone) => {
  const todayKey = toDateKeyInTimeZone(now, timeZone);
  const yesterdayKey = addDaysToDateKey(todayKey, -1);

  const yesterdaySchedule = await resolveShiftSchedule(
    organizationId,
    employeeId,
    yesterdayKey,
    timeZone
  );

  const yesterdayStartMins = parseTimeToMinutes(yesterdaySchedule.shift.startTime);
  const yesterdayEndMins = parseTimeToMinutes(yesterdaySchedule.shift.endTime);
  const isYesterdayOvernight = yesterdayEndMins <= yesterdayStartMins;
  if (
    isYesterdayOvernight
    && now <= yesterdaySchedule.scheduledEndAt
  ) {
    return {
      attendanceDateKey: yesterdayKey,
      ...yesterdaySchedule
    };
  }

  const todaySchedule = await resolveShiftSchedule(
    organizationId,
    employeeId,
    todayKey,
    timeZone
  );

  return {
    attendanceDateKey: todayKey,
    ...todaySchedule
  };
};

const resolveAttendanceScheduleForRequest = async ({
  organizationId,
  employeeId,
  attendanceRow,
  attendanceDateKey,
  organizationTimeZone
}) => {
  const storedStartTime = attendanceRow?.shiftStartTime || null;
  const storedEndTime = attendanceRow?.shiftEndTime || null;
  const hasStoredShiftWindow = Boolean(storedStartTime && storedEndTime);

  if (!hasStoredShiftWindow) {
    return resolveShiftSchedule(
      organizationId,
      employeeId,
      attendanceDateKey,
      organizationTimeZone
    );
  }

  let storedShift = null;
  if (attendanceRow?.shiftId) {
    storedShift = await Shift.findOne({
      _id: attendanceRow.shiftId,
      organizationId,
      status: "active"
    }).select("name code startTime endTime graceMinutes");
  }

  const shift = storedShift || {
    _id: attendanceRow?.shiftId || null,
    name: attendanceRow?.shiftName || getDefaultShift().name,
    code: attendanceRow?.shiftCode || getDefaultShift().code,
    startTime: storedStartTime,
    endTime: storedEndTime,
    graceMinutes: 0
  };

  const startMinutes = parseTimeToMinutes(shift.startTime);
  const endMinutes = parseTimeToMinutes(shift.endTime);
  const scheduledStartAt = attendanceRow?.scheduledStartAt
    ? new Date(attendanceRow.scheduledStartAt)
    : zonedDateTimeToUtc(attendanceDateKey, shift.startTime, organizationTimeZone);
  let scheduledEndAt = attendanceRow?.scheduledEndAt
    ? new Date(attendanceRow.scheduledEndAt)
    : zonedDateTimeToUtc(attendanceDateKey, shift.endTime, organizationTimeZone);

  if (!attendanceRow?.scheduledEndAt && endMinutes !== null && startMinutes !== null && endMinutes <= startMinutes) {
    scheduledEndAt = new Date(scheduledEndAt.getTime() + (24 * 60 * 60 * 1000));
  }

  return {
    shift,
    scheduledStartAt,
    scheduledEndAt
  };
};

const buildRequestedCheckOutAt = (attendanceDateKey, requestedCheckOutTime, checkInAt, timeZone) => {
  if (!attendanceDateKey || !requestedCheckOutTime) return null;
  let checkOutAt = zonedDateTimeToUtc(attendanceDateKey, requestedCheckOutTime, timeZone);
  if (checkOutAt && checkInAt && checkOutAt <= checkInAt) {
    checkOutAt = new Date(checkOutAt.getTime() + (24 * 60 * 60 * 1000));
  }
  return checkOutAt;
};

const isAttendanceRowOvernight = (attendanceRow, organizationTimeZone) => {
  const attendanceDateKey = getAttendanceStoredDateKey(attendanceRow, organizationTimeZone);
  if (
    attendanceRow?.scheduledEndAt
    && toDateKeyInTimeZone(attendanceRow.scheduledEndAt, organizationTimeZone) !== attendanceDateKey
  ) {
    return true;
  }

  const startMinutes = parseTimeToMinutes(attendanceRow?.shiftStartTime);
  const endMinutes = parseTimeToMinutes(attendanceRow?.shiftEndTime);
  return startMinutes !== null && endMinutes !== null && endMinutes <= startMinutes;
};

const resolveMissedCheckoutAttendanceTarget = async ({
  organizationId,
  employeeId,
  requestedDateKey,
  requestedCheckOutTime,
  organizationTimeZone
}) => {
  const previousDateKey = addDaysToDateKey(requestedDateKey, -1);
  const candidateDateKeys = Array.from(new Set([requestedDateKey, previousDateKey].filter(Boolean)));
  const candidateDates = candidateDateKeys.map((dateKey) => startOfDayInTimeZone(dateKey, organizationTimeZone));

  const rows = await Attendance.find({
    organizationId,
    employeeId,
    $or: [
      { dateKey: { $in: candidateDateKeys } },
      { date: { $in: candidateDates } }
    ],
    checkInAt: { $ne: null }
  })
    .select("date dateKey checkInAt checkOutAt scheduledEndAt shiftStartTime shiftEndTime")
    .sort({ date: -1, checkInAt: -1 });

  const exactOpenRow = rows.find((row) => {
    const attendanceDateKey = toDateKeyInTimeZone(row.date, organizationTimeZone);
    return attendanceDateKey === requestedDateKey && row.checkInAt && !row.checkOutAt;
  });
  if (exactOpenRow) {
    return {
      attendance: exactOpenRow,
      attendanceDateKey: requestedDateKey,
      attendanceDate: requestedDateKey
    };
  }

  const previousOpenRow = rows.find((row) => {
    const attendanceDateKey = toDateKeyInTimeZone(row.date, organizationTimeZone);
    return attendanceDateKey === previousDateKey && row.checkInAt && !row.checkOutAt;
  });
  if (!previousOpenRow || !isAttendanceRowOvernight(previousOpenRow, organizationTimeZone)) {
    return null;
  }

  const resolvedCheckOutAt = buildRequestedCheckOutAt(
    previousDateKey,
    requestedCheckOutTime,
    previousOpenRow.checkInAt,
    organizationTimeZone
  );
  if (!resolvedCheckOutAt) {
    return null;
  }

  if (toDateKeyInTimeZone(resolvedCheckOutAt, organizationTimeZone) !== requestedDateKey) {
    return null;
  }

  return {
    attendance: previousOpenRow,
    attendanceDateKey: previousDateKey,
    attendanceDate: previousDateKey
  };
};

const resolveAttendanceTargetForRequestDate = async ({
  organizationId,
  employeeId,
  requestedDateKey,
  requestedCheckOutTime,
  organizationTimeZone
}) => {
  const exactRow = await Attendance.findOne({
    organizationId,
    employeeId,
    ...buildAttendanceDateMatch(requestedDateKey, organizationTimeZone)
  }).select("date dateKey checkInAt checkOutAt scheduledEndAt shiftStartTime shiftEndTime");

  if (exactRow) {
    return {
      attendance: exactRow,
      attendanceDateKey: requestedDateKey,
      attendanceDate: requestedDateKey
    };
  }

  if (!requestedCheckOutTime) {
    return null;
  }

  const previousDateKey = addDaysToDateKey(requestedDateKey, -1);
  const previousRow = await Attendance.findOne({
    organizationId,
    employeeId,
    ...buildAttendanceDateMatch(previousDateKey, organizationTimeZone)
  }).select("date dateKey checkInAt checkOutAt scheduledEndAt shiftStartTime shiftEndTime");

  if (!previousRow || !isAttendanceRowOvernight(previousRow, organizationTimeZone)) {
    return null;
  }

  const resolvedCheckOutAt = buildRequestedCheckOutAt(
    previousDateKey,
    requestedCheckOutTime,
    previousRow.checkInAt,
    organizationTimeZone
  );
  if (!resolvedCheckOutAt) {
    return null;
  }

  if (toDateKeyInTimeZone(resolvedCheckOutAt, organizationTimeZone) !== requestedDateKey) {
    return null;
  }

  return {
    attendance: previousRow,
    attendanceDateKey: previousDateKey,
    attendanceDate: previousDateKey
  };
};

const sendNotification = async ({ toEmail, toName, subject, message }) => {
  if (!toEmail) return;
  try {
    await sendMail("notification", toName || "User", subject, message, toEmail);
  } catch (_) {
    // non-blocking notification
  }
};

const notifyAttendanceApprovalStepAssignees = async ({
  organizationId,
  step,
  actorEmployeeId = null,
  title,
  message,
  type,
  meta = {}
}) => {
  if (!step) return;
  const recipients = await resolveRecipientsForStep({ organizationId, step });
  for (const recipient of recipients) {
    await createNotificationSafe({
      organizationId,
      recipientUserId: recipient.userId,
      recipientEmployeeId: recipient.employeeId,
      actorEmployeeId,
      type,
      title,
      message,
      meta
    });
  }
};

const notifyAttendanceFallbackApprovers = async ({
  organizationId,
  employee,
  title,
  message,
  type,
  meta = {}
}) => {
  const fallbackSteps = [
    employee?.managerId
      ? { approverType: "manager", approverEmployeeId: employee.managerId }
      : null,
    ...["hr", "admin", "org-admin", "superadmin"].map((approverRoleSlug) => ({
      approverType: "role",
      approverRoleSlug
    }))
  ].filter(Boolean);

  const recipientMap = new Map();
  for (const step of fallbackSteps) {
    const recipients = await resolveRecipientsForStep({ organizationId, step });
    for (const recipient of recipients) {
      const userId = recipient.userId?.toString();
      if (userId) recipientMap.set(userId, recipient);
    }
  }

  for (const recipient of recipientMap.values()) {
    await createNotificationSafe({
      organizationId,
      recipientUserId: recipient.userId,
      recipientEmployeeId: recipient.employeeId,
      actorEmployeeId: employee?._id || null,
      type,
      title,
      message,
      meta
    });
  }
};

const notifyAttendanceRequestEmployee = async ({
  request,
  status,
  actorEmployeeId = null,
  attendance = null
}) => {
  const employee = await Employee.findById(request.employeeId).populate("userId", "_id email");
  if (!employee?.userId?._id) return;

  await createNotificationSafe({
    organizationId: request.organizationId,
    recipientUserId: employee.userId._id,
    recipientEmployeeId: employee._id,
    actorEmployeeId,
    type: "attendance_request_action",
    title: `Attendance request ${status}`,
    message: `Your ${String(request.requestType || "attendance").replace(/_/g, " ")} request was ${status}.`,
    meta: {
      attendanceRequestId: request._id,
      attendanceId: attendance?._id || null,
      status,
      date: request.date
    }
  });

  if (attendance) {
    emitAttendanceUpdate(
      { organizationId: request.organizationId, userId: employee.userId._id },
      {
        event: "REQUEST_APPROVED",
        attendance: attendance.toObject ? attendance.toObject() : attendance
      }
    );
  }
};

const sanitizeEntries = (entries, weekStart) => {
  const byDate = new Map();

  for (const entry of entries || []) {
    const key = toDateKey(entry.date);
    if (!byDate.has(key)) {
      byDate.set(key, {
        date: startOfDay(entry.date),
        hours: Number(entry.hours || 0),
        notes: entry.notes || ""
      });
    }
  }

  return buildWeekDates(weekStart).map((date) => {
    const key = toDateKey(date);
    const existing = byDate.get(key);
    if (existing) {
      return existing;
    }
    return { date, hours: 0, notes: "" };
  });
};

const combineDateAndTime = (dateValue, hhmm) => {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return null;
  const [hh, mm] = hhmm.split(":").map(Number);
  const d = startOfDay(dateValue);
  d.setHours(hh, mm, 0, 0);
  return d;
};

const calculateTotalHours = (entries) =>
  (entries || []).reduce((sum, entry) => sum + (Number(entry.hours) || 0), 0);

const throwHttpError = (code, message) => {
  throw { code, statusCode: code, message };
};

const normalizeObjectIdLike = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object") {
    if (typeof value._id === "string") return value._id.trim();
    if (typeof value.employeeId === "string") return value.employeeId.trim();
    if (value._id && typeof value._id === "object" && typeof value._id.toString === "function") {
      return value._id.toString().trim();
    }
    if (typeof value.toString === "function" && value.toString !== Object.prototype.toString) {
      return value.toString().trim();
    }
  }
  return String(value).trim();
};

const assertValidObjectIdLike = (value, fieldName) => {
  const normalized = normalizeObjectIdLike(value);
  if (!mongoose.Types.ObjectId.isValid(normalized)) {
    throwHttpError(400, `Invalid ${fieldName}`);
  }
  return normalized;
};

const serializeMongoIdsDeep = (value) => {
  if (value == null) return value;
  if (value instanceof mongoose.Types.ObjectId) return value.toString();
  if (Array.isArray(value)) return value.map((item) => serializeMongoIdsDeep(item));
  if (value instanceof Date) return value;
  if (typeof value !== "object") return value;

  const source = typeof value.toObject === "function" ? value.toObject() : value;
  const output = {};

  Object.keys(source).forEach((key) => {
    output[key] = serializeMongoIdsDeep(source[key]);
  });

  return output;
};

const isAttendanceDateKey = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

const getAttendanceStoredDateKey = (row, organizationTimeZone = "Asia/Kolkata") => {
  if (isAttendanceDateKey(row?.dateKey)) return row.dateKey;
  if (isAttendanceDateKey(row?.date)) return row.date;
  if (row?.date) return toDateKeyInTimeZone(row.date, organizationTimeZone);
  return "";
};

const getAttendanceRowAnchorDate = (row) =>
  row?.checkInAt || row?.checkOutAt || row?.dateKey || row?.date || row?.createdAt || null;

const getAttendanceRowDayKey = (row, organizationTimeZone = "Asia/Kolkata") => {
  const anchorDate = getAttendanceRowAnchorDate(row);
  if (anchorDate) return toDateKeyInTimeZone(anchorDate, organizationTimeZone);
  return getAttendanceStoredDateKey(row, organizationTimeZone);
};

const getAttendanceRowNormalizedDate = (row, organizationTimeZone = "Asia/Kolkata") => {
  const dateKey = getAttendanceRowDayKey(row, organizationTimeZone);
  return dateKey || null;
};

const normalizeAttendanceDocumentDateFields = (attendance, organizationTimeZone = "Asia/Kolkata") => {
  if (!attendance) return attendance;
  const normalizedDateKey = getAttendanceRowNormalizedDate(attendance, organizationTimeZone);
  if (!normalizedDateKey) return attendance;

  attendance.dateKey = normalizedDateKey;
  attendance.date = startOfDayInTimeZone(normalizedDateKey, organizationTimeZone);
  return attendance;
};

const buildAttendanceDateMatch = (dateKey, organizationTimeZone = "Asia/Kolkata") => {
  const legacyDate = startOfDayInTimeZone(dateKey, organizationTimeZone);
  return {
    $or: [
      { dateKey },
      { date: legacyDate }
    ]
  };
};

const mergeAttendanceRowsByEmployeeDay = (rows = [], organizationTimeZone = "Asia/Kolkata") => {
  const grouped = new Map();

  for (const row of rows || []) {
    const source = typeof row?.toObject === "function" ? row.toObject() : row;
    if (!source) continue;

    const employeeIdValue = source.employeeId?._id || source.employeeId;
    const anchorDate = getAttendanceRowAnchorDate(source);
    if (!employeeIdValue || !anchorDate) continue;
    const employeeId = String(employeeIdValue);
    const dateKey = toDateKeyInTimeZone(anchorDate, organizationTimeZone);
    const key = `${employeeId}-${dateKey}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        ...source,
        employeeId: source.employeeId,
        date: startOfDayInTimeZone(dateKey, organizationTimeZone),
        dateKey
      });
      continue;
    }

    const existing = grouped.get(key);
    const existingCheckIn = existing.checkInAt ? new Date(existing.checkInAt) : null;
    const currentCheckIn = source.checkInAt ? new Date(source.checkInAt) : null;
    const existingCheckOut = existing.checkOutAt ? new Date(existing.checkOutAt) : null;
    const currentCheckOut = source.checkOutAt ? new Date(source.checkOutAt) : null;

    // Keep first check-in of the day.
    if (currentCheckIn && (!existingCheckIn || currentCheckIn < existingCheckIn)) {
      existing.checkInAt = source.checkInAt;
      existing.checkInIp = source.checkInIp || existing.checkInIp || null;
      existing.checkInLatitude = Number.isFinite(source.checkInLatitude)
        ? Number(source.checkInLatitude)
        : (existing.checkInLatitude ?? null);
      existing.checkInLongitude = Number.isFinite(source.checkInLongitude)
        ? Number(source.checkInLongitude)
        : (existing.checkInLongitude ?? null);
    }

    // Keep last checkout of the day.
    if (currentCheckOut && (!existingCheckOut || currentCheckOut > existingCheckOut)) {
      existing.checkOutAt = source.checkOutAt;
      existing.checkOutIp = source.checkOutIp || existing.checkOutIp || null;
    }

    existing.totalMinutes = Math.max(
      Number(existing.totalMinutes || 0),
      Number(source.totalMinutes || 0)
    );
    existing.checkInSelfieProvided = Boolean(
      existing.checkInSelfieProvided || source.checkInSelfieProvided
    );
    existing.checkInSelfieImage = existing.checkInSelfieImage || source.checkInSelfieImage || null;
    existing.checkOutSelfieProvided = Boolean(
      existing.checkOutSelfieProvided || source.checkOutSelfieProvided
    );
    existing.checkOutSelfieImage = existing.checkOutSelfieImage || source.checkOutSelfieImage || null;
    existing.dayHistory = [
      ...(existing.dayHistory || []),
      ...(source.dayHistory || [])
    ].sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime());
    existing.shiftId = existing.shiftId || source.shiftId || null;
    existing.shiftName = existing.shiftName || source.shiftName || null;
    existing.shiftCode = existing.shiftCode || source.shiftCode || null;
    existing.shiftStartTime = existing.shiftStartTime || source.shiftStartTime || null;
    existing.shiftEndTime = existing.shiftEndTime || source.shiftEndTime || null;
    existing.scheduledStartAt = existing.scheduledStartAt || source.scheduledStartAt || null;
    existing.scheduledEndAt = existing.scheduledEndAt || source.scheduledEndAt || null;
    existing.lateByMinutes = Math.max(
      Number(existing.lateByMinutes || 0),
      Number(source.lateByMinutes || 0)
    );
    existing.earlyLoginByMinutes = Math.max(
      Number(existing.earlyLoginByMinutes || 0),
      Number(source.earlyLoginByMinutes || 0)
    );
    existing.earlyCheckoutByMinutes = Math.max(
      Number(existing.earlyCheckoutByMinutes || 0),
      Number(source.earlyCheckoutByMinutes || 0)
    );
    existing.overtimeMinutes = Math.max(
      Number(existing.overtimeMinutes || 0),
      Number(source.overtimeMinutes || 0)
    );
    existing.overriddenAt = existing.overriddenAt || source.overriddenAt || null;
    existing.overriddenBy = existing.overriddenBy || source.overriddenBy || null;
    existing.missedCheckout = Boolean(existing.missedCheckout || source.missedCheckout);
    existing.missedCheckoutMarkedAt = existing.missedCheckoutMarkedAt || source.missedCheckoutMarkedAt || null;

    grouped.set(key, existing);
  }

  return Array.from(grouped.values()).map((row) => {
    const normalizedDate = getAttendanceRowNormalizedDate(row, organizationTimeZone);
    if (normalizedDate) {
      row.date = startOfDayInTimeZone(normalizedDate, organizationTimeZone);
      row.dateKey = normalizedDate;
    }
    const checkInAt = row.checkInAt ? new Date(row.checkInAt) : null;
    const checkOutAt = row.checkOutAt ? new Date(row.checkOutAt) : null;
    const lastPunch = (row.dayHistory || []).length ? row.dayHistory[row.dayHistory.length - 1] : null;
    if (lastPunch?.action === "check_in") {
      row.status = "checked_in";
    } else if (checkInAt && checkOutAt) {
      row.totalMinutes = Math.max(
        Number(row.totalMinutes || 0),
        Math.max(0, Math.round((checkOutAt.getTime() - checkInAt.getTime()) / 60000))
      );
      row.status = "checked_out";
      row.missedCheckout = false;
      row.missedCheckoutMarkedAt = null;
    } else if (checkInAt) {
      row.status = "checked_in";
    }
    return row;
  });
};

const buildAttendanceRangeFilter = (
  organizationId,
  employeeFilter,
  startDate,
  endDate,
  organizationTimeZone = "Asia/Kolkata"
) => {
  const startKey = toDateKeyInTimeZone(startDate, organizationTimeZone);
  const endKey = toDateKeyInTimeZone(endDate, organizationTimeZone);

  return {
    organizationId,
    ...(employeeFilter || {}),
    $or: [
      { dateKey: { $gte: startKey, $lte: endKey } },
      { date: { $gte: startDate, $lte: endDate } },
      { checkInAt: { $gte: startDate, $lte: endDate } },
      { checkOutAt: { $gte: startDate, $lte: endDate } }
    ]
  };
};

const normalizeIp = (rawIp = "") => {
  let value = String(rawIp || "").trim();
  if (!value) return "";

  if (value.startsWith("[") && value.includes("]")) {
    value = value.slice(1, value.indexOf("]"));
  }

  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(value)) {
    value = value.split(":")[0];
  }

  return value.replace(/^::ffff:/, "").trim();
};

const ipV4ToLong = (ip) => {
  const parts = String(ip || "").split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((nums[0] * 256 + nums[1]) * 256 + nums[2]) * 256 + nums[3];
};

const matchesIpv4Cidr = (ip, cidr) => {
  const [network, bitsRaw] = String(cidr || "").split("/");
  const bits = Number(bitsRaw);
  const ipNum = ipV4ToLong(ip);
  const networkNum = ipV4ToLong(network);
  if (ipNum === null || networkNum === null || !Number.isInteger(bits) || bits < 0 || bits > 32) {
    return false;
  }
  const mask = bits === 0 ? 0 : ((0xFFFFFFFF << (32 - bits)) >>> 0);
  return (ipNum & mask) === (networkNum & mask);
};

const getRequestIp = (req, body = {}) => {
  const bodyCandidates = [
    body?.clientIp,
    body?.publicIp,
    body?.ipAddress,
    body?.ip
  ].map((value) => normalizeIp(value)).filter(Boolean);
  if (bodyCandidates.length) {
    return bodyCandidates[0];
  }

  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    const forwardedCandidates = forwarded
      .split(",")
      .map((token) => normalizeIp(token))
      .filter(Boolean);
    if (forwardedCandidates.length) return forwardedCandidates[0];
  }
  const xRealIp = req.headers["x-real-ip"];
  if (typeof xRealIp === "string" && xRealIp.trim()) {
    return normalizeIp(xRealIp);
  }
  return normalizeIp(req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || "");
};

const getRequestDeviceId = (req, body = {}) => {
  const bodyCandidates = [
    body?.deviceId,
    body?.device_id,
    body?.deviceID
  ].map((value) => String(value || "").trim()).filter(Boolean);
  if (bodyCandidates.length) {
    return bodyCandidates[0];
  }

  const headerCandidates = [
    req.headers["x-device-id"],
    req.headers["x-client-device-id"]
  ].map((value) => String(value || "").trim()).filter(Boolean);
  if (headerCandidates.length) {
    return headerCandidates[0];
  }

  return null;
};

const isAllowedIp = (requestIp, allowedIpRaw) => {
  const request = normalizeIp(requestIp);
  const allowed = String(allowedIpRaw || "")
    .split(/[\s,;]+/)
    .map((ip) => normalizeIp(ip))
    .filter(Boolean);
  if (!request || !allowed.length) return false;
  return allowed.some((candidate) => {
    if (candidate === request) return true;
    if (candidate.includes("/")) {
      return matchesIpv4Cidr(request, candidate);
    }
    return false;
  });
};

const toRadians = (value) => (value * Math.PI) / 180;

const getDistanceMeters = (lat1, lon1, lat2, lon2) => {
  const earthRadius = 6371000;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2))
    * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
};

const applyHoursToEntries = (entries, dateValue, hours) => {
  const key = toDateKey(dateValue);
  return (entries || []).map((entry) => {
    if (toDateKey(entry.date) === key) {
      return {
        ...entry,
        hours: Number(hours) || 0
      };
    }
    return entry;
  });
};

const upsertTimesheetHours = async ({
  organizationId,
  employeeId,
  dateValue,
  hoursWorked
}) => {
  const weekStart = getWeekStart(dateValue);
  const weekEnd = getWeekEnd(weekStart);
  let timesheet = await Timesheet.findOne({
    organizationId,
    employeeId,
    weekStart
  });

  if (!timesheet) {
    const entries = sanitizeEntries([], weekStart);
    timesheet = await Timesheet.create({
      organizationId,
      employeeId,
      weekStart,
      weekEnd,
      entries: applyHoursToEntries(entries, dateValue, hoursWorked),
      totalHours: Number(hoursWorked) || 0,
      status: "draft"
    });
    return timesheet;
  }

  if (["draft", "rejected"].includes(timesheet.status)) {
    const entries = sanitizeEntries(timesheet.entries || [], weekStart);
    timesheet.entries = applyHoursToEntries(entries, dateValue, hoursWorked);
    timesheet.totalHours = calculateTotalHours(timesheet.entries);
    await timesheet.save();
  }

  return timesheet;
};

exports.upsertTimesheetHours = upsertTimesheetHours;

const ensureEntriesInWeek = (entries, weekStart, weekEnd) => {
  const start = startOfDay(weekStart);
  const end = endOfDay(weekEnd);
  for (const entry of entries || []) {
    const d = startOfDay(entry.date);
    if (d < start || d > end) {
      throw new Error("Entries must be within the selected week");
    }
  }
};

const validateHours = async (req, entries) => {
  const settings = await OrgSettings.findOne({
    organizationId: req.user.organizationId
  });
  const minWork = settings?.minWorkHoursPerDay ?? 8;
  const minHalf = settings?.minHalfDayHours ?? 4;

  for (const entry of entries || []) {
    const hours = Number(entry.hours || 0);
    if (hours > 0 && hours < minHalf) {
      throw new Error(`Minimum half day hours is ${minHalf}`);
    }
    if (hours >= minHalf && hours < minWork) {
      // half day allowed
      continue;
    }
  }
};

const resolveWorkedMinutes = (attendanceRow) => {
  const explicitMinutes = Number(attendanceRow?.totalMinutes || 0);
  if (explicitMinutes > 0) return explicitMinutes;

  if (attendanceRow?.checkInAt && attendanceRow?.checkOutAt) {
    return Math.max(
      0,
      Math.round((new Date(attendanceRow.checkOutAt).getTime() - new Date(attendanceRow.checkInAt).getTime()) / 60000)
    );
  }

  return 0;
};

const isAttendanceOpenSession = (attendanceRow) =>
  Boolean(attendanceRow?.checkInAt && (attendanceRow.status === "checked_in" || !attendanceRow.checkOutAt));

const buildAttendancePunch = ({
  action,
  at,
  ip = null,
  latitude = null,
  longitude = null,
  selfieProvided = false,
  selfieImage = null,
  deviceId = null,
  source = "web"
}) => ({
  action,
  at,
  ip: ip || null,
  latitude: Number.isFinite(Number(latitude)) ? Number(latitude) : null,
  longitude: Number.isFinite(Number(longitude)) ? Number(longitude) : null,
  selfieProvided: Boolean(selfieProvided),
  selfieImage: selfieImage || null,
  deviceId: deviceId || null,
  source
});

const sumInsideMinutesFromDayHistory = (dayHistory = []) => {
  const ordered = [...(dayHistory || [])]
    .filter((entry) => entry?.action && entry?.at)
    .sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime());
  let openAt = null;
  let totalMinutes = 0;

  ordered.forEach((entry) => {
    if (entry.action === "check_in") {
      openAt = new Date(entry.at);
      return;
    }
    if (entry.action === "check_out" && openAt) {
      totalMinutes += Math.max(0, Math.round((new Date(entry.at).getTime() - openAt.getTime()) / 60000));
      openAt = null;
    }
  });

  return totalMinutes;
};

const sanitizeDayHistoryForSelfieAccess = (dayHistory = [], canViewSelfie = false) =>
  (dayHistory || []).map((entry) => ({
    ...entry,
    selfieImage: canViewSelfie ? (entry.selfieImage || null) : null,
    selfieProvided: canViewSelfie ? Boolean(entry.selfieProvided) : false,
    ip: canViewSelfie ? (entry.ip || null) : null
  }));

const resolveWorkedMinutesForMatrixStatus = (attendanceRow, now = new Date()) => {
  const resolvedMinutes = resolveWorkedMinutes(attendanceRow);
  if (resolvedMinutes > 0) return resolvedMinutes;
  if (!isAttendanceOpenSession(attendanceRow)) return 0;

  const checkInAt = new Date(attendanceRow.checkInAt);
  const shiftEndAt = attendanceRow?.scheduledEndAt ? new Date(attendanceRow.scheduledEndAt) : now;
  if (Number.isNaN(checkInAt.getTime()) || Number.isNaN(shiftEndAt.getTime())) {
    return 0;
  }

  return Math.max(0, Math.round((shiftEndAt.getTime() - checkInAt.getTime()) / 60000));
};

const resolveOvertimeMinutes = (totalMinutes, minWorkHoursPerDay = 8) => {
  const requiredMinutes = Math.max(0, Math.round(Number(minWorkHoursPerDay || 0) * 60));
  return Math.max(0, Math.round(Number(totalMinutes || 0) - requiredMinutes));
};

const resolveAttendanceMatrixStatus = (attendanceRow, { minHalfDayHours = 4, minWorkHoursPerDay = 8, now = new Date() }) => {
  const isOpenSession = isAttendanceOpenSession(attendanceRow);
  const shiftEndAt = attendanceRow?.scheduledEndAt ? new Date(attendanceRow.scheduledEndAt) : null;
  const shiftStillRunning = shiftEndAt && !Number.isNaN(shiftEndAt.getTime()) && now < shiftEndAt;
  if (isOpenSession) return "pending_checkout";

  const hasAnyAttendance = Boolean(attendanceRow?.checkInAt || attendanceRow?.checkOutAt);
  if (!hasAnyAttendance) return "absent";

  const workedMinutes = resolveWorkedMinutesForMatrixStatus(attendanceRow, now);
  const halfDayMinutes = Math.max(0, Number(minHalfDayHours || 0) * 60);
  const fullDayMinutes = Math.max(halfDayMinutes, Number(minWorkHoursPerDay || 0) * 60);

  if (workedMinutes >= fullDayMinutes) return "full_day_present";
  if (["first_half", "second_half"].includes(attendanceRow?.workFromHomePortion)) {
    return "half_day_present";
  }
  if (workedMinutes >= halfDayMinutes) return "half_day_present";
  return "absent";
};

const isNoOpAttendanceOverride = ({
  existingAttendance,
  targetStatus,
  minHalfDayHours = 4,
  minWorkHoursPerDay = 8
}) => {
  if (targetStatus === "absent") {
    if (!existingAttendance) return true;
    return !existingAttendance.checkInAt && !existingAttendance.checkOutAt;
  }

  if (targetStatus === "present") {
    if (!existingAttendance) return false;
    const currentStatus = resolveAttendanceMatrixStatus(existingAttendance, {
      minHalfDayHours,
      minWorkHoursPerDay
    });
    return currentStatus === "present" || currentStatus === "full_day_present";
  }

  if (targetStatus === "half_day_present") {
    if (!existingAttendance) return false;
    const currentStatus = resolveAttendanceMatrixStatus(existingAttendance, {
      minHalfDayHours,
      minWorkHoursPerDay
    });
    return currentStatus === "half_day_present";
  }

  return false;
};

const formatAttendanceOverrideStatus = (status) => {
  if (status === "half_day_present") return "Half Day";
  if (status === "present") return "Present";
  return "Absent";
};

const resolveBulkAttendanceSkipReason = ({
  dateKey,
  holidayDateKeys,
  weekOffDays,
  approvedLeaves,
  organizationTimeZone
}) => {
  if (holidayDateKeys.has(dateKey)) return "holiday";
  if (weekOffDays.includes(getWeekdayForDateKey(dateKey, organizationTimeZone))) return "weekOff";
  if (approvedLeaves.some((leave) => {
    const leaveStartKey = toDateKeyInTimeZone(leave.fromDate, organizationTimeZone);
    const leaveEndKey = toDateKeyInTimeZone(leave.toDate, organizationTimeZone);
    return dateKey >= leaveStartKey && dateKey <= leaveEndKey;
  })) {
    return "approvedLeave";
  }
  return null;
};

const DEFAULT_UNPAID_LEAVE_CODES = new Set(["LOP", "LWP", "LWOP", "ULOP", "UNPAID"]);

const buildAttendanceOverrideUpdate = ({
  status,
  actorEmployeeId,
  shift,
  scheduledStartAt,
  scheduledEndAt,
  shiftMinutes,
  minHalfDayHours = 4
}) => {
  const defaultCheckIn = new Date(scheduledStartAt);
  const defaultCheckOut = new Date(scheduledEndAt);
  const halfDayMinutes = Math.max(1, Math.round(Number(minHalfDayHours || 0) * 60));
  const halfDayCheckOut = new Date(defaultCheckIn.getTime() + halfDayMinutes * 60000);
  const attendanceMinutes = status === "present"
    ? shiftMinutes
    : status === "half_day_present"
      ? halfDayMinutes
      : 0;

  return {
    checkInAt: status === "absent" ? null : defaultCheckIn,
    checkOutAt: status === "present" ? defaultCheckOut : status === "half_day_present" ? halfDayCheckOut : null,
    checkOutSelfieProvided: false,
    checkOutIp: null,
    checkOutSelfieImage: null,
    totalMinutes: attendanceMinutes,
    status: "checked_out",
    overriddenBy: actorEmployeeId || null,
    overriddenAt: new Date(),
    shiftId: shift._id || null,
    shiftName: shift.name,
    shiftCode: shift.code,
    shiftStartTime: shift.startTime,
    shiftEndTime: shift.endTime,
    scheduledStartAt,
    scheduledEndAt,
    lateByMinutes: 0,
    earlyLoginByMinutes: 0,
    earlyCheckoutByMinutes: status === "half_day_present" ? Math.max(0, shiftMinutes - halfDayMinutes) : 0,
    overtimeMinutes: 0,
    missedCheckout: false,
    missedCheckoutMarkedAt: null,
    missedCheckoutResolvedRequestId: null
  };
};

const isThresholdQualifiedAttendance = (status) =>
  status === "present" || status === "half_day_present" || status === "full_day_present";

const isOvernightShiftWindow = (shiftStartTime, shiftEndTime) => {
  const startMinutes = parseTimeToMinutes(shiftStartTime);
  const endMinutes = parseTimeToMinutes(shiftEndTime);
  return startMinutes !== null && endMinutes !== null && endMinutes <= startMinutes;
};

const formatWorkedDuration = (workedMinutes) => {
  if (!Number.isFinite(workedMinutes) || workedMinutes <= 0) return "";
  const hours = Math.floor(workedMinutes / 60);
  const minutes = workedMinutes % 60;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
};

const resolveAttendanceDisplayStatus = ({
  isHoliday,
  isWeekOff,
  isOnLeave,
  leaveType,
  leaveDuration,
  attendanceStatus,
  hasAttendanceOverride,
  isFuture,
  snapshotGenerated
}) => {
  // Half-day leave shares the day with attendance, including approved corrections.
  if (
    isOnLeave
    && leaveDuration === "half_day"
    && leaveType
    && ["half_day_present", "full_day_present", "present"].includes(attendanceStatus)
  ) {
    return "Present + Leave";
  }
  if (isOnLeave && leaveDuration === "half_day" && leaveType) return "Absent + Leave";
  // When sandwich rule turns a holiday/week off into a deducted leave day,
  // the calendar should reflect the leave outcome rather than the base day type.
  if (hasAttendanceOverride && ["present", "half_day_present", "full_day_present", "absent"].includes(attendanceStatus)) {
    if (attendanceStatus === "half_day_present") return "Half Day";
    if (attendanceStatus === "present" || attendanceStatus === "full_day_present") return "Present";
    return "Absent";
  }
  if (isOnLeave && leaveDuration === "full_day" && leaveType) return "Leave";
  if (isHoliday) return "Holiday";
  if (isWeekOff) return "Week Off";
  if (isFuture) return "Future";
  if (attendanceStatus === "pending_checkout" && snapshotGenerated) return "Absent";
  if (attendanceStatus === "pending_checkout") return "Pending Checkout";
  if (attendanceStatus === "full_day_present" || attendanceStatus === "present") return "Present";
  if (attendanceStatus === "half_day_present") return "Half Day";
  if (leaveType && leaveDuration !== "half_day") return "Leave";
  return "Absent";
};

const resolveAttendanceUiMeta = ({ displayStatus, leaveType }) => {
  if (displayStatus === "Holiday") {
    return { label: "Holiday", shortLabel: "H", tone: "holiday" };
  }
  if (displayStatus === "Week Off") {
    return { label: "Week Off", shortLabel: "W", tone: "week_off" };
  }
  if (displayStatus === "Future") {
    return { label: "Not Marked", shortLabel: "-", tone: "future" };
  }
  if (displayStatus === "Leave") {
    const normalized = String(leaveType || "").trim();
    const compact = normalized.replace(/[^a-zA-Z]/g, "").toUpperCase();
    const initials = normalized
      .split(/\s+/)
      .map((part) => part[0] || "")
      .join("")
      .toUpperCase();
    const shortLabel = !normalized
      ? "L"
      : compact.length >= 2 && compact.length <= 4
        ? compact
        : initials || "L";
    return { label: leaveType || "Leave", shortLabel, tone: "leave" };
  }
  if (displayStatus === "Absent + Leave") {
    return { label: `Absent + ${leaveType || "Leave"}`, shortLabel: "AL", tone: "absent_leave" };
  }
  if (displayStatus === "Present + Leave") {
    return { label: `Present + ${leaveType || "Leave"}`, shortLabel: "PL", tone: "present_leave" };
  }
  if (displayStatus === "Pending Checkout") {
    return { label: "Pending Checkout", shortLabel: "PC", tone: "pending_checkout" };
  }
  if (displayStatus === "Present") {
    return { label: "Present", shortLabel: "P", tone: "present" };
  }
  if (displayStatus === "Half Day") {
    return { label: "Half Day", shortLabel: "HP", tone: "half_day" };
  }
  return { label: "Absent", shortLabel: "A", tone: "absent" };
};

const getLeaveDateKeysForDisplay = ({
  leave,
  holidayKeySet,
  weekOffDays,
  timeZone
}) => {
  const fromDateKey = toDateKeyInTimeZone(leave.fromDate, timeZone);
  if (leave.duration === "half_day") return [fromDateKey];

  const workingAnalysis = analyzeLeaveDateKeys({
    fromDate: leave.fromDate,
    toDate: leave.toDate,
    weekOffDays,
    holidaySet: holidayKeySet,
    effectiveDateKeys: leave?.effectiveDateKeys,
    sandwichRuleEnabled: false,
    timeZone
  });
  if (Array.isArray(leave?.effectiveDateKeys) && leave.effectiveDateKeys.length) {
    return workingAnalysis.effectiveDateKeys;
  }

  const sandwichAnalysis = analyzeLeaveDateKeys({
    fromDate: leave.fromDate,
    toDate: leave.toDate,
    weekOffDays,
    holidaySet: holidayKeySet,
    sandwichRuleEnabled: true,
    timeZone
  });

  if (
    Number.isFinite(Number(leave?.totalDays || 0))
    && Number(leave.totalDays || 0) > workingAnalysis.workingDateKeys.length
    && sandwichAnalysis.sandwichDeductedDateKeys.length
  ) {
    return sandwichAnalysis.effectiveDateKeys;
  }

  return workingAnalysis.effectiveDateKeys;
};

const buildAttendanceSummary = (days, daysInMonth) => {
  const summary = {
    presentDays: 0,
    pendingCheckoutDays: 0,
    absentDays: 0,
    onLeaveDays: 0,
    paidLeaveDays: 0,
    unpaidLeaveDays: 0,
    weekOffDays: 0,
    holidayDays: 0,
    selfieDays: 0,
    payrollExcludedDays: 0,
    totalDays: 0
  };

  for (let day = 1; day <= daysInMonth; day += 1) {
    const cell = days[day];
    if (!cell || cell.isFuture) continue;
    if (cell.checkInSelfieProvided) summary.selfieDays += 1;

    if (cell.displayStatus === "Pending Checkout") {
      summary.pendingCheckoutDays += 1;
      if (cell.excludeFromPayroll) summary.payrollExcludedDays += 1;
      continue;
    }
    if (cell.displayStatus === "Half Day") {
      summary.presentDays += 0.5;
      summary.absentDays += 0.5;
      continue;
    }
    if (cell.displayStatus === "Present") {
      summary.presentDays += 1;
      continue;
    }
    if (cell.displayStatus === "Present + Leave") {
      summary.presentDays += 0.5;
      summary.onLeaveDays += 0.5;
      if (cell.isPaidLeave) summary.paidLeaveDays += 0.5;
      else summary.unpaidLeaveDays += 0.5;
      continue;
    }
    if (cell.displayStatus === "Absent + Leave") {
      summary.absentDays += 0.5;
      summary.onLeaveDays += 0.5;
      if (cell.isPaidLeave) summary.paidLeaveDays += 0.5;
      else summary.unpaidLeaveDays += 0.5;
      continue;
    }
    if (cell.displayStatus === "Leave") {
      summary.onLeaveDays += 1;
      if (cell.isPaidLeave) summary.paidLeaveDays += 1;
      else summary.unpaidLeaveDays += 1;
      continue;
    }
    if (cell.displayStatus === "Week Off") {
      summary.weekOffDays += 1;
      continue;
    }
    if (cell.displayStatus === "Holiday") {
      summary.holidayDays += 1;
      continue;
    }
    summary.absentDays += 1;
  }

  summary.totalDays =
    summary.presentDays
    + summary.pendingCheckoutDays
    + summary.absentDays
    + summary.onLeaveDays
    + summary.weekOffDays
    + summary.holidayDays;

  return summary;
};

const decorateAttendanceCell = ({
  cell,
  dayKey,
  todayKey,
  snapshotGenerated
}) => {
  const workedMinutes = Number(cell.totalMinutes || 0);
  const displayStatus = resolveAttendanceDisplayStatus({
    isHoliday: Boolean(cell.holidayName),
    isWeekOff: Boolean(cell.isWeekOff),
    isOnLeave: Boolean(cell.isOnLeave),
    leaveType: cell.leaveType || null,
    leaveDuration: cell.leaveDuration || null,
    attendanceStatus: cell.status,
    hasAttendanceOverride: Boolean(cell.overriddenBy),
    isFuture: dayKey > todayKey,
    snapshotGenerated
  });
  const ui = resolveAttendanceUiMeta({ displayStatus, leaveType: cell.leaveType || null });
  return {
    ...cell,
    isFuture: dayKey > todayKey,
    displayStatus,
    displayLabel: ui.label,
    displayShortLabel: ui.shortLabel,
    displayTone: ui.tone,
    isThresholdQualified: isThresholdQualifiedAttendance(cell.status),
    workedMinutes,
    workedDuration: formatWorkedDuration(workedMinutes),
    isOvernightShift: isOvernightShiftWindow(cell.shiftStartTime, cell.shiftEndTime),
    attendanceDateKey: dayKey
  };
};

const isActiveOvernightSession = (attendanceRow, organizationTimeZone = "Asia/Kolkata") => {
  if (!isAttendanceOpenSession(attendanceRow) || !attendanceRow?.scheduledEndAt) {
    return false;
  }

  const scheduledEndAt = new Date(attendanceRow.scheduledEndAt);
  const now = new Date();
  if (now > scheduledEndAt) {
    return false;
  }

  const storedDayKey = getAttendanceStoredDateKey(attendanceRow, organizationTimeZone);
  const scheduledEndDayKey = toDateKeyInTimeZone(scheduledEndAt, organizationTimeZone);
  return storedDayKey !== scheduledEndDayKey;
};

const canCheckOutAttendance = (attendanceRow, organizationTimeZone = "Asia/Kolkata", now = new Date()) => {
  if (!attendanceRow?.checkInAt) return false;
  if (!isAttendanceOpenSession(attendanceRow)) return false;

  if (isActiveOvernightSession(attendanceRow, organizationTimeZone)) {
    return true;
  }

  const attendanceDateKey = getAttendanceStoredDateKey(attendanceRow, organizationTimeZone);
  const todayKey = toDateKeyInTimeZone(now, organizationTimeZone);
  const yesterdayKey = addDaysToDateKey(todayKey, -1);
  return attendanceDateKey === todayKey || attendanceDateKey === yesterdayKey;
};

const canUpdateClosedCheckout = (attendanceRow, organizationTimeZone = "Asia/Kolkata", now = new Date()) => {
  if (!attendanceRow?.checkInAt || !attendanceRow?.checkOutAt) return false;

  const attendanceDateKey = getAttendanceStoredDateKey(attendanceRow, organizationTimeZone);
  const todayKey = toDateKeyInTimeZone(now, organizationTimeZone);
  return attendanceDateKey === todayKey;
};

const getEmployeeFromReq = async (req) => {
  const employee = await Employee.findOne({
    userId: req.user.userId,
    organizationId: req.user.organizationId
  });

  if (!employee) throw new Error("Employee not found");
  return employee;
};

const parseMonthRange = (monthValue) => {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;

  if (typeof monthValue === "string" && /^\d{4}-\d{2}$/.test(monthValue)) {
    const [y, m] = monthValue.split("-").map(Number);
    year = y;
    month = m;
  }

  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59, 999);
  const daysInMonth = end.getDate();
  return { year, month, start, end, daysInMonth };
};

const getScopedEmployeeIdsForViewer = async (req) => {
  if (!req.user.activeRoleId) return null;

  const role = await Role.findOne({
    _id: req.user.activeRoleId,
    organizationId: req.user.organizationId
  }).select("slug");

  if (role?.slug !== "manager") return null;

  const managerEmployee = await Employee.findOne({
    userId: req.user.userId,
    organizationId: req.user.organizationId
  }).select("_id");

  if (!managerEmployee) return [];

  return Employee.find({
    organizationId: req.user.organizationId,
    managerId: managerEmployee._id
  }).distinct("_id");
};

const buildOnlineAttendanceQuery = ({
  organizationId,
  todayKey,
  yesterdayKey,
  now,
  scopedEmployeeIds
}) => {
  const query = {
    organizationId,
    dateKey: { $gte: yesterdayKey, $lte: todayKey },
    checkInAt: { $ne: null, $lte: now },
    $or: [
      { status: "checked_in" },
      { checkOutAt: null }
    ]
  };

  if (Array.isArray(scopedEmployeeIds)) {
    query.employeeId = { $in: scopedEmployeeIds };
  }

  return query;
};

const isOnlineAttendanceRowVisible = (row, { now, timeZone, todayKey, yesterdayKey }) => {
  if (!row) return false;

  const rowDateKey = row.dateKey || (row.date ? toDateKeyInTimeZone(row.date, timeZone) : null);
  if (!rowDateKey || (rowDateKey !== todayKey && rowDateKey !== yesterdayKey)) {
    return false;
  }

  const scheduledEndAt = row.scheduledEndAt
    ? new Date(row.scheduledEndAt)
    : endOfDayInTimeZone(row.date || row.checkInAt || now, timeZone);

  if (Number.isNaN(scheduledEndAt.getTime())) return false;

  return now <= scheduledEndAt;
};

const getActorRoleSlug = async (req) => {
  if (!req.user.activeRoleId) return "";
  const role = await Role.findOne({
    _id: req.user.activeRoleId,
    organizationId: req.user.organizationId
  }).select("slug");
  return role?.slug || "";
};

const describeApprovalStep = (step) => {
  if (!step) return "Unknown step";
  if (step.approverType === "manager") {
    return `S${step.stepNumber} Reporting Manager`;
  }
  if (step.approverType === "role") {
    return `S${step.stepNumber} Role: ${step.approverRoleSlug || "-"}`;
  }
  return `S${step.stepNumber} Specific Employee`;
};

const isValidApprovalStepShape = (step) =>
  Boolean(
    step
    && Number.isFinite(Number(step.stepNumber))
    && ["manager", "role", "employee"].includes(String(step.approverType || ""))
  );

const rebuildAttendanceApprovalStepsFromFlow = async (request) => {
  if (!request?.approvalFlowId || !request?.employeeId) return null;

  const [flow, subjectEmployee] = await Promise.all([
    ApprovalFlow.findOne({
      _id: request.approvalFlowId,
      organizationId: request.organizationId
    }),
    Employee.findOne({
      _id: request.employeeId,
      organizationId: request.organizationId
    }).select("_id managerId")
  ]);

  if (!flow || !subjectEmployee) return null;

  const rebuiltSteps = buildRuntimeSteps({ flow, subjectEmployee });
  const existingByStep = new Map(
    (request.approvalSteps || [])
      .filter(isValidApprovalStepShape)
      .map((step) => [Number(step.stepNumber), step])
  );

  return rebuiltSteps.map((step) => {
    const existing = existingByStep.get(Number(step.stepNumber));
    if (!existing) return step;
    if (existing.status === "approved" || existing.status === "rejected") {
      return {
        ...step,
        status: existing.status,
        actionBy: existing.actionBy || null,
        actionAt: existing.actionAt || null,
        remarks: existing.remarks || null
      };
    }
    return step;
  });
};

const normalizeApprovalStateSnapshot = (steps = [], currentApprovalStep = null) =>
  JSON.stringify({
    currentApprovalStep: currentApprovalStep == null ? null : Number(currentApprovalStep),
    steps: (steps || []).map((step) => ({
      stepNumber: step?.stepNumber == null ? null : Number(step.stepNumber),
      approverType: step?.approverType || null,
      approverEmployeeId: step?.approverEmployeeId?._id || step?.approverEmployeeId || null,
      approverRoleSlug: step?.approverRoleSlug || null,
      status: step?.status || null,
      actionBy: step?.actionBy?._id || step?.actionBy || null,
      actionAt: step?.actionAt ? new Date(step.actionAt).toISOString() : null,
      remarks: step?.remarks || null
    }))
  });

const repairPendingAttendanceApprovalState = async (request) => {
  if (!request || request.status !== "pending" || !request.approvalFlowId || !Array.isArray(request.approvalSteps) || !request.approvalSteps.length) {
    return request;
  }

  const beforeSnapshot = normalizeApprovalStateSnapshot(
    request.approvalSteps,
    request.currentApprovalStep
  );
  const rebuiltSteps = await rebuildAttendanceApprovalStepsFromFlow(request);
  if (!rebuiltSteps?.length) return request;

  const resolvedProgress = resolveCurrentPendingStep({
    steps: rebuiltSteps,
    currentApprovalStep: request.currentApprovalStep
  });

  request.approvalSteps = resolvedProgress.steps;
  request.currentApprovalStep = resolvedProgress.currentApprovalStep;
  const afterSnapshot = normalizeApprovalStateSnapshot(
    request.approvalSteps,
    request.currentApprovalStep
  );

  if (beforeSnapshot !== afterSnapshot && typeof request.markModified === "function" && typeof request.save === "function") {
    request.markModified("approvalSteps");
    await request.save();
  }

  return request;
};

const canActorViewAttendanceSelfie = async (req) => {
  const roleSlug = await getActorRoleSlug(req);
  return ATTENDANCE_SELFIE_VIEW_ROLE_SLUGS.has(roleSlug);
};

const assertManageAccessForEmployee = async (req, employeeId) => {
  if (!req.user.activeRoleId) return;

  const role = await Role.findOne({
    _id: req.user.activeRoleId,
    organizationId: req.user.organizationId
  }).select("slug");

  if (role?.slug !== "manager") return;

  const managerEmployee = await Employee.findOne({
    userId: req.user.userId,
    organizationId: req.user.organizationId
  }).select("_id");

  if (!managerEmployee) {
    throw new Error("Access denied");
  }

  const reportIds = await Employee.find({
    organizationId: req.user.organizationId,
    managerId: managerEmployee._id
  }).distinct("_id");

  const allowed = reportIds.some((id) => id.toString() === employeeId.toString());
  if (!allowed) {
    throw new Error("Access denied");
  }
};

const assertAttendanceDateEditable = (settings, dateValue, timeZone = "UTC") => {
  const target = startOfDayInTimeZone(dateValue, timeZone);
  const today = startOfDayInTimeZone(new Date(), timeZone);
  const targetKey = toDateKeyInTimeZone(target, timeZone);
  const todayKey = toDateKeyInTimeZone(today, timeZone);

  // Never allow attendance overrides on future dates.
  if (targetKey > todayKey) {
    throw new Error("Attendance cannot be updated for future dates");
  }

  if (!settings?.attendanceLockEnabled) return;

  const mode = settings.attendanceLockMode || "days_window";

  if (mode === "days_window") {
    const lockAfterDays = Number(settings.attendanceLockAfterDays ?? 7);
    const diffDays = Math.floor((today.getTime() - target.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays > lockAfterDays) {
      throw new Error(`Attendance is locked for dates older than ${lockAfterDays} days`);
    }
    return;
  }

  const cutoffDay = Number(settings.attendanceLockDay ?? settings.payrollCutoffDay ?? 25);
  const currentDay = getDayInTimeZone(today, timeZone);

  // payroll_cutoff mode policy:
  // - Before cutoff day: any past date remains editable.
  // - On or after cutoff day: the current month's cutoff day and older dates are locked.
  if (currentDay < cutoffDay) {
    return;
  }

  const [todayYear, todayMonth] = todayKey.split("-").map(Number);
  const lockUntilKey = `${todayYear}-${String(todayMonth).padStart(2, "0")}-${String(cutoffDay).padStart(2, "0")}`;

  if (targetKey <= lockUntilKey) {
    throw new Error(`Attendance is locked through payroll cutoff date ${lockUntilKey}`);
  }
};

const validateAttendanceEditWindow = async (organizationId, dateValue, timeZone = "UTC") => {
  const settings = await OrgSettings.findOne({ organizationId })
    .select("attendanceLockEnabled attendanceLockAfterDays attendanceLockMode attendanceLockDay payrollCutoffDay");
  assertAttendanceDateEditable(settings, dateValue, timeZone);
};

const getAttendanceLockWindowMeta = (settings, timeZone = "UTC", now = new Date()) => {
  const today = startOfDayInTimeZone(now, timeZone);
  const todayKey = toDateKeyInTimeZone(today, timeZone);
  const lockEnabled = Boolean(settings?.attendanceLockEnabled);
  const mode = settings?.attendanceLockMode || "days_window";

  if (!lockEnabled) {
    return {
      attendanceLockEnabled: false,
      attendanceLockMode: mode,
      attendanceLockAfterDays: Number(settings?.attendanceLockAfterDays ?? 7),
      payrollCutoffDay: Number(settings?.payrollCutoffDay ?? 25),
      attendanceLockDay: Number(settings?.attendanceLockDay ?? settings?.payrollCutoffDay ?? 25),
      todayKey,
      lockedThroughDateKey: null
    };
  }

  if (mode === "days_window") {
    const attendanceLockAfterDays = Number(settings?.attendanceLockAfterDays ?? 7);
    return {
      attendanceLockEnabled: true,
      attendanceLockMode: mode,
      attendanceLockAfterDays,
      payrollCutoffDay: Number(settings?.payrollCutoffDay ?? 25),
      attendanceLockDay: Number(settings?.attendanceLockDay ?? settings?.payrollCutoffDay ?? 25),
      todayKey,
      lockedThroughDateKey: addDaysToDateKey(todayKey, -attendanceLockAfterDays)
    };
  }

  const cutoffDay = Number(settings?.attendanceLockDay ?? settings?.payrollCutoffDay ?? 25);
  const currentDay = getDayInTimeZone(today, timeZone);
  if (currentDay < cutoffDay) {
    return {
      attendanceLockEnabled: true,
      attendanceLockMode: mode,
      attendanceLockAfterDays: Number(settings?.attendanceLockAfterDays ?? 7),
      payrollCutoffDay: Number(settings?.payrollCutoffDay ?? 25),
      attendanceLockDay: cutoffDay,
      todayKey,
      lockedThroughDateKey: null
    };
  }

  const [todayYear, todayMonth] = todayKey.split("-").map(Number);
  const lockedThroughDateKey = `${todayYear}-${String(todayMonth).padStart(2, "0")}-${String(cutoffDay).padStart(2, "0")}`;

  return {
    attendanceLockEnabled: true,
    attendanceLockMode: mode,
    attendanceLockAfterDays: Number(settings?.attendanceLockAfterDays ?? 7),
    payrollCutoffDay: Number(settings?.payrollCutoffDay ?? 25),
    attendanceLockDay: cutoffDay,
    todayKey,
    lockedThroughDateKey
  };
};

const getLockTargetDateKey = (settings, monthEndDateKey) => {
  const mode = settings?.attendanceLockMode || "days_window";
  if (mode !== "payroll_cutoff") {
    return monthEndDateKey;
  }

  const [year, month, monthEndDay] = String(monthEndDateKey || "").split("-").map(Number);
  const cutoffDay = Number(settings?.payrollCutoffDay ?? 25);
  const effectiveDay = Math.min(monthEndDay || cutoffDay, cutoffDay);

  return `${year}-${String(month).padStart(2, "0")}-${String(effectiveDay).padStart(2, "0")}`;
};

const buildLockAttendanceActionMeta = ({
  settings,
  monthEndDateKey,
  pendingCheckoutCount,
  snapshotGenerated = false,
  timeZone,
  now = new Date()
}) => {
  const windowMeta = getAttendanceLockWindowMeta(settings, timeZone, now);
  const lockTargetDateKey = getLockTargetDateKey(settings, monthEndDateKey);

  if (!windowMeta.attendanceLockEnabled) {
    return {
      enabled: false,
      pendingCheckoutCount,
      lockedThroughDateKey: windowMeta.lockedThroughDateKey,
      reason: "Attendance lock is disabled in organization settings.",
      snapshotGenerated
    };
  }

  if (!windowMeta.lockedThroughDateKey || lockTargetDateKey > windowMeta.lockedThroughDateKey) {
    return {
      enabled: false,
      pendingCheckoutCount,
      lockedThroughDateKey: windowMeta.lockedThroughDateKey,
      reason: `Lock date has not been crossed yet for ${lockTargetDateKey}.`,
      snapshotGenerated
    };
  }

  if (pendingCheckoutCount < 1) {
    return {
      enabled: false,
      pendingCheckoutCount,
      lockedThroughDateKey: windowMeta.lockedThroughDateKey,
      reason: "No pending checkout rows found for the selected month.",
      snapshotGenerated
    };
  }

  return {
    enabled: true,
    pendingCheckoutCount,
    lockedThroughDateKey: windowMeta.lockedThroughDateKey,
    reason: null,
    snapshotGenerated
  };
};

const countPendingCheckoutForMonth = async ({
  organizationId,
  start,
  end,
  scopedEmployeeIds
}) => {
  const attendanceQuery = {
    organizationId,
    date: { $gte: start, $lte: end },
    checkInAt: { $ne: null },
    $or: [{ status: "checked_in" }, { checkOutAt: null }]
  };

  if (Array.isArray(scopedEmployeeIds)) {
    attendanceQuery.employeeId = { $in: scopedEmployeeIds };
  }

  return Attendance.countDocuments(attendanceQuery);
};

const hasPayrollSnapshotForMonth = async (req, month) => {
  try {
    const snapshotData = await payrollAttendanceService.listMonthlyAttendanceSnapshots({
      user: req.user,
      query: { month }
    });
    return Boolean(snapshotData?.count > 0);
  } catch (_) {
    return false;
  }
};

const CHECK_IN_EARLY_WINDOW_MINUTES = 120;

const formatTimeLabel = (dateValue, timeZone) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(dateValue);

exports.checkIn = async (req) => {
  await assertManualAttendanceEnabled(req.user.organizationId);
  const employee = await getEmployeeFromReq(req);
  const now = new Date();
  const organizationTimeZone = await getOrganizationTimeZone(req.user.organizationId);
  const attendanceSecurity = await OrgSettings.findOne({ organizationId: req.user.organizationId })
    .select(
      "attendanceIpEnabled attendanceAllowedIp attendanceSelfieRequired attendanceMultiPunchEnabled attendanceGeoFenceEnabled attendanceGeoLatitude attendanceGeoLongitude attendanceGeoRadiusMeters attendanceDevBypassEnabled"
    );
  const shouldBypassPolicyChecks = process.env.NODE_ENV !== "production"
    && Boolean(attendanceSecurity?.attendanceDevBypassEnabled);
  const isMultiPunchEnabled = Boolean(attendanceSecurity?.attendanceMultiPunchEnabled);
  const checkInIp = getRequestIp(req, req.body);
  const checkInDeviceId = getRequestDeviceId(req, req.body);
  const checkInLatitude = req.body?.latitude;
  const checkInLongitude = req.body?.longitude;
  const checkInAccuracy = Number(req.body?.accuracy);
  const checkInSelfieImage = req.body?.selfieImage || null;
  const checkInSelfieProvided = Boolean(req.body?.selfieImage);
  if (!shouldBypassPolicyChecks && attendanceSecurity?.attendanceIpEnabled) {
    if (!isAllowedIp(checkInIp, attendanceSecurity.attendanceAllowedIp)) {
      throwHttpError(
        403,
        `Check-in is allowed only from the configured office IP. Detected IP: ${checkInIp || "unknown"}`
      );
    }
  }

  if (!shouldBypassPolicyChecks && attendanceSecurity?.attendanceSelfieRequired && !isMultiPunchEnabled && !checkInSelfieProvided) {
    throwHttpError(403, "Selfie is required for check-in");
  }

  if (!shouldBypassPolicyChecks && attendanceSecurity?.attendanceSelfieRequired && checkInSelfieProvided) {
    if (!employee?.profileImage) {
      throwHttpError(400, "Profile photo is not available. Contact admin before selfie check-in.");
    }
    const faceResult = await compareFacesWithFacePP({
      profileImageUrl: employee.profileImage,
      selfieImage: checkInSelfieImage
    });
    if (!faceResult.passed) {
      throwHttpError(
        403,
        `Face match failed (confidence ${faceResult.confidence.toFixed(2)}). Check-in denied.`
      );
    }
  }

  if (!shouldBypassPolicyChecks && attendanceSecurity?.attendanceGeoFenceEnabled) {
    const officeLat = Number(attendanceSecurity.attendanceGeoLatitude);
    const officeLng = Number(attendanceSecurity.attendanceGeoLongitude);
    const radiusMeters = Number(attendanceSecurity.attendanceGeoRadiusMeters || 200);
    const employeeLat = Number(checkInLatitude);
    const employeeLng = Number(checkInLongitude);
    const accuracyMeters = Number.isFinite(checkInAccuracy) ? Math.max(10, Math.min(checkInAccuracy * 1.5, 50)) : 15;
    const effectiveRadiusMeters = radiusMeters + accuracyMeters;
    if (!Number.isFinite(employeeLat) || !Number.isFinite(employeeLng)) {
      throwHttpError(403, "Location access is required for check-in");
    }
    if (!Number.isFinite(officeLat) || !Number.isFinite(officeLng)) {
      throwHttpError(400, "Office geofence is not configured. Please contact admin.");
    }
    const distanceMeters = getDistanceMeters(
      officeLat,
      officeLng,
      employeeLat,
      employeeLng
    );
    if (distanceMeters > effectiveRadiusMeters) {
      throwHttpError(
        403,
        `You are outside office geofence. Allowed radius is ${radiusMeters} meters (GPS tolerance applied: ${accuracyMeters.toFixed(0)} meters).`
      );
    }
  }

  const {
    attendanceDateKey,
    shift,
    scheduledStartAt,
    scheduledEndAt
  } = await resolveCheckInSchedule(
    req.user.organizationId,
    employee._id,
    now,
    organizationTimeZone
  );
  const checkInDateKey = toDateKeyInTimeZone(now, organizationTimeZone);
  const scheduledEndDateKey = toDateKeyInTimeZone(scheduledEndAt, organizationTimeZone);
  const isOvernightShift = scheduledEndDateKey !== attendanceDateKey;
  let effectiveAttendanceDateKey = attendanceDateKey;
  let effectiveShift = shift;
  let effectiveScheduledStartAt = scheduledStartAt;
  let effectiveScheduledEndAt = scheduledEndAt;

  // Day shifts should always be stored against the actual local check-in day.
  if (!isOvernightShift && attendanceDateKey !== checkInDateKey) {
    const recalculatedSchedule = await resolveShiftSchedule(
      req.user.organizationId,
      employee._id,
      checkInDateKey,
      organizationTimeZone
    );
    effectiveAttendanceDateKey = checkInDateKey;
    effectiveShift = recalculatedSchedule.shift;
    effectiveScheduledStartAt = recalculatedSchedule.scheduledStartAt;
    effectiveScheduledEndAt = recalculatedSchedule.scheduledEndAt;
  }

  const attendanceDate = startOfDayInTimeZone(effectiveAttendanceDateKey, organizationTimeZone);
  const earliestCheckInAt = new Date(
    effectiveScheduledStartAt.getTime() - CHECK_IN_EARLY_WINDOW_MINUTES * 60 * 1000
  );

  if (now < earliestCheckInAt) {
    throwHttpError(
      403,
      `Check-in for ${effectiveShift.name || "your shift"} is allowed only from ${formatTimeLabel(earliestCheckInAt, organizationTimeZone)} to ${formatTimeLabel(effectiveScheduledStartAt, organizationTimeZone)}.`
    );
  }

  const graceMinutes = Number(effectiveShift.graceMinutes || 0);
  const lateDiff = Math.round((now.getTime() - effectiveScheduledStartAt.getTime()) / 60000) - graceMinutes;
  const lateByMinutes = Math.max(0, lateDiff);
  const earlyLoginByMinutes = Math.max(
    0,
    Math.round((effectiveScheduledStartAt.getTime() - now.getTime()) / 60000)
  );

  const openAttendance = await Attendance.findOne({
    organizationId: req.user.organizationId,
    employeeId: employee._id,
    checkInAt: { $ne: null },
    $or: [
      { status: "checked_in" },
      { checkOutAt: null }
    ]
  }).sort({ date: -1, checkInAt: -1 });

  if (
    openAttendance
    && getAttendanceStoredDateKey(openAttendance, organizationTimeZone) !== effectiveAttendanceDateKey
  ) {
    await Attendance.updateOne(
      { _id: openAttendance._id },
      {
        $set: {
          missedCheckout: true,
          missedCheckoutMarkedAt: now,
          missedCheckoutResolvedRequestId: null
        }
      }
    );
  }

  const attendanceBaseFilter = {
    organizationId: req.user.organizationId,
    employeeId: employee._id
  };
  const attendanceFilter = {
    ...attendanceBaseFilter,
    ...buildAttendanceDateMatch(effectiveAttendanceDateKey, organizationTimeZone)
  };
  const insertPayload = {
    organizationId: req.user.organizationId,
    employeeId: employee._id,
    date: attendanceDate,
    dateKey: effectiveAttendanceDateKey,
    checkInAt: now,
    checkInIp: checkInIp || null,
    checkInDeviceId,
    checkInLatitude: Number.isFinite(checkInLatitude) ? Number(checkInLatitude) : null,
    checkInLongitude: Number.isFinite(checkInLongitude) ? Number(checkInLongitude) : null,
    checkInSelfieProvided,
    checkInSelfieImage,
    checkOutSelfieProvided: false,
    checkOutIp: null,
    checkOutSelfieImage: null,
    dayHistory: [
      buildAttendancePunch({
        action: "check_in",
        at: now,
        ip: checkInIp,
        deviceId: checkInDeviceId,
        latitude: checkInLatitude,
        longitude: checkInLongitude,
        selfieProvided: checkInSelfieProvided,
        selfieImage: checkInSelfieImage
      })
    ],
    status: "checked_in",
    shiftId: effectiveShift._id || null,
    shiftName: effectiveShift.name,
    shiftCode: effectiveShift.code,
    shiftStartTime: effectiveShift.startTime,
    shiftEndTime: effectiveShift.endTime,
    scheduledStartAt: effectiveScheduledStartAt,
    scheduledEndAt: effectiveScheduledEndAt,
    lateByMinutes,
    earlyLoginByMinutes,
    earlyCheckoutByMinutes: 0,
    overtimeMinutes: 0,
    missedCheckout: false,
    missedCheckoutMarkedAt: null,
    missedCheckoutResolvedRequestId: null
  };

  const existing = await Attendance.findOne(attendanceFilter).sort({ date: -1, checkInAt: -1 });
  if (!shouldBypassPolicyChecks && attendanceSecurity?.attendanceSelfieRequired && isMultiPunchEnabled && !checkInSelfieProvided && !existing?.checkInAt) {
    throwHttpError(403, "Selfie is required for first check-in");
  }
  if (!existing) {
    let createdAttendance;
    try {
      createdAttendance = await Attendance.create(insertPayload);
    } catch (error) {
      if (error?.code === 11000) {
        throwHttpError(409, "Already checked in for this shift");
      }
      throw error;
    }
  await audit({
    req,
    module: "timesheets",
    action: "CHECK_IN",
    entityId: createdAttendance?._id || null,
    after: createdAttendance?.toObject?.() || null
  });
  emitAttendanceUpdate(
    { organizationId: req.user.organizationId, userId: req.user.userId },
    {
      event: "CHECK_IN",
      attendance: createdAttendance?.toObject?.() || null
    }
  );
  return createdAttendance;
  }

  if (existing?.checkInAt) {
    if (!isMultiPunchEnabled) {
      throw new Error("Already checked in for this shift");
    }

    const wasOpenSession = isAttendanceOpenSession(existing);
    const baseDayHistory = (existing.dayHistory || []).length
      ? existing.dayHistory
      : [
        buildAttendancePunch({
          action: "check_in",
          at: existing.checkInAt,
          ip: existing.checkInIp,
          deviceId: existing.checkInDeviceId,
          latitude: existing.checkInLatitude,
          longitude: existing.checkInLongitude,
          selfieProvided: existing.checkInSelfieProvided,
          selfieImage: existing.checkInSelfieImage
        }),
        ...(existing.checkOutAt
          ? [
            buildAttendancePunch({
              action: "check_out",
              at: existing.checkOutAt,
              ip: existing.checkOutIp,
              deviceId: existing.checkOutDeviceId,
              selfieProvided: existing.checkOutSelfieProvided,
              selfieImage: existing.checkOutSelfieImage
            })
          ]
          : [])
      ];

    const nextDayHistory = wasOpenSession
      ? [
        ...baseDayHistory,
        buildAttendancePunch({
          action: "check_out",
          at: now,
          ip: checkInIp,
          deviceId: checkInDeviceId,
          latitude: checkInLatitude,
          longitude: checkInLongitude,
          selfieProvided: checkInSelfieProvided,
          selfieImage: checkInSelfieImage
        })
      ]
      : baseDayHistory;

    existing.checkInAt = now;
    existing.checkInIp = checkInIp || null;
    existing.checkInDeviceId = checkInDeviceId;
    existing.checkInLatitude = Number.isFinite(checkInLatitude) ? Number(checkInLatitude) : null;
    existing.checkInLongitude = Number.isFinite(checkInLongitude) ? Number(checkInLongitude) : null;
    existing.checkInSelfieProvided = checkInSelfieProvided;
    existing.checkInSelfieImage = checkInSelfieImage;
    existing.checkOutAt = null;
    existing.checkOutIp = null;
    existing.checkOutDeviceId = null;
    existing.checkOutSelfieProvided = false;
    existing.checkOutSelfieImage = null;
    existing.status = "checked_in";
    existing.overriddenBy = null;
    existing.overriddenAt = null;
    existing.dayHistory = [
      ...nextDayHistory,
      buildAttendancePunch({
        action: "check_in",
        at: now,
        ip: checkInIp,
        deviceId: checkInDeviceId,
        latitude: checkInLatitude,
        longitude: checkInLongitude,
        selfieProvided: checkInSelfieProvided,
        selfieImage: checkInSelfieImage
      })
    ];
    existing.totalMinutes = sumInsideMinutesFromDayHistory(existing.dayHistory);
    normalizeAttendanceDocumentDateFields(existing, organizationTimeZone);
    await existing.save();
    emitAttendanceUpdate(
      { organizationId: req.user.organizationId, userId: req.user.userId },
      {
        event: "CHECK_IN",
        attendance: existing.toObject()
      }
    );
    return existing;
  }

  if (!existing.checkInAt) {
    existing.checkInAt = now;
    existing.checkOutAt = null;
    existing.checkInIp = checkInIp || null;
    existing.checkInDeviceId = checkInDeviceId;
    existing.checkInLatitude = Number.isFinite(checkInLatitude) ? Number(checkInLatitude) : null;
    existing.checkInLongitude = Number.isFinite(checkInLongitude) ? Number(checkInLongitude) : null;
    existing.checkInSelfieProvided = checkInSelfieProvided;
    existing.checkInSelfieImage = checkInSelfieImage;
    existing.checkOutSelfieProvided = false;
    existing.checkOutIp = null;
    existing.checkOutDeviceId = null;
    existing.checkOutSelfieImage = null;
    existing.dayHistory = [
      buildAttendancePunch({
        action: "check_in",
        at: now,
        ip: checkInIp,
        latitude: checkInLatitude,
        longitude: checkInLongitude,
        selfieProvided: checkInSelfieProvided,
        selfieImage: checkInSelfieImage
      })
    ];
    existing.totalMinutes = sumInsideMinutesFromDayHistory(existing.dayHistory);
    existing.status = "checked_in";
    existing.overriddenBy = null;
    existing.overriddenAt = null;
    existing.date = attendanceDate;
    existing.dateKey = effectiveAttendanceDateKey;
    existing.shiftId = effectiveShift._id || null;
    existing.shiftName = effectiveShift.name;
    existing.shiftCode = effectiveShift.code;
    existing.shiftStartTime = effectiveShift.startTime;
    existing.shiftEndTime = effectiveShift.endTime;
    existing.scheduledStartAt = effectiveScheduledStartAt;
    existing.scheduledEndAt = effectiveScheduledEndAt;
    existing.lateByMinutes = lateByMinutes;
    existing.earlyLoginByMinutes = earlyLoginByMinutes;
    existing.earlyCheckoutByMinutes = 0;
    existing.overtimeMinutes = 0;
    existing.missedCheckout = false;
    existing.missedCheckoutMarkedAt = null;
    existing.missedCheckoutResolvedRequestId = null;
    normalizeAttendanceDocumentDateFields(existing, organizationTimeZone);
    await existing.save();
    return existing;
  }

  throwHttpError(400, "Already checked in for this shift");
};

exports.getCheckInPolicy = async (req) => {
  const settings = await OrgSettings.findOne({ organizationId: req.user.organizationId })
    .select(
      "attendanceIpEnabled attendanceSelfieRequired attendanceMultiPunchEnabled attendanceGeoFenceEnabled attendanceGeoLatitude attendanceGeoLongitude attendanceGeoRadiusMeters minWorkHoursPerDay attendanceHoursSource"
    );
  const localGeoFenceFallbackEnabled = process.env.NODE_ENV !== "production";

  return {
    attendanceIpEnabled: Boolean(settings?.attendanceIpEnabled),
    attendanceSelfieRequired: Boolean(settings?.attendanceSelfieRequired),
    attendanceMultiPunchEnabled: Boolean(settings?.attendanceMultiPunchEnabled),
    attendanceGeoFenceEnabled: Boolean(settings?.attendanceGeoFenceEnabled),
    attendanceGeoLatitude: localGeoFenceFallbackEnabled ? settings?.attendanceGeoLatitude ?? null : null,
    attendanceGeoLongitude: localGeoFenceFallbackEnabled ? settings?.attendanceGeoLongitude ?? null : null,
    localGeoFenceFallbackEnabled,
    attendanceGeoRadiusMeters: Number(settings?.attendanceGeoRadiusMeters || 200),
    minWorkHoursPerDay: Number(settings?.minWorkHoursPerDay || 8),
    attendanceHoursSource: ATTENDANCE_HOURS_SOURCES.has(settings?.attendanceHoursSource)
      ? settings.attendanceHoursSource
      : "manual"
  };
};

exports.checkOut = async (req) => {
  await assertManualAttendanceEnabled(req.user.organizationId);
  const employee = await getEmployeeFromReq(req);
  const now = new Date();
  const checkOutIp = getRequestIp(req, req.body);
  const checkOutDeviceId = getRequestDeviceId(req, req.body);
  const organizationTimeZone = await getOrganizationTimeZone(req.user.organizationId);
  const attendanceSecurity = await OrgSettings.findOne({ organizationId: req.user.organizationId })
    .select("attendanceSelfieRequired attendanceMultiPunchEnabled attendanceDevBypassEnabled");
  const shouldBypassPolicyChecks = process.env.NODE_ENV !== "production"
    && Boolean(attendanceSecurity?.attendanceDevBypassEnabled);
  const isMultiPunchEnabled = Boolean(attendanceSecurity?.attendanceMultiPunchEnabled);
  const checkOutLatitude = req.body?.latitude;
  const checkOutLongitude = req.body?.longitude;
  const checkOutSelfieImage = req.body?.selfieImage || null;
  const checkOutSelfieProvided = Boolean(req.body?.selfieImage);

  if (!shouldBypassPolicyChecks && attendanceSecurity?.attendanceSelfieRequired && !checkOutSelfieProvided) {
    throwHttpError(403, "Selfie is required for check-out");
  }

  if (!shouldBypassPolicyChecks && attendanceSecurity?.attendanceSelfieRequired && checkOutSelfieProvided) {
    if (!employee?.profileImage) {
      throwHttpError(400, "Profile photo is not available. Contact admin before selfie check-out.");
    }
    const faceResult = await compareFacesWithFacePP({
      profileImageUrl: employee.profileImage,
      selfieImage: checkOutSelfieImage
    });
    if (!faceResult.passed) {
      throwHttpError(
        403,
        `Face match failed (confidence ${faceResult.confidence.toFixed(2)}). Check-out denied.`
      );
    }
  }

  const openAttendance = await Attendance.findOne({
    organizationId: req.user.organizationId,
    employeeId: employee._id,
    checkInAt: { $ne: null },
    $or: [
      { status: "checked_in" },
      { checkOutAt: null }
    ]
  }).sort({ date: -1, checkInAt: -1 });

  let attendance = canCheckOutAttendance(openAttendance, organizationTimeZone, now)
    ? openAttendance
    : null;

  // If no open session exists, allow checkout updates on the latest attendance
  // for today/yesterday. This supports "last checkout wins" for same check-in.
  if (!attendance) {
    attendance = await Attendance.findOne({
      organizationId: req.user.organizationId,
      employeeId: employee._id,
      checkInAt: { $ne: null }
    }).sort({ date: -1, checkInAt: -1 });

    if (!attendance || !attendance.checkInAt) {
      throw new Error("You are not checked in");
    }

    const isClosedCheckoutUpdate = canUpdateClosedCheckout(attendance, organizationTimeZone, now);
    const isValidOpenOvernight = canCheckOutAttendance(attendance, organizationTimeZone, now);
    if (!isClosedCheckoutUpdate && !isValidOpenOvernight) {
      throw new Error("You are not checked in");
    }
  }
  const previousCheckOutAt = attendance.checkOutAt ? new Date(attendance.checkOutAt) : null;
  const normalizedAttendanceDateKey = getAttendanceRowNormalizedDate(attendance, organizationTimeZone);
  const normalizedAttendanceDate = normalizedAttendanceDateKey
    ? startOfDayInTimeZone(normalizedAttendanceDateKey, organizationTimeZone)
    : startOfDayInTimeZone(getAttendanceStoredDateKey(attendance, organizationTimeZone), organizationTimeZone);

  const baseDayHistory = (attendance.dayHistory || []).length
    ? attendance.dayHistory
    : [
      buildAttendancePunch({
        action: "check_in",
        at: attendance.checkInAt,
        ip: attendance.checkInIp,
        deviceId: attendance.checkInDeviceId,
        latitude: attendance.checkInLatitude,
        longitude: attendance.checkInLongitude,
        selfieProvided: attendance.checkInSelfieProvided,
        selfieImage: attendance.checkInSelfieImage
      })
    ];
  const nextDayHistory = [
    ...baseDayHistory,
    buildAttendancePunch({
      action: "check_out",
      at: now,
      ip: checkOutIp,
      deviceId: checkOutDeviceId,
      latitude: checkOutLatitude,
      longitude: checkOutLongitude,
      selfieProvided: checkOutSelfieProvided,
      selfieImage: checkOutSelfieImage
    })
  ];
  const totalMinutes = isMultiPunchEnabled
    ? sumInsideMinutesFromDayHistory(nextDayHistory)
    : Math.max(
      0,
      Math.round((now.getTime() - attendance.checkInAt.getTime()) / 60000)
    );

  if (totalMinutes > 24 * 60) {
    throw new Error("Checkout duration exceeds 24 hours. Please contact admin to resolve the stale attendance record.");
  }

  const scheduledEnd = attendance.scheduledEndAt
    ? new Date(attendance.scheduledEndAt)
    : (
      await resolveShiftSchedule(
        req.user.organizationId,
        employee._id,
        normalizedAttendanceDateKey,
        organizationTimeZone
      )
    ).scheduledEndAt;
  const earlyCheckoutByMinutes = Math.max(
    0,
    Math.round((scheduledEnd.getTime() - now.getTime()) / 60000)
  );
  const overtimeMinutes = Math.max(
    0,
    Math.round((now.getTime() - scheduledEnd.getTime()) / 60000)
  );

  attendance.checkOutAt = now;
  attendance.checkOutIp = checkOutIp || null;
  attendance.checkOutDeviceId = checkOutDeviceId;
  attendance.checkOutSelfieProvided = checkOutSelfieProvided;
  attendance.checkOutSelfieImage = checkOutSelfieImage;
  attendance.dayHistory = nextDayHistory;
  if (normalizedAttendanceDate) {
    attendance.date = normalizedAttendanceDate;
    attendance.dateKey = normalizedAttendanceDateKey;
  }
  attendance.totalMinutes = totalMinutes;
  attendance.status = "checked_out";
  attendance.overriddenBy = null;
  attendance.overriddenAt = null;
  attendance.earlyCheckoutByMinutes = earlyCheckoutByMinutes;
  attendance.overtimeMinutes = overtimeMinutes;
  attendance.missedCheckout = false;
  attendance.missedCheckoutMarkedAt = null;
  attendance.missedCheckoutResolvedRequestId = null;
  normalizeAttendanceDocumentDateFields(attendance, organizationTimeZone);
  await attendance.save();

  // Update weekly timesheet hours for today
  const hoursWorked = Number((totalMinutes / 60).toFixed(2));
  await upsertTimesheetHours({
    organizationId: req.user.organizationId,
    employeeId: employee._id,
    dateValue: normalizedAttendanceDate || attendance.date,
    hoursWorked
  });

  await audit({
    req,
    module: "timesheets",
    action: "CHECK_OUT",
    entityId: attendance._id,
    before: { checkOutAt: previousCheckOutAt },
    after: attendance.toObject()
  });
  emitAttendanceUpdate(
    { organizationId: req.user.organizationId, userId: req.user.userId },
    {
      event: "CHECK_OUT",
      attendance: attendance.toObject()
    }
  );

  return attendance;
};

exports.getMyAttendance = async (req) => {
  const employee = await getEmployeeFromReq(req);
  const organizationTimeZone = await getOrganizationTimeZone(req.user.organizationId);
  const queryDate = req.query.date ? new Date(req.query.date) : new Date();
  const dayStart = startOfDayInTimeZone(queryDate, organizationTimeZone);
  const dayEnd = endOfDayInTimeZone(queryDate, organizationTimeZone);
  const requestedDayKey = toDateKeyInTimeZone(queryDate, organizationTimeZone);
  const todayKey = toDateKeyInTimeZone(new Date(), organizationTimeZone);
  const attendanceHoursSource = await getAttendanceHoursSource(req.user.organizationId);

  if (attendanceHoursSource === "monitor_agent") {
    return buildMonitorAttendanceList({
      organizationId: req.user.organizationId,
      start: dayStart,
      end: dayEnd,
      timeZone: organizationTimeZone,
      employees: [employee]
    });
  }

  const rows = await Attendance.find(
    buildAttendanceRangeFilter(
      req.user.organizationId,
      { employeeId: employee._id },
      dayStart,
      dayEnd,
      organizationTimeZone
    )
  ).sort({ date: -1, checkInAt: -1 });
  const mergedRows = mergeAttendanceRowsByEmployeeDay(rows, organizationTimeZone);

  if (requestedDayKey === todayKey) {
    const { attendanceDateKey } = await resolveCheckInSchedule(
      req.user.organizationId,
      employee._id,
      new Date(),
      organizationTimeZone
    );
    if (attendanceDateKey !== requestedDayKey) {
      const currentShiftRows = await Attendance.find({
        organizationId: req.user.organizationId,
        employeeId: employee._id,
        ...buildAttendanceDateMatch(attendanceDateKey, organizationTimeZone)
      }).sort({ date: -1, checkInAt: -1 });
      const mergedCurrentShiftRows = mergeAttendanceRowsByEmployeeDay(currentShiftRows, organizationTimeZone)
        .filter((row) => getAttendanceRowDayKey(row, organizationTimeZone) === attendanceDateKey);
      if (mergedCurrentShiftRows.length) {
        return mergedCurrentShiftRows;
      }
    }
    const currentShiftRows = mergedRows
      .filter((row) => getAttendanceRowDayKey(row, organizationTimeZone) === attendanceDateKey);
    if (currentShiftRows.length) {
      return currentShiftRows;
    }
  }

  return mergedRows
    .filter((row) => getAttendanceRowDayKey(row, organizationTimeZone) === requestedDayKey);
};

exports.getAttendance = async (req) => {
  const organizationTimeZone = await getOrganizationTimeZone(req.user.organizationId);
  const start = req.query.startDate ? new Date(req.query.startDate) : new Date();
  const end = req.query.endDate ? new Date(req.query.endDate) : start;
  const requestedEmployeeId = req.query.employeeId ? String(req.query.employeeId) : "";

  const startDate = startOfDayInTimeZone(start, organizationTimeZone);
  const endDate = endOfDayInTimeZone(end, organizationTimeZone);
  const employeeFilter = {};
  let monitorEmployeeQuery = {
    organizationId: req.user.organizationId,
    isDeleted: false
  };

  if (requestedEmployeeId) {
    await assertManageAccessForEmployee(req, requestedEmployeeId);
    employeeFilter.employeeId = requestedEmployeeId;
    monitorEmployeeQuery._id = requestedEmployeeId;
  }

  if (req.user.activeRoleId) {
    const role = await Role.findOne({
      _id: req.user.activeRoleId,
      organizationId: req.user.organizationId
    }).select("slug");

    if (role?.slug === "manager") {
      const managerEmployee = await Employee.findOne({
        userId: req.user.userId,
        organizationId: req.user.organizationId
      }).select("_id");

      if (managerEmployee) {
        const reportIds = await Employee.find({
          organizationId: req.user.organizationId,
          managerId: managerEmployee._id
        }).distinct("_id");
        if (requestedEmployeeId) {
          const allowed = reportIds.some((id) => String(id) === requestedEmployeeId);
          if (!allowed) throw new Error("Access denied");
        } else {
          employeeFilter.employeeId = { $in: reportIds };
          monitorEmployeeQuery._id = { $in: reportIds };
        }
      }
    }
  }

  const attendanceHoursSource = await getAttendanceHoursSource(req.user.organizationId);
  if (attendanceHoursSource === "monitor_agent") {
    const employees = await Employee.find(monitorEmployeeQuery)
      .select("_id firstName lastName employeeCode userId")
      .lean();
    const monitorRows = await buildMonitorAttendanceList({
      organizationId: req.user.organizationId,
      start: startDate,
      end: endDate,
      timeZone: organizationTimeZone,
      employees
    });
    const employeeById = new Map(employees.map((employee) => [String(employee._id), employee]));
    return monitorRows.map((row) => ({
      ...row,
      employeeId: employeeById.get(String(row.employeeId)) || row.employeeId
    }));
  }

  const rows = await Attendance.find(
    buildAttendanceRangeFilter(
      req.user.organizationId,
      employeeFilter,
      startDate,
      endDate,
      organizationTimeZone
    )
  )
    .populate("employeeId", "firstName lastName employeeCode");
  return mergeAttendanceRowsByEmployeeDay(rows, organizationTimeZone);
};

exports.getAttendanceMatrix = async (req) => {
  const organizationTimeZone = await getOrganizationTimeZone(req.user.organizationId);
  const canViewSelfie = await canActorViewAttendanceSelfie(req);
  const todayKey = toDateKeyInTimeZone(new Date(), organizationTimeZone);
  const { year, month, start, end, daysInMonth } = parseMonthRangeInTimeZone(
    req.query.month,
    organizationTimeZone
  );
  const shouldPaginate = Boolean(req.query.page || req.query.limit);
  const page = parsePositiveInt(req.query.page, 1);
  const limit = Math.min(200, parsePositiveInt(req.query.limit, 50));
  const sortBy = String(req.query.sortBy || "employeeCode");
  const sortOrder = String(req.query.sortOrder || "asc").toLowerCase() === "desc" ? -1 : 1;

  const search = String(req.query.search || "").trim();
  const scopedEmployeeIds = await getScopedEmployeeIdsForViewer(req);
  const employeeQuery = buildAttendanceMatrixEmployeeQuery({
    organizationId: req.user.organizationId,
    monthStart: start,
    scopedEmployeeIds,
    search
  });

  const totalEmployees = await Employee.countDocuments(employeeQuery);

  let employeeCursor = Employee.find(employeeQuery)
    .select("_id firstName lastName employeeCode userId shiftId")
    .sort(
      sortBy === "firstName"
        ? { firstName: sortOrder, lastName: sortOrder, employeeCode: 1 }
        : sortBy === "lastName"
          ? { lastName: sortOrder, firstName: sortOrder, employeeCode: 1 }
          : { employeeCode: sortOrder, firstName: 1, lastName: 1 }
    );

  if (shouldPaginate) {
    employeeCursor = employeeCursor.skip((page - 1) * limit).limit(limit);
  }

  const employees = await employeeCursor;
  const orgSettings = await OrgSettings.findOne({ organizationId: req.user.organizationId })
    .select("minHalfDayHours minWorkHoursPerDay attendanceHoursSource attendanceLockEnabled attendanceLockAfterDays attendanceLockMode payrollCutoffDay");
  const attendanceHoursSource = ATTENDANCE_HOURS_SOURCES.has(orgSettings?.attendanceHoursSource)
    ? orgSettings.attendanceHoursSource
    : "manual";

  if (!employees.length) {
    return {
      year,
      month,
      daysInMonth,
      attendanceHoursSource,
      employees: [],
      lockAttendance: null,
      pagination: {
        total: totalEmployees,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(totalEmployees / limit))
      }
    };
  }

  const employeeIds = employees.map((e) => e._id);
  const [attendanceRowsRaw, holidays, approvedLeaves, weekOffMap] = await Promise.all([
    Attendance.find(
      buildAttendanceRangeFilter(
        req.user.organizationId,
        { employeeId: { $in: employeeIds } },
        start,
        end,
        organizationTimeZone
      )
    )
      .select("employeeId date checkInAt checkOutAt checkInIp checkOutIp checkInSelfieProvided checkOutSelfieProvided totalMinutes overriddenBy overriddenAt shiftName shiftCode shiftStartTime shiftEndTime lateByMinutes earlyLoginByMinutes earlyCheckoutByMinutes overtimeMinutes missedCheckout missedCheckoutMarkedAt")
      .populate("overriddenBy", "firstName lastName"),
    Holiday.find({
      organizationId: req.user.organizationId,
      status: "active",
      date: { $gte: start, $lte: end }
    }).select("date name"),
    Leave.find({
      organizationId: req.user.organizationId,
      employeeId: { $in: employeeIds },
      status: "approved",
      fromDate: { $lte: end },
      toDate: { $gte: start }
    }).populate("leaveTypeId", "name code"),
    WeekOffService.resolveWeekOffMapForEmployees({
      organizationId: req.user.organizationId,
      employees
    }),
  ]);

  const attendanceRows = mergeAttendanceRowsByEmployeeDay(attendanceRowsRaw, organizationTimeZone);
  const monitorHours = attendanceHoursSource === "monitor_agent"
    ? await getMonitorAttendanceHours({
        organizationId: req.user.organizationId,
        start,
        end,
        timeZone: organizationTimeZone,
        employees
      })
    : new Map();
  const pendingCheckoutCount = await countPendingCheckoutForMonth({
    organizationId: req.user.organizationId,
    start,
    end,
    scopedEmployeeIds
  });
  const monthEndDateKey = toDateKeyInTimeZone(end, organizationTimeZone);
  const snapshotGenerated = await hasPayrollSnapshotForMonth(req, `${year}-${String(month).padStart(2, "0")}`);
  const lockAttendance = buildLockAttendanceActionMeta({
    settings: orgSettings,
    monthEndDateKey,
    pendingCheckoutCount,
    snapshotGenerated,
    timeZone: organizationTimeZone
  });

  const holidayByDay = new Map();
  holidays.forEach((h) => {
    holidayByDay.set(getDayInTimeZone(h.date, organizationTimeZone), h.name);
  });
  const holidayKeySet = new Set(
    holidays.map((holiday) => toDateKeyInTimeZone(holiday.date, organizationTimeZone))
  );

  const attendanceMap = new Map();
  attendanceRows.forEach((row) => {
    const day = getDayInTimeZone(row.date, organizationTimeZone);
    const key = `${row.employeeId.toString()}-${day}`;
    const overriddenByName = row.overriddenBy
      ? `${row.overriddenBy.firstName || ""} ${row.overriddenBy.lastName || ""}`.trim()
      : null;
    const isOpenSession = isAttendanceOpenSession(row);
    const status = resolveAttendanceMatrixStatus(row, {
      minHalfDayHours: Number(orgSettings?.minHalfDayHours ?? 4),
      minWorkHoursPerDay: Number(orgSettings?.minWorkHoursPerDay ?? 8)
    });
    const overtimeMinutes = resolveOvertimeMinutes(
      Number(row.totalMinutes || 0),
      Number(orgSettings?.minWorkHoursPerDay ?? 8)
    );
    attendanceMap.set(key, {
      status,
      checkInAt: row.checkInAt || null,
      checkOutAt: row.checkOutAt || null,
      checkInIp: canViewSelfie ? (row.checkInIp || null) : null,
      checkOutIp: canViewSelfie ? (row.checkOutIp || null) : null,
      checkInSelfieProvided: canViewSelfie ? Boolean(row.checkInSelfieProvided) : false,
      checkOutSelfieProvided: canViewSelfie ? Boolean(row.checkOutSelfieProvided) : false,
      totalMinutes: Number(row.totalMinutes || 0),
      isOpenSession,
      excludeFromPayroll: isOpenSession,
      payrollReconciledByLeave: false,
      missedCheckout: Boolean(row.missedCheckout),
      missedCheckoutMarkedAt: row.missedCheckoutMarkedAt || null,
      overriddenBy: overriddenByName || null,
      overriddenAt: row.overriddenAt || null,
      shiftName: row.shiftName || null,
      shiftCode: row.shiftCode || null,
      shiftStartTime: row.shiftStartTime || null,
      shiftEndTime: row.shiftEndTime || null,
      lateByMinutes: Number(row.lateByMinutes || 0),
      earlyLoginByMinutes: Number(row.earlyLoginByMinutes || 0),
      earlyCheckoutByMinutes: Number(row.earlyCheckoutByMinutes || 0),
      overtimeMinutes,
      workFromHomePortion: row.workFromHomePortion || null
    });

    if (isActiveOvernightSession(row, organizationTimeZone)) {
      const spilloverDayKey = toDateKeyInTimeZone(row.scheduledEndAt, organizationTimeZone);
      if (spilloverDayKey === todayKey) {
        const spilloverDay = getDayInTimeZone(row.scheduledEndAt, organizationTimeZone);
        const spilloverKey = `${row.employeeId.toString()}-${spilloverDay}`;
        attendanceMap.set(spilloverKey, {
          ...attendanceMap.get(key),
          status: "pending_checkout",
          isOpenSession: true,
          excludeFromPayroll: true
        });
      }
    }
  });

  if (attendanceHoursSource === "monitor_agent") {
    monitorHours.forEach((monitorRow, key) => {
      const [employeeId, dateKey] = key.split("|");
      const day = getDayInTimeZone(startOfDayInTimeZone(dateKey, organizationTimeZone), organizationTimeZone);
      const totalMinutes = monitorRow.totalMinutes;
      const firstSeenAt = monitorRow.firstSeenAt ? new Date(monitorRow.firstSeenAt).toISOString() : null;
      const lastSeenAt = monitorRow.lastSeenAt ? new Date(monitorRow.lastSeenAt).toISOString() : null;
      attendanceMap.set(`${employeeId}-${day}`, {
        status: resolveAttendanceMatrixStatus({ checkInAt: firstSeenAt, checkOutAt: lastSeenAt, totalMinutes }, {
          minHalfDayHours: Number(orgSettings?.minHalfDayHours ?? 4),
          minWorkHoursPerDay: Number(orgSettings?.minWorkHoursPerDay ?? 8)
        }),
        checkInAt: firstSeenAt,
        checkOutAt: lastSeenAt,
        checkInIp: null,
        checkOutIp: null,
        checkInSelfieProvided: false,
        checkOutSelfieProvided: false,
        totalMinutes,
        hoursSource: "monitor_agent",
        isOpenSession: false,
        excludeFromPayroll: false,
        payrollReconciledByLeave: false,
        missedCheckout: false,
        missedCheckoutMarkedAt: null,
        overriddenBy: null,
        overriddenAt: null,
        shiftName: null,
        shiftCode: null,
        shiftStartTime: null,
        shiftEndTime: null,
        lateByMinutes: 0,
        earlyLoginByMinutes: 0,
        earlyCheckoutByMinutes: 0,
        overtimeMinutes: resolveOvertimeMinutes(totalMinutes, Number(orgSettings?.minWorkHoursPerDay ?? 8)),
        workFromHomePortion: null
      });
    });
  }

  const leaveMap = new Map();
  approvedLeaves.forEach((leave) => {
    const employeeWeekOffDays = weekOffMap.employeeMap.get(String(leave.employeeId)) || weekOffMap.defaultDays || [];
    getLeaveDateKeysForDisplay({
      leave,
      holidayKeySet,
      weekOffDays: employeeWeekOffDays,
      timeZone: organizationTimeZone
    }).forEach((dateKey) => {
      const leaveDate = startOfDayInTimeZone(dateKey, organizationTimeZone);
      if (leaveDate < start || leaveDate > end) return;
      const key = `${leave.employeeId.toString()}-${getDayInTimeZone(leaveDate, organizationTimeZone)}`;
      leaveMap.set(key, {
        isOnLeave: true,
        leaveType: leave.leaveTypeId?.name || "Leave",
        leaveCode: leave.leaveTypeId?.code || "",
        isPaidLeave: !DEFAULT_UNPAID_LEAVE_CODES.has(String(leave.leaveTypeId?.code || "").toUpperCase()),
        leaveDuration: leave.duration || "full_day",
        leaveHalfDaySession: leave.halfDaySession || null,
        leaveUnits: leave.duration === "half_day" ? 0.5 : 1
      });
    });
  });

  const data = employees.map((emp) => {
    const days = {};
    for (let day = 1; day <= daysInMonth; day += 1) {
      const key = `${emp._id.toString()}-${day}`;
      const base = attendanceMap.get(key);
      const leaveInfo = leaveMap.get(key) || {
        isOnLeave: false,
        leaveType: null,
        leaveCode: "",
        isPaidLeave: false,
        leaveDuration: null,
        leaveHalfDaySession: null,
        leaveUnits: 0
      };
      const dayKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const weekday = getWeekdayForDateKey(dayKey, organizationTimeZone);
      const employeeWeekOffDays = weekOffMap.employeeMap.get(String(emp._id)) || weekOffMap.defaultDays || [];
      const isWeekOff = employeeWeekOffDays.includes(weekday);
      const holidayName = holidayByDay.get(day) || null;
      days[day] = base || {
        status: "absent",
        checkInAt: null,
        checkOutAt: null,
        checkInIp: null,
        checkOutIp: null,
        checkInSelfieProvided: false,
        checkOutSelfieProvided: false,
        isOpenSession: false,
        excludeFromPayroll: false,
        payrollReconciledByLeave: false,
        missedCheckout: false,
        missedCheckoutMarkedAt: null,
        overriddenBy: null,
        overriddenAt: null,
        shiftName: null,
        shiftCode: null,
        shiftStartTime: null,
        shiftEndTime: null,
        lateByMinutes: 0,
        earlyLoginByMinutes: 0,
        earlyCheckoutByMinutes: 0,
        overtimeMinutes: 0,
        workFromHomePortion: null
      };
      days[day].isOnLeave = leaveInfo.isOnLeave;
      days[day].leaveType = leaveInfo.leaveType;
      days[day].leaveCode = leaveInfo.leaveCode;
      days[day].isPaidLeave = leaveInfo.isPaidLeave;
      days[day].leaveDuration = leaveInfo.leaveDuration;
      days[day].leaveHalfDaySession = leaveInfo.leaveHalfDaySession;
      days[day].leaveUnits = leaveInfo.leaveUnits;
      if (
        leaveInfo.isOnLeave
        && leaveInfo.leaveDuration === "half_day"
        && days[day].status === "pending_checkout"
      ) {
        days[day].excludeFromPayroll = false;
        days[day].payrollReconciledByLeave = true;
      }
      days[day].isWeekOff = isWeekOff;
      days[day].holidayName = holidayName;
      days[day] = decorateAttendanceCell({
        cell: days[day],
        dayKey,
        todayKey,
        snapshotGenerated: Boolean(snapshotGenerated)
      });
    }
    return {
      employeeId: String(emp._id),
      firstName: emp.firstName,
      lastName: emp.lastName,
      employeeCode: emp.employeeCode,
      days,
      summary: buildAttendanceSummary(days, daysInMonth)
    };
  });

  return {
    year,
    month,
    daysInMonth,
    attendanceHoursSource,
    employees: data,
    lockAttendance,
    pagination: {
      total: totalEmployees,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(totalEmployees / limit))
    }
  };
};

exports.getMyAttendanceMatrix = async (req) => {
  const organizationTimeZone = await getOrganizationTimeZone(req.user.organizationId);
  const canViewSelfie = await canActorViewAttendanceSelfie(req);
  const todayKey = toDateKeyInTimeZone(new Date(), organizationTimeZone);
  const { year, month, start, end, daysInMonth } = parseMonthRangeInTimeZone(
    req.query.month,
    organizationTimeZone
  );
  const employee = await getEmployeeFromReq(req);

  const [attendanceRowsRaw, holidays, approvedLeaves, weekOffDays, orgSettings] = await Promise.all([
    Attendance.find(
      buildAttendanceRangeFilter(
        req.user.organizationId,
        { employeeId: employee._id },
        start,
        end,
        organizationTimeZone
      )
    )
      .select("employeeId date checkInAt checkOutAt checkInIp checkOutIp checkInSelfieProvided checkOutSelfieProvided totalMinutes overriddenBy overriddenAt shiftName shiftCode shiftStartTime shiftEndTime lateByMinutes earlyLoginByMinutes earlyCheckoutByMinutes overtimeMinutes missedCheckout missedCheckoutMarkedAt")
      .populate("overriddenBy", "firstName lastName"),
    Holiday.find({
      organizationId: req.user.organizationId,
      status: "active",
      date: { $gte: start, $lte: end }
    }).select("date name"),
    Leave.find({
      organizationId: req.user.organizationId,
      employeeId: employee._id,
      status: "approved",
      fromDate: { $lte: end },
      toDate: { $gte: start }
    }).populate("leaveTypeId", "name code"),
    WeekOffService.resolveWeekOffDays({
      organizationId: req.user.organizationId,
      shiftId: employee.shiftId
    }),
    OrgSettings.findOne({ organizationId: req.user.organizationId })
      .select("minHalfDayHours minWorkHoursPerDay attendanceHoursSource attendanceLockEnabled attendanceLockAfterDays attendanceLockMode payrollCutoffDay")
  ]);

  const attendanceRows = mergeAttendanceRowsByEmployeeDay(attendanceRowsRaw, organizationTimeZone);
  const attendanceHoursSource = ATTENDANCE_HOURS_SOURCES.has(orgSettings?.attendanceHoursSource)
    ? orgSettings.attendanceHoursSource
    : "manual";
  const monitorHours = attendanceHoursSource === "monitor_agent"
    ? await getMonitorAttendanceHours({
        organizationId: req.user.organizationId,
        start,
        end,
        timeZone: organizationTimeZone,
        employees: [employee]
      })
    : new Map();
  const pendingCheckoutCount = await countPendingCheckoutForMonth({
    organizationId: req.user.organizationId,
    start,
    end,
    scopedEmployeeIds: [employee._id]
  });
  const monthEndDateKey = toDateKeyInTimeZone(end, organizationTimeZone);
  const snapshotGenerated = await hasPayrollSnapshotForMonth(req, `${year}-${String(month).padStart(2, "0")}`);
  const lockAttendance = buildLockAttendanceActionMeta({
    settings: orgSettings,
    monthEndDateKey,
    pendingCheckoutCount,
    snapshotGenerated,
    timeZone: organizationTimeZone
  });

  const holidayByDay = new Map();
  holidays.forEach((h) => {
    holidayByDay.set(getDayInTimeZone(h.date, organizationTimeZone), h.name);
  });
  const holidayKeySet = new Set(
    holidays.map((holiday) => toDateKeyInTimeZone(holiday.date, organizationTimeZone))
  );

  const days = {};
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    days[day] = {
      status: "absent",
      checkInAt: null,
      checkOutAt: null,
      checkInIp: null,
      checkOutIp: null,
      checkInSelfieProvided: false,
      checkOutSelfieProvided: false,
      isOpenSession: false,
      excludeFromPayroll: false,
      payrollReconciledByLeave: false,
      missedCheckout: false,
      missedCheckoutMarkedAt: null,
      overriddenBy: null,
      overriddenAt: null,
      shiftName: null,
      shiftCode: null,
      shiftStartTime: null,
      shiftEndTime: null,
      lateByMinutes: 0,
      earlyLoginByMinutes: 0,
      earlyCheckoutByMinutes: 0,
      overtimeMinutes: 0,
      workFromHomePortion: null,
      isOnLeave: false,
      leaveType: null,
      leaveDuration: null,
      leaveHalfDaySession: null,
      leaveUnits: 0,
      isWeekOff: weekOffDays.includes(getWeekdayForDateKey(dateKey, organizationTimeZone)),
      holidayName: holidayByDay.get(day) || null
    };
  }
  attendanceRows.forEach((row) => {
    const day = getDayInTimeZone(row.date, organizationTimeZone);
    const overriddenByName = row.overriddenBy
      ? `${row.overriddenBy.firstName || ""} ${row.overriddenBy.lastName || ""}`.trim()
      : null;
    const isOpenSession = isAttendanceOpenSession(row);
    const status = resolveAttendanceMatrixStatus(row, {
      minHalfDayHours: Number(orgSettings?.minHalfDayHours ?? 4),
      minWorkHoursPerDay: Number(orgSettings?.minWorkHoursPerDay ?? 8)
    });
    const overtimeMinutes = resolveOvertimeMinutes(
      Number(row.totalMinutes || 0),
      Number(orgSettings?.minWorkHoursPerDay ?? 8)
    );
    days[day] = {
      ...days[day],
      status,
      checkInAt: row.checkInAt || null,
      checkOutAt: row.checkOutAt || null,
      checkInIp: canViewSelfie ? (row.checkInIp || null) : null,
      checkOutIp: canViewSelfie ? (row.checkOutIp || null) : null,
      checkInSelfieProvided: canViewSelfie ? Boolean(row.checkInSelfieProvided) : false,
      checkOutSelfieProvided: canViewSelfie ? Boolean(row.checkOutSelfieProvided) : false,
      totalMinutes: Number(row.totalMinutes || 0),
      isOpenSession,
      excludeFromPayroll: isOpenSession,
      payrollReconciledByLeave: false,
      missedCheckout: Boolean(row.missedCheckout),
      missedCheckoutMarkedAt: row.missedCheckoutMarkedAt || null,
      overriddenBy: overriddenByName || null,
      overriddenAt: row.overriddenAt || null,
      shiftName: row.shiftName || null,
      shiftCode: row.shiftCode || null,
      shiftStartTime: row.shiftStartTime || null,
      shiftEndTime: row.shiftEndTime || null,
      lateByMinutes: Number(row.lateByMinutes || 0),
      earlyLoginByMinutes: Number(row.earlyLoginByMinutes || 0),
      earlyCheckoutByMinutes: Number(row.earlyCheckoutByMinutes || 0),
      overtimeMinutes,
      workFromHomePortion: row.workFromHomePortion || null
    };

    if (isActiveOvernightSession(row, organizationTimeZone)) {
      const spilloverDayKey = toDateKeyInTimeZone(row.scheduledEndAt, organizationTimeZone);
      if (spilloverDayKey === todayKey) {
        const spilloverDay = getDayInTimeZone(row.scheduledEndAt, organizationTimeZone);
        days[spilloverDay] = {
          ...days[spilloverDay],
          ...days[day],
          status: "pending_checkout",
          isOpenSession: true,
          excludeFromPayroll: true
        };
      }
    }
  });

  if (attendanceHoursSource === "monitor_agent") {
    monitorHours.forEach((monitorRow, key) => {
      const [, dateKey] = key.split("|");
      const day = getDayInTimeZone(startOfDayInTimeZone(dateKey, organizationTimeZone), organizationTimeZone);
      const totalMinutes = monitorRow.totalMinutes;
      const firstSeenAt = monitorRow.firstSeenAt ? new Date(monitorRow.firstSeenAt).toISOString() : null;
      const lastSeenAt = monitorRow.lastSeenAt ? new Date(monitorRow.lastSeenAt).toISOString() : null;
      days[day] = {
        ...days[day],
        status: resolveAttendanceMatrixStatus({ checkInAt: firstSeenAt, checkOutAt: lastSeenAt, totalMinutes }, {
          minHalfDayHours: Number(orgSettings?.minHalfDayHours ?? 4),
          minWorkHoursPerDay: Number(orgSettings?.minWorkHoursPerDay ?? 8)
        }),
        checkInAt: firstSeenAt,
        checkOutAt: lastSeenAt,
        totalMinutes,
        hoursSource: "monitor_agent",
        isOpenSession: false,
        excludeFromPayroll: false,
        overtimeMinutes: resolveOvertimeMinutes(totalMinutes, Number(orgSettings?.minWorkHoursPerDay ?? 8))
      };
    });
  }

  approvedLeaves.forEach((leave) => {
    getLeaveDateKeysForDisplay({
      leave,
      holidayKeySet,
      weekOffDays,
      timeZone: organizationTimeZone
    }).forEach((dateKey) => {
      const leaveDate = startOfDayInTimeZone(dateKey, organizationTimeZone);
      if (leaveDate < start || leaveDate > end) return;
      const day = getDayInTimeZone(leaveDate, organizationTimeZone);
      days[day] = {
        ...days[day],
        isOnLeave: true,
        leaveType: leave.leaveTypeId?.name || "Leave",
        leaveCode: leave.leaveTypeId?.code || "",
        isPaidLeave: !DEFAULT_UNPAID_LEAVE_CODES.has(String(leave.leaveTypeId?.code || "").toUpperCase()),
        leaveDuration: leave.duration || "full_day",
        leaveHalfDaySession: leave.halfDaySession || null,
        leaveUnits: leave.duration === "half_day" ? 0.5 : 1
      };
      if (
        days[day].leaveDuration === "half_day"
        && days[day].status === "pending_checkout"
      ) {
        days[day].excludeFromPayroll = false;
        days[day].payrollReconciledByLeave = true;
      }
    });
  });

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dayKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    days[day] = decorateAttendanceCell({
      cell: days[day],
      dayKey,
      todayKey,
      snapshotGenerated: Boolean(snapshotGenerated)
    });
  }

  return {
    year,
    month,
    daysInMonth,
    attendanceHoursSource,
    lockAttendance,
    employees: [{
      employeeId: String(employee._id),
      firstName: employee.firstName,
      lastName: employee.lastName,
      employeeCode: employee.employeeCode,
      days,
      summary: buildAttendanceSummary(days, daysInMonth)
    }]
  };
};

exports.getAttendanceCellHistory = async (req) => {
  const employeeId = req.query.employeeId;
  const date = req.query.date;
  if (!employeeId || !date) {
    throw new Error("employeeId and date are required");
  }

  await assertManageAccessForEmployee(req, employeeId);
  const canViewSelfie = await canActorViewAttendanceSelfie(req);

  const organizationTimeZone = await getOrganizationTimeZone(req.user.organizationId);
  const requestedDayKey = normalizeAttendanceRequestDateKey(date, organizationTimeZone);
  const dayStart = startOfDayInTimeZone(requestedDayKey, organizationTimeZone);
  const dayEnd = endOfDayInTimeZone(requestedDayKey, organizationTimeZone);
  const attendanceRows = await Attendance.find(
    buildAttendanceRangeFilter(
      req.user.organizationId,
      { employeeId },
      dayStart,
      dayEnd,
      organizationTimeZone
    )
  )
    .populate("overriddenBy", "firstName lastName employeeCode")
    .sort({ date: -1, checkInAt: -1 });
  const attendance = mergeAttendanceRowsByEmployeeDay(attendanceRows, organizationTimeZone)
    .find((row) => getAttendanceRowDayKey(row, organizationTimeZone) === requestedDayKey) || null;
  const orgSettings = await OrgSettings.findOne({ organizationId: req.user.organizationId })
    .select("attendanceHoursSource minHalfDayHours minWorkHoursPerDay")
    .lean();
  const attendanceHoursSource = ATTENDANCE_HOURS_SOURCES.has(orgSettings?.attendanceHoursSource)
    ? orgSettings.attendanceHoursSource
    : "manual";
  const employeeForMonitor = attendanceHoursSource === "monitor_agent"
    ? await Employee.findOne({ _id: employeeId, organizationId: req.user.organizationId })
        .select("_id employeeCode userId")
        .lean()
    : null;
  const monitorHours = employeeForMonitor
    ? await getMonitorAttendanceHours({
        organizationId: req.user.organizationId,
        start: dayStart,
        end: dayEnd,
        timeZone: organizationTimeZone,
        employees: [employeeForMonitor]
      })
    : new Map();
  const monitorRow = monitorHours.get(`${employeeId}|${requestedDayKey}`) || null;

  const approvedLeave = await Leave.findOne({
    organizationId: req.user.organizationId,
    employeeId,
    status: "approved",
    fromDate: { $lte: dayEnd },
    toDate: { $gte: dayStart }
  })
    .populate("leaveTypeId", "name code")
    .populate("actionBy", "firstName lastName employeeCode")
    .populate("approvalSteps.actionBy", "firstName lastName employeeCode")
    .sort({ createdAt: -1 });

  const attendanceRequest = await AttendanceRequest.findOne({
    organizationId: req.user.organizationId,
    employeeId,
    date: requestedDayKey
  })
    .populate("actionBy", "firstName lastName employeeCode")
    .populate("approvalSteps.actionBy", "firstName lastName employeeCode")
    .sort({ createdAt: -1 });

  const leaveActionBy = resolveActionEmployeeFromRequest(approvedLeave);
  const leaveActionAt = resolveActionAtFromRequest(approvedLeave);

  const leaveData = approvedLeave
    ? {
        leaveType: approvedLeave.leaveTypeId?.name || "Leave",
        leaveCode: approvedLeave.leaveTypeId?.code || "",
        duration: approvedLeave.duration || "full_day",
        halfDaySession: approvedLeave.halfDaySession || null,
        reason: approvedLeave.reason || "",
        status: approvedLeave.status,
        approvedBy: toEmployeeDisplayName(leaveActionBy),
        approvedByEmployeeCode: leaveActionBy?.employeeCode || null,
        approvedAt: leaveActionAt
      }
    : null;

  const requestActionBy = resolveActionEmployeeFromRequest(attendanceRequest);
  const requestActionAt = resolveActionAtFromRequest(attendanceRequest);
  const attendanceRequestData = attendanceRequest
    ? {
        requestType: attendanceRequest.requestType,
        dayPortion: attendanceRequest.dayPortion || "full_day",
        requestedCheckInTime: attendanceRequest.requestedCheckInTime || null,
        requestedCheckOutTime: attendanceRequest.requestedCheckOutTime || null,
        reason: attendanceRequest.reason || "",
        status: attendanceRequest.status,
        approvedBy: toEmployeeDisplayName(requestActionBy),
        approvedByEmployeeCode: requestActionBy?.employeeCode || null,
        approvedAt: requestActionAt,
        rejectionReason: attendanceRequest.rejectionReason || null
      }
    : null;

  if (attendanceHoursSource === "monitor_agent" && monitorRow) {
    const totalMinutes = monitorRow.totalMinutes;
    const firstSeenAt = monitorRow.firstSeenAt ? new Date(monitorRow.firstSeenAt).toISOString() : null;
    const lastSeenAt = monitorRow.lastSeenAt ? new Date(monitorRow.lastSeenAt).toISOString() : null;
    const monitorAttendanceData = {
      _id: null,
      employeeId,
      date: requestedDayKey,
      checkInAt: firstSeenAt,
      checkOutAt: lastSeenAt,
      totalMinutes,
      hoursSource: "monitor_agent",
      status: resolveAttendanceMatrixStatus({ checkInAt: firstSeenAt, checkOutAt: lastSeenAt, totalMinutes }, {
        minHalfDayHours: Number(orgSettings?.minHalfDayHours ?? 4),
        minWorkHoursPerDay: Number(orgSettings?.minWorkHoursPerDay ?? 8)
      }),
      checkInSelfieProvided: false,
      checkInSelfieImage: null,
      checkOutSelfieProvided: false,
      checkOutSelfieImage: null,
      checkInIp: null,
      checkOutIp: null,
      dayHistory: []
    };
    return {
      attendance: monitorAttendanceData,
      leave: leaveData,
      attendanceRequest: attendanceRequestData,
      history: buildAttendanceActivityHistory([], monitorAttendanceData)
    };
  }

  if (!attendance) {
    return { attendance: null, leave: leaveData, attendanceRequest: attendanceRequestData, history: [] };
  }

  const attendanceData = attendance.toObject ? attendance.toObject() : attendance;
  attendanceData.dayHistory = sanitizeDayHistoryForSelfieAccess(attendanceData.dayHistory || [], canViewSelfie);
  if (!canViewSelfie) {
    attendanceData.checkInSelfieProvided = false;
    attendanceData.checkInSelfieImage = null;
    attendanceData.checkOutSelfieProvided = false;
    attendanceData.checkOutSelfieImage = null;
    attendanceData.checkInIp = null;
    attendanceData.checkOutIp = null;
  }

  const history = await AuditLog.find({
    organizationId: req.user.organizationId,
    module: "timesheets",
    entityId: attendance._id,
    action: { $in: ["CHECK_IN", "CHECK_OUT", "ATTENDANCE_OVERRIDE"] }
  })
    .populate("userId", "email")
    .sort({ createdAt: -1 })
    .select("action before after createdAt userId");

  return {
    attendance: attendanceData,
    leave: leaveData,
    attendanceRequest: attendanceRequestData,
    history: buildAttendanceActivityHistory(history, attendanceData)
  };
};

exports.getMyAttendanceCellHistory = async (req) => {
  const employee = await getEmployeeFromReq(req);
  req.query.employeeId = employee._id.toString();
  return exports.getAttendanceCellHistory(req);
};

exports.getAttendanceRequestDefaults = async (req) => {
  const employee = await getEmployeeFromReq(req);
  const organizationTimeZone = await getOrganizationTimeZone(req.user.organizationId);
  const dateKey = normalizeAttendanceRequestDateKey(req.query.date, organizationTimeZone);
  const { shift, scheduledStartAt, scheduledEndAt } = await resolveShiftSchedule(
    req.user.organizationId,
    employee._id,
    dateKey,
    organizationTimeZone
  );
  const dayPortion = req.query.dayPortion || "full_day";
  const startMinutes = String(shift.startTime || "00:00")
    .split(":")
    .reduce((total, part, index) => total + Number(part || 0) * (index === 0 ? 60 : 1), 0);
  let endMinutes = String(shift.endTime || "00:00")
    .split(":")
    .reduce((total, part, index) => total + Number(part || 0) * (index === 0 ? 60 : 1), 0);
  if (endMinutes <= startMinutes) endMinutes += 24 * 60;
  const midpointMinutes = startMinutes + Math.round((endMinutes - startMinutes) / 2);
  const toTime = (minutes) => {
    const normalized = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
    return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
  };
  const requestedCheckInTime =
    dayPortion === "second_half" ? toTime(midpointMinutes) : shift.startTime;
  const requestedCheckOutTime =
    dayPortion === "first_half" ? toTime(midpointMinutes) : shift.endTime;

  return {
    date: dateKey,
    requestType: req.query.requestType || "work_from_home",
    dayPortion,
    requestedCheckInTime,
    requestedCheckOutTime,
    shift: {
      id: shift._id || null,
      name: shift.name,
      code: shift.code,
      startTime: shift.startTime,
      endTime: shift.endTime
    },
    scheduledStartAt,
    scheduledEndAt
  };
};

exports.raiseAttendanceRequest = async (req) => {
  const employee = await getEmployeeFromReq(req);
  const organizationTimeZone = await getOrganizationTimeZone(req.user.organizationId);
  let dateKey = normalizeAttendanceRequestDateKey(req.body.date, organizationTimeZone);
  let date = startOfDayInTimeZone(dateKey, organizationTimeZone);
  const requestedDateKey = dateKey;
  const today = startOfDayInTimeZone(new Date(), organizationTimeZone);
  if (date > today) {
    throw new Error("Attendance request date cannot be in the future");
  }

  let requestType = req.body.requestType;
  const dayPortion = requestType === "work_from_home"
    ? req.body.dayPortion || "full_day"
    : "full_day";
  let requestedCheckInTime = req.body.requestedCheckInTime || null;
  let requestedCheckOutTime = req.body.requestedCheckOutTime || null;

  if (requestType === "work_from_home") {
    const defaults = await exports.getAttendanceRequestDefaults({
      ...req,
      query: { date: dateKey, requestType, dayPortion }
    });
    requestedCheckInTime = defaults.requestedCheckInTime;
    requestedCheckOutTime = defaults.requestedCheckOutTime;
  }

  if (requestType === "missed_checkout" && !requestedCheckOutTime) {
    throw new Error("Requested checkout time is required for missed checkout request");
  }
  if (requestType === "correction" && !requestedCheckInTime && !requestedCheckOutTime) {
    throw new Error("Provide requested check-in or check-out time");
  }
  if (requestType === "work_from_home" && (!requestedCheckInTime || !requestedCheckOutTime)) {
    throw new Error("Shift timings are required for work from home request");
  }

  if (requestType === "missed_checkout") {
    const target = await resolveMissedCheckoutAttendanceTarget({
      organizationId: req.user.organizationId,
      employeeId: employee._id,
      requestedDateKey: dateKey,
      requestedCheckOutTime,
      organizationTimeZone
    });
    if (!target) {
      const existingAttendanceTarget = await resolveAttendanceTargetForRequestDate({
        organizationId: req.user.organizationId,
        employeeId: employee._id,
        requestedDateKey: dateKey,
        requestedCheckOutTime,
        organizationTimeZone
      });
      if (!existingAttendanceTarget?.attendance?.checkInAt) {
        throw new Error("No unresolved check-in found for the provided date");
      }

      if (existingAttendanceTarget.attendance.checkOutAt) {
        requestType = "correction";
      } else {
        throw new Error("No unresolved check-in found for the provided date");
      }
    }
  }

  const existingPending = await AttendanceRequest.findOne({
    organizationId: req.user.organizationId,
    employeeId: employee._id,
    date: requestedDateKey,
    status: "pending"
  });
  if (existingPending) {
    throw new Error("A pending attendance request already exists for this date");
  }

  const flowConfig = await resolveApplicableFlow({
    organizationId: req.user.organizationId,
    moduleKey: "attendance_request",
    subjectEmployee: employee,
    preferredFlowId: employee.attendanceApprovalFlowId || null
  });
  const initialPendingStep = (flowConfig?.steps || []).find((s) => s.status === "pending");

  const request = await AttendanceRequest.create({
    organizationId: req.user.organizationId,
    employeeId: employee._id,
    date: requestedDateKey,
    requestType,
    dayPortion,
    requestedCheckInTime,
    requestedCheckOutTime,
    reason: req.body.reason,
    status: "pending",
    approvalFlowId: flowConfig?.flowId || null,
    approvalSteps: flowConfig?.steps || [],
    currentApprovalStep: initialPendingStep?.stepNumber || null
  });

  const pendingStep = getCurrentPendingStep(request.approvalSteps || []);
  const employeeName = `${employee.firstName || ""} ${employee.lastName || ""}`.trim();
  const notificationPayload = {
    organizationId: req.user.organizationId,
    actorEmployeeId: employee._id,
    type: "attendance_request_pending_approval",
    title: "Attendance request approval pending",
    message: `${employeeName} submitted an attendance request for ${requestedDateKey}.`,
    meta: {
      attendanceRequestId: request._id,
      status: request.status,
      currentApprovalStep: request.currentApprovalStep
    }
  };

  if (pendingStep) {
    await notifyAttendanceApprovalStepAssignees({
      step: pendingStep,
      ...notificationPayload
    });
  } else {
    await notifyAttendanceFallbackApprovers({
      employee,
      ...notificationPayload
    });
  }

  return request;
};

const addAttendanceRequestCalendarContext = async ({
  rows,
  organizationId,
  organizationTimeZone
}) => {
  if (!rows?.length) return [];

  const plainRows = serializeMongoIdsDeep(rows);
  const employeeIds = Array.from(new Set(
    plainRows
      .map((row) => String(row.employeeId?._id || row.employeeId || ""))
      .filter(Boolean)
  ));
  const dateKeys = plainRows.map((row) => String(row.date || "")).filter(Boolean).sort();
  const firstDateKey = dateKeys[0];
  const lastDateKey = dateKeys[dateKeys.length - 1];

  const [employees, holidays] = await Promise.all([
    Employee.find({
      organizationId,
      _id: { $in: employeeIds }
    }).select("_id shiftId").lean(),
    Holiday.find({
      organizationId,
      status: "active",
      date: {
        $gte: startOfDayInTimeZone(firstDateKey, organizationTimeZone),
        $lte: endOfDayInTimeZone(lastDateKey, organizationTimeZone)
      }
    }).select("date name").lean()
  ]);
  const weekOffMap = await WeekOffService.resolveWeekOffMapForEmployees({
    organizationId,
    employees
  });
  const holidayByDate = new Map(
    holidays.map((holiday) => [
      toDateKeyInTimeZone(holiday.date, organizationTimeZone),
      holiday
    ])
  );

  return plainRows.map((row) => {
    const employeeId = String(row.employeeId?._id || row.employeeId || "");
    const dateKey = String(row.date || "");
    const holiday = holidayByDate.get(dateKey);
    const weekOffDays =
      weekOffMap.employeeMap.get(employeeId) || weekOffMap.defaultDays || [];
    const isWeekOff = weekOffDays.includes(
      getWeekdayForDateKey(dateKey, organizationTimeZone)
    );
    const calendarDayType = holiday ? "holiday" : isWeekOff ? "week_off" : "working_day";

    return {
      ...row,
      calendarDayType,
      calendarDayLabel:
        calendarDayType === "holiday"
          ? holiday.name || "Holiday"
          : calendarDayType === "week_off"
            ? "Week Off"
            : "Working Day",
      holidayName: holiday?.name || null
    };
  });
};

exports.getMyAttendanceRequests = async (req) => {
  const employee = await getEmployeeFromReq(req);
  const organizationTimeZone = await getOrganizationTimeZone(req.user.organizationId);
  const query = {
    organizationId: req.user.organizationId,
    employeeId: employee._id
  };
  const pageRequested = req.query.page !== undefined || req.query.limit !== undefined;
  const page = parsePositiveInt(req.query.page, 1);
  const limit = Math.min(parsePositiveInt(req.query.limit, 20), 100);
  const baseQuery = AttendanceRequest.find(query)
    .populate("actionBy", "firstName lastName employeeCode")
    .populate("approvalSteps.approverEmployeeId", "firstName lastName employeeCode")
    .populate("approvalSteps.actionBy", "firstName lastName employeeCode")
    .sort({ createdAt: -1 });

  if (!pageRequested) {
    const rows = await baseQuery;
    await Promise.all(rows.map((row) => repairPendingAttendanceApprovalState(row)));
    return addAttendanceRequestCalendarContext({
      rows,
      organizationId: req.user.organizationId,
      organizationTimeZone
    });
  }

  const [items, total] = await Promise.all([
    baseQuery.skip((page - 1) * limit).limit(limit),
    AttendanceRequest.countDocuments(query)
  ]);

  await Promise.all(items.map((row) => repairPendingAttendanceApprovalState(row)));
  return {
    items: await addAttendanceRequestCalendarContext({
      rows: items,
      organizationId: req.user.organizationId,
      organizationTimeZone
    }),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit))
    }
  };
};

exports.getAttendanceRequests = async (req) => {
  const organizationTimeZone = await getOrganizationTimeZone(req.user.organizationId);
  const query = {
    organizationId: req.user.organizationId
  };

  if (req.query.status) {
    query.status = req.query.status;
  }

  if (req.user.activeRoleId) {
    const role = await Role.findOne({
      _id: req.user.activeRoleId,
      organizationId: req.user.organizationId
    }).select("slug");

    if (role?.slug === "manager") {
      const managerEmployee = await Employee.findOne({
        userId: req.user.userId,
        organizationId: req.user.organizationId
      }).select("_id");

      if (managerEmployee) {
        const reportIds = await Employee.find({
          organizationId: req.user.organizationId,
          managerId: managerEmployee._id
        }).distinct("_id");
        query.employeeId = { $in: reportIds };
      } else {
        query.employeeId = { $in: [] };
      }
    }
  }

  const rows = await AttendanceRequest.find(query)
    .populate("employeeId", "firstName lastName employeeCode")
    .populate("actionBy", "firstName lastName employeeCode")
    .populate("approvalSteps.approverEmployeeId", "firstName lastName employeeCode")
    .populate("approvalSteps.actionBy", "firstName lastName employeeCode")
    .sort({ createdAt: -1 });

  await Promise.all(rows.map((row) => repairPendingAttendanceApprovalState(row)));
  return addAttendanceRequestCalendarContext({
    rows,
    organizationId: req.user.organizationId,
    organizationTimeZone
  });
};

exports.getMyPendingAttendanceApprovals = async (req) => {
  const organizationTimeZone = await getOrganizationTimeZone(req.user.organizationId);
  const actorRoleSlug = await getActorRoleSlug(req);
  const pageRequested = req.query.page !== undefined || req.query.limit !== undefined;
  const page = parsePositiveInt(req.query.page, 1);
  const limit = Math.min(parsePositiveInt(req.query.limit, 20), 100);
  if (!REQUEST_APPROVER_ROLE_SLUGS.has(actorRoleSlug)) {
    return pageRequested
      ? {
          items: [],
          pagination: {
            page,
            limit,
            total: 0,
            totalPages: 1
          }
        }
      : [];
  }

  const query = {
    organizationId: req.user.organizationId,
    status: "pending"
  };

  if (actorRoleSlug === "manager") {
    const managerEmployee = await Employee.findOne({
      userId: req.user.userId,
      organizationId: req.user.organizationId
    }).select("_id");

    if (!managerEmployee) {
      return pageRequested
        ? {
            items: [],
            pagination: {
              page,
              limit,
              total: 0,
              totalPages: 1
            }
          }
        : [];
    }

    const reportIds = await Employee.find({
      organizationId: req.user.organizationId,
      managerId: managerEmployee._id
    }).distinct("_id");
    query.employeeId = { $in: reportIds };
  }

  const rows = await AttendanceRequest.find(query)
    .populate("employeeId", "firstName lastName employeeCode")
    .populate("actionBy", "firstName lastName employeeCode")
    .populate("approvalSteps.approverEmployeeId", "firstName lastName employeeCode")
    .populate("approvalSteps.actionBy", "firstName lastName employeeCode")
    .sort({ createdAt: -1 });

  await Promise.all(rows.map((row) => repairPendingAttendanceApprovalState(row)));

  const actorContext = await getActorApprovalContext(req);
  const filteredRows = rows.filter((row) => {
    const steps = Array.isArray(row.approvalSteps) ? row.approvalSteps : [];
    if (!steps.length) return true;
    const currentStep = getCurrentPendingStep(steps);
    if (!currentStep) return false;
    return canActorApproveStep(currentStep, actorContext);
  });

  if (!pageRequested) {
    return addAttendanceRequestCalendarContext({
      rows: filteredRows,
      organizationId: req.user.organizationId,
      organizationTimeZone
    });
  }

  const total = filteredRows.length;
  const items = filteredRows.slice((page - 1) * limit, (page - 1) * limit + limit);
  return {
    items: await addAttendanceRequestCalendarContext({
      rows: items,
      organizationId: req.user.organizationId,
      organizationTimeZone
    }),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit))
    }
  };
};

exports.actionAttendanceRequest = async (req) => {
  const requestId = assertValidObjectIdLike(req.params?.id, "attendance request id");

  const organizationTimeZone = await getOrganizationTimeZone(req.user.organizationId);
  const request = await AttendanceRequest.findOne({
    _id: requestId,
    organizationId: req.user.organizationId
  });
  if (!request) throw new Error("Attendance request not found");
  await repairPendingAttendanceApprovalState(request);
  if (request.status !== "pending") throw new Error("Attendance request already actioned");
  const actorRoleSlug = await getActorRoleSlug(req);
  if (!REQUEST_APPROVER_ROLE_SLUGS.has(actorRoleSlug)) {
    throw new Error("Only reporting manager, HR, or admin can action requests");
  }

  await assertManageAccessForEmployee(req, request.employeeId);

  const actorEmployee = await Employee.findOne({
    userId: req.user.userId,
    organizationId: req.user.organizationId
  }).select("_id");
  const actorContext = await getActorApprovalContext(req);
  let finalStatusToApply = req.body.status;
  let isIntermediateApproval = false;

  if (
    ["approved", "rejected"].includes(req.body.status)
    && Array.isArray(request.approvalSteps)
    && request.approvalSteps.length
  ) {
    let resolvedProgress = resolveCurrentPendingStep({
      steps: request.approvalSteps || [],
      currentApprovalStep: request.currentApprovalStep
    });
    if (!isValidApprovalStepShape(resolvedProgress.currentStep)) {
      const rebuiltSteps = await rebuildAttendanceApprovalStepsFromFlow(request);
      if (rebuiltSteps?.length) {
        request.approvalSteps = rebuiltSteps;
        resolvedProgress = resolveCurrentPendingStep({
          steps: rebuiltSteps,
          currentApprovalStep: request.currentApprovalStep
        });
      }
    }
    if (resolvedProgress.repaired) {
      request.approvalSteps = resolvedProgress.steps;
      request.currentApprovalStep = resolvedProgress.currentApprovalStep;
    }
    const currentStep = resolvedProgress.currentStep;
    if (!currentStep) {
      throw new Error("No pending approval step found");
    }

    const allowedByFlow = canActorApproveStep(currentStep, actorContext);
    if (allowedByFlow) {
      const progress = advanceApprovalSteps({
        steps: resolvedProgress.steps,
        action: req.body.status,
        actionBy: actorEmployee?._id || null,
        remarks: req.body.status === "rejected" ? req.body.rejectionReason || "" : null
      });
      request.approvalSteps = progress.steps;
      request.currentApprovalStep = progress.currentApprovalStep;
      finalStatusToApply = progress.finalStatus;
      isIntermediateApproval = progress.isIntermediateApproval;
    } else {
      throw new Error(`You are not the current approver for this step. Pending step: ${describeApprovalStep(currentStep)}`);
    }
  }

  if (finalStatusToApply === "rejected") {
    request.status = "rejected";
    request.rejectionReason = req.body.rejectionReason;
    request.actionBy = actorEmployee?._id || null;
    request.actionAt = new Date();
    await request.save();
    await notifyAttendanceRequestEmployee({
      request,
      status: "rejected",
      actorEmployeeId: actorEmployee?._id || null
    });
    return request;
  }

  if (isIntermediateApproval) {
    request.status = "pending";
    request.actionBy = actorEmployee?._id || null;
    request.actionAt = new Date();
    await request.save();
    const requestEmployee = await Employee.findById(request.employeeId).select("firstName lastName");
    const pendingStep = getCurrentPendingStep(request.approvalSteps || []);
    await notifyAttendanceApprovalStepAssignees({
      organizationId: request.organizationId,
      step: pendingStep,
      actorEmployeeId: actorEmployee?._id || null,
      type: "attendance_request_pending_approval",
      title: "Attendance request approval pending",
      message: `${requestEmployee?.firstName || "Employee"} ${requestEmployee?.lastName || ""}`.trim()
        + " attendance request is waiting for your approval.",
      meta: {
        attendanceRequestId: request._id,
        status: request.status,
        currentApprovalStep: request.currentApprovalStep
      }
    });
    return request;
  }

  let attendanceDateKey = normalizeAttendanceRequestDateKey(request.date, organizationTimeZone);
  if (request.requestType === "missed_checkout") {
    const target = await resolveMissedCheckoutAttendanceTarget({
      organizationId: req.user.organizationId,
      employeeId: request.employeeId,
      requestedDateKey: attendanceDateKey,
      requestedCheckOutTime: request.requestedCheckOutTime || null,
      organizationTimeZone
    });
    if (target?.attendanceDateKey) {
      attendanceDateKey = target.attendanceDateKey;
    }
  } else if (request.requestType === "correction" && request.requestedCheckOutTime) {
    const correctionTarget = await resolveAttendanceTargetForRequestDate({
      organizationId: req.user.organizationId,
      employeeId: request.employeeId,
      requestedDateKey: attendanceDateKey,
      requestedCheckOutTime: request.requestedCheckOutTime,
      organizationTimeZone
    });
    if (correctionTarget?.attendanceDateKey) {
      attendanceDateKey = correctionTarget.attendanceDateKey;
    }
  }

  const attendanceDate = startOfDayInTimeZone(attendanceDateKey, organizationTimeZone);
  const attendance = await Attendance.findOneAndUpdate(
    {
      organizationId: req.user.organizationId,
      employeeId: request.employeeId,
      ...buildAttendanceDateMatch(attendanceDateKey, organizationTimeZone)
    },
    {
      $setOnInsert: {
        organizationId: req.user.organizationId,
        employeeId: request.employeeId,
        date: attendanceDate,
        dateKey: attendanceDateKey
      }
    },
    { upsert: true, new: true }
  );

  const existingCheckIn = attendance.checkInAt;
  const existingCheckOut = attendance.checkOutAt;
  const { shift, scheduledStartAt, scheduledEndAt } = await resolveAttendanceScheduleForRequest({
    organizationId: req.user.organizationId,
    employeeId: request.employeeId,
    attendanceRow: attendance,
    attendanceDateKey,
    organizationTimeZone
  });

  let checkInAt = existingCheckIn;
  let checkOutAt = existingCheckOut;

  let requestedCheckInAt = request.requestedCheckInTime
    ? zonedDateTimeToUtc(attendanceDateKey, request.requestedCheckInTime, organizationTimeZone)
    : null;
  let requestedCheckOutAt = request.requestedCheckOutTime
    ? zonedDateTimeToUtc(attendanceDateKey, request.requestedCheckOutTime, organizationTimeZone)
    : null;
  if (request.requestType === "work_from_home") {
    const midpointAt = new Date(
      scheduledStartAt.getTime() + Math.round((scheduledEndAt.getTime() - scheduledStartAt.getTime()) / 2)
    );
    requestedCheckInAt =
      request.dayPortion === "second_half" ? midpointAt : new Date(scheduledStartAt);
    requestedCheckOutAt =
      request.dayPortion === "first_half" ? midpointAt : new Date(scheduledEndAt);
  }
  const isPartialWfh =
    request.requestType === "work_from_home"
    && ["first_half", "second_half"].includes(request.dayPortion);

  if (isPartialWfh) {
    if (requestedCheckInAt && (!checkInAt || requestedCheckInAt < checkInAt)) {
      checkInAt = requestedCheckInAt;
    }
    if (requestedCheckOutAt && (!checkOutAt || requestedCheckOutAt > checkOutAt)) {
      checkOutAt = requestedCheckOutAt;
    }
  } else {
    if (requestedCheckInAt) checkInAt = requestedCheckInAt;
    if (requestedCheckOutAt) checkOutAt = requestedCheckOutAt;
  }

  if (checkInAt && checkOutAt && checkOutAt <= checkInAt) {
    const nextDay = new Date(checkOutAt);
    nextDay.setDate(nextDay.getDate() + 1);
    checkOutAt = nextDay;
  }

  const lateByMinutes = checkInAt
    ? Math.max(
        0,
        Math.round((checkInAt.getTime() - scheduledStartAt.getTime()) / 60000) - Number(shift.graceMinutes || 0)
      )
    : 0;
  const earlyLoginByMinutes = checkInAt
    ? Math.max(0, Math.round((scheduledStartAt.getTime() - checkInAt.getTime()) / 60000))
    : 0;
  const earlyCheckoutByMinutes = checkOutAt
    ? Math.max(0, Math.round((scheduledEndAt.getTime() - checkOutAt.getTime()) / 60000))
    : 0;
  const overtimeMinutes = checkOutAt
    ? Math.max(0, Math.round((checkOutAt.getTime() - scheduledEndAt.getTime()) / 60000))
    : 0;

  const totalMinutes =
    checkInAt && checkOutAt
      ? Math.max(0, Math.round((checkOutAt.getTime() - checkInAt.getTime()) / 60000))
      : 0;

  attendance.date = attendanceDate;
  attendance.dateKey = attendanceDateKey;
  attendance.checkInAt = checkInAt || null;
  attendance.checkOutAt = checkOutAt || null;
  attendance.totalMinutes = totalMinutes;
  if (request.requestType === "work_from_home") {
    attendance.workFromHomePortion = request.dayPortion || "full_day";
  }
  attendance.status = checkInAt && checkOutAt ? "checked_out" : "checked_in";
  attendance.overriddenBy = actorEmployee?._id || null;
  attendance.overriddenAt = new Date();
  attendance.shiftId = shift._id || null;
  attendance.shiftName = shift.name;
  attendance.shiftCode = shift.code;
  attendance.shiftStartTime = shift.startTime;
  attendance.shiftEndTime = shift.endTime;
  attendance.scheduledStartAt = scheduledStartAt;
  attendance.scheduledEndAt = scheduledEndAt;
  attendance.lateByMinutes = lateByMinutes;
  attendance.earlyLoginByMinutes = earlyLoginByMinutes;
  attendance.earlyCheckoutByMinutes = earlyCheckoutByMinutes;
  attendance.overtimeMinutes = overtimeMinutes;
  attendance.missedCheckout = Boolean(checkInAt && !checkOutAt);
  attendance.missedCheckoutMarkedAt = checkInAt && !checkOutAt ? (attendance.missedCheckoutMarkedAt || new Date()) : null;
  if (request.requestType === "missed_checkout" && checkOutAt) {
    attendance.missedCheckout = false;
    attendance.missedCheckoutMarkedAt = null;
    attendance.missedCheckoutResolvedRequestId = request._id;
  }
  await attendance.save();

  if (checkInAt && checkOutAt) {
    const hoursWorked = Number((totalMinutes / 60).toFixed(2));
    await upsertTimesheetHours({
      organizationId: req.user.organizationId,
      employeeId: request.employeeId,
      dateValue: attendanceDate,
      hoursWorked
    });
  }

  request.status = "approved";
  request.rejectionReason = null;
  request.actionBy = actorEmployee?._id || null;
  request.actionAt = new Date();
  request.resolvedAttendanceId = attendance._id;
  await request.save();

  await notifyAttendanceRequestEmployee({
    request,
    status: "approved",
    actorEmployeeId: actorEmployee?._id || null,
    attendance
  });

  return request;
};

exports.overrideAttendance = async (req) => {
  await assertManualAttendanceEnabled(req.user.organizationId);
  const actorEmployee = await Employee.findOne({
    userId: req.user.userId,
    organizationId: req.user.organizationId
  }).select("_id");

  const employeeId = assertValidObjectIdLike(req.params.employeeId, "employeeId");

  const employee = await Employee.findOne({
    _id: employeeId,
    organizationId: req.user.organizationId
  }).select("_id");

  if (!employee) {
    throw new Error("Employee not found");
  }

  const organizationTimeZone = await getOrganizationTimeZone(req.user.organizationId);
  const date = startOfDayInTimeZone(req.body.date, organizationTimeZone);
  const dateKey = toDateKeyInTimeZone(date, organizationTimeZone);
  await assertManageAccessForEmployee(req, employee._id);
  await validateAttendanceEditWindow(req.user.organizationId, date, organizationTimeZone);
  const status = req.body.status;
  const existingAttendance = await Attendance.findOne({
    organizationId: req.user.organizationId,
    employeeId: employee._id,
    ...buildAttendanceDateMatch(dateKey, organizationTimeZone)
  });
  const orgSettings = await OrgSettings.findOne({ organizationId: req.user.organizationId })
    .select("minHalfDayHours minWorkHoursPerDay");

  if (isNoOpAttendanceOverride({
    existingAttendance,
    targetStatus: status,
    minHalfDayHours: Number(orgSettings?.minHalfDayHours ?? 4),
    minWorkHoursPerDay: Number(orgSettings?.minWorkHoursPerDay ?? 8)
  })) {
    throw {
      code: 400,
      statusCode: 400,
      message: `Attendance is already marked as ${formatAttendanceOverrideStatus(status)}`
    };
  }

  const { shift, scheduledStartAt, scheduledEndAt } = await resolveShiftSchedule(
    req.user.organizationId,
    employee._id,
    dateKey,
    organizationTimeZone
  );
  const defaultCheckIn = new Date(scheduledStartAt);
  const defaultCheckOut = new Date(scheduledEndAt);
  const shiftMinutes = Math.max(
    0,
    Math.round((defaultCheckOut.getTime() - defaultCheckIn.getTime()) / 60000)
  );

  const update = buildAttendanceOverrideUpdate({
    status,
    actorEmployeeId: actorEmployee?._id,
    shift,
    scheduledStartAt,
    scheduledEndAt,
    shiftMinutes,
    minHalfDayHours: Number(orgSettings?.minHalfDayHours ?? 4)
  });

  const attendance = await Attendance.findOneAndUpdate(
    {
      organizationId: req.user.organizationId,
      employeeId: employee._id,
      ...buildAttendanceDateMatch(dateKey, organizationTimeZone)
    },
    {
      $set: {
        ...update
      },
      $setOnInsert: {
        organizationId: req.user.organizationId,
        employeeId: employee._id,
        date,
        dateKey
      }
    },
    { upsert: true, new: true }
  );

  const hoursWorked = Number((Number(update.totalMinutes || 0) / 60).toFixed(2));
  await upsertTimesheetHours({
    organizationId: req.user.organizationId,
    employeeId: employee._id,
    dateValue: date,
    hoursWorked
  });

  await audit({
    req,
    module: "timesheets",
    action: "ATTENDANCE_OVERRIDE",
    entityId: attendance._id,
    after: attendance.toObject()
  });

  const employeeWithUser = await Employee.findById(employee._id).populate("userId", "email");
  if (employeeWithUser?.userId?.email) {
    await sendNotification({
      toEmail: employeeWithUser.userId.email,
      toName: employeeWithUser.firstName,
      subject: "Attendance Updated",
      message: `Your attendance for ${date.toDateString()} has been marked as ${formatAttendanceOverrideStatus(status)}.`
    });
  }
  if (employeeWithUser?.userId?._id) {
    await createNotificationSafe({
      organizationId: req.user.organizationId,
      recipientUserId: employeeWithUser.userId._id,
      recipientEmployeeId: employeeWithUser._id,
      actorEmployeeId: actorEmployee?._id || null,
      type: "attendance_override",
      title: "Attendance updated",
      message: `Your attendance for ${date.toDateString()} was overridden to ${formatAttendanceOverrideStatus(status)}.`,
      meta: {
        date: dateKey,
        status
      }
    });
  }

  return attendance;
};

const resolveScheduleFromShift = (shiftValue, dateKey, timeZone) => {
  const shift = shiftValue || getDefaultShift();
  const startMinutes = parseTimeToMinutes(shift.startTime);
  const endMinutes = parseTimeToMinutes(shift.endTime);
  const scheduledStartAt = zonedDateTimeToUtc(dateKey, shift.startTime, timeZone);
  let scheduledEndAt = zonedDateTimeToUtc(dateKey, shift.endTime, timeZone);
  if (endMinutes <= startMinutes) {
    scheduledEndAt = new Date(scheduledEndAt.getTime() + 86400000);
  }
  return { shift, scheduledStartAt, scheduledEndAt };
};

const bulkUpsertTimesheetHours = async ({ organizationId, changes }) => {
  if (!changes.length) return;
  const grouped = new Map();
  for (const change of changes) {
    const weekStart = getWeekStart(change.date);
    const key = `${change.employeeId}:${weekStart.toISOString()}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        employeeId: change.employeeId,
        weekStart,
        weekEnd: getWeekEnd(weekStart),
        changes: []
      });
    }
    grouped.get(key).changes.push(change);
  }

  const employeeIds = Array.from(new Set(changes.map((change) => String(change.employeeId))));
  const weekStarts = Array.from(new Map(
    Array.from(grouped.values()).map((group) => [group.weekStart.toISOString(), group.weekStart])
  ).values());
  const existingRows = await Timesheet.find({
    organizationId,
    employeeId: { $in: employeeIds },
    weekStart: { $in: weekStarts }
  }).lean();
  const existingMap = new Map(
    existingRows.map((row) => [`${row.employeeId}:${new Date(row.weekStart).toISOString()}`, row])
  );

  const operations = [];
  for (const [key, group] of grouped.entries()) {
    const existing = existingMap.get(key);
    if (existing && !["draft", "rejected"].includes(existing.status)) continue;
    let entries = sanitizeEntries(existing?.entries || [], group.weekStart);
    group.changes.forEach((change) => {
      entries = applyHoursToEntries(entries, change.date, change.hoursWorked);
    });
    const totalHours = calculateTotalHours(entries);
    operations.push({
      updateOne: {
        filter: {
          organizationId,
          employeeId: group.employeeId,
          weekStart: group.weekStart
        },
        update: {
          $set: { entries, totalHours },
          $setOnInsert: {
            organizationId,
            employeeId: group.employeeId,
            weekStart: group.weekStart,
            weekEnd: group.weekEnd,
            status: "draft"
          }
        },
        upsert: true
      }
    });
  }
  if (operations.length) await Timesheet.bulkWrite(operations, { ordered: false });
};

const processAttendanceOverrideBatch = async ({
  req,
  requestedUpdates,
  includeNonWorkingDays
}) => {
  await assertManualAttendanceEnabled(req.user.organizationId);
  const organizationId = req.user.organizationId;
  const organizationTimeZone = await getOrganizationTimeZone(organizationId);
  const deduplicated = new Map();
  for (const item of requestedUpdates) {
    const employeeId = normalizeObjectIdLike(item.employeeId);
    if (!mongoose.Types.ObjectId.isValid(employeeId)) continue;
    const rawDate = String(item.date || "");
    const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
      ? rawDate
      : toDateKeyInTimeZone(item.date, organizationTimeZone);
    deduplicated.set(`${employeeId}:${dateKey}`, {
      employeeId,
      date: dateKey,
      status: item.status
    });
  }
  const updates = Array.from(deduplicated.values());
  const requestedEmployeeIds = Array.from(new Set(updates.map((item) => item.employeeId)));
  const dateKeys = Array.from(new Set(updates.map((item) => item.date))).sort();
  if (!updates.length) {
    return {
      updatedCount: 0,
      employeeCount: 0,
      updatedEmployeeIds: [],
      dayCount: 0,
      skippedCount: 0,
      skippedByReason: { holiday: 0, weekOff: 0, approvedLeave: 0 },
      includeNonWorkingDays
    };
  }

  const rangeStart = startOfDayInTimeZone(dateKeys[0], organizationTimeZone);
  const rangeEnd = endOfDayInTimeZone(dateKeys[dateKeys.length - 1], organizationTimeZone);
  const [settings, actorEmployee, scopedEmployeeIds, employees] = await Promise.all([
    OrgSettings.findOne({ organizationId })
      .select("minHalfDayHours attendanceLockEnabled attendanceLockAfterDays attendanceLockMode attendanceLockDay payrollCutoffDay"),
    Employee.findOne({ userId: req.user.userId, organizationId }).select("_id"),
    getScopedEmployeeIdsForViewer(req),
    Employee.find({
      _id: { $in: requestedEmployeeIds },
      organizationId
    }).select("_id firstName userId shiftId").populate("userId", "email")
  ]);
  dateKeys.forEach((dateKey) => {
    assertAttendanceDateEditable(settings, startOfDayInTimeZone(dateKey, organizationTimeZone), organizationTimeZone);
  });

  if (Array.isArray(scopedEmployeeIds)) {
    const allowed = new Set(scopedEmployeeIds.map(String));
    if (employees.some((employee) => !allowed.has(String(employee._id)))) {
      throw new Error("Access denied");
    }
  }

  const employeeMap = new Map(employees.map((employee) => [String(employee._id), employee]));
  const shiftIds = Array.from(new Set(employees.map((employee) => String(employee.shiftId || "")).filter(Boolean)));
  const [shifts, weekOffMap, holidays, approvedLeaves] = await Promise.all([
    Shift.find({
      _id: { $in: shiftIds },
      organizationId,
      status: "active"
    }).select("name code startTime endTime graceMinutes").lean(),
    includeNonWorkingDays
      ? Promise.resolve({ defaultDays: [], employeeMap: new Map() })
      : WeekOffService.resolveWeekOffMapForEmployees({ organizationId, employees }),
    includeNonWorkingDays
      ? Promise.resolve([])
      : Holiday.find({ organizationId, date: { $gte: rangeStart, $lte: rangeEnd } }).select("date").lean(),
    includeNonWorkingDays
      ? Promise.resolve([])
      : Leave.find({
        organizationId,
        employeeId: { $in: requestedEmployeeIds },
        status: "approved",
        fromDate: { $lte: rangeEnd },
        toDate: { $gte: rangeStart }
      }).select("employeeId fromDate toDate").lean()
  ]);
  const shiftMap = new Map(shifts.map((shift) => [String(shift._id), shift]));
  const holidayDateKeys = new Set(
    holidays.map((holiday) => toDateKeyInTimeZone(holiday.date, organizationTimeZone))
  );
  const leavesByEmployee = new Map();
  approvedLeaves.forEach((leave) => {
    const employeeId = String(leave.employeeId);
    if (!leavesByEmployee.has(employeeId)) leavesByEmployee.set(employeeId, []);
    leavesByEmployee.get(employeeId).push(leave);
  });

  const applied = [];
  const skippedByReason = { holiday: 0, weekOff: 0, approvedLeave: 0 };
  for (const item of updates) {
    const employee = employeeMap.get(item.employeeId);
    if (!employee) continue;
    if (!includeNonWorkingDays) {
      const skipReason = resolveBulkAttendanceSkipReason({
        dateKey: item.date,
        holidayDateKeys,
        weekOffDays: weekOffMap.employeeMap.get(item.employeeId) || weekOffMap.defaultDays || [],
        approvedLeaves: leavesByEmployee.get(item.employeeId) || [],
        organizationTimeZone
      });
      if (skipReason) {
        skippedByReason[skipReason] += 1;
        continue;
      }
    }
    const date = startOfDayInTimeZone(item.date, organizationTimeZone);
    const shift = shiftMap.get(String(employee.shiftId || "")) || getDefaultShift();
    const { scheduledStartAt, scheduledEndAt } = resolveScheduleFromShift(
      shift,
      item.date,
      organizationTimeZone
    );
    const shiftMinutes = Math.max(0, Math.round((scheduledEndAt - scheduledStartAt) / 60000));
    const attendanceUpdate = buildAttendanceOverrideUpdate({
      status: item.status,
      actorEmployeeId: actorEmployee?._id,
      shift,
      scheduledStartAt,
      scheduledEndAt,
      shiftMinutes,
      minHalfDayHours: Number(settings?.minHalfDayHours ?? 4)
    });
    applied.push({ ...item, employee, date, attendanceUpdate });
  }

  if (applied.length) {
    await Attendance.bulkWrite(applied.map((item) => ({
      updateOne: {
        filter: {
          organizationId,
          employeeId: item.employee._id,
          ...buildAttendanceDateMatch(item.date, organizationTimeZone)
        },
        update: {
          $set: item.attendanceUpdate,
          $setOnInsert: {
            organizationId,
            employeeId: item.employee._id,
            date: item.date,
            dateKey: item.date
          }
        },
        upsert: true
      }
    })), { ordered: false });

    await bulkUpsertTimesheetHours({
      organizationId,
      changes: applied.map((item) => ({
        employeeId: item.employee._id,
        date: item.date,
        hoursWorked: Number((Number(item.attendanceUpdate.totalMinutes || 0) / 60).toFixed(2))
      }))
    });

    const attendanceRows = await Attendance.find({
      organizationId,
      employeeId: { $in: employees.map((employee) => employee._id) },
      dateKey: { $in: dateKeys }
    }).lean();
    const appliedKeys = new Set(applied.map((item) => `${item.employeeId}:${item.date}`));
    const auditRows = attendanceRows
      .filter((row) => appliedKeys.has(`${row.employeeId}:${row.dateKey}`))
      .map((row) => ({
        organizationId,
        userId: req.user?._id || req.user?.userId,
        module: "timesheets",
        action: "ATTENDANCE_OVERRIDE",
        entityId: row._id,
        after: row,
        ipAddress: req.ip,
        userAgent: req.headers?.["user-agent"] || ""
      }));
    if (auditRows.length) await AuditLog.insertMany(auditRows, { ordered: false });
  }

  const changesByEmployee = new Map();
  applied.forEach((item) => {
    if (!changesByEmployee.has(item.employeeId)) changesByEmployee.set(item.employeeId, []);
    changesByEmployee.get(item.employeeId).push({ date: item.date, status: item.status });
  });
  await Promise.all(Array.from(changesByEmployee.entries()).map(async ([employeeId, changes]) => {
    const employee = employeeMap.get(employeeId);
    if (!employee?.userId) return;
    const sortedChanges = changes.sort((left, right) =>
      String(left.date).localeCompare(String(right.date))
    );
    const summary = sortedChanges
      .map((change) => `${change.date}: ${formatAttendanceOverrideStatus(change.status)}`)
      .join(", ");
    await Promise.all([
      employee.userId.email
        ? sendNotification({
          toEmail: employee.userId.email,
          toName: employee.firstName,
          subject: "Attendance Updated",
          message: `Your attendance was updated for ${summary}.`
        })
        : Promise.resolve(),
      createNotificationSafe({
        organizationId,
        recipientUserId: employee.userId._id,
        recipientEmployeeId: employee._id,
        actorEmployeeId: actorEmployee?._id || null,
        type: "attendance_override",
        title: "Attendance updated",
        message: `Attendance was updated for ${sortedChanges.length} day(s): ${summary}.`,
        meta: { changes: sortedChanges, dayCount: sortedChanges.length }
      })
    ]);
  }));

  return {
    updatedCount: applied.length,
    employeeCount: employeeMap.size,
    updatedEmployeeIds: Array.from(changesByEmployee.keys()),
    dayCount: dateKeys.length,
    skippedCount: Object.values(skippedByReason).reduce((sum, count) => sum + count, 0),
    skippedByReason,
    includeNonWorkingDays
  };
};

exports.bulkOverrideAttendance = async (req) => {
  const startDate = req.body.startDate || req.body.date;
  const endDate = req.body.endDate || req.body.date;
  const dateKeys = [];
  for (let dateKey = startDate; dateKey <= endDate; dateKey = addDaysToDateKey(dateKey, 1)) {
    dateKeys.push(dateKey);
    if (dateKeys.length > 30) throw { code: 400, message: "Bulk attendance can cover at most 30 days" };
  }
  const employeeIds = Array.from(new Set((req.body.employeeIds || []).map(normalizeObjectIdLike)));
  const result = await processAttendanceOverrideBatch({
    req,
    includeNonWorkingDays: req.body.includeNonWorkingDays !== false,
    requestedUpdates: employeeIds.flatMap((employeeId) =>
      dateKeys.map((date) => ({ employeeId, date, status: req.body.status }))
    )
  });
  return {
    ...result,
    startDate,
    endDate,
    date: dateKeys.length === 1 ? dateKeys[0] : undefined,
    status: req.body.status
  };
};

exports.customBulkOverrideAttendance = async (req) =>
  processAttendanceOverrideBatch({
    req,
    includeNonWorkingDays: req.body.includeNonWorkingDays !== false,
    requestedUpdates: req.body.updates || []
  });

exports.lockAttendanceMonth = async (req) => {
  const organizationTimeZone = await getOrganizationTimeZone(req.user.organizationId);
  const { start, end } = parseMonthRangeInTimeZone(req.body.month, organizationTimeZone);
  const monthEndDateKey = toDateKeyInTimeZone(end, organizationTimeZone);
  const settings = await OrgSettings.findOne({ organizationId: req.user.organizationId })
    .select("attendanceLockEnabled attendanceLockAfterDays attendanceLockMode attendanceLockDay payrollCutoffDay");
  const scopedEmployeeIds = await getScopedEmployeeIdsForViewer(req);

  const attendanceQuery = {
    organizationId: req.user.organizationId,
    date: { $gte: start, $lte: end },
    checkInAt: { $ne: null },
    $or: [
      { status: "checked_in" },
      { checkOutAt: null }
    ]
  };

  if (Array.isArray(scopedEmployeeIds)) {
    attendanceQuery.employeeId = { $in: scopedEmployeeIds };
  }

  const pendingCheckoutCount = await Attendance.countDocuments(attendanceQuery);
  const lockAttendance = buildLockAttendanceActionMeta({
    settings,
    monthEndDateKey,
    pendingCheckoutCount,
    timeZone: organizationTimeZone
  });

  if (!lockAttendance.enabled) {
    throwHttpError(400, lockAttendance.reason || "Attendance lock action is not available yet.");
  }

  const snapshotResult = await payrollAttendanceService.generateMonthlyAttendanceSnapshots({
    ...req,
    body: {
      month: req.body.month,
      forceRebuild: true,
      employeeIds: Array.isArray(scopedEmployeeIds) && scopedEmployeeIds.length
        ? scopedEmployeeIds.map((id) => String(id))
        : undefined
    }
  });

  await audit({
    req,
    module: "timesheets",
    action: "ATTENDANCE_LOCK_MONTH",
    entityId: req.user.organizationId,
    after: {
      month: req.body.month,
      pendingCheckoutCount,
      snapshotGenerated: true
    }
  });

  return {
    month: req.body.month,
    updatedCount: snapshotResult?.generatedCount || 0,
    pendingCheckoutCount,
    lockedThroughDateKey: lockAttendance.lockedThroughDateKey,
    snapshotGenerated: true
  };
};

exports.getOnline = async (req) => {
  const [organizationTimeZone, scopedEmployeeIds] = await Promise.all([
    getOrganizationTimeZone(req.user.organizationId),
    getScopedEmployeeIdsForViewer(req)
  ]);
  const now = new Date();
  const todayKey = toDateKeyInTimeZone(now, organizationTimeZone);
  const yesterdayKey = addDaysToDateKey(todayKey, -1);

  const query = buildOnlineAttendanceQuery({
    organizationId: req.user.organizationId,
    todayKey,
    yesterdayKey,
    now,
    scopedEmployeeIds
  });

  const rows = await Attendance.find(query)
    .select("employeeId date dateKey checkInAt checkOutAt scheduledEndAt status")
    .populate("employeeId", "firstName lastName employeeCode")
    .sort({ checkInAt: -1 })
    .lean();

  return rows.filter((row) => isOnlineAttendanceRowVisible(row, {
    now,
    timeZone: organizationTimeZone,
    todayKey,
    yesterdayKey
  }));
};

exports.getOnLeave = async (req) => {
  const [organizationTimeZone, scopedEmployeeIds] = await Promise.all([
    getOrganizationTimeZone(req.user.organizationId),
    getScopedEmployeeIdsForViewer(req)
  ]);
  const todayStart = startOfDayInTimeZone(new Date(), organizationTimeZone);
  const todayEnd = endOfDayInTimeZone(new Date(), organizationTimeZone);

  const query = {
    organizationId: req.user.organizationId,
    status: "approved",
    fromDate: { $lte: todayEnd },
    toDate: { $gte: todayStart }
  };

  if (Array.isArray(scopedEmployeeIds)) {
    query.employeeId = { $in: scopedEmployeeIds };
  }

  return Leave.find(query)
    .select("employeeId leaveTypeId fromDate toDate status")
    .populate("employeeId", "firstName lastName employeeCode")
    .populate("leaveTypeId", "name code")
    .sort({ fromDate: 1 })
    .lean();
};

exports.createWeekly = async (req) => {
  const employee = await getEmployeeFromReq(req);
  const baseDate = req.body.weekStart || new Date();
  const weekStart = getWeekStart(baseDate);
  const weekEnd = getWeekEnd(weekStart);

  const exists = await Timesheet.findOne({
    organizationId: req.user.organizationId,
    employeeId: employee._id,
    weekStart
  });

  if (exists) {
    throw new Error("Timesheet already exists for this week");
  }

  const entries = sanitizeEntries(req.body.entries || [], weekStart);
  const totalHours = calculateTotalHours(entries);  
  const timesheet = await Timesheet.create({
    organizationId: req.user.organizationId,
    employeeId: employee._id,
    weekStart,
    weekEnd,
    entries,
    totalHours,
    status: "draft"
  });

  await audit({
    req,
    module: "timesheets",
    action: "CREATE",
    entityId: timesheet._id,
    after: timesheet.toObject()
  });

  return timesheet;
};

exports.updateWeekly = async (req) => {
  const employee = await getEmployeeFromReq(req);
  const timesheet = await Timesheet.findOne({
    _id: req.params.id,
    organizationId: req.user.organizationId,
    employeeId: employee._id
  });

  if (!timesheet) throw new Error("Timesheet not found");

  if (!["draft", "rejected"].includes(timesheet.status)) {
    throw new Error("Timesheet is locked after submission");
  }

  ensureEntriesInWeek(req.body.entries || [], timesheet.weekStart, timesheet.weekEnd);
  const entries = sanitizeEntries(req.body.entries || [], timesheet.weekStart);
  await validateHours(req, entries);
  timesheet.entries = entries;
  timesheet.totalHours = calculateTotalHours(entries);

  await timesheet.save();

  await audit({
    req,
    module: "timesheets",
    action: "UPDATE",
    entityId: timesheet._id,
    after: timesheet.toObject()
  });

  return timesheet;
};

exports.submitWeekly = async (req) => {
  const employee = await getEmployeeFromReq(req);
  const timesheet = await Timesheet.findOne({
    _id: req.params.id,
    organizationId: req.user.organizationId,
    employeeId: employee._id
  });

  if (!timesheet) throw new Error("Timesheet not found");

  const now = new Date();
  const tsStart = new Date(timesheet.weekStart);
  if (
    tsStart.getFullYear() !== now.getFullYear() ||
    tsStart.getMonth() !== now.getMonth()
  ) {
    throw new Error("Timesheet submission allowed only for current month");
  }

  if (!["draft", "rejected"].includes(timesheet.status)) {
    throw new Error("Timesheet already submitted");
  }

  if (Array.isArray(req.body.entries)) {
    ensureEntriesInWeek(req.body.entries, timesheet.weekStart, timesheet.weekEnd);
    const entries = sanitizeEntries(req.body.entries, timesheet.weekStart);
    await validateHours(req, entries);
    timesheet.entries = entries;
    timesheet.totalHours = calculateTotalHours(entries);
  } else {
    await validateHours(req, timesheet.entries);
  }
  timesheet.status = "submitted";
  timesheet.submittedAt = new Date();
  await timesheet.save();

  await audit({
    req,
    module: "timesheets",
    action: "SUBMIT",
    entityId: timesheet._id,
    after: timesheet.toObject()
  });

  return timesheet;
};

exports.getMyWeekly = async (req) => {
  const employee = await getEmployeeFromReq(req);
  const weekStartQuery = req.query.weekStart;

  if (weekStartQuery) {
    const weekStart = getWeekStart(weekStartQuery);
    return Timesheet.findOne({
      organizationId: req.user.organizationId,
      employeeId: employee._id,
      weekStart
    }).populate("employeeId", "firstName lastName employeeCode");
  }

  const pageRequested = req.query.page !== undefined || req.query.limit !== undefined;
  const page = parsePositiveInt(req.query.page, 1);
  const limit = Math.min(parsePositiveInt(req.query.limit, 20), 100);
  const query = {
    organizationId: req.user.organizationId,
    employeeId: employee._id
  };
  const baseQuery = Timesheet.find(query)
    .populate("employeeId", "firstName lastName employeeCode")
    .sort({ weekStart: -1 });

  if (!pageRequested) {
    return baseQuery;
  }

  const [items, total] = await Promise.all([
    baseQuery.skip((page - 1) * limit).limit(limit),
    Timesheet.countDocuments(query)
  ]);

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit))
    }
  };
};

exports.getAllWeekly = async (req) => {
  const query = { organizationId: req.user.organizationId };
  const pageRequested = req.query.page !== undefined || req.query.limit !== undefined;
  const page = parsePositiveInt(req.query.page, 1);
  const limit = Math.min(parsePositiveInt(req.query.limit, 20), 100);

  if (req.user.activeRoleId) {
    const role = await Role.findOne({
      _id: req.user.activeRoleId,
      organizationId: req.user.organizationId
    }).select("slug");

    if (role?.slug === "manager") {
      const managerEmployee = await Employee.findOne({
        userId: req.user.userId,
        organizationId: req.user.organizationId
      }).select("_id");

      if (managerEmployee) {
        const reportIds = await Employee.find({
          organizationId: req.user.organizationId,
          managerId: managerEmployee._id
        }).distinct("_id");
        query.employeeId = { $in: reportIds };
      }
    }
  }

  const baseQuery = Timesheet.find(query)
    .populate("employeeId", "firstName lastName employeeCode")
    .sort({ weekStart: -1 });

  if (!pageRequested) {
    return baseQuery;
  }

  const [items, total] = await Promise.all([
    baseQuery.skip((page - 1) * limit).limit(limit),
    Timesheet.countDocuments(query)
  ]);

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit))
    }
  };
};

exports.actionWeekly = async (req) => {
  const timesheet = await Timesheet.findOne({
    _id: req.params.id,
    organizationId: req.user.organizationId
  });

  if (!timesheet) throw new Error("Timesheet not found");

  if (timesheet.status !== "submitted") {
    throw new Error("Only submitted timesheets can be actioned");
  }

  if (req.user.activeRoleId) {
    const role = await Role.findOne({
      _id: req.user.activeRoleId,
      organizationId: req.user.organizationId
    }).select("slug");

    if (role?.slug === "manager") {
      const managerEmployee = await Employee.findOne({
        userId: req.user.userId,
        organizationId: req.user.organizationId
      }).select("_id");

      if (managerEmployee) {
        const reportIds = await Employee.find({
          organizationId: req.user.organizationId,
          managerId: managerEmployee._id
        }).distinct("_id");
        const isReport = reportIds.some(
          (id) => id.toString() === timesheet.employeeId.toString()
        );
        if (!isReport) {
          throw new Error("Access denied");
        }
      }
    }
  }

  const actor = await Employee.findOne({
    userId: req.user.userId,
    organizationId: req.user.organizationId
  });

  if (req.body.status === "approved") {
    timesheet.status = "approved";
    timesheet.rejectionReason = undefined;
  } else if (req.body.status === "rejected") {
    timesheet.status = "rejected";
    timesheet.rejectionReason = req.body.rejectionReason;
  } else {
    throw new Error("Invalid timesheet action");
  }

  timesheet.actionBy = actor?._id;
  timesheet.actionAt = new Date();

  await timesheet.save();

  await audit({
    req,
    module: "timesheets",
    action: "ACTION",
    entityId: timesheet._id,
    after: timesheet.toObject()
  });

  return timesheet;
};

exports.recallWeekly = async (req) => {
  const employee = await getEmployeeFromReq(req);
  const timesheet = await Timesheet.findOne({
    _id: req.params.id,
    organizationId: req.user.organizationId,
    employeeId: employee._id
  });

  if (!timesheet) throw new Error("Timesheet not found");

  if (timesheet.status !== "approved") {
    throw new Error("Only approved timesheets can be recalled");
  }

  const lastWeekStart = getWeekStart(new Date());
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);
  if (toDateKey(timesheet.weekStart) !== toDateKey(lastWeekStart)) {
    throw new Error("Only last week timesheet can be recalled");
  }

  timesheet.status = "draft";
  timesheet.actionBy = undefined;
  timesheet.actionAt = undefined;
  await timesheet.save();

  await audit({
    req,
    module: "timesheets",
    action: "RECALL",
    entityId: timesheet._id,
    after: timesheet.toObject()
  });

  return timesheet;
};

exports.__private__ = {
  validateAttendanceEditWindow,
  getAttendanceLockWindowMeta,
  getAttendanceRowDayKey,
  getAttendanceRowNormalizedDate,
  mergeAttendanceRowsByEmployeeDay,
  isNoOpAttendanceOverride,
  buildAttendanceOverrideUpdate,
  resolveBulkAttendanceSkipReason,
  buildAttendanceMatrixEmployeeQuery,
  resolveAttendanceMatrixStatus,
  resolveOvertimeMinutes,
  resolveAttendanceDisplayStatus,
  buildOnlineAttendanceQuery,
  isOnlineAttendanceRowVisible
};
