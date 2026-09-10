const crypto = require("crypto");
const Employee = require("../employees/employee.model");
const Attendance = require("../timesheets/timesheetAttendance.model");
const Leave = require("../leaves/leave.model");
const LeaveType = require("../leaveTypes/leaveType.model");
const WeekOff = require("../weekOffs/weekOff.model");
const Holiday = require("../holidays/holiday.model");
const OrgSettings = require("../orgSettings/orgSettings.model");
const Organization = require("../organizations/organization.model");
const { getPayrollPgPool } = require("../../config/payrollDb");
const { getMonitorPgPool } = require("../../config/monitorDb");
const { getTenantIdForOrganization } = require("./payrollProvisioning.service");
const { analyzeLeaveDateKeys } = require("../leaves/leavePolicy.util");
const {
  parseMonthRangeInTimeZone,
  toDateKeyInTimeZone,
  addDaysToDateKey,
  getWeekdayForDateKey
} = require("../../utils/timezone");

const DEFAULT_UNPAID_LEAVE_CODES = new Set(["LOP", "LWP", "LWOP", "ULOP", "UNPAID"]);
const ATTENDANCE_HOURS_SOURCES = new Set(["monitor_agent", "manual", "biometric", "access_card"]);

const toSafeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const resolveAttendanceMinutes = (row) => {
  const storedMinutes = toSafeNumber(row?.totalMinutes, 0);
  if (storedMinutes > 0) return storedMinutes;
  if (!row?.checkInAt || !row?.checkOutAt) return 0;

  const checkInAt = new Date(row.checkInAt);
  const checkOutAt = new Date(row.checkOutAt);
  if (Number.isNaN(checkInAt.getTime()) || Number.isNaN(checkOutAt.getTime())) return 0;

  return Math.max(0, Math.round((checkOutAt.getTime() - checkInAt.getTime()) / 60000));
};

const getOrganizationTimeZone = async (organizationId) => {
  const settings = await OrgSettings.findOne({ organizationId }).select("timezone").lean();
  if (settings?.timezone) return settings.timezone;

  const organization = await Organization.findById(organizationId).select("timezone").lean();
  if (organization?.timezone) return organization.timezone;

  return process.env.PAYROLL_DEFAULT_TIMEZONE || "Asia/Kolkata";
};

const buildDateKeys = (startKey, endKey) => {
  const keys = [];
  let current = startKey;
  while (current <= endKey) {
    keys.push(current);
    current = addDaysToDateKey(current, 1);
  }
  return keys;
};

const buildAttendanceMap = (rows, timeZone) => {
  const map = new Map();
  for (const row of rows) {
    const employeeId = String(row.employeeId);
    const dayKey = toDateKeyInTimeZone(row.date, timeZone);
    map.set(`${employeeId}:${dayKey}`, {
      ...row,
      totalMinutes: resolveAttendanceMinutes(row)
    });
  }
  return map;
};

const getMonitorAttendanceRows = async ({ organizationId, start, end, timeZone, employees }) => {
  const pool = await getMonitorPgPool();
  const employeeMap = new Map();
  for (const employee of employees || []) {
    const employeeId = String(employee._id);
    employeeMap.set(employeeId, employeeId);
    if (employee.employeeCode) employeeMap.set(String(employee.employeeCode), employeeId);
    if (employee.userId) employeeMap.set(String(employee.userId), employeeId);
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

  return rows
    .map((row) => {
      const employeeId = employeeMap.get(String(row.employee_id));
      if (!employeeId) return null;
      const totalMinutes = Math.max(0, Math.round(Number(row.total_seconds || 0) / 60));
      return {
        _id: null,
        employeeId,
        date: row.date_key,
        checkInAt: row.first_seen_at || null,
        checkOutAt: row.last_seen_at || null,
        status: "present",
        totalMinutes,
        overtimeMinutes: 0,
        lateByMinutes: 0,
        earlyCheckoutByMinutes: 0,
        hoursSource: "monitor_agent"
      };
    })
    .filter(Boolean);
};

const mergeAttendanceRowsByEmployeeDay = (rows = [], timeZone = "Asia/Kolkata") => {
  const grouped = new Map();

  for (const row of rows || []) {
    if (!row?.employeeId || !row?.date) continue;
    const employeeId = String(row.employeeId);
    const dayKey = toDateKeyInTimeZone(row.date, timeZone);
    const key = `${employeeId}:${dayKey}`;

    if (!grouped.has(key)) {
      grouped.set(key, { ...row, employeeId, date: dayKey });
      continue;
    }

    const existing = grouped.get(key);
    existing.totalMinutes = Math.max(
      Number(existing.totalMinutes || 0),
      Number(row.totalMinutes || 0)
    );
    existing.overtimeMinutes = Math.max(
      Number(existing.overtimeMinutes || 0),
      Number(row.overtimeMinutes || 0)
    );
    existing.lateByMinutes = Math.max(
      Number(existing.lateByMinutes || 0),
      Number(row.lateByMinutes || 0)
    );
    existing.earlyCheckoutByMinutes = Math.max(
      Number(existing.earlyCheckoutByMinutes || 0),
      Number(row.earlyCheckoutByMinutes || 0)
    );

    if (row.checkInAt && (!existing.checkInAt || new Date(row.checkInAt) < new Date(existing.checkInAt))) {
      existing.checkInAt = row.checkInAt;
    }
    if (row.checkOutAt && (!existing.checkOutAt || new Date(row.checkOutAt) > new Date(existing.checkOutAt))) {
      existing.checkOutAt = row.checkOutAt;
    }

    grouped.set(key, existing);
  }

  return Array.from(grouped.values()).map((row) => {
    const hasCheckIn = Boolean(row.checkInAt);
    const hasCheckOut = Boolean(row.checkOutAt);
    if (hasCheckIn && hasCheckOut) {
      row.totalMinutes = Math.max(
        Number(row.totalMinutes || 0),
        Math.max(0, Math.round((new Date(row.checkOutAt).getTime() - new Date(row.checkInAt).getTime()) / 60000))
      );
      row.status = "checked_out";
    } else if (hasCheckIn) {
      row.status = "checked_in";
    }
    return row;
  });
};

const buildHolidayMap = (rows, timeZone) => {
  const map = new Map();
  for (const row of rows) {
    const dayKey = toDateKeyInTimeZone(row.date, timeZone);
    map.set(dayKey, row);
  }
  return map;
};

const getLeaveDateKeysForPayroll = ({ leave, holidayKeySet, weekOffDays, timeZone }) => {
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

const buildLeaveIndex = ({
  rows,
  leaveTypeCodeById,
  leaveTypeCodeByName = new Map(),
  leaveTypePayrollPayableById,
  leaveTypePayrollPayableByCode = new Map(),
  leaveTypePayrollPayableByName = new Map(),
  unpaidCodes,
  hasRequestUnpaidCodes,
  timeZone,
  holidayKeySet,
  weekOffDays
}) => {
  const map = new Map();

  for (const leave of rows) {
    const leaveTypeId = String(leave.leaveTypeId?._id || leave.leaveTypeId || "");
    const rawLeaveTypeName = String(leave.leaveTypeId?.name || leave.leaveType || "").trim();
    const leaveTypeName = rawLeaveTypeName.toUpperCase();
    const leaveTypeCode = String(
      leaveTypeCodeById.get(leaveTypeId) ||
        leave.leaveTypeId?.code ||
        leave.code ||
        leaveTypeCodeByName.get(leaveTypeName) ||
        rawLeaveTypeName
    ).toUpperCase();
    const payrollPayableSetting =
      leaveTypePayrollPayableById.get(leaveTypeId) ??
      leaveTypePayrollPayableByCode.get(leaveTypeCode) ??
      leaveTypePayrollPayableByName.get(leaveTypeName);
    const isUnpaid = hasRequestUnpaidCodes
      ? unpaidCodes.has(leaveTypeCode)
      : payrollPayableSetting === false || (payrollPayableSetting === undefined && unpaidCodes.has(leaveTypeCode));
    const unit = leave.duration === "half_day" ? 0.5 : 1;
    const isPaid = !isUnpaid;

    const effectiveDateKeys = getLeaveDateKeysForPayroll({
      leave,
      holidayKeySet,
      weekOffDays,
      timeZone
    });

    for (const dateKey of effectiveDateKeys) {
      map.set(dateKey, {
        leaveId: String(leave._id),
        isPaid,
        units: unit,
        leaveTypeCode
      });
    }
  }

  return map;
};

const buildWeekOffResolver = (rows) => {
  const byShift = new Map();
  let fallbackWeekOffs = [];

  for (const row of rows) {
    const days = Array.isArray(row.weekOffDays) ? row.weekOffDays : [];
    const key = row.shiftId ? String(row.shiftId) : "default";
    if (key === "default") {
      fallbackWeekOffs = days;
    }
    byShift.set(key, days);
  }

  return (employeeShiftId) => {
    if (!employeeShiftId) return fallbackWeekOffs;
    return byShift.get(String(employeeShiftId)) || fallbackWeekOffs;
  };
};

const normalizeSnapshotDayStatus = (dayStatus) => {
  if (dayStatus === "present_paid_leave_half") return "paid_leave_half";
  if (dayStatus === "present_unpaid_leave_half") return "unpaid_leave_half";
  return dayStatus;
};

const getTenantIdByOrganization = async (client, organizationId) => {
  const result = await client.query(
    `SELECT id FROM payroll_tenants WHERE organization_id = $1`,
    [String(organizationId)]
  );
  return result.rows[0]?.id || null;
};

const getProfileMap = async (client, tenantId, employeeIds) => {
  if (!employeeIds.length) return new Map();
  const result = await client.query(
    `
      SELECT id, employee_external_id
      FROM employee_payroll_profiles
      WHERE tenant_id = $1
        AND employee_external_id = ANY($2::varchar[])
    `,
    [tenantId, employeeIds]
  );
  return new Map(result.rows.map((row) => [row.employee_external_id, row.id]));
};

const upsertSnapshot = async (client, payload) => {
  const query = `
    INSERT INTO payroll_attendance_snapshots (
      tenant_id,
      pay_month,
      organization_external_id,
      employee_external_id,
      employee_payroll_profile_id,
      timezone,
      calendar_days,
      working_days,
      present_days,
      half_days,
      absent_days,
      paid_leave_days,
      unpaid_leave_days,
      week_off_days,
      holiday_days,
      lop_days,
      payable_days,
      overtime_minutes,
      late_by_minutes,
      early_checkout_minutes,
      attendance_minutes,
      min_work_minutes,
      min_half_day_minutes,
      source_hash,
      generation_status,
      generated_at,
      metadata,
      created_by,
      updated_by
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,NOW(),$26,$27,$27
    )
    ON CONFLICT (tenant_id, pay_month, employee_external_id)
    DO UPDATE SET
      employee_payroll_profile_id = EXCLUDED.employee_payroll_profile_id,
      timezone = EXCLUDED.timezone,
      calendar_days = EXCLUDED.calendar_days,
      working_days = EXCLUDED.working_days,
      present_days = EXCLUDED.present_days,
      half_days = EXCLUDED.half_days,
      absent_days = EXCLUDED.absent_days,
      paid_leave_days = EXCLUDED.paid_leave_days,
      unpaid_leave_days = EXCLUDED.unpaid_leave_days,
      week_off_days = EXCLUDED.week_off_days,
      holiday_days = EXCLUDED.holiday_days,
      lop_days = EXCLUDED.lop_days,
      payable_days = EXCLUDED.payable_days,
      overtime_minutes = EXCLUDED.overtime_minutes,
      late_by_minutes = EXCLUDED.late_by_minutes,
      early_checkout_minutes = EXCLUDED.early_checkout_minutes,
      attendance_minutes = EXCLUDED.attendance_minutes,
      min_work_minutes = EXCLUDED.min_work_minutes,
      min_half_day_minutes = EXCLUDED.min_half_day_minutes,
      source_hash = EXCLUDED.source_hash,
      generation_status = EXCLUDED.generation_status,
      generated_at = NOW(),
      metadata = EXCLUDED.metadata,
      updated_by = EXCLUDED.updated_by
    RETURNING id
  `;

  const values = [
    payload.tenantId,
    payload.month,
    payload.organizationExternalId,
    payload.employeeExternalId,
    payload.employeePayrollProfileId || null,
    payload.timezone,
    payload.calendarDays,
    payload.workingDays,
    payload.presentDays,
    payload.halfDays,
    payload.absentDays,
    payload.paidLeaveDays,
    payload.unpaidLeaveDays,
    payload.weekOffDays,
    payload.holidayDays,
    payload.lopDays,
    payload.payableDays,
    payload.overtimeMinutes,
    payload.lateByMinutes,
    payload.earlyCheckoutMinutes,
    payload.attendanceMinutes,
    payload.minWorkMinutes,
    payload.minHalfDayMinutes,
    payload.sourceHash,
    payload.generationStatus,
    JSON.stringify(payload.metadata || {}),
    payload.actorId
  ];

  const result = await client.query(query, values);
  return result.rows[0].id;
};

const insertSnapshotDays = async (client, snapshotId, dayRows, actorId) => {
  if (!dayRows.length) return;

  const columns = [
    "snapshot_id",
    "tenant_id",
    "employee_external_id",
    "day_date",
    "day_key",
    "day_of_week",
    "day_status",
    "payable_units",
    "lop_units",
    "attendance_minutes",
    "overtime_minutes",
    "late_by_minutes",
    "early_checkout_minutes",
    "attendance_id",
    "leave_id",
    "holiday_id",
    "week_off_applied",
    "is_holiday",
    "is_leave",
    "metadata",
    "created_by",
    "updated_by"
  ];

  const values = [];
  const placeholders = [];
  let p = 1;

  for (const row of dayRows) {
    placeholders.push(
      `($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`
    );
    values.push(
      snapshotId,
      row.tenantId,
      row.employeeExternalId,
      row.dayDate,
      row.dayKey,
      row.dayOfWeek,
      row.dayStatus,
      row.payableUnits,
      row.lopUnits,
      row.attendanceMinutes,
      row.overtimeMinutes,
      row.lateByMinutes,
      row.earlyCheckoutMinutes,
      row.attendanceId,
      row.leaveId,
      row.holidayId,
      row.weekOffApplied,
      row.isHoliday,
      row.isLeave,
      JSON.stringify(row.metadata || {}),
      actorId,
      actorId
    );
  }

  await client.query(
    `INSERT INTO payroll_attendance_snapshot_days (${columns.join(",")}) VALUES ${placeholders.join(",")}`,
    values
  );
};

exports.generateMonthlyAttendanceSnapshots = async (req) => {
  const organizationId = String(req.user.organizationId);
  const actorId = String(req.user.userId);
  const {
    month,
    employeeIds = [],
    forceRebuild = false,
    includeInactiveEmployees = false,
    unpaidLeaveTypeCodes = []
  } = req.body;

  const pool = await getPayrollPgPool();
  if (!pool) {
    throw { code: 400, message: "Payroll Postgres is not enabled" };
  }

  const unpaidCodes = new Set(
    (unpaidLeaveTypeCodes.length ? unpaidLeaveTypeCodes : [...DEFAULT_UNPAID_LEAVE_CODES]).map(
      (item) => String(item || "").toUpperCase()
    )
  );
  const hasRequestUnpaidCodes = unpaidLeaveTypeCodes.length > 0;

  const timeZone = await getOrganizationTimeZone(organizationId);
  const monthRange = parseMonthRangeInTimeZone(month, timeZone);
  const dateKeys = buildDateKeys(monthRange.startKey, monthRange.endKey);

  const employeeQuery = {
    organizationId,
    ...(includeInactiveEmployees ? {} : { status: { $in: ["active", "on_leave"] } })
  };
  if (employeeIds.length) {
    employeeQuery._id = { $in: employeeIds };
  }

  const employees = await Employee.find(employeeQuery)
    .select("_id employeeCode userId shiftId status")
    .lean();

  if (!employees.length) {
    return {
      month,
      timezone: timeZone,
      generatedCount: 0,
      skippedCount: 0,
      message: "No employees found for snapshot generation"
    };
  }

  const employeeIdList = employees.map((employee) => employee._id);
  const employeeIdStrings = employees.map((employee) => String(employee._id));

  const [attendanceRowsRaw, leaveRows, leaveTypes, holidayRows, weekOffRows, orgSettings] =
    await Promise.all([
      Attendance.find({
        organizationId,
        employeeId: { $in: employeeIdList },
        $or: [
          { date: { $gte: monthRange.start, $lte: monthRange.end } },
          { checkInAt: { $gte: monthRange.start, $lte: monthRange.end } },
          { checkOutAt: { $gte: monthRange.start, $lte: monthRange.end } }
        ]
      })
        .select(
          "_id employeeId date checkInAt checkOutAt status totalMinutes overtimeMinutes lateByMinutes earlyCheckoutByMinutes"
        )
        .lean(),
      Leave.find({
        organizationId,
        employeeId: { $in: employeeIdList },
        status: "approved",
        fromDate: { $lte: monthRange.end },
        toDate: { $gte: monthRange.start }
      })
        .select("_id employeeId leaveTypeId leaveType code fromDate toDate duration totalDays effectiveDateKeys")
        .lean(),
      LeaveType.find({ organizationId }).select("_id name code includeInPayroll").lean(),
      Holiday.find({
        organizationId,
        status: "active",
        date: { $gte: monthRange.start, $lte: monthRange.end }
      })
        .select("_id date")
        .lean(),
      WeekOff.find({ organizationId }).select("_id shiftId weekOffDays").lean(),
      OrgSettings.findOne({ organizationId })
        .select("minWorkHoursPerDay minHalfDayHours attendanceHoursSource")
        .lean()
    ]);

  const minWorkMinutes = Math.max(0, Math.round(toSafeNumber(orgSettings?.minWorkHoursPerDay, 8) * 60));
  const minHalfDayMinutes = Math.max(
    0,
    Math.round(toSafeNumber(orgSettings?.minHalfDayHours, 4) * 60)
  );

  const attendanceHoursSource = ATTENDANCE_HOURS_SOURCES.has(orgSettings?.attendanceHoursSource)
    ? orgSettings.attendanceHoursSource
    : "manual";
  const attendanceRowsForSnapshot = attendanceHoursSource === "monitor_agent"
    ? await getMonitorAttendanceRows({
        organizationId,
        start: monthRange.start,
        end: monthRange.end,
        timeZone,
        employees
      })
    : attendanceRowsRaw;
  const attendanceRows = mergeAttendanceRowsByEmployeeDay(attendanceRowsForSnapshot, timeZone);
  const leaveTypeCodeById = new Map(
    leaveTypes.map((item) => [String(item._id), String(item.code || "").toUpperCase()])
  );
  const leaveTypeCodeByName = new Map(
    leaveTypes.map((item) => [String(item.name || "").trim().toUpperCase(), String(item.code || "").toUpperCase()])
  );
  const leaveTypePayrollPayableById = new Map(
    leaveTypes.map((item) => [String(item._id), item.includeInPayroll])
  );
  const leaveTypePayrollPayableByCode = new Map(
    leaveTypes.map((item) => [String(item.code || "").toUpperCase(), item.includeInPayroll])
  );
  const leaveTypePayrollPayableByName = new Map(
    leaveTypes.map((item) => [String(item.name || "").trim().toUpperCase(), item.includeInPayroll])
  );
  const attendanceMap = buildAttendanceMap(attendanceRows, timeZone);
  const holidayMap = buildHolidayMap(holidayRows, timeZone);
  const holidayKeySet = new Set(
    holidayRows.map((holiday) => toDateKeyInTimeZone(holiday.date, timeZone))
  );
  const resolveWeekOffDays = buildWeekOffResolver(weekOffRows);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const tenantId = await getTenantIdForOrganization(client, organizationId, {
      actorId: req.user.userId
    });

    const profileMap = await getProfileMap(client, tenantId, employeeIdStrings);

    let generatedCount = 0;
    for (const employee of employees) {
      const employeeExternalId = String(employee._id);
      const weekOffDays = resolveWeekOffDays(employee.shiftId ? String(employee.shiftId) : null);
      const employeeLeaveRows = leaveRows.filter((leave) => String(leave.employeeId) === employeeExternalId);
      const employeeLeaveMap = buildLeaveIndex({
        rows: employeeLeaveRows,
        leaveTypeCodeById,
        leaveTypeCodeByName,
        leaveTypePayrollPayableById,
        leaveTypePayrollPayableByCode,
        leaveTypePayrollPayableByName,
        unpaidCodes,
        hasRequestUnpaidCodes,
        timeZone,
        holidayKeySet,
        weekOffDays
      });

      const totals = {
        calendarDays: monthRange.daysInMonth,
        workingDays: 0,
        presentDays: 0,
        halfDays: 0,
        absentDays: 0,
        paidLeaveDays: 0,
        unpaidLeaveDays: 0,
        weekOffDays: 0,
        holidayDays: 0,
        lopDays: 0,
        payableDays: 0,
        overtimeMinutes: 0,
        lateByMinutes: 0,
        earlyCheckoutMinutes: 0,
        attendanceMinutes: 0
      };

      const dayRows = [];

      for (const dayKey of dateKeys) {
        const weekday = getWeekdayForDateKey(dayKey, timeZone);
        const attendance = attendanceMap.get(`${employeeExternalId}:${dayKey}`);
        const leave = employeeLeaveMap.get(dayKey);
        const holiday = holidayMap.get(dayKey);
        const isHoliday = Boolean(holiday);
        const isWeekOff = weekOffDays.includes(weekday);
        const isWorkingDay = !isHoliday && !isWeekOff;

        if (isWorkingDay) totals.workingDays += 1;

        let dayStatus = "absent";
        let payableUnits = 0;
        let lopUnits = 0;

        const attendanceMinutes = toSafeNumber(attendance?.totalMinutes, 0);
        const overtimeMinutes = toSafeNumber(attendance?.overtimeMinutes, 0);
        const lateByMinutes = toSafeNumber(attendance?.lateByMinutes, 0);
        const earlyCheckoutMinutes = toSafeNumber(attendance?.earlyCheckoutByMinutes, 0);

        totals.attendanceMinutes += attendanceMinutes;
        totals.overtimeMinutes += overtimeMinutes;
        totals.lateByMinutes += lateByMinutes;
        totals.earlyCheckoutMinutes += earlyCheckoutMinutes;

        if (leave && leave.units === 1) {
          if (leave.isPaid) {
            dayStatus = "paid_leave";
            payableUnits = 1;
            totals.paidLeaveDays += 1;
          } else {
            dayStatus = "unpaid_leave";
            lopUnits = 1;
            totals.unpaidLeaveDays += 1;
            totals.lopDays += 1;
          }
        } else if (leave && leave.units === 0.5) {
          const qualifiesHalfDayAttendance = attendance && attendanceMinutes >= minHalfDayMinutes;
          if (qualifiesHalfDayAttendance) {
            dayStatus = leave.isPaid ? "paid_leave_half" : "unpaid_leave_half";
            payableUnits = leave.isPaid ? 1 : 0.5;
            totals.halfDays += 0.5;
            if (leave.isPaid) {
              totals.paidLeaveDays += 0.5;
            } else {
              lopUnits = 0.5;
              totals.unpaidLeaveDays += 0.5;
              totals.lopDays += 0.5;
            }
          } else if (leave.isPaid) {
            dayStatus = "paid_leave_half";
            payableUnits = 0.5;
            lopUnits = isWorkingDay ? 0.5 : 0;
            totals.paidLeaveDays += 0.5;
            if (isWorkingDay) {
              totals.lopDays += 0.5;
            }
          } else {
            dayStatus = "unpaid_leave_half";
            lopUnits = 0.5;
            totals.unpaidLeaveDays += 0.5;
            totals.lopDays += 0.5;
          }
        } else if (attendance) {
          if (isHoliday) {
            dayStatus = "holiday_worked";
            payableUnits = 1;
            totals.presentDays += 1;
          } else if (isWeekOff) {
            dayStatus = "week_off_worked";
            payableUnits = 1;
            totals.presentDays += 1;
          } else if (attendanceMinutes >= minWorkMinutes) {
            dayStatus = "present";
            payableUnits = 1;
            totals.presentDays += 1;
          } else if (attendanceMinutes >= minHalfDayMinutes) {
            dayStatus = "half_day";
            payableUnits = 0.5;
            lopUnits = 0.5;
            totals.halfDays += 0.5;
            totals.lopDays += 0.5;
          } else {
            dayStatus = "absent";
            lopUnits = 1;
            totals.absentDays += 1;
            totals.lopDays += 1;
          }
        } else if (isHoliday) {
          dayStatus = "holiday";
          payableUnits = 1;
          totals.holidayDays += 1;
        } else if (isWeekOff) {
          dayStatus = "week_off";
          payableUnits = 1;
          totals.weekOffDays += 1;
        } else {
          dayStatus = "absent";
          lopUnits = 1;
          totals.absentDays += 1;
          totals.lopDays += 1;
        }

        totals.payableDays += payableUnits;

        dayRows.push({
          tenantId,
          employeeExternalId,
          dayDate: dayKey,
          dayKey,
          dayOfWeek: weekday,
          dayStatus,
          payableUnits,
          lopUnits,
          attendanceMinutes,
          overtimeMinutes,
          lateByMinutes,
          earlyCheckoutMinutes,
          attendanceId: attendance?._id ? String(attendance._id) : null,
          leaveId: leave ? String(leave.leaveId) : null,
          holidayId: holiday ? String(holiday._id) : null,
          weekOffApplied: isWeekOff,
          isHoliday,
          isLeave: Boolean(leave),
          dayStatus: normalizeSnapshotDayStatus(dayStatus),
          metadata: {
            leaveTypeCode: leave?.leaveTypeCode || null
          }
        });
      }

      const sourceHash = crypto
        .createHash("sha256")
        .update(
          JSON.stringify({
            employeeExternalId,
            month,
            totals
          })
        )
        .digest("hex");

      const snapshotId = await upsertSnapshot(client, {
        tenantId,
        month,
        organizationExternalId: organizationId,
        employeeExternalId,
        employeePayrollProfileId: profileMap.get(employeeExternalId) || null,
        timezone: timeZone,
        calendarDays: totals.calendarDays,
        workingDays: totals.workingDays,
        presentDays: Number(totals.presentDays.toFixed(2)),
        halfDays: Number(totals.halfDays.toFixed(2)),
        absentDays: Number(totals.absentDays.toFixed(2)),
        paidLeaveDays: Number(totals.paidLeaveDays.toFixed(2)),
        unpaidLeaveDays: Number(totals.unpaidLeaveDays.toFixed(2)),
        weekOffDays: Number(totals.weekOffDays.toFixed(2)),
        holidayDays: Number(totals.holidayDays.toFixed(2)),
        lopDays: Number(totals.lopDays.toFixed(2)),
        payableDays: Number(totals.payableDays.toFixed(2)),
        overtimeMinutes: Math.round(totals.overtimeMinutes),
        lateByMinutes: Math.round(totals.lateByMinutes),
        earlyCheckoutMinutes: Math.round(totals.earlyCheckoutMinutes),
        attendanceMinutes: Math.round(totals.attendanceMinutes),
        minWorkMinutes,
        minHalfDayMinutes,
        sourceHash,
        generationStatus: forceRebuild ? "recomputed" : "generated",
        metadata: {
          unpaidLeaveTypeCodes: [...unpaidCodes],
          attendanceHoursSource
        },
        actorId
      });

      await client.query(`DELETE FROM payroll_attendance_snapshot_days WHERE snapshot_id = $1`, [
        snapshotId
      ]);
      await insertSnapshotDays(client, snapshotId, dayRows, actorId);
      generatedCount += 1;
    }

    await client.query("COMMIT");
    return {
      month,
      timezone: timeZone,
      totalEmployees: employees.length,
      generatedCount
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

exports.listMonthlyAttendanceSnapshots = async (req) => {
  const organizationId = String(req.user.organizationId);
  const { month, employeeId } = req.query;
  const pool = await getPayrollPgPool();

  if (!pool) {
    throw { code: 400, message: "Payroll Postgres is not enabled" };
  }

  const client = await pool.connect();
  try {
    const tenantId = await getTenantIdForOrganization(client, organizationId, {
      actorId: req.user.userId
    });

    const values = [tenantId, month];
    let filterClause = "";
    if (employeeId) {
      values.push(employeeId);
      filterClause = ` AND s.employee_external_id = $3 `;
    }

    const snapshots = await client.query(
      `
        SELECT
          s.id,
          s.pay_month,
          s.employee_external_id,
          s.calendar_days,
          s.working_days,
          s.present_days,
          s.half_days,
          s.absent_days,
          s.paid_leave_days,
          s.unpaid_leave_days,
          s.week_off_days,
          s.holiday_days,
          s.lop_days,
          s.payable_days,
          s.overtime_minutes,
          s.late_by_minutes,
          s.early_checkout_minutes,
          s.attendance_minutes,
          s.generation_status,
          s.generated_at
        FROM payroll_attendance_snapshots s
        WHERE s.tenant_id = $1
          AND s.pay_month = $2
          ${filterClause}
        ORDER BY s.employee_external_id ASC
      `,
      values
    );

    return {
      month,
      count: snapshots.rows.length,
      snapshots: snapshots.rows
    };
  } finally {
    client.release();
  }
};

exports.__test__ = {
  toSafeNumber,
  resolveAttendanceMinutes,
  buildDateKeys,
  buildAttendanceMap,
  buildHolidayMap,
  buildLeaveIndex,
  buildWeekOffResolver,
  normalizeSnapshotDayStatus
};
