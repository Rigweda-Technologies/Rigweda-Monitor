import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger
} from "@/components/ui/hover-card";
import { getApiWithToken, postApiWithToken, putApiWithToken } from "@/services/apiWrapper";
import { useAuth } from "@/context/useAuth";
import { toast } from "sonner";
import { formatDateKeyInOrgCalendar, formatDateTimeInOrgTimeZone, formatTimeInOrgTimeZone } from "@/utils/timezone";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowUpDown, CalendarDays, Camera, Clock, ShieldCheck } from "lucide-react";

type DayCell = {
  status: "present" | "half_day_present" | "full_day_present" | "absent" | "pending_checkout";
  displayStatus?: string;
  displayLabel?: string;
  displayShortLabel?: string;
  displayTone?: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  totalMinutes?: number;
  workedMinutes?: number;
  workedDuration?: string;
  checkInIp?: string | null;
  checkOutIp?: string | null;
  checkInSelfieProvided?: boolean;
  checkOutSelfieProvided?: boolean;
  isOpenSession?: boolean;
  excludeFromPayroll?: boolean;
  payrollReconciledByLeave?: boolean;
  missedCheckout?: boolean;
  missedCheckoutMarkedAt?: string | null;
  overriddenBy: string | null;
  overriddenAt: string | null;
  shiftName?: string | null;
  shiftCode?: string | null;
  shiftStartTime?: string | null;
  shiftEndTime?: string | null;
  lateByMinutes?: number;
  earlyLoginByMinutes?: number;
  earlyCheckoutByMinutes?: number;
  overtimeMinutes?: number;
  isOnLeave: boolean;
  leaveType: string | null;
  leaveCode?: string | null;
  isPaidLeave?: boolean;
  leaveDuration?: "full_day" | "half_day" | null;
  leaveHalfDaySession?: "first_half" | "second_half" | null;
  leaveUnits?: number;
  isWeekOff: boolean;
  holidayName: string | null;
  isFuture?: boolean;
  isThresholdQualified?: boolean;
  isOvernightShift?: boolean;
  attendanceDateKey?: string | null;
};

type EmployeeRow = {
  employeeId: string;
  firstName: string;
  lastName: string;
  employeeCode: string;
  days: Record<number, DayCell>;
  summary?: {
    presentDays: number;
    pendingCheckoutDays: number;
    absentDays: number;
    onLeaveDays: number;
    paidLeaveDays: number;
    unpaidLeaveDays: number;
    weekOffDays: number;
    holidayDays: number;
    selfieDays: number;
    payrollExcludedDays: number;
    totalDays: number;
  };
};

type AttendanceHistoryItem = {
  action: string;
  createdAt: string;
  actor: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
};

type AttendanceDayHistoryItem = {
  action?: "check_in" | "check_out";
  at?: string;
  ip?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  selfieProvided?: boolean;
  source?: string | null;
};

type AttendanceSnapshot = {
  checkInAt?: string | null;
  checkOutAt?: string | null;
  checkInIp?: string | null;
  checkOutIp?: string | null;
  checkInSelfieProvided?: boolean;
  checkInSelfieImage?: string | null;
  checkOutSelfieProvided?: boolean;
  checkOutSelfieImage?: string | null;
  dayHistory?: AttendanceDayHistoryItem[];
} | null;

type ApprovedLeaveDetail = {
  leaveType?: string | null;
  leaveCode?: string | null;
  duration?: "full_day" | "half_day" | null;
  halfDaySession?: "first_half" | "second_half" | null;
  reason?: string | null;
  status?: string | null;
  approvedBy?: string | null;
  approvedByEmployeeCode?: string | null;
  approvedAt?: string | null;
} | null;

type AttendanceRequestDetail = {
  requestType?: "missed_checkout" | "correction" | "work_from_home" | null;
  dayPortion?: "full_day" | "first_half" | "second_half" | null;
  requestedCheckInTime?: string | null;
  requestedCheckOutTime?: string | null;
  reason?: string | null;
  status?: string | null;
  approvedBy?: string | null;
  approvedByEmployeeCode?: string | null;
  approvedAt?: string | null;
  rejectionReason?: string | null;
} | null;

type AttendanceCellDetailPayload = {
  history: AttendanceHistoryItem[];
  attendance: AttendanceSnapshot;
  leave: ApprovedLeaveDetail;
  attendanceRequest: AttendanceRequestDetail;
};

type MatrixPagination = {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

type LockAttendanceMeta = {
  enabled: boolean;
  pendingCheckoutCount: number;
  lockedThroughDateKey: string | null;
  reason: string | null;
  snapshotGenerated?: boolean;
};

type AttendanceOverrideStatus = "present" | "half_day_present" | "absent";

const toEmployeeIdString = (value: unknown): string => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record._id === "string") return record._id;
    if (typeof record.employeeId === "string") return record.employeeId;
    if (typeof (record as { toHexString?: unknown }).toHexString === "function") {
      return String((record as { toHexString: () => string }).toHexString());
    }
    if (typeof record.$oid === "string") return record.$oid;
    if (record._id && typeof record._id === "object") {
      const nested = record._id as Record<string, unknown>;
      if (typeof (nested as { toHexString?: unknown }).toHexString === "function") {
        return String((nested as { toHexString: () => string }).toHexString());
      }
      if (typeof nested.$oid === "string") return nested.$oid;
      if (typeof nested.toString === "function") return nested.toString();
    }
  }
  return String(value);
};

const normalizeEmployeeIds = (values: unknown[]): string[] =>
  Array.from(
    new Set(
      values
        .map((value) => toEmployeeIdString(value).trim())
        .filter(Boolean)
    )
  );

const currentMonth = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = `${now.getMonth() + 1}`.padStart(2, "0");
  return `${y}-${m}`;
};

const monthOptions = [
  { value: "01", label: "January" },
  { value: "02", label: "February" },
  { value: "03", label: "March" },
  { value: "04", label: "April" },
  { value: "05", label: "May" },
  { value: "06", label: "June" },
  { value: "07", label: "July" },
  { value: "08", label: "August" },
  { value: "09", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" }
];

const emptyCell: DayCell = {
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
  isWeekOff: false,
  holidayName: null,
  isOnLeave: false,
  leaveType: "",
  leaveCode: "",
  isPaidLeave: false,
  leaveDuration: null,
  leaveHalfDaySession: null,
  leaveUnits: 0
};

const isPresentLikeStatus = (status?: string | null) =>
  status === "present" || status === "half_day_present" || status === "full_day_present";

const getAttendanceOverrideLabel = (status: AttendanceOverrideStatus) => {
  if (status === "half_day_present") return "Half Day";
  if (status === "present") return "Present";
  return "Absent";
};

const formatMinutesAsDuration = (minutes?: number | null) => {
  const totalMinutes = Math.max(0, Number(minutes || 0));
  if (!totalMinutes) return "0m";
  const hours = Math.floor(totalMinutes / 60);
  const remainderMinutes = totalMinutes % 60;
  if (hours === 0) return `${remainderMinutes}m`;
  if (remainderMinutes === 0) return `${hours}h`;
  return `${hours}h ${remainderMinutes}m`;
};

const isAbsentLikeAttendance = (attendance?: { checkInAt?: string | Date | null; checkOutAt?: string | Date | null } | null) =>
  !attendance?.checkInAt && !attendance?.checkOutAt;

const addDaysToDateKey = (dateKey: string, dayDelta: number) => {
  const [year, month, day] = dateKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + dayDelta, 12, 0, 0));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
};

const mergeAttendancePages = (existing: EmployeeRow[], incoming: EmployeeRow[]) => {
  const merged = new Map<string, EmployeeRow>();
  existing.forEach((row) => merged.set(toEmployeeIdString(row.employeeId), row));
  incoming.forEach((row) => merged.set(toEmployeeIdString(row.employeeId), row));
  return Array.from(merged.values());
};

const buildActivityTimeline = (
  history: AttendanceHistoryItem[],
  attendanceSnapshot: AttendanceSnapshot,
  attendanceCell?: DayCell | null
): AttendanceHistoryItem[] => {
  const items = [...history];
  const hasCheckInEvent = items.some((item) => item.action === "CHECK_IN");
  const hasCheckOutEvent = items.some((item) => item.action === "CHECK_OUT");
  const fallbackCheckInAt = attendanceSnapshot?.checkInAt || attendanceCell?.checkInAt || null;
  const fallbackCheckOutAt = attendanceSnapshot?.checkOutAt || attendanceCell?.checkOutAt || null;

  if (!hasCheckInEvent && fallbackCheckInAt) {
    items.push({
      action: "CHECK_IN",
      createdAt: fallbackCheckInAt,
      actor: "Employee"
    });
  }

  if (!hasCheckOutEvent && fallbackCheckOutAt) {
    items.push({
      action: "CHECK_OUT",
      createdAt: fallbackCheckOutAt,
      actor: "Employee"
    });
  }

  return items.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
};

const formatAttendanceStatusLabel = (status?: unknown) => {
  switch (status) {
    case "present":
    case "full_day_present":
      return "Present";
    case "half_day_present":
      return "Half Day";
    case "absent":
      return "Absent";
    case "pending_checkout":
      return "Pending Checkout";
    default:
      return null;
  }
};

const formatActivityAction = (item: AttendanceHistoryItem) => {
  switch (item.action) {
    case "CHECK_IN":
      return "Checked in";
    case "CHECK_OUT":
      return "Checked out";
    case "ATTENDANCE_OVERRIDE": {
      const beforeStatus = formatAttendanceStatusLabel(item.before?.status);
      const afterStatus = formatAttendanceStatusLabel(item.after?.status);
      if (afterStatus) {
        const leaveNote = item.after?.isOnLeave ? "; approved leave retained" : "";
        return `Attendance overridden to ${afterStatus}${beforeStatus ? ` from ${beforeStatus}` : ""}${leaveNote}`;
      }
      return "Attendance overridden";
    }
    default:
      return item.action.replace(/_/g, " ").toLowerCase().replace(/^\w/, (char) => char.toUpperCase());
  }
};

const Attendance = () => {
  const { hasAnyPermission, profile } = useAuth();
  const canViewAll = hasAnyPermission(["ATTENDANCE_VIEW_ALL"]);
  const canViewSelf = hasAnyPermission(["ATTENDANCE_VIEW_SELF"]);
  const canView = canViewAll || canViewSelf;
  const canEdit = hasAnyPermission(["ATTENDANCE_MANAGE"]);
  const canViewSelfieData = ["hr", "org-admin"].includes(profile?.activeRole?.slug || "");

  const [month, setMonth] = useState(currentMonth());
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [daysInMonth, setDaysInMonth] = useState(31);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [pagination, setPagination] = useState<MatrixPagination | null>(null);
  const [lockAttendanceMeta, setLockAttendanceMeta] = useState<LockAttendanceMeta | null>(null);
  const [lockingAttendance, setLockingAttendance] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState<"employeeCode" | "firstName">("employeeCode");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const tableViewportRef = useRef<HTMLDivElement | null>(null);
  const loadingMoreRef = useRef(false);
  const resetPaginationRef = useRef(false);
  const progressiveRenderTimersRef = useRef<number[]>([]);
  const progressiveRenderRunRef = useRef(0);

  const [open, setOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeRow | null>(null);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<AttendanceOverrideStatus>("present");
  const [saving, setSaving] = useState(false);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const [bulkStartDate, setBulkStartDate] = useState("");
  const [bulkEndDate, setBulkEndDate] = useState("");
  const [bulkIncludeNonWorkingDays, setBulkIncludeNonWorkingDays] = useState(false);
  const [bulkStatus, setBulkStatus] = useState<AttendanceOverrideStatus>("present");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [customBulkOpen, setCustomBulkOpen] = useState(false);
  const [customBulkSaving, setCustomBulkSaving] = useState(false);
  const [customBulkDays, setCustomBulkDays] = useState<number[]>([]);
  const [customBulkValues, setCustomBulkValues] = useState<Record<string, boolean>>({});
  const [customBulkOriginalValues, setCustomBulkOriginalValues] = useState<Record<string, boolean>>({});
  const [showBulkControls, setShowBulkControls] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [history, setHistory] = useState<AttendanceHistoryItem[]>([]);
  const [selectedAttendanceSnapshot, setSelectedAttendanceSnapshot] = useState<AttendanceSnapshot>(null);
  const [selectedLeaveDetail, setSelectedLeaveDetail] = useState<ApprovedLeaveDetail>(null);
  const [selectedAttendanceRequestDetail, setSelectedAttendanceRequestDetail] = useState<AttendanceRequestDetail>(null);
  const [hoveredCellDay, setHoveredCellDay] = useState<number | null>(null);
  const [hoveredCellLoading, setHoveredCellLoading] = useState(false);
  const [hoveredCellDetails, setHoveredCellDetails] = useState<AttendanceCellDetailPayload | null>(null);
  const hoveredCellRequestRef = useRef(0);
  const [selectedYear, selectedMonth] = month.split("-");
  const yearOptions = useMemo(() => {
    const currentYearValue = new Date().getFullYear();
    return Array.from({ length: 7 }, (_, index) => String(currentYearValue - 3 + index));
  }, []);

  const updateMonthFilter = (nextYear: string, nextMonth: string) => {
    setMonth(`${nextYear}-${nextMonth}`);
  };

  const cancelProgressiveRender = useCallback(() => {
    progressiveRenderRunRef.current += 1;
    progressiveRenderTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    progressiveRenderTimersRef.current = [];
  }, []);

  const renderRowsProgressively = useCallback((incomingRows: EmployeeRow[], appendToExisting: boolean) => {
    cancelProgressiveRender();
    const runId = progressiveRenderRunRef.current;

    if (!appendToExisting) {
      setRows([]);
    }

    if (incomingRows.length === 0) {
      return;
    }

    incomingRows.forEach((row, index) => {
      const timerId = window.setTimeout(() => {
        if (progressiveRenderRunRef.current !== runId) return;
        setRows((prev) => {
          if (appendToExisting) {
            return mergeAttendancePages(prev, [row]);
          }
          return [...prev, row];
        });
      }, index * 24);
      progressiveRenderTimersRef.current.push(timerId);
    });
  }, [cancelProgressiveRender]);

  const fetchMatrix = useCallback(async () => {
    if (!canView) {
      cancelProgressiveRender();
      setRows([]);
      return;
    }
    try {
      if (currentPage > 1) setLoadingMore(true);
      else setLoading(true);
      const endpoint = canViewAll
        ? `/timesheets/attendance/matrix?month=${month}&page=${currentPage}&limit=${pageSize}&search=${encodeURIComponent(searchTerm.trim())}&sortBy=${sortBy}&sortOrder=${sortOrder}`
        : `/timesheets/attendance/matrix/my?month=${month}`;
      const permission = canViewAll ? ["ATTENDANCE_VIEW_ALL"] : ["ATTENDANCE_VIEW_SELF"];

      const res = await getApiWithToken(endpoint, null, {
        requiredPermissions: permission
      });
      if (res?.skipped) return;
      if (!res?.success) {
        toast.error(res?.message || "Failed to load attendance");
        return;
      }

      const nextRows = (res.data?.employees || []).map((employee: EmployeeRow & { employeeId: unknown }) => ({
        ...employee,
        employeeId: toEmployeeIdString(employee.employeeId)
      }));

      const sampleCell = nextRows[0]
        ? Object.values(nextRows[0].days || {}).find((cell) => Boolean(cell))
        : null;
      const backendDisplayPayloadMissing = Boolean(
        nextRows.length > 0
          && sampleCell
          && typeof sampleCell === "object"
          && !("displayStatus" in sampleCell)
      );
      if (backendDisplayPayloadMissing) {
        toast.error("Attendance backend is outdated. Restart or redeploy the backend to load computed attendance statuses.");
        return;
      }

      const isPaginatedAppend = Boolean(canViewAll && currentPage > 1);

      renderRowsProgressively(nextRows, isPaginatedAppend);
      setDaysInMonth(res.data?.daysInMonth || 31);
      setPagination(res.data?.pagination || null);
      setLockAttendanceMeta((prev) => {
        const nextLockMeta = res.data?.lockAttendance || null;
        if (nextLockMeta) return nextLockMeta;
        return isPaginatedAppend ? prev : null;
      });
      if (currentPage === 1) {
        setSelectedEmployeeIds((prev) => {
          const validIds = new Set(nextRows.map((e: EmployeeRow) => e.employeeId));
          return prev.filter((id) => validIds.has(id));
        });
      }
    } finally {
      loadingMoreRef.current = false;
      setLoading(false);
      setLoadingMore(false);
    }
  }, [canView, currentPage, canViewAll, month, pageSize, searchTerm, sortBy, sortOrder, cancelProgressiveRender, renderRowsProgressively]);

  useEffect(() => {
    cancelProgressiveRender();
    resetPaginationRef.current = true;
    loadingMoreRef.current = false;
    if (tableViewportRef.current) {
      tableViewportRef.current.scrollTop = 0;
    }
    setCurrentPage(1);
    setRows([]);
  }, [month, pageSize, searchTerm, sortBy, sortOrder, cancelProgressiveRender]);

  useEffect(() => {
    if (resetPaginationRef.current && currentPage !== 1) {
      return;
    }
    if (resetPaginationRef.current && currentPage === 1) {
      resetPaginationRef.current = false;
    }
    fetchMatrix();
  }, [currentPage, fetchMatrix]);

  const refreshMatrixLatest = useCallback(async () => {
    cancelProgressiveRender();
    loadingMoreRef.current = false;
    resetPaginationRef.current = true;
    if (tableViewportRef.current) {
      tableViewportRef.current.scrollTop = 0;
    }
    setRows([]);
    setPagination(null);

    if (currentPage !== 1) {
      setCurrentPage(1);
      return;
    }

    resetPaginationRef.current = false;
    await fetchMatrix();
  }, [currentPage, fetchMatrix, cancelProgressiveRender]);

  useEffect(() => () => {
    cancelProgressiveRender();
  }, [cancelProgressiveRender]);

  const filteredRows = useMemo(() => rows || [], [rows]);
  const visibleRows = filteredRows;
  const lockAttendanceButtonLabel = useMemo(() => {
    if (lockingAttendance) return "Processing...";
    if (!lockAttendanceMeta) return "Generate Snapshot";
    const countSuffix = lockAttendanceMeta.pendingCheckoutCount
      ? ` (${lockAttendanceMeta.pendingCheckoutCount})`
      : "";
    return lockAttendanceMeta.snapshotGenerated
      ? `Refresh Snapshot${countSuffix}`
      : `Generate Snapshot${countSuffix}`;
  }, [lockAttendanceMeta, lockingAttendance]);
  const lockAttendanceHelperText = useMemo(() => {
    if (!lockAttendanceMeta) return null;
    if (!lockAttendanceMeta.enabled) {
      return lockAttendanceMeta.reason || "Payroll snapshot action is not available yet.";
    }
    if (lockAttendanceMeta.snapshotGenerated) {
      return `A payroll attendance snapshot already exists for ${month}. Open-session attendance row(s): ${lockAttendanceMeta.pendingCheckoutCount}. These rows appear as absent in the table after snapshot generation and will stay absent in payroll until attendance is corrected and the snapshot is refreshed.`;
    }
    return `Attendance cutoff is available for ${month}. You can now generate the payroll attendance snapshot. Pending checkout day(s): ${lockAttendanceMeta.pendingCheckoutCount}.`;
  }, [lockAttendanceMeta, month]);

  const hasMoreRows = Boolean(canViewAll && pagination && pagination.page < pagination.totalPages);
  const selectedCell = useMemo(() => {
    if (!selectedEmployee || !selectedDay) return null;
    return selectedEmployee.days?.[selectedDay] || null;
  }, [selectedDay, selectedEmployee]);
  const isNoOpOverride = useMemo(() => {
    if (selectedStatus === "absent") {
      return isAbsentLikeAttendance(selectedAttendanceSnapshot || selectedCell);
    }
    if (selectedStatus === "present") {
      return selectedCell?.displayStatus === "Present";
    }
    if (selectedStatus === "half_day_present") {
      return selectedCell?.displayStatus === "Half Day";
    }
    return false;
  }, [selectedAttendanceSnapshot, selectedCell, selectedStatus]);
  const activityTimeline = useMemo(
    () => buildActivityTimeline(history, selectedAttendanceSnapshot, selectedCell),
    [history, selectedAttendanceSnapshot, selectedCell]
  );

  const loadAttendanceCellDetails = useCallback(async (row: EmployeeRow, day: number) => {
    const cell = row.days?.[day] || emptyCell;
    if (cell.isFuture || cell.isWeekOff) return null;

    const date = `${month}-${String(day).padStart(2, "0")}`;
    const employeeId = toEmployeeIdString(row.employeeId);
    const endpoint = canViewAll
      ? `/timesheets/attendance/matrix/history?employeeId=${employeeId}&date=${date}`
      : `/timesheets/attendance/matrix/history/my?date=${date}`;
    const requiredPermissions = canViewAll
      ? ["ATTENDANCE_VIEW_ALL"]
      : ["ATTENDANCE_VIEW_SELF"];

    const res = await getApiWithToken(endpoint, null, { requiredPermissions });
    if (!res?.success) return null;

    return {
      history: res.data?.history || [],
      attendance: res.data?.attendance || null,
      leave: res.data?.leave || null,
      attendanceRequest: res.data?.attendanceRequest || null
    } satisfies AttendanceCellDetailPayload;
  }, [canViewAll, month]);

  const handleMatrixScroll = () => {
    const viewport = tableViewportRef.current;
    if (!viewport || loading || loadingMore || loadingMoreRef.current || !hasMoreRows) return;
    const { scrollTop, scrollHeight, clientHeight } = viewport;
    if (scrollTop <= 0 || scrollHeight <= clientHeight) return;
    const progress = (scrollTop + clientHeight) / scrollHeight;
    if (progress < 0.5) return;
    loadingMoreRef.current = true;
    setCurrentPage((prev) => {
      if (!pagination || prev >= pagination.totalPages) {
        loadingMoreRef.current = false;
        return prev;
      }
      return prev + 1;
    });
  };

  const toggleSort = (field: "employeeCode" | "firstName") => {
    if (field === "firstName" && sortBy === "employeeCode") {
      setSortBy("firstName");
      setSortOrder("asc");
      return;
    }
    if (sortBy === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(field);
    setSortOrder("asc");
  };

  const openCellDetails = async (row: EmployeeRow, day: number) => {
    const cell = row.days?.[day] || emptyCell;
    if (cell.isFuture || cell.isWeekOff) return;
    setSelectedEmployee(row);
    setSelectedDay(day);
    setSelectedStatus(cell.status === "half_day_present" ? "half_day_present" : cell.isThresholdQualified ? "present" : "absent");
    setOpen(true);
    setHistory([]);
    setSelectedAttendanceSnapshot(null);
    setSelectedLeaveDetail(null);
    setSelectedAttendanceRequestDetail(null);
    try {
      setHistoryLoading(true);
      const payload = await loadAttendanceCellDetails(row, day);
      if (payload) {
        setHistory(payload.history);
        setSelectedAttendanceSnapshot(payload.attendance);
        setSelectedLeaveDetail(payload.leave);
        setSelectedAttendanceRequestDetail(payload.attendanceRequest);
      }
    } finally {
      setHistoryLoading(false);
    }
  };

  const loadEmployeeHoverPreview = useCallback(async (row: EmployeeRow, day: number) => {
    const requestId = hoveredCellRequestRef.current + 1;
    hoveredCellRequestRef.current = requestId;
    setHoveredCellDay(day);
    setHoveredCellLoading(true);
    setHoveredCellDetails(null);

    try {
      const payload = await loadAttendanceCellDetails(row, day);
      if (hoveredCellRequestRef.current !== requestId) return;
      setHoveredCellDetails(payload);
    } finally {
      if (hoveredCellRequestRef.current === requestId) {
        setHoveredCellLoading(false);
      }
    }
  }, [loadAttendanceCellDetails]);

  const saveOverride = async () => {
    if (!selectedEmployee || !selectedDay) return;
    if (isNoOpOverride) {
      toast.info(`Attendance is already marked as ${getAttendanceOverrideLabel(selectedStatus)}`);
      return;
    }
    const date = `${month}-${String(selectedDay).padStart(2, "0")}`;
    const employeeId = toEmployeeIdString(selectedEmployee.employeeId);

    try {
      setSaving(true);
      const res = await putApiWithToken(
        `/timesheets/attendance/matrix/${employeeId}`,
        { date, status: selectedStatus },
        null,
        { requiredPermissions: ["ATTENDANCE_MANAGE"] }
      );
      if (res?.skipped) return;
      if (!res?.success) {
        toast.error(res?.message || "Failed to update attendance");
        return;
      }

      toast.success("Attendance updated");
      setOpen(false);
      await fetchMatrix();
    } finally {
      setSaving(false);
    }
  };

  const getAttendanceDateKey = (day: number) => `${month}-${String(day).padStart(2, "0")}`;

  const formatHoverInfo = (cell: DayCell, day: number) => {
    const parts: string[] = [];
    const resolvedStatus = cell.displayStatus || "Absent";
    const attendanceDateKey = cell.attendanceDateKey || getAttendanceDateKey(day);
    const isOvernightShift = Boolean(cell.isOvernightShift);
    const hideTimings = resolvedStatus === "Leave" || resolvedStatus === "Holiday";
    if (resolvedStatus !== "Absent") parts.push(`Status: ${resolvedStatus}`);
    if (isOvernightShift) {
      parts.push(`Attendance Date: ${formatDateKeyInOrgCalendar(attendanceDateKey)}`);
    }
    if (cell.excludeFromPayroll) {
      parts.push("Excluded from payroll until checkout is completed");
    }
    if (cell.payrollReconciledByLeave) {
      parts.push("Payroll inclusion reconciled by approved half-day leave");
    }
    if (cell.missedCheckout) {
      parts.push("Missed checkout flagged");
    }
    if (cell.missedCheckoutMarkedAt) {
      parts.push(`Missed checkout marked at: ${formatDateTimeInOrgTimeZone(cell.missedCheckoutMarkedAt)}`);
    }
    if (cell.isWeekOff) parts.push("Week Off");
    if (cell.holidayName) parts.push(`Holiday: ${cell.holidayName}`);
    if (!hideTimings && cell.checkInAt) {
      parts.push(`Check-in: ${isOvernightShift ? formatDateTimeInOrgTimeZone(cell.checkInAt) : formatTimeInOrgTimeZone(cell.checkInAt)}`);
    }
    if (!hideTimings && cell.checkOutAt) {
      parts.push(`Check-out: ${isOvernightShift ? formatDateTimeInOrgTimeZone(cell.checkOutAt) : formatTimeInOrgTimeZone(cell.checkOutAt)}`);
    }
    if (!hideTimings && cell.workedDuration) {
      parts.push(`Worked: ${cell.workedDuration}`);
    }
    if (!hideTimings && canViewSelfieData && (cell.checkInAt || cell.checkOutAt)) {
      const selfieParts = [];
      if (cell.checkInAt) selfieParts.push(`In ${cell.checkInSelfieProvided ? "Yes" : "No"}`);
      if (cell.checkOutAt) selfieParts.push(`Out ${cell.checkOutSelfieProvided ? "Yes" : "No"}`);
      parts.push(`Selfie: ${selfieParts.join(", ") || "No"}`);
    }
    if (!hideTimings && canViewSelfieData && (cell.checkInIp || cell.checkOutIp)) {
      const ipParts = [];
      if (cell.checkInIp) ipParts.push(`In ${cell.checkInIp}`);
      if (cell.checkOutIp) ipParts.push(`Out ${cell.checkOutIp}`);
      parts.push(`IP: ${ipParts.join(", ")}`);
    }
    if (cell.shiftName || cell.shiftCode) {
      parts.push(`Shift: ${cell.shiftName || ""}${cell.shiftCode ? ` (${cell.shiftCode})` : ""}`);
    }
    if (cell.shiftStartTime && cell.shiftEndTime) {
      parts.push(
        isOvernightShift
          ? `Shift Window: ${formatDateKeyInOrgCalendar(attendanceDateKey)} ${cell.shiftStartTime} -> ${formatDateKeyInOrgCalendar(addDaysToDateKey(attendanceDateKey, 1))} ${cell.shiftEndTime}`
          : `Shift Time: ${cell.shiftStartTime} - ${cell.shiftEndTime}`
      );
    }
    if ((cell.lateByMinutes || 0) > 0) parts.push(`Late by: ${cell.lateByMinutes} min`);
    if ((cell.earlyLoginByMinutes || 0) > 0) parts.push(`Early login by: ${cell.earlyLoginByMinutes} min`);
    if ((cell.earlyCheckoutByMinutes || 0) > 0) parts.push(`Early checkout by: ${cell.earlyCheckoutByMinutes} min`);
    if ((cell.overtimeMinutes || 0) > 0) parts.push(`Overtime: ${formatMinutesAsDuration(cell.overtimeMinutes)}`);
    if (cell.isOnLeave) {
      const sessionLabel = cell.leaveHalfDaySession === "second_half" ? "Second Half" : "First Half";
      const leaveLabel = cell.leaveDuration === "half_day"
        ? `${cell.leaveType || "Leave"} (${sessionLabel})`
        : (cell.leaveType || "Leave");
      parts.push(`Approved Leave: ${leaveLabel}`);
    }
    if (cell.overriddenBy) parts.push(`Attendance override: Set to ${cell.displayStatus || "Present"} by ${cell.overriddenBy}`);
    if (cell.overriddenAt) parts.push(`Overridden at: ${formatDateTimeInOrgTimeZone(cell.overriddenAt)}`);
    return parts.join(" | ") || "No details";
  };

  const getCellUi = (cell: DayCell) => {
    const toneClasses: Record<string, string> = {
      holiday: "bg-amber-100 text-amber-700 border-amber-300",
      week_off: "bg-sky-100 text-sky-700 border-sky-300",
      future: "bg-slate-100 text-slate-500 border-slate-200",
      leave: "bg-violet-100 text-violet-700 border-violet-300",
      absent_leave: "bg-fuchsia-100 text-fuchsia-700 border-fuchsia-300",
      present_leave: "bg-teal-100 text-teal-700 border-teal-300",
      pending_checkout: "bg-orange-100 text-orange-700 border-orange-300",
      present: "bg-emerald-100 text-emerald-700 border-emerald-300",
      half_day: "bg-lime-100 text-lime-700 border-lime-300",
      absent: "bg-rose-100 text-rose-700 border-rose-300"
    };
    return {
      label: cell.displayLabel || "Absent",
      shortLabel: cell.displayShortLabel || "A",
      className: toneClasses[cell.displayTone || "absent"] || toneClasses.absent
    };
  };

  const downloadCsv = () => {
    const header = [
      "Employee Code",
      "Employee Name",
      "Present",
      "Pending Checkout",
      "Absent",
      "Leave",
      "Week Off",
      "Holiday",
      "Excluded From Payroll",
      "Total Days"
    ];
    if (canViewSelfieData) {
      header.splice(8, 0, "Selfie");
    }
    const lines = [header.join(",")];
    filteredRows.forEach((row) => {
      const t = row.summary || {
        presentDays: 0,
        pendingCheckoutDays: 0,
        absentDays: 0,
        onLeaveDays: 0,
        weekOffDays: 0,
        holidayDays: 0,
        selfieDays: 0,
        payrollExcludedDays: 0,
        totalDays: 0
      };
      const name = `${row.firstName || ""} ${row.lastName || ""}`.trim();
      const rowData = [
        row.employeeCode || "",
        `"${name.replace(/"/g, '""')}"`,
        t.presentDays,
        t.pendingCheckoutDays,
        t.absentDays,
        t.onLeaveDays,
        t.weekOffDays,
        t.holidayDays,
        t.payrollExcludedDays,
        t.totalDays
      ];
      if (canViewSelfieData) {
        rowData.splice(8, 0, t.selfieDays);
      }
      lines.push(rowData.join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const runLockAttendance = async () => {
    if (!canEdit || !lockAttendanceMeta?.enabled || lockingAttendance) return;
    const isRefresh = Boolean(lockAttendanceMeta?.snapshotGenerated);
    const confirmed = window.confirm(
      isRefresh
        ? `Refresh the payroll snapshot for ${month} now? Open-session attendance row(s) will continue to be treated as absent in payroll until attendance is corrected and the snapshot is refreshed again.`
        : `Generate the payroll snapshot for ${month} now? Pending checkout day(s) will be treated as absent inside payroll calculations until attendance is corrected and the snapshot is refreshed.`
    );
    if (!confirmed) return;

    try {
      setLockingAttendance(true);
      const res = await postApiWithToken(
        "/timesheets/attendance/matrix/lock-month",
        { month },
        null,
        { requiredPermissions: ["ATTENDANCE_MANAGE"] }
      );
      if (res?.skipped) return;
      if (!res?.success) {
        toast.error(res?.message || "Failed to process payroll snapshot");
        return;
      }
      toast.success(
        isRefresh
          ? `Payroll attendance snapshot refreshed for ${month}.`
          : `Payroll attendance snapshot generated for ${month}.`
      );
      await refreshMatrixLatest();
    } finally {
      setLockingAttendance(false);
    }
  };

  const toggleEmployeeSelection = (employeeId: string) => {
    const normalizedEmployeeId = toEmployeeIdString(employeeId).trim();
    if (!normalizedEmployeeId) return;

    setSelectedEmployeeIds((prev) => {
      const next = normalizeEmployeeIds(prev);
      return next.includes(normalizedEmployeeId)
        ? next.filter((id) => id !== normalizedEmployeeId)
        : [...next, normalizedEmployeeId];
    });
  };

  const toggleSelectAllFiltered = () => {
    const filteredIds = normalizeEmployeeIds(filteredRows.map((r) => r.employeeId));
    const allSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedEmployeeIds.includes(id));
    if (allSelected) {
      setSelectedEmployeeIds((prev) => normalizeEmployeeIds(prev).filter((id) => !filteredIds.includes(id)));
    } else {
      setSelectedEmployeeIds((prev) => normalizeEmployeeIds([...prev, ...filteredIds]));
    }
  };

  const runBulkUpdate = async () => {
    if (!canEdit) return;
    const employeeIds = normalizeEmployeeIds(selectedEmployeeIds);
    if (!bulkStartDate || !bulkEndDate || employeeIds.length === 0) {
      toast.error("Select employees and a date range for bulk update");
      return;
    }
    const start = new Date(`${bulkStartDate}T00:00:00`);
    const end = new Date(`${bulkEndDate}T00:00:00`);
    const dayCount = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
    if (dayCount < 1 || dayCount > 30) {
      toast.error("Select a date range of 1 to 30 days");
      return;
    }
    try {
      setBulkSaving(true);
      const res = await postApiWithToken(
        "/timesheets/attendance/matrix/bulk",
        {
          employeeIds,
          startDate: bulkStartDate,
          endDate: bulkEndDate,
          includeNonWorkingDays: bulkIncludeNonWorkingDays,
          status: bulkStatus
        },
        null,
        { requiredPermissions: ["ATTENDANCE_MANAGE"] }
      );
      if (res?.skipped) return;
      if (!res?.success) {
        toast.error(res?.message || "Bulk update failed");
        return;
      }
      toast.success(
        `Updated ${res.data?.updatedCount || 0} attendance record(s); skipped ${res.data?.skippedCount || 0} protected day(s)`
      );
      setSelectedEmployeeIds([]);
      await refreshMatrixLatest();
    } finally {
      setBulkSaving(false);
    }
  };

  const openCustomBulkUpdate = () => {
    const employeeIds = normalizeEmployeeIds(selectedEmployeeIds);
    if (employeeIds.length === 0) {
      toast.error("Select employees before opening customized update");
      return;
    }
    const selectedRows = filteredRows.filter((row) => employeeIds.includes(row.employeeId));
    const initialValues: Record<string, boolean> = {};
    selectedRows.forEach((row) => {
        for (let day = 1; day <= daysInMonth; day += 1) {
          const cell = row.days?.[day];
          const status = cell?.status;
          const displayStatus = cell?.displayStatus;
          initialValues[`${row.employeeId}:${day}`] =
            status === "present"
            || status === "full_day_present"
            || status === "half_day_present"
            || displayStatus === "Present"
            || displayStatus === "Half Day"
            || displayStatus === "Present + Leave"
            || Boolean(cell?.isThresholdQualified);
        }
      });
    const editableDays = Array.from({ length: daysInMonth }, (_, index) => index + 1)
      .filter((day) =>
        bulkIncludeNonWorkingDays
        || selectedRows.some((row) => {
          const cell = row.days?.[day];
          return !cell?.holidayName && !cell?.isWeekOff && !cell?.isOnLeave;
        })
      )
      .slice(0, 30);
    setCustomBulkDays(editableDays);
    setCustomBulkValues(initialValues);
    setCustomBulkOriginalValues(initialValues);
    setCustomBulkOpen(true);
  };

  const saveCustomBulkUpdate = async () => {
    const selectedRows = filteredRows.filter((row) => selectedEmployeeIds.includes(row.employeeId));
    if (customBulkDays.length === 0) {
      toast.error("Select at least one date");
      return;
    }
    const updates = selectedRows.flatMap((row) =>
      customBulkDays
        .filter((day) => {
          const key = `${row.employeeId}:${day}`;
          return Boolean(customBulkValues[key]) !== Boolean(customBulkOriginalValues[key]);
        })
        .map((day) => ({
          employeeId: row.employeeId,
          date: `${month}-${String(day).padStart(2, "0")}`,
          status: customBulkValues[`${row.employeeId}:${day}`] ? "present" : "absent"
        }))
    );
    if (updates.length === 0) {
      toast.error("No attendance changes to save");
      return;
    }
    try {
      setCustomBulkSaving(true);
      const res = await postApiWithToken(
        "/timesheets/attendance/matrix/custom-bulk",
        { updates, includeNonWorkingDays: bulkIncludeNonWorkingDays },
        null,
        { requiredPermissions: ["ATTENDANCE_MANAGE"] }
      );
      if (res?.skipped) return;
      if (!res?.success) {
        toast.error(res?.message || "Customized update failed");
        return;
      }
      toast.success(
        `Updated ${res.data?.updatedCount || 0} attendance record(s); skipped ${res.data?.skippedCount || 0} protected day(s)`
      );
      setCustomBulkOpen(false);
      setSelectedEmployeeIds([]);
      await refreshMatrixLatest();
    } finally {
      setCustomBulkSaving(false);
    }
  };

  const isEmployeeOnlyView = canViewSelf && !canViewAll;
  const selfRow = isEmployeeOnlyView ? (rows?.[0] || null) : null;
  const monthStart = new Date(`${month}-01T00:00:00`);
  const firstDayOffset = Number.isNaN(monthStart.getTime()) ? 0 : monthStart.getDay();
  const calendarSlots = Array.from(
    { length: firstDayOffset + daysInMonth },
    (_, idx) => (idx < firstDayOffset ? null : idx - firstDayOffset + 1)
  );
  const weekDayHeaders = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const summaryColumnCount = canViewSelfieData ? 8 : 7;
  const loadingRowCount = 6;

  const renderMonthSelector = (tone: "soft" | "bright" = "soft") => {
    const wrapperClassName =
      tone === "bright"
        ? "flex w-full sm:w-auto items-center gap-2 rounded-2xl border border-slate-200/80 bg-gradient-to-r from-white via-slate-50 to-sky-50 px-3 py-2 shadow-sm"
        : "flex w-full sm:w-auto items-center gap-2 rounded-2xl border border-slate-200 bg-gradient-to-r from-white via-white to-slate-50 px-3 py-2 shadow-sm";
    const selectClassName =
      tone === "bright"
        ? "border-0 bg-white/80 shadow-none focus:ring-0"
        : "border-0 bg-white shadow-none focus:ring-0";

    return (
      <div className={wrapperClassName}>
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white shadow-sm">
          <CalendarDays className="h-4 w-4" />
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <Select value={selectedMonth} onValueChange={(value) => updateMonthFilter(selectedYear, value)}>
            <SelectTrigger className={`w-[138px] ${selectClassName}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {monthOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={selectedYear} onValueChange={(value) => updateMonthFilter(value, selectedMonth)}>
            <SelectTrigger className={`w-[92px] ${selectClassName}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {yearOptions.map((year) => (
                <SelectItem key={year} value={year}>
                  {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  };

  return (
    <MainLayout
      title="Attendance"
      breadcrumb={[{ label: "Home", href: "/" }, { label: "Attendance" }]}
    >
      {!canView && (
        <div className="bg-card rounded-xl card-shadow p-6 text-sm text-muted-foreground">
          You do not have permission to view attendance.
        </div>
      )}

      {canView && (
        <>
          <div className="text-xs text-muted-foreground">
            Tip: Hover any day cell to view check-in/out, shift, late/early, leave, holiday and override details.
                <p className="text-sm text-slate-600 text-right">
                  {canEdit ? "Click any day cell to override attendance." : "Read-only view."}
                </p>
          </div>

          {isEmployeeOnlyView ? (
            <>
              <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-blue-50 p-4 sm:p-5 mb-4">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-slate-500">My Attendance Calendar</p>
                    <h3 className="text-lg font-semibold tracking-tight text-slate-900">
                      {selfRow ? `${selfRow.firstName || ""} ${selfRow.lastName || ""}`.trim() : "Attendance"}
                    </h3>
                  </div>
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    {renderMonthSelector("soft")}
                    <Button variant="outline" onClick={fetchMatrix}>
                      Refresh
                    </Button>
                  </div>
                </div>
              </div>

              {loading && (
                <div className="bg-card rounded-xl border p-5 space-y-3">
                  <Skeleton className="h-8 w-48 rounded-md" />
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <Skeleton className="h-20 w-full rounded-xl" />
                    <Skeleton className="h-20 w-full rounded-xl" />
                    <Skeleton className="h-20 w-full rounded-xl" />
                    <Skeleton className="h-20 w-full rounded-xl" />
                  </div>
                  <Skeleton className="h-72 w-full rounded-xl" />
                </div>
              )}

              {!loading && !selfRow && (
                <div className="bg-card rounded-xl border p-8 text-sm text-muted-foreground">
                  No attendance data found.
                </div>
              )}

              {!loading && selfRow && (
                <>
                  <div className="rounded-2xl border border-slate-200 bg-white card-shadow p-3 sm:p-4">
                    <div className="grid grid-cols-7 gap-2 mb-2">
                      {weekDayHeaders.map((day) => (
                        <div key={day} className="text-[11px] sm:text-xs text-center font-medium text-slate-500 py-1">
                          {day}
                        </div>
                      ))}
                    </div>

                    <div className="grid grid-cols-7 gap-2">
                      {calendarSlots.map((day, idx) => {
                        if (!day) {
                          return <div key={`blank-${idx}`} className="h-[86px] sm:h-[96px] rounded-xl bg-slate-50/60 border border-slate-100" />;
                        }
                        const cell = selfRow.days?.[day] || emptyCell;
                        const isFuture = Boolean(cell.isFuture);
                        const cellUi = getCellUi(cell);
                        const hasAttendance = isPresentLikeStatus(cell.status) || cell.status === "pending_checkout";
                        const isLeaveOnlyDay = Boolean(cell.isOnLeave) && !hasAttendance;
                        const hideTimings = isLeaveOnlyDay || Boolean(cell.holidayName) || cell.isWeekOff;
                        const isOvernightShift = Boolean(cell.isOvernightShift);
                        const attendanceDateKey = cell.attendanceDateKey || getAttendanceDateKey(day);
                        const hoverTimeline =
                          hoveredCellDay === day && hoveredCellDetails
                            ? buildActivityTimeline(hoveredCellDetails.history, hoveredCellDetails.attendance, cell)
                            : [];
                        return (
                          <HoverCard
                            key={day}
                            openDelay={120}
                            closeDelay={80}
                            onOpenChange={(openState) => {
                              if (openState) {
                                void loadEmployeeHoverPreview(selfRow, day);
                                return;
                              }
                              if (hoveredCellDay === day) {
                                setHoveredCellDay(null);
                                setHoveredCellLoading(false);
                                setHoveredCellDetails(null);
                              }
                            }}
                          >
                            <HoverCardTrigger asChild>
                              <button
                                type="button"
                                onClick={() => !isFuture && openCellDetails(selfRow, day)}
                                className={`h-[86px] sm:h-[96px] w-full rounded-xl border p-2 text-left transition-all duration-200 ${cellUi.className} ${isFuture ? "opacity-60 cursor-default" : "hover:-translate-y-0.5 hover:shadow-sm"}`}
                                disabled={isFuture}
                              >
                                <div className="flex items-center justify-between">
                                  <span className="text-[11px] sm:text-xs font-semibold">{String(day).padStart(2, "0")}</span>
                                  <span className="text-[10px] sm:text-[11px] font-semibold">{cellUi.shortLabel}</span>
                                </div>
                                <div className="mt-2 text-[10px] sm:text-[11px] leading-4 opacity-90">
                                  {hideTimings ? (
                                    <p>
                                      {cell.holidayName
                                        ? `Holiday: ${cell.holidayName}`
                                        : cell.isWeekOff
                                          ? "Week Off"
                                        : `Leave: ${cell.leaveType || "Approved leave"}`}
                                    </p>
                                  ) : (
                                    <>
                                      <p>{cell.checkInAt ? `In ${formatTimeInOrgTimeZone(cell.checkInAt)}` : "No check-in"}</p>
                                      <p>{cell.checkOutAt ? `Out ${formatTimeInOrgTimeZone(cell.checkOutAt)}` : "No check-out"}</p>
                                    </>
                                  )}
                                {cell.isOnLeave && (
                                  <p className="text-violet-700">
                                    Approved leave: {cell.leaveType || "Leave"}
                                  </p>
                                )}
                                  {cell.overriddenBy && (
                                    <p className="text-slate-600">
                                      Attendance override: {cell.displayStatus || "Present"}
                                  </p>
                                )}
                              </div>
                            </button>
                          </HoverCardTrigger>
                          <HoverCardContent className="w-72">
                              <div className="space-y-2">
                                <p className="text-sm font-semibold">{month}-{String(day).padStart(2, "0")} • {cellUi.label}</p>
                                {isOvernightShift && (
                                  <p className="text-xs text-slate-700">
                                    Attendance Date: {formatDateKeyInOrgCalendar(attendanceDateKey)}
                                  </p>
                                )}
                                {!hideTimings && (
                                  <>
                                    <p className="text-xs text-muted-foreground">
                                      Check-in: {cell.checkInAt
                                        ? (isOvernightShift
                                          ? formatDateTimeInOrgTimeZone(cell.checkInAt)
                                          : formatTimeInOrgTimeZone(cell.checkInAt))
                                        : "Not recorded"}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      Check-out: {cell.checkOutAt
                                        ? (isOvernightShift
                                          ? formatDateTimeInOrgTimeZone(cell.checkOutAt)
                                          : formatTimeInOrgTimeZone(cell.checkOutAt))
                                        : "Not recorded"}
                                    </p>
                                    {cell.workedDuration && (
                                      <p className="text-xs text-muted-foreground">
                                        Worked: {cell.workedDuration}
                                      </p>
                                    )}
                                    {canViewSelfieData && (
                                      <>
                                        <p className="text-xs text-muted-foreground">
                                          Selfie: In {cell.checkInSelfieProvided ? "Yes" : "No"}
                                          {cell.checkOutAt ? ` / Out ${cell.checkOutSelfieProvided ? "Yes" : "No"}` : ""}
                                        </p>
                                        {cell.checkInIp && (
                                          <p className="text-xs text-muted-foreground">
                                            Check-in IP: {cell.checkInIp}
                                          </p>
                                        )}
                                        {cell.checkOutIp && (
                                          <p className="text-xs text-muted-foreground">
                                            Check-out IP: {cell.checkOutIp}
                                          </p>
                                        )}
                                      </>
                                    )}
                                  </>
                                )}
                                {(cell.shiftName || cell.shiftCode) && (
                                  <p className="text-xs text-muted-foreground">
                                    Shift: {cell.shiftName || "Shift"}{cell.shiftCode ? ` (${cell.shiftCode})` : ""}
                                  </p>
                                )}
                                {cell.shiftStartTime && cell.shiftEndTime && (
                                  <p className="text-xs text-muted-foreground">
                                    {isOvernightShift
                                      ? `Shift Window: ${formatDateKeyInOrgCalendar(attendanceDateKey)} ${cell.shiftStartTime} -> ${formatDateKeyInOrgCalendar(addDaysToDateKey(attendanceDateKey, 1))} ${cell.shiftEndTime}`
                                      : `Shift Time: ${cell.shiftStartTime} - ${cell.shiftEndTime}`}
                                  </p>
                                )}
                                {cell.holidayName && (
                                  <p className="text-xs text-amber-700">Holiday: {cell.holidayName}</p>
                                )}
                                {cell.isOnLeave && (
                                  <p className="text-xs text-violet-700">
                                    Leave: {cell.leaveType || "Approved leave"}
                                  </p>
                                )}
                                {(cell.lateByMinutes || 0) > 0 && (
                                  <p className="text-xs text-rose-700">Late by {cell.lateByMinutes} min</p>
                                )}
                                <div className="rounded-md border border-slate-100 bg-slate-50 p-2">
                                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                                    Day history
                                  </p>
                                  {hoveredCellLoading && hoveredCellDay === day ? (
                                    <p className="mt-1 text-xs text-muted-foreground">Loading history...</p>
                                  ) : hoverTimeline.length ? (
                                    <div className="mt-1 space-y-1.5">
                                      {hoverTimeline.slice(0, 3).map((item, index) => (
                                        <p key={`${item.createdAt}-${index}`} className="text-xs text-slate-600">
                                          {formatDateTimeInOrgTimeZone(item.createdAt)} - {formatActivityAction(item)} by {item.actor}
                                        </p>
                                      ))}
                                      {hoverTimeline.length > 3 && (
                                        <p className="text-[11px] text-slate-500">
                                          + {hoverTimeline.length - 3} more event{hoverTimeline.length - 3 === 1 ? "" : "s"}
                                        </p>
                                      )}
                                    </div>
                                  ) : (
                                    <p className="mt-1 text-xs text-muted-foreground">No history found for this date.</p>
                                  )}
                                  <p className="mt-2 text-[11px] text-slate-500">Click the date to open full details.</p>
                                </div>
                              </div>
                            </HoverCardContent>
                          </HoverCard>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <div className="rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white via-slate-50 to-sky-50 p-4 sm:p-5 mb-4 shadow-sm">
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                    <div className="w-full lg:w-auto">
                      {canEdit && (
                        <Button
                          variant="outline"
                          className="h-12 w-full bg-white/90 sm:w-auto"
                          onClick={() => setShowBulkControls((prev) => !prev)}
                        >
                          {showBulkControls ? "Hide Bulk Update" : "Show Bulk Update"}
                        </Button>
                      )}
                    </div>
                    <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(320px,auto)_minmax(240px,1fr)_auto_auto_auto] xl:items-center">
                      <div className="min-w-0">
                        {renderMonthSelector("bright")}
                      </div>
                      <Input
                        placeholder="Search employee..."
                        value={search}
                        onChange={(e) => {
                          const value = e.target.value;
                          setSearch(value);
                          setSearchTerm(value);
                        }}
                        className="h-12 w-full bg-white/90"
                      />
                    <Button variant="outline" className="h-12 bg-white/90" onClick={refreshMatrixLatest}>
                      Refresh
                    </Button>
                      {canEdit && (
                        <Button
                          className="h-12 bg-slate-900 text-white hover:bg-slate-800"
                          onClick={runLockAttendance}
                          disabled={!lockAttendanceMeta?.enabled || lockingAttendance}
                          title={lockAttendanceMeta?.reason || undefined}
                        >
                          {lockAttendanceButtonLabel}
                        </Button>
                      )}
                      <Button variant="outline" className="h-12 bg-white/90" onClick={downloadCsv}>
                        Export CSV
                      </Button>
                    </div>
                  </div>
                </div>
                {canEdit && lockAttendanceMeta && (
                  <div className="mt-3 text-xs text-slate-600">
                    {lockAttendanceHelperText}
                  </div>
                )}

                {canEdit && (
                  <div
                    className={`mt-4 overflow-hidden transition-all duration-500 ease-out ${
                      showBulkControls ? "max-h-64 opacity-100 translate-y-0" : "max-h-0 opacity-0 -translate-y-1"
                    }`}
                  >
                    {showBulkControls && (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(220px,auto)_minmax(170px,200px)_minmax(170px,200px)_minmax(150px,180px)_auto] xl:items-end">
                        <Button variant="outline" className="bg-white/90" onClick={toggleSelectAllFiltered}>
                          Select/Unselect Filtered ({selectedEmployeeIds.length})
                        </Button>
                        <div>
                          <label className="mb-1 block text-xs text-slate-600">From</label>
                          <Input
                            type="date"
                            value={bulkStartDate}
                            onChange={(e) => setBulkStartDate(e.target.value)}
                            className="h-12 w-full bg-white/90"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-slate-600">To (max 30 days)</label>
                          <Input
                            type="date"
                            value={bulkEndDate}
                            min={bulkStartDate || undefined}
                            onChange={(e) => setBulkEndDate(e.target.value)}
                            className="h-12 w-full bg-white/90"
                          />
                        </div>
                        <Select value={bulkStatus} onValueChange={(v) => setBulkStatus(v as AttendanceOverrideStatus)}>
                          <SelectTrigger className="h-12 w-full bg-white/90">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="present">Present</SelectItem>
                            <SelectItem value="half_day_present">Half Day</SelectItem>
                            <SelectItem value="absent">Absent</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button className="h-12" onClick={runBulkUpdate} disabled={bulkSaving}>
                          {bulkSaving ? "Updating..." : "Bulk Update"}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-12 bg-white/90 xl:col-start-5"
                          onClick={openCustomBulkUpdate}
                        >
                          Customized Update
                        </Button>
                        <label className="flex items-center gap-2 text-sm text-slate-700 xl:col-span-4">
                          <input
                            type="checkbox"
                            checked={bulkIncludeNonWorkingDays}
                            onChange={(e) => setBulkIncludeNonWorkingDays(e.target.checked)}
                            className="h-4 w-4 rounded border-slate-300"
                          />
                          Also mark holidays, week-offs, and approved leave days
                        </label>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white/95 shadow-sm overflow-hidden flex flex-col min-h-0 lg:h-[calc(100vh-290px)]">
                <div className="border-b border-slate-200 bg-slate-50/70 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <div className="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1">
                      <span className="inline-block h-2.5 w-2.5 rounded bg-emerald-500" />
                      Full Day Present
                    </div>
                    <div className="flex items-center gap-2 rounded-full border border-lime-200 bg-lime-50 px-3 py-1">
                      <span className="inline-block h-2.5 w-2.5 rounded bg-lime-500" />
                      Half Day Present
                    </div>
                    <div className="flex items-center gap-2 rounded-full border border-orange-200 bg-orange-50 px-3 py-1">
                      <span className="inline-block h-2.5 w-2.5 rounded bg-orange-500" />
                      Pending Checkout
                    </div>
                    <div className="flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-3 py-1">
                      <span className="inline-block h-2.5 w-2.5 rounded bg-rose-500" />
                      Absent
                    </div>
                    <div className="flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1">
                      <span className="inline-block h-2.5 w-2.5 rounded bg-sky-500" />
                      Week Off
                    </div>
                    <div className="flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-3 py-1">
                      <span className="inline-block h-2.5 w-2.5 rounded bg-violet-500" />
                      Approved Leave
                    </div>
                    <div className="flex items-center gap-2 rounded-full border border-teal-200 bg-teal-50 px-3 py-1">
                      <span className="inline-block h-2.5 w-2.5 rounded bg-teal-500" />
                      Present + Leave
                    </div>
                    <div className="flex items-center gap-2 rounded-full border border-fuchsia-200 bg-fuchsia-50 px-3 py-1">
                      <span className="inline-block h-2.5 w-2.5 rounded bg-fuchsia-500" />
                      Absent + Leave
                    </div>
                    <div className="flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1">
                      <span className="inline-block h-2.5 w-2.5 rounded bg-amber-500" />
                      Holiday
                    </div>
                  </div>
                </div>
                <div
                  ref={tableViewportRef}
                  onScroll={handleMatrixScroll}
                  className="min-h-0 flex-1 overflow-y-auto overflow-x-auto"
                >
                  <table className="w-full border-collapse min-w-[1100px]">
                  <thead>
                    <tr className="border-b border-slate-200">
                      {canEdit && (
                        <th className="sticky left-0 top-0 bg-white/95 backdrop-blur text-left p-3 min-w-[48px] z-30 text-slate-600">
                          Sel
                        </th>
                      )}
                      <th className={`sticky ${canEdit ? "left-[48px]" : "left-0"} top-0 bg-white/95 backdrop-blur text-left p-3 min-w-[220px] z-30 text-slate-700`}>
                        <button
                          type="button"
                          onClick={() => toggleSort("firstName")}
                          className="inline-flex items-center gap-1 font-semibold"
                          title="Default sort is employee ID. Click to sort by employee name."
                        >
                          <span>Employee</span>
                          <ArrowUpDown className={`h-3.5 w-3.5 ${sortBy === "employeeCode" || sortBy === "firstName" ? "opacity-100" : "opacity-40"}`} />
                        </button>
                        <div className="text-[11px] font-normal text-slate-500">
                          Sorted by {sortBy === "employeeCode" ? "Employee ID" : "Employee Name"} ({sortOrder})
                        </div>
                      </th>
                      {Array.from({ length: daysInMonth }).map((_, idx) => (
                        <th key={idx + 1} className="sticky top-0 bg-white/95 backdrop-blur z-20 text-center p-2 text-sm text-slate-500 min-w-[42px]">
                          {idx + 1}
                        </th>
                      ))}
                      <th className="sticky top-0 bg-white/95 backdrop-blur z-20 text-center p-2 text-sm text-slate-500 min-w-[90px]">
                        Present
                      </th>
                      <th className="sticky top-0 bg-white/95 backdrop-blur z-20 text-center p-2 text-sm text-slate-500 min-w-[120px]">
                        Pending Checkout
                      </th>
                      <th className="sticky top-0 bg-white/95 backdrop-blur z-20 text-center p-2 text-sm text-slate-500 min-w-[90px]">
                        Absent
                      </th>
                      <th className="sticky top-0 bg-white/95 backdrop-blur z-20 text-center p-2 text-sm text-slate-500 min-w-[120px]">
                        Leave
                      </th>
                      <th className="sticky top-0 bg-white/95 backdrop-blur z-20 text-center p-2 text-sm text-slate-500 min-w-[90px]">
                        Week Off
                      </th>
                      <th className="sticky top-0 bg-white/95 backdrop-blur z-20 text-center p-2 text-sm text-slate-500 min-w-[90px]">
                        Holiday
                      </th>
                      {canViewSelfieData && (
                        <th className="sticky top-0 bg-white/95 backdrop-blur z-20 text-center p-2 text-sm text-slate-500 min-w-[90px]">
                          Selfie
                        </th>
                      )}
                      <th className="sticky top-0 bg-white/95 backdrop-blur z-20 text-center p-2 text-sm text-slate-500 min-w-[90px]">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading && rows.length === 0 && (
                      <tr>
                        <td colSpan={daysInMonth + summaryColumnCount + (canEdit ? 1 : 0)} className="p-3">
                          <div className="space-y-2">
                            {Array.from({ length: loadingRowCount }).map((_, idx) => (
                              <Skeleton key={`attendance-row-skeleton-${idx}`} className="h-10 w-full rounded-md" />
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                    {!loading && filteredRows.length === 0 && (
                      <tr>
                        <td colSpan={daysInMonth + summaryColumnCount + (canEdit ? 1 : 0)} className="p-4 text-muted-foreground">
                          No employees found.
                        </td>
                      </tr>
                    )}
                    {visibleRows.map((row) => (
                      <tr key={row.employeeId} className="border-b border-slate-100 hover:bg-slate-50/55 transition-colors">
                        {canEdit && (
                          <td className="sticky left-0 bg-white p-2 z-20 text-center">
                            <input
                              type="checkbox"
                              checked={selectedEmployeeIds.includes(row.employeeId)}
                              onChange={() => toggleEmployeeSelection(row.employeeId)}
                            />
                          </td>
                        )}
                        <td className={`sticky ${canEdit ? "left-[48px]" : "left-0"} bg-white p-3 z-10`}>
                          <div className="font-medium">
                            {`${row.firstName || ""} ${row.lastName || ""}`.trim() || "-"}
                          </div>
                          <div className="text-xs text-muted-foreground">{row.employeeCode || "-"}</div>
                        </td>
                        {Array.from({ length: daysInMonth }).map((_, idx) => {
                          const day = idx + 1;
                          const cell = row.days?.[day] || emptyCell;
                          const isFuture = Boolean(cell.isFuture);
                          const isNonInteractive = isFuture || cell.isWeekOff;
                          const cellUi = getCellUi(cell);

                          return (
                            <td key={day} className="p-1">
                              <button
                                type="button"
                                onClick={() => !isNonInteractive && openCellDetails(row, day)}
                                disabled={isNonInteractive}
                                title={formatHoverInfo(cell, day)}
                                className={`w-full h-8 rounded-md text-xs font-semibold border transition-all duration-200 ${cellUi.className} ${
                                  isNonInteractive ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:opacity-95 hover:-translate-y-[1px] hover:shadow-sm"
                                }`}
                              >
                                {cellUi.shortLabel}
                              </button>
                            </td>
                          );
                        })}
                        {(() => {
                          const totals = row.summary || {
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
                          const leaveBreakdown = [
                            `Paid ${totals.paidLeaveDays.toFixed(1)}`,
                            `Unpaid ${totals.unpaidLeaveDays.toFixed(1)}`
                          ].join(" · ");
                          return (
                            <>
                              <td className="text-center text-sm font-medium text-emerald-700">
                                {totals.presentDays.toFixed(1)}
                              </td>
                              <td className="text-center text-sm font-medium text-orange-700">
                                {totals.pendingCheckoutDays}
                              </td>
                              <td className="text-center text-sm font-medium text-rose-700">
                                {totals.absentDays.toFixed(1)}
                              </td>
                              <td className="text-center text-sm font-medium text-violet-700">
                                <HoverCard openDelay={120} closeDelay={80}>
                                  <HoverCardTrigger asChild>
                                    <button
                                      type="button"
                                      className="inline-flex cursor-help items-center rounded px-1 py-0.5 transition-colors hover:bg-violet-50 focus:outline-none focus:ring-2 focus:ring-violet-300"
                                    >
                                      {totals.onLeaveDays.toFixed(1)}
                                    </button>
                                  </HoverCardTrigger>
                                  <HoverCardContent className="w-48">
                                    <div className="space-y-1 text-left">
                                      <p className="text-sm font-semibold text-slate-900">Leave breakdown</p>
                                      <p className="text-xs text-slate-600">{leaveBreakdown}</p>
                                    </div>
                                  </HoverCardContent>
                                </HoverCard>
                              </td>
                              <td className="text-center text-sm font-medium text-sky-700">
                                {totals.weekOffDays}
                              </td>
                              <td className="text-center text-sm font-medium text-amber-700">
                                {totals.holidayDays}
                              </td>
                              {canViewSelfieData && (
                                <td className="text-center text-sm font-medium text-slate-700">
                                  {totals.selfieDays}
                                </td>
                              )}
                              <td className="text-center text-sm font-medium">
                                {totals.totalDays}
                              </td>
                            </>
                          );
                        })()}
                      </tr>
                    ))}
                    {loadingMore && rows.length > 0 && (
                      <>
                        {Array.from({ length: 3 }).map((_, idx) => (
                          <tr key={`attendance-loading-more-${idx}`} className="border-b border-slate-100">
                            <td colSpan={daysInMonth + summaryColumnCount + (canEdit ? 1 : 0)} className="p-3">
                              <Skeleton className="h-10 w-full rounded-md" />
                            </td>
                          </tr>
                        ))}
                      </>
                    )}
                  </tbody>
                  </table>
                </div>
              </div>

              {canViewAll && pagination && (
                <div className="border-t border-slate-200 px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <span>
                      Showing {rows.length} of {pagination.total}
                    </span>
                    <Select
                      value={String(pageSize)}
                      onValueChange={(value) => setPageSize(Number(value))}
                    >
                      <SelectTrigger className="h-8 w-[120px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="10">10 rows</SelectItem>
                        <SelectItem value="20">20 rows</SelectItem>
                        <SelectItem value="30">30 rows</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {loadingMore
                      ? "Loading more attendance rows..."
                      : hasMoreRows
                        ? "Scroll past 50% to load more"
                        : "You have reached the end"}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      <Dialog open={customBulkOpen} onOpenChange={setCustomBulkOpen}>
        <DialogContent className="max-w-6xl gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b bg-white px-6 py-5">
            <DialogTitle className="text-xl">Customized Attendance Update</DialogTitle>
            <p className="pt-1 text-sm text-muted-foreground">
              Choose up to 30 dates. Checked cells will be marked Present; blank cells will be marked Absent.
            </p>
          </DialogHeader>
          <div className="max-h-[70vh] space-y-4 overflow-auto bg-slate-50/60 px-6 py-5">
            <section className="rounded-lg border bg-white p-4">
              <p className="mb-3 text-sm font-semibold text-slate-800">1. Select dates in {month}</p>
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: daysInMonth }).map((_, index) => {
                  const day = index + 1;
                  const selected = customBulkDays.includes(day);
                  const selectedRows = filteredRows.filter((row) => selectedEmployeeIds.includes(row.employeeId));
                  const protectedForAll = !bulkIncludeNonWorkingDays
                    && selectedRows.length > 0
                    && selectedRows.every((row) => {
                      const cell = row.days?.[day];
                      return Boolean(cell?.holidayName || cell?.isWeekOff || cell?.isOnLeave);
                    });
                  return (
                    <label
                      key={day}
                      title={protectedForAll ? "Holiday, week-off, or approved leave for all selected employees" : undefined}
                      className={`flex h-9 min-w-10 items-center justify-center gap-1 rounded-md border px-2 text-sm ${
                        protectedForAll
                          ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                          : selected
                            ? "cursor-pointer border-blue-500 bg-blue-50 text-blue-700"
                            : "cursor-pointer bg-white text-slate-600"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={protectedForAll}
                        onChange={() => {
                          setCustomBulkDays((current) => {
                            if (current.includes(day)) return current.filter((value) => value !== day);
                            if (current.length >= 30) {
                              toast.error("You can select at most 30 dates");
                              return current;
                            }
                            return [...current, day].sort((a, b) => a - b);
                          });
                        }}
                        className="sr-only"
                      />
                      {day}
                    </label>
                  );
                })}
              </div>
            </section>

            <section className="rounded-lg border bg-white">
              <div className="border-b px-4 py-3 text-sm text-slate-600">
                2. Edit like a spreadsheet. ✓ Present · blank Absent
                {!bulkIncludeNonWorkingDays && " · Holidays, week-offs, and approved leave will be skipped"}
              </div>
              {customBulkDays.length === 0 ? (
                <p className="p-8 text-center text-sm text-muted-foreground">Select dates to display the editor.</p>
              ) : (
                <div className="overflow-auto">
                  <table className="w-full min-w-max border-collapse">
                    <thead>
                      <tr className="bg-slate-50">
                        <th className="sticky left-0 z-10 min-w-56 border-b border-r bg-slate-50 p-3 text-left text-sm">
                          Employee
                        </th>
                        {customBulkDays.map((day) => (
                          <th key={day} className="min-w-16 border-b border-r p-2 text-center text-sm">
                            {day}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRows
                        .filter((row) => selectedEmployeeIds.includes(row.employeeId))
                        .map((row) => (
                          <tr key={row.employeeId}>
                            <td className="sticky left-0 z-10 border-b border-r bg-white p-3">
                              <div className="text-sm font-medium">
                                {`${row.firstName || ""} ${row.lastName || ""}`.trim()}
                              </div>
                              <div className="text-xs text-muted-foreground">{row.employeeCode}</div>
                            </td>
                            {customBulkDays.map((day) => {
                              const key = `${row.employeeId}:${day}`;
                              const checked = Boolean(customBulkValues[key]);
                              const cell = row.days?.[day];
                              const protectedLabel = cell?.holidayName
                                ? "Holiday"
                                : cell?.isWeekOff
                                  ? "Week Off"
                                  : cell?.isOnLeave
                                    ? (cell.leaveType || "Leave")
                                    : null;
                              const protectedDay = Boolean(protectedLabel) && !bulkIncludeNonWorkingDays;
                              return (
                                <td
                                  key={day}
                                  className={`border-b border-r p-2 text-center ${
                                    protectedDay
                                      ? "bg-sky-50"
                                      : checked
                                        ? "bg-emerald-50"
                                        : "bg-rose-50/40"
                                  }`}
                                >
                                  <div className="flex min-w-12 flex-col items-center gap-1">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      disabled={protectedDay}
                                      onChange={(event) =>
                                        setCustomBulkValues((current) => ({
                                          ...current,
                                          [key]: event.target.checked
                                        }))
                                      }
                                      className="h-5 w-5 cursor-pointer accent-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
                                      aria-label={`${row.firstName} day ${day}`}
                                    />
                                    {protectedLabel && (
                                      <span className="max-w-16 truncate text-[10px] font-medium text-sky-700" title={protectedLabel}>
                                        {protectedLabel}
                                      </span>
                                    )}
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
          <DialogFooter className="border-t bg-white px-6 py-4">
            <Button variant="outline" onClick={() => setCustomBulkOpen(false)} disabled={customBulkSaving}>
              Cancel
            </Button>
            <Button onClick={saveCustomBulkUpdate} disabled={customBulkSaving || customBulkDays.length === 0}>
              {customBulkSaving ? "Saving..." : "Save Customized Attendance"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b bg-white px-6 py-5">
            <DialogTitle className="text-xl">{canEdit ? "Update Attendance" : "Attendance Details"}</DialogTitle>
            <p className="pt-1 text-sm text-muted-foreground">
              {selectedEmployee
                ? `${selectedEmployee.firstName} ${selectedEmployee.lastName} - ${month}-${String(selectedDay || 1).padStart(2, "0")}`
                : ""}
            </p>
          </DialogHeader>
          <div className="max-h-[68vh] space-y-4 overflow-y-auto bg-slate-50/60 px-6 py-5">
            {canEdit && (
              <div className="rounded-lg border bg-white p-4 shadow-sm">
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Attendance Status
                </label>
                <Select
                  value={selectedStatus}
                  onValueChange={(v) => setSelectedStatus(v as AttendanceOverrideStatus)}
                >
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="present">Present</SelectItem>
                    <SelectItem value="half_day_present">Half Day</SelectItem>
                    <SelectItem value="absent">Absent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-4">
              {canViewSelfieData && selectedAttendanceSnapshot && (
                <section className="rounded-lg border bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-emerald-600" />
                    <h3 className="text-sm font-semibold text-slate-900">Selfie Verification</h3>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="overflow-hidden rounded-lg border bg-slate-50">
                      <div className="flex items-center justify-between border-b bg-white px-3 py-2">
                        <span className="text-sm font-medium text-slate-800">Check-in</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          selectedAttendanceSnapshot.checkInSelfieProvided
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-100 text-slate-600"
                        }`}>
                          {selectedAttendanceSnapshot.checkInSelfieProvided ? "Captured" : "Not captured"}
                        </span>
                      </div>
                      {selectedAttendanceSnapshot.checkInSelfieImage ? (
                        <img
                          src={selectedAttendanceSnapshot.checkInSelfieImage}
                          alt="Check-in selfie proof"
                          className="h-52 w-full object-contain bg-slate-100"
                        />
                      ) : (
                        <div className="flex h-52 items-center justify-center text-slate-400">
                          <Camera className="h-7 w-7" />
                        </div>
                      )}
                      {(selectedAttendanceSnapshot.checkInIp || selectedAttendanceSnapshot.checkOutIp) && (
                        <p className="border-t bg-white px-3 py-2 text-xs text-slate-500">
                          Check-in IP: {selectedAttendanceSnapshot.checkInIp || "-"}
                        </p>
                      )}
                    </div>
                    <div className="overflow-hidden rounded-lg border bg-slate-50">
                      <div className="flex items-center justify-between border-b bg-white px-3 py-2">
                        <span className="text-sm font-medium text-slate-800">Check-out</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          selectedAttendanceSnapshot.checkOutSelfieProvided
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-100 text-slate-600"
                        }`}>
                          {selectedAttendanceSnapshot.checkOutSelfieProvided ? "Captured" : "Not captured"}
                        </span>
                      </div>
                      {selectedAttendanceSnapshot.checkOutSelfieImage ? (
                        <img
                          src={selectedAttendanceSnapshot.checkOutSelfieImage}
                          alt="Check-out selfie proof"
                          className="h-52 w-full object-contain bg-slate-100"
                        />
                      ) : (
                        <div className="flex h-52 items-center justify-center text-slate-400">
                          <Camera className="h-7 w-7" />
                        </div>
                      )}
                      {(selectedAttendanceSnapshot.checkInIp || selectedAttendanceSnapshot.checkOutIp) && (
                        <p className="border-t bg-white px-3 py-2 text-xs text-slate-500">
                          Check-out IP: {selectedAttendanceSnapshot.checkOutIp || "-"}
                        </p>
                      )}
                    </div>
                  </div>
                </section>
              )}
              {selectedAttendanceSnapshot?.dayHistory && selectedAttendanceSnapshot.dayHistory.length > 0 && (
                <section className="rounded-lg border bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-center gap-2">
                    <Clock className="h-4 w-4 text-slate-500" />
                    <h3 className="text-sm font-semibold text-slate-900">Day History</h3>
                  </div>
                  <div className="space-y-2">
                    {selectedAttendanceSnapshot.dayHistory.map((entry, index) => (
                      <div key={`${entry.at || "punch"}-${index}`} className="grid gap-1 rounded-md border border-slate-100 bg-slate-50 px-3 py-2 sm:grid-cols-[110px_1fr]">
                        <p className="text-xs font-semibold text-slate-800">
                          {entry.action === "check_out" ? "Check-out" : "Check-in"}
                        </p>
                        <div className="space-y-0.5 text-xs text-muted-foreground">
                          <p>{entry.at ? formatDateTimeInOrgTimeZone(entry.at) : "-"}</p>
                          {canViewSelfieData && (
                            <p>
                              IP: {entry.ip || "-"} • Selfie: {entry.selfieProvided ? "Yes" : "No"}
                            </p>
                          )}
                          {(() => {
                            const hasValidCoordinates =
                              entry.latitude !== null &&
                              entry.latitude !== undefined &&
                              entry.longitude !== null &&
                              entry.longitude !== undefined &&
                              !(Number(entry.latitude) === 0 && Number(entry.longitude) === 0);
                            return (
                              <p>
                                Location: {hasValidCoordinates ? `${entry.latitude}, ${entry.longitude}` : "-"}
                              </p>
                            );
                          })()}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              {(selectedLeaveDetail || selectedCell?.isOnLeave) && (
                <section className="rounded-lg border bg-white p-4 shadow-sm">
                  <p className="text-sm font-semibold text-slate-900 mb-2">Approved Leave</p>
                  <p className="text-xs text-muted-foreground">
                    Type: {selectedLeaveDetail?.leaveType || selectedCell?.leaveType || "Leave"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Duration: {(selectedLeaveDetail?.duration || selectedCell?.leaveDuration) === "half_day" ? "Half Day" : "Full Day"}
                  </p>
                  {((selectedLeaveDetail?.duration || selectedCell?.leaveDuration) === "half_day") && (
                    <p className="text-xs text-muted-foreground">
                      Session: {(selectedLeaveDetail?.halfDaySession || selectedCell?.leaveHalfDaySession) === "second_half" ? "Second Half" : "First Half"}
                    </p>
                  )}
                  {selectedLeaveDetail?.approvedBy && (
                    <p className="text-xs text-muted-foreground">
                      Approved by: {selectedLeaveDetail.approvedBy}{selectedLeaveDetail.approvedByEmployeeCode ? ` (${selectedLeaveDetail.approvedByEmployeeCode})` : ""}
                    </p>
                  )}
                  {selectedLeaveDetail?.approvedAt && (
                    <p className="text-xs text-muted-foreground">
                      Approved at: {formatDateTimeInOrgTimeZone(selectedLeaveDetail.approvedAt)}
                    </p>
                  )}
                  {selectedLeaveDetail?.reason && (
                    <p className="text-xs text-muted-foreground">
                      Reason: {selectedLeaveDetail.reason}
                    </p>
                  )}
                </section>
              )}
              {selectedAttendanceRequestDetail && (
                <section className="rounded-lg border bg-white p-4 shadow-sm">
                  <p className="text-sm font-semibold text-slate-900 mb-2">Attendance Request</p>
                  <p className="text-xs text-muted-foreground">
                    Type: {selectedAttendanceRequestDetail.requestType === "missed_checkout" ? "Missed Checkout" : selectedAttendanceRequestDetail.requestType === "work_from_home" ? "Work From Home" : "Correction"}
                  </p>
                  {selectedAttendanceRequestDetail.requestType === "work_from_home" && (
                    <p className="text-xs text-muted-foreground">
                      Portion: {String(selectedAttendanceRequestDetail.dayPortion || "full_day").replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())}
                    </p>
                  )}
                  {selectedAttendanceRequestDetail.requestedCheckInTime && (
                    <p className="text-xs text-muted-foreground">
                      Requested check-in: {selectedAttendanceRequestDetail.requestedCheckInTime}
                    </p>
                  )}
                  {selectedAttendanceRequestDetail.requestedCheckOutTime && (
                    <p className="text-xs text-muted-foreground">
                      Requested check-out: {selectedAttendanceRequestDetail.requestedCheckOutTime}
                    </p>
                  )}
                  {selectedAttendanceRequestDetail.status && (
                    <p className="text-xs text-muted-foreground">
                      Status: {selectedAttendanceRequestDetail.status}
                    </p>
                  )}
                  {selectedAttendanceRequestDetail.approvedBy && (
                    <p className="text-xs text-muted-foreground">
                      Approved by: {selectedAttendanceRequestDetail.approvedBy}{selectedAttendanceRequestDetail.approvedByEmployeeCode ? ` (${selectedAttendanceRequestDetail.approvedByEmployeeCode})` : ""}
                    </p>
                  )}
                  {selectedAttendanceRequestDetail.approvedAt && (
                    <p className="text-xs text-muted-foreground">
                      Approved at: {formatDateTimeInOrgTimeZone(selectedAttendanceRequestDetail.approvedAt)}
                    </p>
                  )}
                  {selectedAttendanceRequestDetail.reason && (
                    <p className="text-xs text-muted-foreground">
                      Reason: {selectedAttendanceRequestDetail.reason}
                    </p>
                  )}
                  {selectedAttendanceRequestDetail.rejectionReason && (
                    <p className="text-xs text-muted-foreground">
                      Rejection reason: {selectedAttendanceRequestDetail.rejectionReason}
                    </p>
                  )}
                </section>
              )}
              {selectedCell && (
                <section className="rounded-lg border bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-center gap-2">
                    <Clock className="h-4 w-4 text-slate-500" />
                    <h3 className="text-sm font-semibold text-slate-900">Attendance Details</h3>
                  </div>
                  <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                  {selectedCell.shiftName || selectedCell.shiftCode ? (
                    <p className="text-xs text-muted-foreground">
                      Shift: {selectedCell.shiftName || ""}{selectedCell.shiftCode ? ` (${selectedCell.shiftCode})` : ""}
                    </p>
                  ) : null}
                  {selectedCell.shiftStartTime && selectedCell.shiftEndTime ? (
                    <p className="text-xs text-muted-foreground">
                      Shift Time: {selectedCell.shiftStartTime} - {selectedCell.shiftEndTime}
                    </p>
                  ) : null}
                  {selectedCell.checkInAt ? (
                    <p className="text-xs text-muted-foreground">
                      Check-in: {formatDateTimeInOrgTimeZone(selectedCell.checkInAt)}
                    </p>
                  ) : null}
                  {selectedCell.checkOutAt ? (
                    <p className="text-xs text-muted-foreground">
                      Check-out: {formatDateTimeInOrgTimeZone(selectedCell.checkOutAt)}
                    </p>
                  ) : null}
                  {((selectedCell.totalMinutes || 0) > 0 || selectedCell.workedDuration) ? (
                    <p className="text-xs text-muted-foreground">
                      Total Hours: {selectedCell.workedDuration || `${(Number(selectedCell.totalMinutes || 0) / 60).toFixed(1)}h`}
                    </p>
                  ) : null}
                  {(selectedCell.lateByMinutes || 0) > 0 ? (
                    <p className="text-xs text-muted-foreground">Late by: {selectedCell.lateByMinutes} min</p>
                  ) : null}
                  {(selectedCell.earlyLoginByMinutes || 0) > 0 ? (
                    <p className="text-xs text-muted-foreground">Early login by: {selectedCell.earlyLoginByMinutes} min</p>
                  ) : null}
                  {(selectedCell.earlyCheckoutByMinutes || 0) > 0 ? (
                    <p className="text-xs text-muted-foreground">Early checkout by: {selectedCell.earlyCheckoutByMinutes} min</p>
                  ) : null}
                  {(selectedCell.overtimeMinutes || 0) > 0 ? (
                    <p className="text-xs text-muted-foreground">Overtime: {formatMinutesAsDuration(selectedCell.overtimeMinutes)}</p>
                  ) : null}
                  {selectedCell.overriddenBy ? (
                    <p className="text-xs text-muted-foreground">
                      Attendance override: Set to {selectedCell.displayStatus || "Present"} by {selectedCell.overriddenBy}
                      {selectedCell.isOnLeave ? "; approved leave retained" : ""}
                    </p>
                  ) : null}
                  {selectedCell.overriddenAt ? (
                    <p className="text-xs text-muted-foreground">
                      Overridden at: {formatDateTimeInOrgTimeZone(selectedCell.overriddenAt)}
                    </p>
                  ) : null}
                  </div>
                </section>
              )}
              <section className="rounded-lg border bg-white p-4 shadow-sm">
                <p className="text-sm font-semibold text-slate-900 mb-2">Activity Timeline</p>
                {historyLoading && <p className="text-xs text-muted-foreground">Loading...</p>}
                {!historyLoading && activityTimeline.length === 0 && (
                  <p className="text-xs text-muted-foreground">No activity found.</p>
                )}
                {!historyLoading && activityTimeline.map((h, idx) => (
                  <p key={`${h.createdAt}-${idx}`} className="text-xs mb-1 text-slate-600">
                    {formatDateTimeInOrgTimeZone(h.createdAt)} - {formatActivityAction(h)} by {h.actor}
                  </p>
                ))}
              </section>
            </div>
          </div>
          <DialogFooter className="border-t bg-white px-6 py-4">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            {canEdit && (
              <Button onClick={saveOverride} disabled={saving || isNoOpOverride}>
                {saving ? "Saving..." : "Save"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
};

export default Attendance;
