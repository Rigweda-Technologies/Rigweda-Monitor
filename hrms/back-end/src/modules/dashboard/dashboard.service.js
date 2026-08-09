const EmployeeService = require("../employees/employee.service");
const OrgSettingsService = require("../orgSettings/orgSettings.service");
const NotificationService = require("../notifications/notification.service");
const Holiday = require("../holidays/holiday.model");
const Leave = require("../leaves/leave.model");
const Timesheet = require("../timesheets/timesheet.model");
const Attendance = require("../timesheets/timesheetAttendance.model");
const WeekOffService = require("../weekOffs/weekOff.service");
const Organization = require("../organizations/organization.model");
const OrgSettings = require("../orgSettings/orgSettings.model");
const Role = require("../roles/role.model");
const Permission = require("../permissions/permission.model");
const {
  isValidTimeZone,
  toDateKeyInTimeZone,
  addDaysToDateKey,
  getWeekdayForDateKey
} = require("../../utils/timezone");

const withQuery = (req, query) => ({
  ...req,
  query: {
    ...(req.query || {}),
    ...query
  }
});

const getOrganizationTimeZone = async (organizationId) => {
  const settings = await OrgSettings.findOne({ organizationId }).select("timezone");
  if (isValidTimeZone(settings?.timezone)) return settings.timezone;

  const organization = await Organization.findById(organizationId).select("timezone");
  if (isValidTimeZone(organization?.timezone)) return organization.timezone;
  return "Asia/Kolkata";
};

const getPermissionCodesForRequest = async (req) => {
  if (!req.user?.activeRoleId) return [];

  const roleInOrg = await Role.findOne({
    _id: req.user.activeRoleId,
    organizationId: req.user.organizationId
  }).lean();

  if (roleInOrg) {
    if (roleInOrg.isSystemRole) return ["*"];
    if (!roleInOrg.permissionIds?.length) return [];
    const permissions = await Permission.find({
      _id: { $in: roleInOrg.permissionIds },
      organizationId: req.user.organizationId
    }).select("code");
    return permissions.map((p) => p.code);
  }

  const fallbackRole = await Role.findById(req.user.activeRoleId).select("slug isSystemRole").lean();
  if (fallbackRole?.slug === "superadmin" || fallbackRole?.isSystemRole) return ["*"];
  return [];
};

const hasAnyPermission = (codes, required) => {
  if (!required || required.length === 0) return true;
  if (codes.includes("*")) return true;
  return required.some((code) => codes.includes(code));
};

const getEmployeeExternalId = (value) => {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    if (value._id) return String(value._id);
    if (value.employeeId) return getEmployeeExternalId(value.employeeId);
  }
  return null;
};

const isActiveEmployee = (employee) => {
  if (!employee) return false;
  return employee.status !== "resigned" && employee.employmentLifecycleStatus !== "terminated";
};

const isApprovedLeaveOnDate = (leave, dateKey, timeZone) => {
  if (leave?.status !== "approved") return false;
  const fromKey = toDateKeyInTimeZone(leave.fromDate, timeZone);
  const toKey = toDateKeyInTimeZone(leave.toDate, timeZone);
  return dateKey >= fromKey && dateKey <= toKey;
};

const buildLeaveIndex = (leaves, timeZone, fromKey, toKey) => {
  const index = new Set();
  (leaves || []).forEach((leave) => {
    if (leave?.status !== "approved") return;
    let cursor = toDateKeyInTimeZone(leave.fromDate, timeZone);
    const end = toDateKeyInTimeZone(leave.toDate, timeZone);
    while (cursor && cursor <= end && cursor <= toKey) {
      if (cursor >= fromKey) {
        index.add(`${String(leave.employeeId?._id || leave.employeeId)}-${cursor}`);
      }
      cursor = addDaysToDateKey(cursor, 1);
    }
  });
  return index;
};

const getAttendanceAnchorDateKey = (row, timeZone) => {
  const anchorDate = row?.checkInAt || row?.checkOutAt || row?.date || row?.createdAt;
  return anchorDate ? toDateKeyInTimeZone(anchorDate, timeZone) : null;
};

const isAttendanceRowRelevantForToday = (row, { timeZone, todayKey }) => {
  const anchorDateKey = getAttendanceAnchorDateKey(row, timeZone);
  if (!anchorDateKey) return false;
  if (anchorDateKey === todayKey) return true;

  const scheduledEndDateKey = row?.scheduledEndAt
    ? toDateKeyInTimeZone(row.scheduledEndAt, timeZone)
    : anchorDateKey;
  const isOvernightShift = Boolean(row?.scheduledEndAt && scheduledEndDateKey !== anchorDateKey);

  if (isOvernightShift && scheduledEndDateKey === todayKey) {
    return true;
  }

  return false;
};

const buildDashboardTodayAttendance = ({ rows, activeEmployeeIds, timeZone, todayKey }) => {
  const bestRows = new Map();

  for (const row of rows || []) {
    const employeeId = getEmployeeExternalId(row?.employeeId);
    if (!employeeId || !activeEmployeeIds.has(employeeId)) continue;
    if (!isAttendanceRowRelevantForToday(row, { timeZone, todayKey })) continue;

    const anchorDateKey = getAttendanceAnchorDateKey(row, timeZone);
    const scheduledEndDateKey = row?.scheduledEndAt
      ? toDateKeyInTimeZone(row.scheduledEndAt, timeZone)
      : anchorDateKey;
    const isOvernightShift = Boolean(row?.scheduledEndAt && scheduledEndDateKey !== anchorDateKey);

    const score = anchorDateKey === todayKey
      ? 3
      : isOvernightShift && scheduledEndDateKey === todayKey
        ? 2
        : 1;

    const existing = bestRows.get(employeeId);
    if (!existing || score > existing.score) {
      bestRows.set(employeeId, { score, row });
    }
  }

  return Array.from(bestRows.values()).map((entry) => entry.row);
};

const buildDashboardStats = ({
  employees,
  attendanceToday,
  attendanceLast7,
  attendanceLast30,
  leaveList,
  holidays,
  weekOffMap,
  timeZone,
  todayKey
}) => {
  const holidayKeyMap = new Map(
    (holidays || []).map((holiday) => [toDateKeyInTimeZone(holiday.date, timeZone), holiday.name])
  );
  const todayAttendanceMap = new Map(
    (attendanceToday || []).map((row) => [String(row.employeeId?._id || row.employeeId), row])
  );
  const start7Key = addDaysToDateKey(todayKey, -6);
  const start30Key = addDaysToDateKey(todayKey, -29);
  const leaveIndex = buildLeaveIndex(leaveList, timeZone, start7Key, todayKey);
  const leaveIndex30 = buildLeaveIndex(leaveList, timeZone, start30Key, todayKey);
  const attendanceLast7Map = new Map(
    (attendanceLast7 || []).map((row) => {
      const employeeId = String(row.employeeId?._id || row.employeeId);
      const dateKey = toDateKeyInTimeZone(row.checkInAt || row.checkOutAt || row.date, timeZone);
      return [`${employeeId}-${dateKey}`, row];
    })
  );
  const attendanceLast30Map = new Map(
    (attendanceLast30 || []).map((row) => {
      const employeeId = String(row.employeeId?._id || row.employeeId);
      const dateKey = toDateKeyInTimeZone(row.checkInAt || row.checkOutAt || row.date, timeZone);
      return [`${employeeId}-${dateKey}`, row];
    })
  );
  const now = new Date();

  const todayStatusList = (employees || []).map((employee) => {
    const employeeId = String(employee._id);
    const attendance = todayAttendanceMap.get(employeeId) || null;
    const holidayName = holidayKeyMap.get(todayKey) || null;
    const employeeWeekOffDays = weekOffMap.employeeMap.get(employeeId) || weekOffMap.defaultDays || [];
    const isWeekOff = employeeWeekOffDays.includes(getWeekdayForDateKey(todayKey, timeZone));
    const isOnLeave = (leaveList || []).some((leave) =>
      String(leave.employeeId?._id || leave.employeeId) === employeeId
      && isApprovedLeaveOnDate(leave, todayKey, timeZone)
    );
    const hasAttendance = Boolean(attendance?.checkInAt || attendance?.checkOutAt);
    const scheduledEndAt = attendance?.scheduledEndAt ? new Date(attendance.scheduledEndAt) : null;
    const isShiftCompleted = Boolean(
      scheduledEndAt
      && !Number.isNaN(scheduledEndAt.getTime())
      && now >= scheduledEndAt
    );
    const isOpenSession = Boolean(attendance?.checkInAt && (attendance.status === "checked_in" || !attendance.checkOutAt));
    const isPendingCheckout = Boolean(isOpenSession && isShiftCompleted);
    const countAsAbsent = !holidayName
      && !isWeekOff
      && !isOnLeave
      && !hasAttendance;
    const countedOnLeave = Boolean(isOnLeave);
    const countedPresent = !countedOnLeave && hasAttendance;
    const countedAbsent = !countedOnLeave && !countedPresent;

    return {
      employeeId,
      holidayName,
      isWeekOff,
      isOnLeave,
      checkInAt: attendance?.checkInAt || null,
      checkOutAt: attendance?.checkOutAt || null,
      lateByMinutes: Number(attendance?.lateByMinutes || 0),
      shiftStartTime: attendance?.shiftStartTime || employee?.shiftId?.startTime || null,
      overriddenBy: attendance?.overriddenBy || null,
      overriddenAt: attendance?.overriddenAt || null,
      present: hasAttendance,
      countedPresent,
      countedOnLeave,
      countedAbsent,
      pendingCheckout: isPendingCheckout,
      absent: countAsAbsent
    };
  });

  const kpis = {
    totalEmployees: employees.length,
    presentToday: todayStatusList.filter((item) => item.countedPresent).length,
    absentToday: todayStatusList.filter((item) => item.countedAbsent).length,
    checkedInOnly: todayStatusList.filter((item) => item.pendingCheckout).length,
    lateArrivals: todayStatusList.filter((item) =>
      item.countedPresent
      && !item.holidayName
      && !item.isWeekOff
      && item.lateByMinutes > 0
    ).length,
    onLeaveToday: todayStatusList.filter((item) => item.countedOnLeave).length
  };

  const monthDaySummary = {
    present: todayStatusList.filter((item) => item.countedPresent).length,
    pendingCheckout: todayStatusList.filter((item) => item.pendingCheckout).length,
    absent: todayStatusList.filter((item) => item.countedAbsent).length,
    onLeave: todayStatusList.filter((item) => item.countedOnLeave).length,
    weekOff: todayStatusList.filter((item) => item.isWeekOff).length,
    holiday: todayStatusList.filter((item) => Boolean(item.holidayName)).length,
    overridden: todayStatusList.filter((item) => item.overriddenBy || item.overriddenAt).length
  };

  const groupedDepartments = {};
  const todayStatusByEmployeeId = new Map(todayStatusList.map((item) => [String(item.employeeId), item]));
  (employees || []).forEach((employee) => {
    const dept = employee.departmentId?.name || "Unassigned";
    if (!groupedDepartments[dept]) {
      groupedDepartments[dept] = { name: dept, employees: 0, present: 0, onLeave: 0, absent: 0 };
    }
    groupedDepartments[dept].employees += 1;
    const status = todayStatusByEmployeeId.get(String(employee._id));
    if (!status) return;
    if (status.countedOnLeave) groupedDepartments[dept].onLeave += 1;
    else if (status.countedPresent) groupedDepartments[dept].present += 1;
    else groupedDepartments[dept].absent += 1;
  });

  const departmentAnalytics = Object.values(groupedDepartments)
    .sort((a, b) => b.employees - a.employees)
    .slice(0, 6);

  const attendanceTrend = Array.from({ length: 7 }).map((_, idx) => {
    const key = addDaysToDateKey(start7Key, idx);
    let present = 0;
    let absent = 0;
    let excluded = 0;

    (employees || []).forEach((employee) => {
      const employeeId = String(employee._id);
      const holidayName = holidayKeyMap.get(key) || null;
      const employeeWeekOffDays = weekOffMap.employeeMap.get(employeeId) || weekOffMap.defaultDays || [];
      const isWeekOff = employeeWeekOffDays.includes(getWeekdayForDateKey(key, timeZone));
      const isOnLeave = leaveIndex.has(`${employeeId}-${key}`);
      const attendance = attendanceLast7Map.get(`${employeeId}-${key}`) || null;

      if (holidayName || isWeekOff || isOnLeave) {
        excluded += 1;
        return;
      }

      if (attendance?.checkInAt || attendance?.checkOutAt) {
        present += 1;
        return;
      }

      absent += 1;
    });

    return {
      key,
      present,
      absent,
      excluded
    };
  });

  const attendanceTrendMonthly = Array.from({ length: 30 }).map((_, idx) => {
    const key = addDaysToDateKey(start30Key, idx);
    let present = 0;
    let absent = 0;
    let excluded = 0;

    (employees || []).forEach((employee) => {
      const employeeId = String(employee._id);
      const holidayName = holidayKeyMap.get(key) || null;
      const employeeWeekOffDays = weekOffMap.employeeMap.get(employeeId) || weekOffMap.defaultDays || [];
      const isWeekOff = employeeWeekOffDays.includes(getWeekdayForDateKey(key, timeZone));
      const isOnLeave = leaveIndex30.has(`${employeeId}-${key}`);
      const attendance = attendanceLast30Map.get(`${employeeId}-${key}`) || null;

      if (holidayName || isWeekOff || isOnLeave) {
        excluded += 1;
        return;
      }

      if (attendance?.checkInAt || attendance?.checkOutAt) {
        present += 1;
        return;
      }

      absent += 1;
    });

    return {
      key,
      present,
      absent,
      excluded
    };
  });

  return {
    todayStatusList,
    dashboardStats: {
      kpis,
      monthDaySummary,
      departmentAnalytics,
      attendanceTrend,
      attendanceTrendMonthly
    }
  };
};

exports.getSummary = async (req) => {
  const permissionCodes = await getPermissionCodesForRequest(req);
  const month = req.query?.month || toDateKeyInTimeZone(new Date(), "UTC").slice(0, 7);
  const year = Number(req.query?.year || new Date().getFullYear());
  const timeZone = await getOrganizationTimeZone(req.user.organizationId);
  const todayKey = toDateKeyInTimeZone(new Date(), timeZone);
  const start7Key = addDaysToDateKey(todayKey, -6);
  const start30Key = addDaysToDateKey(todayKey, -29);
  const monthYear = Number(String(month).slice(0, 4));
  const monthNumber = Number(String(month).slice(5, 7));
  const monthStartDateUtc = new Date(Date.UTC(monthYear, Math.max(0, monthNumber - 1), 1, 0, 0, 0, 0));
  const monthEndDateUtc = new Date(Date.UTC(monthYear, Math.max(0, monthNumber), 0, 23, 59, 59, 999));

  const canViewEmployees = hasAnyPermission(permissionCodes, ["EMP_VIEW"]);
  const canViewAttendance = hasAnyPermission(permissionCodes, ["TIMESHEET_VIEW_ALL"]);
  const canViewLeaves = hasAnyPermission(permissionCodes, ["LEAVE_VIEW_ALL"]);
  const canViewWeekly = hasAnyPermission(permissionCodes, ["TIMESHEET_VIEW_ALL"]);
  const canViewHolidays = hasAnyPermission(permissionCodes, ["HOLIDAY_VIEW"]);
  const canViewWeekOffs = hasAnyPermission(permissionCodes, ["WEEK_OFF_VIEW"]);
  const canViewOrgSettings = hasAnyPermission(permissionCodes, ["ORG_SETTINGS_VIEW"]);
  const canViewNotifications = hasAnyPermission(permissionCodes, ["NOTIFICATION_VIEW_SELF"]);

  const withDashboardFallback = async (key, fn, fallback) => {
    try {
      return await fn();
    } catch (error) {
      console.error(`[dashboard.summary] ${key} failed`, {
        organizationId: req.user?.organizationId,
        userId: req.user?.userId,
        message: error?.message || error
      });
      return fallback;
    }
  };

  const [
    employeesData,
    holidays,
    orgSettings,
    notificationsData
  ] = await Promise.all([
    canViewEmployees
      ? withDashboardFallback("employees", () => EmployeeService.listByOrganization(withQuery(req, { compact: "true" })), { items: [], pagination: null })
      : Promise.resolve({ items: [], pagination: null }),
    canViewHolidays
      ? withDashboardFallback("holidays", () => Holiday.find({
        organizationId: req.user.organizationId,
        year,
        status: "active"
      }).lean(), [])
      : Promise.resolve([]),
    canViewOrgSettings
      ? withDashboardFallback("orgSettings", () => OrgSettingsService.get(req), null)
      : Promise.resolve(null),
    canViewNotifications
      ? withDashboardFallback("notifications", () => NotificationService.getMyNotifications(withQuery(req, { limit: 6 })), { items: [] })
      : Promise.resolve({ items: [] })
  ]);

  const activeEmployees = (employeesData?.items || []).filter(isActiveEmployee);
  const weekOffMap = canViewWeekOffs || canViewAttendance
    ? await WeekOffService.resolveWeekOffMapForEmployees({
      organizationId: req.user.organizationId,
      employees: activeEmployees
    })
    : { defaultDays: [], employeeMap: new Map() };
  const activeEmployeeIds = new Set(activeEmployees.map((employee) => String(employee._id)));

  const activeEmployeeObjectIds = activeEmployees
    .map((employee) => employee?._id)
    .filter(Boolean);

  const [attendanceLast30, leaveListRaw, weeklyRaw] = await Promise.all([
    canViewAttendance && activeEmployeeObjectIds.length
      ? withDashboardFallback(
        "attendanceLast30",
        () => Attendance.find({
          organizationId: req.user.organizationId,
          employeeId: { $in: activeEmployeeObjectIds },
          dateKey: { $gte: start30Key, $lte: todayKey }
        })
          .select("employeeId date dateKey checkInAt checkOutAt scheduledEndAt shiftStartTime lateByMinutes overriddenBy overriddenAt status")
          .lean(),
        []
      )
      : Promise.resolve([]),
    canViewLeaves && activeEmployeeObjectIds.length
      ? withDashboardFallback(
        "leaves",
        () => Leave.find({
          organizationId: req.user.organizationId,
          employeeId: { $in: activeEmployeeObjectIds },
          status: "approved",
          fromDate: { $lte: monthEndDateUtc },
          toDate: { $gte: monthStartDateUtc }
        })
          .select("employeeId leaveTypeId status fromDate toDate createdAt")
          .populate("leaveTypeId", "name")
          .lean(),
        []
      )
      : Promise.resolve([]),
    canViewWeekly && activeEmployeeObjectIds.length
      ? withDashboardFallback(
        "weekly",
        () => Timesheet.find({
          organizationId: req.user.organizationId,
          employeeId: { $in: activeEmployeeObjectIds },
          weekStart: { $gte: monthStartDateUtc, $lte: monthEndDateUtc }
        })
          .select("employeeId status weekStart createdAt submittedAt")
          .limit(50)
          .lean(),
        []
      )
      : Promise.resolve([])
  ]);

  const activeAttendanceToday = buildDashboardTodayAttendance({
    rows: attendanceLast30 || [],
    activeEmployeeIds,
    timeZone,
    todayKey
  });

  const activeAttendanceLast7 = (attendanceLast30 || []).filter((row) => {
    const dayKey = toDateKeyInTimeZone(row?.checkInAt || row?.checkOutAt || row?.date, timeZone);
    const employeeId = getEmployeeExternalId(row?.employeeId);
    return Boolean(employeeId && activeEmployeeIds.has(employeeId) && dayKey >= start7Key && dayKey <= todayKey);
  });

  const activeLeaves = (leaveListRaw || []).filter((row) => {
    const employeeId = getEmployeeExternalId(row?.employeeId);
    return Boolean(employeeId && activeEmployeeIds.has(employeeId));
  });

  const activeWeekly = (weeklyRaw || []).filter((row) => {
    const employeeId = getEmployeeExternalId(row?.employeeId);
    return Boolean(employeeId && activeEmployeeIds.has(employeeId));
  });

  const { todayStatusList, dashboardStats } = buildDashboardStats({
    employees: activeEmployees,
    attendanceToday: activeAttendanceToday,
    attendanceLast7: activeAttendanceLast7,
    attendanceLast30: (attendanceLast30 || []).filter((row) => {
      const employeeId = getEmployeeExternalId(row?.employeeId);
      return Boolean(employeeId && activeEmployeeIds.has(employeeId));
    }),
    leaveList: activeLeaves,
    holidays: holidays || [],
    weekOffMap: weekOffMap || { defaultDays: [], employeeMap: new Map() },
    timeZone,
    todayKey
  });

  const compactEmployeeList = (activeEmployees || []).map((employee) => ({
    _id: employee?._id,
    firstName: employee?.firstName || "",
    lastName: employee?.lastName || "",
    employeeCode: employee?.employeeCode || "",
    dateOfJoining: employee?.dateOfJoining || null,
    status: employee?.status || null,
    departmentId: employee?.departmentId
      ? { _id: employee.departmentId?._id, name: employee.departmentId?.name || "" }
      : null,
    designationId: employee?.designationId
      ? { _id: employee.designationId?._id, name: employee.designationId?.name || "" }
      : null
  }));

  const compactLeaveList = (activeLeaves || []).map((leave) => ({
    _id: leave?._id,
    status: leave?.status || null,
    fromDate: leave?.fromDate || null,
    toDate: leave?.toDate || null,
    createdAt: leave?.createdAt || null,
    employeeId: leave?.employeeId || null,
    leaveTypeId: leave?.leaveTypeId
      ? { _id: leave.leaveTypeId?._id, name: leave.leaveTypeId?.name || "" }
      : null
  }));

  const compactWeeklyList = (activeWeekly || []).map((item) => ({
    _id: item?._id,
    status: item?.status || null,
    weekStart: item?.weekStart || null,
    createdAt: item?.createdAt || null,
    submittedAt: item?.submittedAt || null,
    employeeId: item?.employeeId || null
  }));

  const compactNotifications = (notificationsData?.items || []).map((item) => ({
    _id: item?._id,
    title: item?.title || "",
    message: item?.message || "",
    createdAt: item?.createdAt || null
  }));

  const compactHolidays = (holidays || []).map((holiday) => ({
    _id: holiday?._id,
    date: holiday?.date || null,
    name: holiday?.name || ""
  }));

  const compactOrgSettings = orgSettings
    ? {
      timezone: orgSettings?.timezone || null,
      sandwichRuleEnabled: Boolean(orgSettings?.sandwichRuleEnabled),
      attendanceLockEnabled: Boolean(orgSettings?.attendanceLockEnabled),
      leaveTypeCreditMode: orgSettings?.leaveTypeCreditMode || null
    }
    : null;

  return {
    employeeList: compactEmployeeList,
    attendanceToday: (activeAttendanceToday || []).map((row) => ({
      employeeId: row?.employeeId,
      checkInAt: row?.checkInAt || null,
      checkOutAt: row?.checkOutAt || null
    })),
    attendanceLast7: (activeAttendanceLast7 || []).map((row) => ({
      employeeId: row?.employeeId,
      checkInAt: row?.checkInAt || null,
      checkOutAt: row?.checkOutAt || null
    })),
    attendanceMatrix: [],
    leaveList: compactLeaveList,
    weeklyList: compactWeeklyList,
    holidays: compactHolidays,
    weekOffDays: weekOffMap?.defaultDays || [],
    todayStatusList,
    dashboardStats,
    orgSettings: compactOrgSettings,
    notifications: compactNotifications
  };
};
