import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { MainLayout } from "@/components/layout/MainLayout";
import {
  CheckCircle,
  XCircle,
  Clock,
  ClipboardCheck,
  Timer,
  Eye,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  CalendarDays,
  LogIn,
  LogOut,
  User,
  MessageSquare,
  AlertTriangle,
  Home,
  CheckCircle2,
  Circle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { getApiWithToken, postApiWithToken, putApiWithToken } from "@/services/apiWrapper";
import { toast } from "sonner";
import { hasPermission } from "@/utils/auth";
import { useAuth } from "@/context/useAuth";
import { InlineLoader } from "@/components/ui/loaders";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatDateInOrgTimeZone,
  formatDateKeyInOrgCalendar,
  formatDateTimeInOrgTimeZone,
  formatTimeInOrgTimeZone,
  getOrgTimeZone,
  subscribeToOrgTimeZone,
  toDateKeyInOrgCalendar,
  toDateKeyInOrgTimeZone
} from "@/utils/timezone";

const toDateInput = (value: Date) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getWeekStart = (value: Date) => {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = (day + 6) % 7; // Monday start
  d.setDate(d.getDate() - diff);
  return d;
};

const buildWeekDates = (weekStart: Date) => {
  const dates: Date[] = [];
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    dates.push(d);
  }
  return dates;
};

type WeeklyEntry = {
  date?: string;
  hours?: number;
  notes?: string;
};

type EmployeeSummary = {
  _id?: string;
  firstName?: string;
  lastName?: string;
  employeeCode?: string;
};

type TeamTimesheet = {
  _id?: string;
  id?: string;
  employeeId?: EmployeeSummary | null;
  weekStart?: string;
  weekEnd?: string;
  status?: string;
  entries?: WeeklyEntry[];
};

const getTimesheetId = (timesheet: TeamTimesheet | null | undefined) =>
  toIdString(timesheet?._id || timesheet?.id);

const normalizeTimesheetRecord = (timesheet: TeamTimesheet | null | undefined) => {
  if (!timesheet) return null;
  return {
    ...timesheet,
    _id: getTimesheetId(timesheet)
  };
};

type AttendanceTodayRecord = {
  date?: string | null;
  checkInAt?: string | null;
  checkOutAt?: string | null;
};

const shiftDateKey = (dateKey: string, dayDelta: number) => {
  const [year, month, day] = dateKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + dayDelta, 12, 0, 0));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
};

const normalizeEntries = (weekDates: Date[], rawEntries: WeeklyEntry[]) => {
  const byDate = new Map<string, WeeklyEntry>();
  (rawEntries || []).forEach((entry) => {
    const key = String(entry.date || "").slice(0, 10);
    if (!byDate.has(key)) {
      byDate.set(key, {
        date: key,
        hours: Number(entry.hours || 0),
        notes: entry.notes || ""
      });
    }
  });

  return weekDates.map((date) => {
    const key = toDateInput(date);
    return (
      byDate.get(key) || {
        date: key,
        hours: 0,
        notes: ""
      }
    );
  });
};

const getStatusBadge = (status?: string | null) => {
  const normalizedStatus = String(status || "").trim().toLowerCase();

  switch (normalizedStatus) {
    case "approved":
      return (
        <Badge className="status-badge status-active gap-1">
          <CheckCircle className="w-3 h-3" /> Approved
        </Badge>
      );
    case "pending":
    case "submitted":
      return (
        <Badge className="status-badge status-pending gap-1">
          <Clock className="w-3 h-3" /> {normalizedStatus === "submitted" ? "Submitted" : "Pending"}
        </Badge>
      );
    case "rejected":
      return (
        <Badge className="status-badge status-rejected gap-1">
          <XCircle className="w-3 h-3" /> Rejected
        </Badge>
      );
    default:
      return <Badge variant="secondary">Draft</Badge>;
  }
};

type AttendanceRequest = {
  _id: string;
  _actionId?: string;
  date: string;
  requestType: "missed_checkout" | "correction" | "work_from_home";
  dayPortion?: "full_day" | "first_half" | "second_half";
  requestedCheckInTime?: string | null;
  requestedCheckOutTime?: string | null;
  reason: string;
  status: "pending" | "approved" | "rejected";
  rejectionReason?: string | null;
  actionBy?: { firstName?: string; lastName?: string; employeeCode?: string } | null;
  actionAt?: string | null;
  employeeId?: { firstName?: string; lastName?: string; employeeCode?: string };
  approvalSteps?: {
    stepNumber: number;
    approverType: "manager" | "role" | "employee";
    approverRoleSlug?: string | null;
    approverEmployeeId?: { firstName?: string; lastName?: string; employeeCode?: string } | null;
    status: "queued" | "pending" | "approved" | "rejected";
    actionBy?: { firstName?: string; lastName?: string; employeeCode?: string } | null;
    actionAt?: string | null;
    remarks?: string | null;
  }[];
  currentApprovalStep?: number | null;
  calendarDayType?: "working_day" | "week_off" | "holiday";
  calendarDayLabel?: string;
  holidayName?: string | null;
};

const toPersonLabel = (employee: EmployeeSummary | null | undefined) => {
  if (!employee) return "-";
  const name = `${employee.firstName || ""} ${employee.lastName || ""}`.trim();
  return employee.employeeCode ? `${name || "Employee"} (${employee.employeeCode})` : name || "Employee";
};

const approverLabel = (step: AttendanceRequest["approvalSteps"] extends Array<infer T> ? T : never) => {
  if (!step) return "-";
  if (step.approverType === "manager") return "Reporting Manager";
  if (step.approverType === "role") return step.approverRoleSlug ? `Role: ${step.approverRoleSlug}` : "Role";
  return step.approverEmployeeId ? `Employee: ${toPersonLabel(step.approverEmployeeId)}` : "Employee";
};

const normalizeRoleKey = (value: string | null | undefined) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-");

type AttendanceRequestType = AttendanceRequest["requestType"];

const getAttendanceRequestTypeLabel = (requestType: string | null | undefined) =>
  String(requestType || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase()) || "-";

const resolveActionedBy = (request: AttendanceRequest) => {
  if (request.actionBy) return request.actionBy;
  const approvedSteps = (request.approvalSteps || []).filter(
    (s) => (s.status === "approved" || s.status === "rejected") && s.actionBy
  );
  if (!approvedSteps.length) return null;
  return approvedSteps.sort(
    (a, b) => new Date(b.actionAt || 0).getTime() - new Date(a.actionAt || 0).getTime()
  )[0].actionBy;
};

const resolveActionedAt = (request: AttendanceRequest) => {
  if (request.actionAt) return request.actionAt;
  const actioned = (request.approvalSteps || []).filter(
    (s) => (s.status === "approved" || s.status === "rejected") && s.actionAt
  );
  if (!actioned.length) return null;
  return actioned.sort(
    (a, b) => new Date(b.actionAt || 0).getTime() - new Date(a.actionAt || 0).getTime()
  )[0].actionAt;
};

const approvalProgressLabel = (request: AttendanceRequest) => {
  const steps = Array.isArray(request.approvalSteps) ? request.approvalSteps : [];
  if (!steps.length) return "Single-step";
  const pending = steps.find((s) => s.status === "pending");
  if (request.status === "approved") return `Completed (${steps.length} steps)`;
  if (request.status === "rejected") {
    const rejectedStep = steps.find((s) => s.status === "rejected");
    return rejectedStep ? `Rejected at S${rejectedStep.stepNumber}` : "Rejected";
  }
  if (!pending) return "Pending";
  return `S${pending.stepNumber}/${steps.length} • ${approverLabel(pending)}`;
};

const getAttendanceRequestStatus = (request: AttendanceRequest) => {
  const normalizedStatus = String(request.status || "").trim().toLowerCase();
  if (["pending", "approved", "rejected"].includes(normalizedStatus)) return normalizedStatus;

  const steps = Array.isArray(request.approvalSteps) ? request.approvalSteps : [];
  if (steps.some((step) => String(step.status || "").trim().toLowerCase() === "pending")) {
    return "pending";
  }

  if (request.currentApprovalStep != null) return "pending";
  return normalizedStatus || "draft";
};

const toIdString = (value: unknown) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((item) => Number.isInteger(item))) {
    return value.map((item) => Number(item).toString(16).padStart(2, "0")).join("");
  }
  if (typeof value === "object" && value !== null && "_actionId" in value && typeof (value as { _actionId?: string })._actionId === "string") {
    return (value as { _actionId: string })._actionId;
  }
  if (typeof value === "object" && value !== null && "_id" in value) return toIdString((value as { _id?: unknown })._id);
  if (typeof value === "object" && value !== null && "id" in value) return toIdString((value as { id?: unknown }).id);
  if (typeof value === "object" && value !== null && "$oid" in value && typeof (value as { $oid?: string }).$oid === "string") {
    return (value as { $oid: string }).$oid;
  }
  if (typeof value === "object" && value !== null && "buffer" in value) {
    const buffer = (value as { buffer?: unknown }).buffer;
    if (Array.isArray(buffer)) return toIdString(buffer);
    if (typeof buffer === "object" && buffer !== null) {
      const bytes = Object.values(buffer)
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item >= 0);
      if (bytes.length) return toIdString(bytes);
    }
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "data" in value &&
    (value as { type?: string }).type === "Buffer"
  ) {
    return toIdString((value as { data?: unknown }).data);
  }
  if (typeof value === "object" && value !== null && "data" in value) {
    const data = (value as { data?: unknown }).data;
    if (Array.isArray(data)) return toIdString(data);
  }
  if (typeof value === "object" && value !== null && "toHexString" in value && typeof (value as { toHexString?: () => string }).toHexString === "function") {
    return (value as { toHexString: () => string }).toHexString();
  }
  if (typeof value === "object" && typeof value.toString === "function" && value.toString !== Object.prototype.toString) {
    const asString = value.toString();
    if (asString && asString !== "[object Object]") return asString;
  }
  return String(value);
};

const getAttendanceRequestId = (request: AttendanceRequest | string | null | undefined) =>
  typeof request === "string" ? request : toIdString(request?._actionId || request?._id);

const normalizeAttendanceRequestRecord = (
  request: (AttendanceRequest & { id?: string }) | null | undefined
): AttendanceRequest | null => {
  if (!request) return null;
  const requestId = toIdString(request?._actionId || request?._id || request?.id);
  return {
    ...request,
    date: request.date ? toDateKeyInOrgCalendar(request.date) : request.date,
    _id: requestId,
    _actionId: requestId
  };
};

const mergeTimesheetPages = (existing: TeamTimesheet[], incoming: TeamTimesheet[]) => {
  const merged = new Map<string, TeamTimesheet>();
  existing.forEach((item) => {
    const itemId = toIdString(item?._id || item?.id);
    if (itemId) merged.set(itemId, item);
  });
  incoming.forEach((item) => {
    const itemId = toIdString(item?._id || item?.id);
    if (itemId) merged.set(itemId, item);
  });
  return Array.from(merged.values());
};

const mergeAttendanceRequestPages = (existing: AttendanceRequest[], incoming: AttendanceRequest[]) => {
  const merged = new Map<string, AttendanceRequest>();
  existing.forEach((item) => {
    const itemId = getAttendanceRequestId(item);
    if (itemId) merged.set(itemId, item);
  });
  incoming.forEach((item) => {
    const itemId = getAttendanceRequestId(item);
    if (itemId) merged.set(itemId, item);
  });
  return Array.from(merged.values());
};

const Timesheets = () => {
  const { profile } = useAuth();
  const [weekStartDate, setWeekStartDate] = useState(getWeekStart(new Date()));
  const [timeZone, setTimeZone] = useState(() => getOrgTimeZone());
  const [attendanceToday, setAttendanceToday] = useState<AttendanceTodayRecord | null>(null);
  const [timesheet, setTimesheet] = useState<TeamTimesheet | null>(null);
  const [entries, setEntries] = useState<WeeklyEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [viewMode, setViewMode] = useState<"all" | "my">("my");
  const [weeklyList, setWeeklyList] = useState<TeamTimesheet[]>([]);
  const [teamCurrentPage, setTeamCurrentPage] = useState(1);
  const [teamTotalPages, setTeamTotalPages] = useState(1);
  const [teamTotalItems, setTeamTotalItems] = useState(0);
  const [teamPageSize] = useState(15);
  const [teamLoadingMore, setTeamLoadingMore] = useState(false);
  const [myLeaveDates, setMyLeaveDates] = useState<string[]>([]);
  const [weekOffDays, setWeekOffDays] = useState<number[]>([]);
  const [minWorkHoursPerDay, setMinWorkHoursPerDay] = useState(8);
  const [minHalfDayHours, setMinHalfDayHours] = useState(4);
  const [weekLoading, setWeekLoading] = useState(false);
  const [actionDialogOpen, setActionDialogOpen] = useState(false);
  const [actionType, setActionType] = useState<"approve" | "reject">("approve");
  const [selectedTimesheet, setSelectedTimesheet] = useState<TeamTimesheet | null>(null);
  const [comment, setComment] = useState("");
  const [showTeamTimesheets, setShowTeamTimesheets] = useState(true);
  const [attendanceRequestOpen, setAttendanceRequestOpen] = useState(false);
  const [attendanceRequestDetailOpen, setAttendanceRequestDetailOpen] = useState(false);
  const [attendanceRequestLoading, setAttendanceRequestLoading] = useState(false);
  const [attendanceRequestForm, setAttendanceRequestForm] = useState({
    date: toDateKeyInOrgTimeZone(new Date()),
    requestType: "missed_checkout" as AttendanceRequestType,
    dayPortion: "full_day" as "full_day" | "first_half" | "second_half",
    requestedCheckInTime: "",
    requestedCheckOutTime: "",
    reason: ""
  });
  const [myAttendanceRequests, setMyAttendanceRequests] = useState<AttendanceRequest[]>([]);
  const [myAttendanceRequestsPage, setMyAttendanceRequestsPage] = useState(1);
  const [myAttendanceRequestsTotalPages, setMyAttendanceRequestsTotalPages] = useState(1);
  const [myAttendanceRequestsTotalItems, setMyAttendanceRequestsTotalItems] = useState(0);
  const [myAttendanceRequestsLoadingMore, setMyAttendanceRequestsLoadingMore] = useState(false);
  const [pendingAttendanceRequests, setPendingAttendanceRequests] = useState<AttendanceRequest[]>([]);
  const [selectedAttendanceRequest, setSelectedAttendanceRequest] = useState<AttendanceRequest | null>(null);
  const teamTableViewportRef = useRef<HTMLDivElement | null>(null);
  const teamLoadingMoreRef = useRef(false);
  const myAttendanceRequestsViewportRef = useRef<HTMLDivElement | null>(null);
  const myAttendanceRequestsLoadingMoreRef = useRef(false);
  const currentEmployeeId = toIdString(profile?.employeeId);
  const currentRoleSlug = profile?.activeRole?.slug || "";
  const isEmployeeRole = normalizeRoleKey(currentRoleSlug) === "employee";
  const showEmployeeOnlyPanels = isEmployeeRole;
  const canSubmit = hasPermission("TIMESHEET_SUBMIT_SELF");
  const canEdit = hasPermission("TIMESHEET_EDIT_SELF");
  const canCreate = hasPermission("TIMESHEET_CREATE_SELF");
  const canAction = hasPermission("TIMESHEET_ACTION");
  const canRecall = hasPermission("TIMESHEET_RECALL_SELF");
  const canViewAll = hasPermission("TIMESHEET_VIEW_ALL");

  const canCurrentActorActionAttendanceRequest = (request: AttendanceRequest) => {
    const steps = Array.isArray(request.approvalSteps) ? request.approvalSteps : [];
    if (!steps.length) return true;
    const pending = steps.find((s) => s.status === "pending");
    if (!pending) return false;
    if (pending.approverType === "role") {
      return Boolean(
        normalizeRoleKey(pending.approverRoleSlug) &&
        normalizeRoleKey(pending.approverRoleSlug) === normalizeRoleKey(currentRoleSlug)
      );
    }
    const stepEmployeeId = toIdString(pending.approverEmployeeId);
    return Boolean(stepEmployeeId && currentEmployeeId && stepEmployeeId === currentEmployeeId);
  };

  const weekStart = useMemo(() => getWeekStart(weekStartDate), [weekStartDate]);
  const weekDates = useMemo(() => buildWeekDates(weekStart), [weekStart]);
  const isCurrentMonthWeek = useMemo(() => {
    const now = new Date();
    return (
      weekStart.getFullYear() === now.getFullYear() &&
      weekStart.getMonth() === now.getMonth()
    );
  }, [weekStart]);
  const weekStartKey = useMemo(() => toDateInput(weekStart), [weekStart]);
  const timesheetWeekKey = useMemo(() => {
    if (!timesheet?.weekStart) return "";
    return toDateInput(new Date(timesheet.weekStart));
  }, [timesheet?.weekStart]);
  const isWeekSynced = !timesheet?._id || timesheetWeekKey === weekStartKey;
  const weekOffCount = useMemo(
    () => weekDates.filter((date) => weekOffDays.includes(date.getDay())).length,
    [weekDates, weekOffDays]
  );
  const weekTotalHours = useMemo(
    () =>
      entries.reduce((sum, entry, index) => {
        const date = weekDates[index];
        if (date && weekOffDays.includes(date.getDay())) return sum;
        return sum + (Number(entry.hours) || 0);
      }, 0),
    [entries, weekDates, weekOffDays]
  );
  const minWeeklyHours = useMemo(
    () => minWorkHoursPerDay * (7 - weekOffCount),
    [minWorkHoursPerDay, weekOffCount]
  );

  const getDayStatus = (dateValue: string | Date, hoursValue: number) => {
    const day = new Date(dateValue).getDay();
    if (weekOffDays.includes(day)) return { label: "WO", tone: "muted" };
    if (hoursValue >= minWorkHoursPerDay) return { label: "F", tone: "good" };
    if (hoursValue >= minHalfDayHours) return { label: "H", tone: "warn" };
    return { label: "A", tone: "bad" };
  };

  const loadTeamTimesheets = useCallback(async (pageToLoad = 1) => {
    if (pageToLoad > 1) {
      setTeamLoadingMore(true);
    }
    const resAll = await getApiWithToken(`/timesheets/weekly?page=${pageToLoad}&limit=${teamPageSize}`, null, {
      requiredPermissions: ["TIMESHEET_VIEW_ALL"]
    });
    if (resAll?.skipped) return;
    if (resAll?.success) {
      const payload = resAll.data;
      const nextItems = (Array.isArray(payload) ? payload : (payload?.items || [])).map((item: TeamTimesheet) => ({
        ...item,
        _id: getTimesheetId(item)
      }));
      const pagination = Array.isArray(payload)
        ? { page: 1, totalPages: 1, total: nextItems.length }
        : payload?.pagination;
      setWeeklyList((prev) => (pageToLoad > 1 ? mergeTimesheetPages(prev, nextItems) : nextItems));
      setTeamCurrentPage(Number(pagination?.page || pageToLoad));
      setTeamTotalPages(Math.max(1, Number(pagination?.totalPages || 1)));
      setTeamTotalItems(Number(pagination?.total || nextItems.length));
      setViewMode("all");
    } else {
      setWeeklyList([]);
      setTeamCurrentPage(1);
      setTeamTotalPages(1);
      setTeamTotalItems(0);
    }
    teamLoadingMoreRef.current = false;
    setTeamLoadingMore(false);
  }, [teamPageSize]);

  const loadAttendanceToday = useCallback(async () => {
    const res = await getApiWithToken(
      `/timesheets/attendance/my?date=${toDateKeyInOrgTimeZone(new Date())}`,
      null,
      { requiredPermissions: ["TIMESHEET_VIEW_SELF", "TIMESHEET_CHECKIN_SELF", "TIMESHEET_CHECKOUT_SELF"] }
    );
    if (res?.skipped) return;
    if (res?.success) {
      const record = (res.data || [])[0];
      setAttendanceToday(record || null);
    }
  }, []);

  const loadWeekly = useCallback(async () => {
    setWeekLoading(true);
    setTimesheet(null);
    setEntries(normalizeEntries(weekDates, []));
    if (hasPermission("TIMESHEET_VIEW_ALL")) {
      await loadTeamTimesheets(1);
    } else {
      setWeeklyList([]);
      setTeamCurrentPage(1);
      setTeamTotalPages(1);
      setTeamTotalItems(0);
      setViewMode("my");
    }

    const weekStartIso = toDateInput(weekStart);
    const resWeek = await getApiWithToken(
      `/timesheets/weekly/my?weekStart=${weekStartIso}`,
      null,
      { requiredPermissions: ["TIMESHEET_VIEW_SELF"] }
    );
    if (resWeek?.skipped) {
      setWeekLoading(false);
      return;
    }
    if (resWeek?.success && resWeek.data) {
      const normalizedTimesheet = normalizeTimesheetRecord(resWeek.data);
      setTimesheet(normalizedTimesheet);
      setEntries(normalizeEntries(weekDates, normalizedTimesheet?.entries || []));
    } else {
      setTimesheet(null);
      setEntries(normalizeEntries(weekDates, []));
    }
    setWeekLoading(false);
  }, [loadTeamTimesheets, weekDates, weekStart]);

  const loadMyLeavesForWeek = useCallback(async () => {
    const start = toDateInput(weekStart);
    const end = toDateInput(weekDates[6]);
    const res = await getApiWithToken(
      `/leaves/my-range?startDate=${start}&endDate=${end}`,
      null,
      { requiredPermissions: ["LEAVE_VIEW_SELF"] }
    );
    if (res?.skipped) return;
    if (res?.success) {
      const dates: string[] = [];
      (res.data || []).forEach((leave: { fromDate?: string; toDate?: string }) => {
        const from = new Date(leave.fromDate);
        const to = new Date(leave.toDate);
        const current = new Date(from);
        while (current <= to) {
          dates.push(toDateInput(new Date(current)));
          current.setDate(current.getDate() + 1);
        }
      });
      setMyLeaveDates(dates);
    } else {
      setMyLeaveDates([]);
    }
  }, [weekDates, weekStart]);

  const loadWeekOffs = useCallback(async () => {
    const res = await getApiWithToken("/week-offs", null, {
      requiredPermissions: ["WEEK_OFF_VIEW"]
    });
    if (res?.skipped) return;
    if (res?.success) {
      setWeekOffDays(res.data?.weekOffDays || []);
    }
  }, []);

  const loadOrgSettings = useCallback(async () => {
    const res = await getApiWithToken("/org-settings", null, {
      requiredPermissions: ["ORG_SETTINGS_VIEW"]
    });
    if (res?.skipped) return;
    if (res?.success) {
      setMinWorkHoursPerDay(
        typeof res.data?.minWorkHoursPerDay === "number" ? res.data.minWorkHoursPerDay : 8
      );
      setMinHalfDayHours(
        typeof res.data?.minHalfDayHours === "number" ? res.data.minHalfDayHours : 4
      );
    }
  }, []);

  const loadMyAttendanceRequests = useCallback(async (pageToLoad = 1) => {
    if (pageToLoad > 1) {
      setMyAttendanceRequestsLoadingMore(true);
    }
    const res = await getApiWithToken(`/timesheets/attendance/requests/my?page=${pageToLoad}&limit=20`, null, {
      requiredPermissions: ["TIMESHEET_VIEW_SELF"]
    });
    if (res?.skipped) return;
    if (res?.success) {
      const payload = res.data;
      const nextItems = (Array.isArray(payload) ? payload : (payload?.items || []))
        .map((request: AttendanceRequest & { id?: string }) => normalizeAttendanceRequestRecord(request))
        .filter(Boolean) as AttendanceRequest[];
      const pagination = Array.isArray(payload)
        ? { page: 1, totalPages: 1, total: nextItems.length }
        : payload?.pagination;
      setMyAttendanceRequests((prev) => (pageToLoad > 1 ? mergeAttendanceRequestPages(prev, nextItems) : nextItems));
      setMyAttendanceRequestsPage(Number(pagination?.page || pageToLoad));
      setMyAttendanceRequestsTotalPages(Math.max(1, Number(pagination?.totalPages || 1)));
      setMyAttendanceRequestsTotalItems(Number(pagination?.total || nextItems.length));
    } else if (pageToLoad === 1) {
      setMyAttendanceRequests([]);
      setMyAttendanceRequestsPage(1);
      setMyAttendanceRequestsTotalPages(1);
      setMyAttendanceRequestsTotalItems(0);
    }
    myAttendanceRequestsLoadingMoreRef.current = false;
    setMyAttendanceRequestsLoadingMore(false);
  }, []);

  const loadPendingAttendanceRequests = useCallback(async () => {
    const res = await getApiWithToken("/timesheets/attendance/requests?status=pending", null, {
      requiredPermissions: ["ATTENDANCE_MANAGE"]
    });
    if (res?.skipped) return;
    if (res?.success) {
      setPendingAttendanceRequests(
        (res.data || [])
          .map((request: AttendanceRequest & { id?: string }) => normalizeAttendanceRequestRecord(request))
          .filter(Boolean) as AttendanceRequest[]
      );
    }
  }, []);

  useEffect(() => {
    loadAttendanceToday();
    loadWeekly();
    loadWeekOffs();
    loadOrgSettings();
    loadMyLeavesForWeek();
    loadMyAttendanceRequests();

    if (showEmployeeOnlyPanels) {
      loadPendingAttendanceRequests();
    } else {
      setPendingAttendanceRequests([]);
    }
  }, [
    loadAttendanceToday,
    loadWeekly,
    loadWeekOffs,
    loadOrgSettings,
    loadMyLeavesForWeek,
    loadMyAttendanceRequests,
    loadPendingAttendanceRequests,
    showEmployeeOnlyPanels
  ]);

  useEffect(() => subscribeToOrgTimeZone(setTimeZone), []);

  const hasMoreTeamTimesheets = teamCurrentPage < teamTotalPages;
  const hasMoreMyAttendanceRequests = myAttendanceRequestsPage < myAttendanceRequestsTotalPages;

  useEffect(() => {
    if (teamCurrentPage <= 1 || !canViewAll) return;
    loadTeamTimesheets(teamCurrentPage);
  }, [canViewAll, loadTeamTimesheets, teamCurrentPage]);

  useEffect(() => {
    if (myAttendanceRequestsPage <= 1) return;
    loadMyAttendanceRequests(myAttendanceRequestsPage);
  }, [loadMyAttendanceRequests, myAttendanceRequestsPage]);

  useEffect(() => {
    if (!attendanceRequestOpen || attendanceRequestForm.requestType !== "work_from_home") return;
    applyWfhShiftDefaults(attendanceRequestForm.date, attendanceRequestForm.dayPortion);
  }, [
    attendanceRequestOpen,
    attendanceRequestForm.requestType,
    attendanceRequestForm.date,
    attendanceRequestForm.dayPortion
  ]);

  const handleTeamTimesheetsScroll = () => {
    const viewport = teamTableViewportRef.current;
    if (!viewport || weekLoading || teamLoadingMore || teamLoadingMoreRef.current || !hasMoreTeamTimesheets || viewMode !== "all" || !showTeamTimesheets) {
      return;
    }
    const { scrollTop, scrollHeight, clientHeight } = viewport;
    if (scrollTop <= 0 || scrollHeight <= clientHeight) return;
    const progress = (scrollTop + clientHeight) / scrollHeight;
    if (progress < 0.5) return;
    teamLoadingMoreRef.current = true;
    setTeamCurrentPage((prev) => {
      if (prev >= teamTotalPages) {
        teamLoadingMoreRef.current = false;
        return prev;
      }
      return prev + 1;
    });
  };

  const handleMyAttendanceRequestsScroll = () => {
    const viewport = myAttendanceRequestsViewportRef.current;
    if (
      !viewport
      || weekLoading
      || myAttendanceRequestsLoadingMore
      || myAttendanceRequestsLoadingMoreRef.current
      || !hasMoreMyAttendanceRequests
    ) {
      return;
    }
    const { scrollTop, scrollHeight, clientHeight } = viewport;
    if (scrollTop <= 0 || scrollHeight <= clientHeight) return;
    const progress = (scrollTop + clientHeight) / scrollHeight;
    if (progress < 0.6) return;
    myAttendanceRequestsLoadingMoreRef.current = true;
    setMyAttendanceRequestsPage((prev) => {
      if (prev >= myAttendanceRequestsTotalPages) {
        myAttendanceRequestsLoadingMoreRef.current = false;
        return prev;
      }
      return prev + 1;
    });
  };

  const applyWfhShiftDefaults = async (
    date: string,
    dayPortion: "full_day" | "first_half" | "second_half"
  ) => {
    if (!date) return;
    const res = await getApiWithToken(
      `/timesheets/attendance/requests/defaults/my?date=${date}&requestType=work_from_home&dayPortion=${dayPortion}`,
      null,
      { requiredPermissions: ["TIMESHEET_VIEW_SELF"] }
    );
    if (res?.skipped) return;
    if (res?.success) {
      setAttendanceRequestForm((prev) => {
        if (
          prev.requestType !== "work_from_home"
          || prev.date !== date
          || prev.dayPortion !== dayPortion
        ) {
          return prev;
        }
        return {
          ...prev,
          requestedCheckInTime: res.data?.requestedCheckInTime || "",
          requestedCheckOutTime: res.data?.requestedCheckOutTime || ""
        };
      });
    } else {
      toast.error(res?.message || "Failed to fetch shift timings");
    }
  };

  const submitAttendanceRequest = async () => {
    if (!attendanceRequestForm.reason.trim()) {
      toast.error("Reason is required");
      return;
    }
    if (
      attendanceRequestForm.requestType === "missed_checkout" &&
      !attendanceRequestForm.requestedCheckOutTime
    ) {
      toast.error("Requested checkout time is required");
      return;
    }
    if (
      attendanceRequestForm.requestType === "correction" &&
      !attendanceRequestForm.requestedCheckInTime &&
      !attendanceRequestForm.requestedCheckOutTime
    ) {
      toast.error("Provide check-in or check-out time");
      return;
    }
    if (
      attendanceRequestForm.requestType === "work_from_home" &&
      (!attendanceRequestForm.requestedCheckInTime || !attendanceRequestForm.requestedCheckOutTime)
    ) {
      toast.error("Shift check-in and check-out times are required for WFH");
      return;
    }
    setAttendanceRequestLoading(true);
    const res = await postApiWithToken(
      "/timesheets/attendance/requests/my",
      attendanceRequestForm,
      null,
      { requiredPermissions: ["TIMESHEET_VIEW_SELF"] }
    );
    setAttendanceRequestLoading(false);
    if (res?.skipped) return;
    if (res?.success) {
      toast.success("Attendance request raised");
      setAttendanceRequestOpen(false);
      setAttendanceRequestForm({
        date: toDateKeyInOrgTimeZone(new Date()),
        requestType: "missed_checkout",
        dayPortion: "full_day",
        requestedCheckInTime: "",
        requestedCheckOutTime: "",
        reason: ""
      });
      loadMyAttendanceRequests();
      loadPendingAttendanceRequests();
    } else {
      toast.error(res?.message || "Failed to raise attendance request");
    }
  };

  const openAttendanceRequestDialog = () => {
    setAttendanceRequestForm({
      date: attendanceRequestDefaultDate,
      requestType: attendanceRequestDefaultType,
      dayPortion: "full_day",
      requestedCheckInTime: "",
      requestedCheckOutTime: "",
      reason: ""
    });
    setAttendanceRequestOpen(true);
  };

  const openAttendanceRequestDetail = (request: AttendanceRequest) => {
    setSelectedAttendanceRequest(request);
    setAttendanceRequestDetailOpen(true);
  };

  const actionAttendanceRequest = async (requestRow: AttendanceRequest | string, status: "approved" | "rejected") => {
    const requestId = getAttendanceRequestId(requestRow);
    if (!requestId || requestId === "[object Object]") {
      toast.error("Invalid attendance request id");
      return;
    }
    const request = pendingAttendanceRequests.find((r) => getAttendanceRequestId(r) === requestId);
    if (request && !canCurrentActorActionAttendanceRequest(request)) {
      toast.error("You are not the current approver for this request");
      return;
    }
    let rejectionReason = "";
    if (status === "rejected") {
      rejectionReason = window.prompt("Enter rejection reason") || "";
      if (!rejectionReason.trim()) return;
    }
    const res = await putApiWithToken(
      `/timesheets/attendance/requests/${encodeURIComponent(requestId)}/action`,
      { status, rejectionReason },
      null,
      { requiredPermissions: ["ATTENDANCE_MANAGE"] }
    );
    if (res?.skipped) return;
    if (res?.success) {
      toast.success(`Attendance request ${status}`);
      loadWeekly();
      loadPendingAttendanceRequests();
      loadMyAttendanceRequests();
    } else {
      toast.error(res?.message || "Failed to action request");
    }
  };

  const handleEntryChange = (index: number, field: keyof WeeklyEntry, value: string | number) => {
    setEntries((prev) =>
      prev.map((entry, idx) =>
        idx === index ? { ...entry, [field]: value } : entry
      )
    );
  };

  const createDraft = async () => {
    setSaving(true);
    const payload = {
      weekStart: toDateInput(weekStart),
      entries: entries.map((entry) => ({
        date: entry.date,
        hours: Number(entry.hours) || 0,
        notes: entry.notes || ""
      }))
    };
    const res = await postApiWithToken(
      "/timesheets/weekly",
      payload,
      null,
      { requiredPermissions: ["TIMESHEET_CREATE_SELF"] }
    );
    setSaving(false);
    if (res?.skipped) return;
    if (res?.success) {
      toast.success("Timesheet created");
      setTimesheet(normalizeTimesheetRecord(res.data));
      loadWeekly();
    } else {
      toast.error(res?.message || "Create failed");
    }
  };

  const saveDraft = async () => {
    const timesheetId = getTimesheetId(timesheet);
    if (!timesheetId || timesheetId === "[object Object]") {
      toast.error("Invalid timesheet id");
      return;
    }
    setSaving(true);
    const payload = {
      weekStart: weekStartKey,
      entries: entries.map((entry) => ({
        date: entry.date,
        hours: Number(entry.hours) || 0,
        notes: entry.notes || ""
      }))
    };
    
    const res = await putApiWithToken(
      `/timesheets/weekly/${timesheetId}`,
      payload,
      null,
      { requiredPermissions: ["TIMESHEET_EDIT_SELF"] }
    );
    setSaving(false);
    if (res?.skipped) return;
    if (res?.success) {
      toast.success("Timesheet updated");
      setTimesheet(normalizeTimesheetRecord(res.data));
      loadWeekly();
    } else {
      toast.error(res?.message || "Update failed");
    }
  };

  const submitTimesheet = async () => {
    const timesheetId = getTimesheetId(timesheet);
    if (!timesheetId || timesheetId === "[object Object]") {
      toast.error("Invalid timesheet id");
      return;
    }
    setSaving(true);
    const payload = {
      weekStart: weekStartKey,
      entries: entries.map((entry) => ({
        date: entry.date,
        hours: Number(entry.hours) || 0,
        notes: entry.notes || ""
      }))
    };
    const res = await postApiWithToken(
      `/timesheets/weekly/${timesheetId}/submit`,
      payload,
      null,
      { requiredPermissions: ["TIMESHEET_SUBMIT_SELF"] }
    );
    setSaving(false);
    if (res?.skipped) return;
    if (res?.success) {
      toast.success("Timesheet submitted");
      setTimesheet(normalizeTimesheetRecord(res.data));
      loadWeekly();
    } else {
      toast.error(res?.message || "Submit failed");
    }
  };

  const recallTimesheet = async () => {
    const timesheetId = getTimesheetId(timesheet);
    if (!timesheetId || timesheetId === "[object Object]") {
      toast.error("Invalid timesheet id");
      return;
    }
    setSaving(true);
    const res = await postApiWithToken(
      `/timesheets/weekly/${timesheetId}/recall`,
      {},
      null,
      { requiredPermissions: ["TIMESHEET_RECALL_SELF"] }
    );
    setSaving(false);
    if (res?.skipped) return;
    if (res?.success) {
      toast.success("Timesheet recalled");
      setTimesheet(normalizeTimesheetRecord(res.data));
      loadWeekly();
    } else {
      toast.error(res?.message || "Recall failed");
    }
  };

  const openActionDialog = (ts: TeamTimesheet, type: "approve" | "reject") => {
    setSelectedTimesheet({
      ...ts,
      _id: getTimesheetId(ts)
    });
    setActionType(type);
    setComment("");
    setActionDialogOpen(true);
  };

  const submitAction = async () => {
    const selectedTimesheetId = getTimesheetId(selectedTimesheet);
    if (!selectedTimesheetId || selectedTimesheetId === "[object Object]") {
      toast.error("Invalid timesheet id");
      return;
    }
    const payload: { status: "approved" | "rejected"; rejectionReason?: string } = { status: actionType === "approve" ? "approved" : "rejected" };
    if (payload.status === "rejected") payload.rejectionReason = comment;

    const res = await putApiWithToken(
      `/timesheets/weekly/${selectedTimesheetId}/action`,
      payload,
      null,
      { requiredPermissions: ["TIMESHEET_ACTION"] }
    );
    if (res?.skipped) return;
    if (res?.success) {
      toast.success(`Timesheet ${payload.status}`);
      setActionDialogOpen(false);
      loadWeekly();
    } else {
      toast.error(res?.message || "Action failed");
    }
  };

  const isCheckedIn = Boolean(attendanceToday?.checkInAt && !attendanceToday?.checkOutAt);
  const attendanceRequestDefaultDate = isCheckedIn && attendanceToday?.date
    ? toDateKeyInOrgCalendar(attendanceToday.date)
    : shiftDateKey(toDateKeyInOrgTimeZone(new Date()), -1);
  const attendanceRequestDefaultType = attendanceToday?.checkOutAt ? "correction" : "missed_checkout";

  const timesheetLocked =
    timesheet?.status && ["submitted", "approved"].includes(timesheet.status);

  const shiftWeek = (direction: -1 | 1) => {
    const next = new Date(weekStart);
    next.setDate(next.getDate() + direction * 7);
    setWeekStartDate(next);
  };

  return (
    <MainLayout
      title="Timesheets"
      breadcrumb={[{ label: "Home", href: "/" }, { label: "Timesheets" }]}
    >
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <Button
          variant="outline"
          onClick={openAttendanceRequestDialog}
          disabled={!hasPermission("TIMESHEET_VIEW_SELF")}
        >
          Raise Attendance Request
        </Button>
        <div className="ml-auto text-xs text-muted-foreground">
          Today: {toDateInput(new Date())}
        </div>
      </div>

      <motion.div
        className="bg-card rounded-xl card-shadow overflow-hidden mb-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.22 }}
      >
        <div className="px-6 py-4 border-b border-border">
          <h3 className="text-lg font-semibold">My Attendance Requests</h3>
          <p className="text-sm text-muted-foreground">Raise request when missed checkout/check-in correction is needed.</p>
        </div>
        <div
          ref={myAttendanceRequestsViewportRef}
          className="max-h-[420px] overflow-auto"
          onScroll={handleMyAttendanceRequestsScroll}
        >
          <Table>
            <TableHeader>
              <TableRow className="table-header">
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Requested Time</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actioned By</TableHead>
                <TableHead>Approval</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {myAttendanceRequests.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-muted-foreground">No attendance requests</TableCell>
                </TableRow>
              )}
              {myAttendanceRequests.map((r) => {
                const actionedBy = resolveActionedBy(r);
                const actionedAt = resolveActionedAt(r);
                return (
                <TableRow key={r._actionId || toIdString(r._id)} className="table-row-hover">
                  <TableCell>
                    <div>{formatDateKeyInOrgCalendar(r.date)}</div>
                    {r.calendarDayType === "week_off" && (
                      <Badge className="mt-1 border-amber-300 bg-amber-100 text-amber-800 hover:bg-amber-100">
                        Week Off
                      </Badge>
                    )}
                    {r.calendarDayType === "holiday" && (
                      <Badge className="mt-1 border-violet-300 bg-violet-100 text-violet-800 hover:bg-violet-100">
                        Holiday{r.holidayName ? `: ${r.holidayName}` : ""}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{getAttendanceRequestTypeLabel(r.requestType)}</TableCell>
                  <TableCell>{r.requestedCheckInTime || "-"} / {r.requestedCheckOutTime || "-"}</TableCell>
                  <TableCell>{getStatusBadge(getAttendanceRequestStatus(r))}</TableCell>
                  <TableCell className="text-xs">
                    {actionedBy ? (
                      <div>
                        <div className="font-medium">{toPersonLabel(actionedBy)}</div>
                        {actionedAt && (
                          <div className="text-muted-foreground">{formatDateTimeInOrgTimeZone(actionedAt, {}, timeZone)}</div>
                        )}
                      </div>
                    ) : "-"}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground" title={approvalProgressLabel(r)}>
                    {approvalProgressLabel(r)}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate" title={r.reason}>{r.reason}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" className="gap-2" onClick={() => openAttendanceRequestDetail(r)}>
                      <Eye className="h-4 w-4" />
                      View
                    </Button>
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between border-t border-border px-6 py-3 text-xs text-muted-foreground">
          <span>
            Showing {myAttendanceRequests.length} of {myAttendanceRequestsTotalItems || myAttendanceRequests.length} attendance requests
          </span>
          {myAttendanceRequestsLoadingMore && <span>Loading more...</span>}
        </div>
      </motion.div>

      {showEmployeeOnlyPanels && canAction && (
        <motion.div
          className="bg-card rounded-xl card-shadow overflow-hidden mb-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.23 }}
        >
          <div className="px-6 py-4 border-b border-border">
            <h3 className="text-lg font-semibold">Pending Attendance Requests</h3>
            <p className="text-sm text-muted-foreground">Approve/reject employee attendance regularization requests.</p>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="table-header">
                <TableHead>Employee</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Requested Time</TableHead>
                <TableHead>Approval</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pendingAttendanceRequests.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground">No pending requests</TableCell>
                </TableRow>
              )}
              {pendingAttendanceRequests.map((r) => (
                <TableRow key={r._actionId || r._id} className="table-row-hover">
                  <TableCell>
                    {r.employeeId
                      ? `${r.employeeId.firstName || ""} ${r.employeeId.lastName || ""}`.trim()
                      : "-"}
                  </TableCell>
                  <TableCell>{formatDateKeyInOrgCalendar(r.date)}</TableCell>
                  <TableCell>{getAttendanceRequestTypeLabel(r.requestType)}</TableCell>
                  <TableCell>{r.requestedCheckInTime || "-"} / {r.requestedCheckOutTime || "-"}</TableCell>
                  <TableCell className="max-w-[240px] truncate text-xs text-muted-foreground" title={approvalProgressLabel(r)}>
                    {approvalProgressLabel(r)}
                  </TableCell>
                  <TableCell className="max-w-[220px] truncate" title={r.reason}>{r.reason}</TableCell>
                  <TableCell>
                    {canCurrentActorActionAttendanceRequest(r) ? (
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="gap-2" onClick={() => openAttendanceRequestDetail(r)}>
                          <Eye className="h-4 w-4" />
                          View
                        </Button>
                        <Button size="sm" onClick={() => actionAttendanceRequest(r, "approved")}>
                          Approve
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => actionAttendanceRequest(r, "rejected")}>
                          Reject
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">Not your step</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </motion.div>
      )}

      {isEmployeeRole && (
        <motion.div
          className="bg-card rounded-xl card-shadow overflow-hidden mb-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-border bg-muted/20">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold mr-2">Weekly Timesheet</h3>
              <Button
                variant="outline"
                size="icon"
                onClick={() => shiftWeek(-1)}
                aria-label="Previous week"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <div className="text-sm font-medium">
                {toDateInput(weekStart)} - {toDateInput(weekDates[6])}
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={() => shiftWeek(1)}
                aria-label="Next week"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
              <div className="ml-1 sm:ml-3 px-2.5 py-1 rounded-md bg-primary/10 text-primary text-sm font-semibold">
                Worked hours: {weekTotalHours} / {minWeeklyHours}
              </div>
              <div className="text-xs text-muted-foreground">
                ({toDateInput(weekStart)} - {toDateInput(weekDates[6])})
              </div>
            </div>
            <div className="flex items-center gap-3">
              {timesheet?._id ? getStatusBadge(timesheet.status) : <Badge>Draft</Badge>}
              <div className="text-xs text-muted-foreground">
              {timesheet?.status === "submitted" && "Waiting for approval"}
              {timesheet?.status === "approved" && "Approved"}
              {timesheet?.status === "rejected" && "Rejected - update and resubmit"}
              </div>
            </div>
          </div>
          {weekLoading && (
            <div className="px-6 py-3 space-y-2">
              <Skeleton className="h-8 w-56 rounded-md" />
              <Skeleton className="h-10 w-full rounded-md" />
              <Skeleton className="h-10 w-full rounded-md" />
              <Skeleton className="h-10 w-full rounded-md" />
            </div>
          )}
          {!isWeekSynced && !weekLoading && (
            <div className="px-6 py-2 text-xs text-amber-700 bg-amber-50 border-b border-amber-200">
              Week changed. Please wait for the correct week data to load before submitting.
            </div>
          )}
          {!isCurrentMonthWeek && (
            <div className="px-6 py-2 text-xs text-red-700 bg-red-50 border-b border-red-200">
              You can only submit timesheets for the current month.
            </div>
          )}
          {timesheet?.status === "rejected" && timesheet?.rejectionReason && (
            <div className="px-6 py-2 text-xs text-red-700 bg-red-50 border-b border-red-200">
              Rejection reason: {timesheet.rejectionReason}
            </div>
          )}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="table-header">
                  <TableHead className="w-32">Field</TableHead>
                  {weekDates.map((date) => {
                    const isWeekOff = weekOffDays.includes(date.getDay());
                    return (
                      <TableHead key={date.toISOString()} className={isWeekOff ? "opacity-60" : ""}>
                        <div className="flex flex-col">
                          <span>
                            {formatDateInOrgTimeZone(date, {
                              weekday: "short",
                              month: "short",
                              day: "numeric"
                            })}
                          </span>
                          {isWeekOff && (
                            <span className="text-xs text-muted-foreground">Week Off</span>
                          )}
                        </div>
                      </TableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="table-row-hover">
                  <TableCell className="font-medium">Hours</TableCell>
                  {weekDates.map((date, index) => {
                    const isWeekOff = weekOffDays.includes(date.getDay());
                    const isLeave = myLeaveDates.includes(toDateInput(date));
                    const rawHours = Number(entries[index]?.hours || 0);
                    const isInvalid =
                      rawHours > 0 && rawHours < minHalfDayHours;
                    return (
                      <TableCell key={date.toISOString()}>
                        {isWeekOff ? (
                          <div className="text-xs text-muted-foreground">
                            Week Off
                            <div>Full day: {minWorkHoursPerDay}h</div>
                          </div>
                        ) : isLeave ? (
                          <div className="text-xs text-muted-foreground">
                            On Leave
                          </div>
                        ) : (
                          <>
                            <Input
                              type="number"
                              min={0}
                              max={24}
                              step={0.5}
                              value={entries[index]?.hours ?? 0}
                              onChange={(e) => handleEntryChange(index, "hours", e.target.value)}
                              disabled={timesheetLocked || !canEdit}
                              className={isInvalid ? "border-red-500" : ""}
                            />
                            {isInvalid && (
                              <div className="text-xs text-red-500 mt-1">
                                Min half day: {minHalfDayHours}h
                              </div>
                            )}
                          </>
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
                <TableRow className="table-row-hover">
                  <TableCell className="font-medium">Notes</TableCell>
                  {weekDates.map((date, index) => {
                    const isWeekOff = weekOffDays.includes(date.getDay());
                    const isLeave = myLeaveDates.includes(toDateInput(date));
                    return (
                      <TableCell key={date.toISOString()}>
                        <Input
                          value={entries[index]?.notes ?? ""}
                          onChange={(e) => handleEntryChange(index, "notes", e.target.value)}
                          placeholder={isWeekOff ? "Week off" : "Work summary"}
                          disabled={timesheetLocked || isWeekOff || isLeave || !canEdit}
                        />
                      </TableCell>
                    );
                  })}
                </TableRow>
              </TableBody>
            </Table>
          </div>
          <div className="px-6 py-2 text-xs text-muted-foreground">
            Full day: {minWorkHoursPerDay}h · Half day: {minHalfDayHours}h ·
            Minimum weekly hours: {minWeeklyHours}h
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3 px-6 py-4 border-t border-border">
            {!timesheet?._id && canCreate && (
              <Button onClick={createDraft} disabled={saving}>
                Create Draft
              </Button>
            )}
            {timesheet?._id && !timesheetLocked && canEdit && (
              <Button variant="outline" onClick={saveDraft} disabled={saving}>
                Save Draft
              </Button>
            )}
            {timesheet?._id && !timesheetLocked && canSubmit && (
              <Button onClick={submitTimesheet} disabled={saving || !isCurrentMonthWeek}>
                Submit Timesheet
              </Button>
            )}
            {timesheet?._id && timesheet?.status === "approved" && canRecall && (
              <Button variant="outline" onClick={recallTimesheet} disabled={saving}>
                Recall
              </Button>
            )}
          </div>
        </motion.div>
      )}

      {viewMode === "all" && canAction && (
        <motion.div
          className="bg-card rounded-xl card-shadow overflow-hidden"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <div className="px-6 py-4 border-b border-border flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">Team Timesheets</h3>
              <p className="text-sm text-muted-foreground">Approve or reject weekly submissions</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowTeamTimesheets((prev) => !prev)}
              aria-label="Toggle Team Timesheets"
            >
              <ChevronDown className={`w-4 h-4 transition-transform ${showTeamTimesheets ? "rotate-0" : "-rotate-90"}`} />
            </Button>
          </div>
          {showTeamTimesheets && (
            <>
              <div
                ref={teamTableViewportRef}
                onScroll={handleTeamTimesheetsScroll}
                className="h-[420px] overflow-y-auto overflow-x-auto"
              >
              <Table>
                <TableHeader>
                  <TableRow className="table-header">
                    <TableHead>Employee</TableHead>
                    <TableHead>Week</TableHead>
                    <TableHead>Days</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Total Hours</TableHead>
                    <TableHead className="w-36">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {weeklyList.map((item) => {
                    const weeklyRowId = toIdString(item._id || item.id || item.employeeId);
                    return (
                    <TableRow key={weeklyRowId} className="table-row-hover">
                      <TableCell>
                        {item.employeeId
                          ? `${item.employeeId.firstName || ""} ${item.employeeId.lastName || ""}`.trim()
                          : "-"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {toDateInput(new Date(item.weekStart))} - {toDateInput(new Date(item.weekEnd))}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 text-xs">
                          {(item.entries || []).map((entry: WeeklyEntry, idx: number) => {
                            const status = getDayStatus(entry.date, Number(entry.hours || 0));
                            const base =
                              "px-1.5 py-0.5 rounded border text-[10px] leading-4";
                            const tone =
                              status.tone === "good"
                                ? "bg-green-50 text-green-700 border-green-200"
                                : status.tone === "warn"
                                  ? "bg-amber-50 text-amber-700 border-amber-200"
                                  : status.tone === "bad"
                                    ? "bg-red-50 text-red-700 border-red-200"
                                    : "bg-muted text-muted-foreground";

                            const label = formatDateInOrgTimeZone(entry.date, {
                              weekday: "short"
                            });

                            return (
                              <span
                                key={`${weeklyRowId}-${idx}`}
                                className={`${base} ${tone}`}
                                title={`${label}: ${status.label} (${Number(entry.hours || 0)}h)`}
                              >
                                {label[0]}
                                {status.label}
                              </span>
                            );
                          })}
                        </div>
                      </TableCell>
                      <TableCell>{getStatusBadge(item.status)}</TableCell>
                      <TableCell>{item.totalHours || 0}</TableCell>
                      <TableCell className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => openActionDialog(item, "approve")}
                          disabled={item.status !== "submitted"}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openActionDialog(item, "reject")}
                          disabled={item.status !== "submitted"}
                        >
                          Reject
                        </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              </div>
              <div className="border-t border-border px-6 py-3 text-sm text-muted-foreground">
                {weekLoading && weeklyList.length > 0
                  ? "Loading more timesheets..."
                  : teamLoadingMore
                    ? "Loading more timesheets..."
                    : hasMoreTeamTimesheets
                    ? `Showing ${weeklyList.length} of ${teamTotalItems} team timesheets. Scroll down to load more.`
                    : `Showing ${weeklyList.length} team timesheets.`}
              </div>
            </>
          )}
        </motion.div>
      )}

      <Dialog open={actionDialogOpen} onOpenChange={setActionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionType === "approve" ? "Approve Timesheet" : "Reject Timesheet"}
            </DialogTitle>
          </DialogHeader>
          {actionType === "reject" && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Reason</label>
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Add rejection reason"
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitAction}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={attendanceRequestOpen} onOpenChange={setAttendanceRequestOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Raise Attendance Request</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              type="date"
              value={attendanceRequestForm.date}
              onChange={(e) => setAttendanceRequestForm((prev) => ({ ...prev, date: e.target.value }))}
            />
            <select
              className="form-input"
              value={attendanceRequestForm.requestType}
              onChange={(e) => {
                const nextType = e.target.value as AttendanceRequestType;
                setAttendanceRequestForm((prev) => ({
                  ...prev,
                  requestType: nextType,
                  dayPortion: "full_day",
                  requestedCheckInTime: nextType === "missed_checkout" ? "" : prev.requestedCheckInTime,
                  requestedCheckOutTime: nextType === "work_from_home" ? "" : prev.requestedCheckOutTime
                }));
              }}
            >
              <option value="missed_checkout">Missed Checkout</option>
              <option value="correction">Correction</option>
              <option value="work_from_home">Work From Home</option>
            </select>
            {attendanceRequestForm.requestType === "work_from_home" && (
              <select
                className="form-input md:col-span-2"
                value={attendanceRequestForm.dayPortion}
                onChange={(event) =>
                  setAttendanceRequestForm((previous) => ({
                    ...previous,
                    dayPortion: event.target.value as "full_day" | "first_half" | "second_half"
                  }))
                }
              >
                <option value="full_day">Full Day WFH</option>
                <option value="first_half">First Half WFH</option>
                <option value="second_half">Second Half WFH</option>
              </select>
            )}
            <Input
              type="time"
              value={attendanceRequestForm.requestedCheckInTime}
              onChange={(e) =>
                setAttendanceRequestForm((prev) => ({ ...prev, requestedCheckInTime: e.target.value }))
              }
              placeholder="Requested check-in time"
              disabled={attendanceRequestForm.requestType === "missed_checkout" || attendanceRequestForm.requestType === "work_from_home"}
            />
            <Input
              type="time"
              value={attendanceRequestForm.requestedCheckOutTime}
              onChange={(e) =>
                setAttendanceRequestForm((prev) => ({ ...prev, requestedCheckOutTime: e.target.value }))
              }
              placeholder="Requested check-out time"
              disabled={attendanceRequestForm.requestType === "work_from_home"}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {attendanceRequestForm.requestType === "missed_checkout"
              ? "Provide the missing check-out time. Check-in time is taken from existing attendance."
              : attendanceRequestForm.requestType === "work_from_home"
                ? "Times are derived from the assigned shift and selected half. A half-day WFH counts as 0.5 present unless it combines with office attendance for the other half."
                : "Provide one or both times to request correction."}
          </p>
          {attendanceRequestForm.requestType === "correction" && attendanceToday?.checkOutAt && (
            <p className="text-xs text-sky-700 mt-1">
              Existing checkout found for this attendance day. New requests will be submitted as a correction.
            </p>
          )}
          {attendanceRequestForm.requestType === "missed_checkout" && isCheckedIn && attendanceToday?.date && (
            <p className="text-xs text-amber-700 mt-1">
              Open shift detected for {formatDateKeyInOrgCalendar(attendanceRequestDefaultDate)}. Keep this date to update the overnight attendance correctly.
            </p>
          )}
          <Textarea
            className="mt-3"
            placeholder="Reason"
            value={attendanceRequestForm.reason}
            onChange={(e) => setAttendanceRequestForm((prev) => ({ ...prev, reason: e.target.value }))}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAttendanceRequestOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitAttendanceRequest} disabled={attendanceRequestLoading}>
              {attendanceRequestLoading ? <InlineLoader label="Submitting..." className="text-white" /> : "Submit Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={attendanceRequestDetailOpen} onOpenChange={setAttendanceRequestDetailOpen}>
        <DialogContent className="max-w-lg p-0 overflow-hidden gap-0">
          {selectedAttendanceRequest && (() => {
            const req = selectedAttendanceRequest;
            const status = getAttendanceRequestStatus(req);
            const actionedBy = resolveActionedBy(req);
            const actionedAt = resolveActionedAt(req);
            const steps = req.approvalSteps || [];
            const isApproved = status === "approved";
            const isRejected = status === "rejected";
            const headerBg = "from-blue-500 to-blue-700";
            const typeIcon = req.requestType === "work_from_home"
              ? <Home className="w-5 h-5" />
              : req.requestType === "missed_checkout"
              ? <LogOut className="w-5 h-5" />
              : <LogIn className="w-5 h-5" />;
            const initials = actionedBy
              ? `${actionedBy.firstName?.[0] || ""}${actionedBy.lastName?.[0] || ""}`.toUpperCase() || "?"
              : null;

            return (
              <>
                {/* Premium header banner */}
                <div className={`bg-gradient-to-r ${headerBg} px-6 pt-6 pb-5 text-white`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="bg-white/20 rounded-xl p-2.5 backdrop-blur-sm">
                        {typeIcon}
                      </div>
                      <div>
                        <p className="text-white/70 text-xs font-medium uppercase tracking-wider mb-0.5">Attendance Request</p>
                        <h2 className="text-lg font-bold leading-tight">{getAttendanceRequestTypeLabel(req.requestType)}</h2>
                        {req.requestType === "work_from_home" && (
                          <p className="text-xs text-white/80">
                            {getAttendanceRequestTypeLabel(req.dayPortion || "full_day")}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full backdrop-blur-sm ${
                      isApproved ? "bg-white/25 text-white" : isRejected ? "bg-white/25 text-white" : "bg-white/25 text-white"
                    }`}>
                      {isApproved ? <CheckCircle className="w-3.5 h-3.5" /> : isRejected ? <XCircle className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                      {isApproved ? "Approved" : isRejected ? "Rejected" : "Pending"}
                    </div>
                  </div>

                  {/* Date strip */}
                  <div className="mt-4 flex items-center gap-4 text-sm">
                    <div className="flex items-center gap-1.5 bg-white/15 rounded-lg px-3 py-1.5">
                      <CalendarDays className="w-3.5 h-3.5 opacity-80" />
                      <span className="font-medium">{formatDateKeyInOrgCalendar(req.date)}</span>
                    </div>
                    <div className="flex items-center gap-2 text-white/80 text-xs">
                      <LogIn className="w-3.5 h-3.5" />
                      <span>{req.requestedCheckInTime || "—"}</span>
                      <span className="opacity-50">→</span>
                      <LogOut className="w-3.5 h-3.5" />
                      <span>{req.requestedCheckOutTime || "—"}</span>
                    </div>
                  </div>
                </div>

                {/* Body */}
                <div className="overflow-y-auto max-h-[55vh] px-6 py-5 space-y-5">

                  {/* Actioned by card */}
                  {actionedBy ? (
                    <div className="rounded-xl border p-4 flex items-center gap-4 bg-blue-50 border-blue-100">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0 bg-blue-600">
                        {initials}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-medium uppercase tracking-wider mb-0.5 text-blue-600">
                          {isApproved ? "Approved by" : isRejected ? "Rejected by" : "Actioned by"}
                        </p>
                        <p className="font-semibold text-sm truncate">{toPersonLabel(actionedBy)}</p>
                        {actionedAt && (
                          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatDateTimeInOrgTimeZone(actionedAt, {}, timeZone)}
                          </p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed bg-muted/20 p-4 flex items-center gap-3 text-muted-foreground">
                      <User className="w-5 h-5 flex-shrink-0" />
                      <span className="text-sm">Awaiting approval action</span>
                    </div>
                  )}

                  {/* Reason */}
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Reason</p>
                    </div>
                    <div className="rounded-xl border bg-muted/30 px-4 py-3 text-sm text-foreground whitespace-pre-wrap break-words leading-relaxed">
                      {req.reason || "—"}
                    </div>
                  </div>

                  {/* Rejection reason */}
                  {req.rejectionReason && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                        <p className="text-xs font-semibold uppercase tracking-wider text-red-500">Rejection Reason</p>
                      </div>
                      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 whitespace-pre-wrap break-words leading-relaxed">
                        {req.rejectionReason}
                      </div>
                    </div>
                  )}

                  {/* Approval timeline */}
                  {steps.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <CheckCircle2 className="w-3.5 h-3.5 text-muted-foreground" />
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Approval Timeline</p>
                      </div>
                      <div className="relative pl-6 space-y-0">
                        {steps.map((step, idx) => {
                          const isDone = step.status === "approved" || step.status === "rejected";
                          const isStepRejected = step.status === "rejected";
                          const isLast = idx === steps.length - 1;
                          return (
                            <div key={step.stepNumber} className="relative">
                              {/* Vertical line */}
                              {!isLast && (
                                <div className={`absolute left-[-16px] top-5 w-0.5 h-full ${isDone ? "bg-emerald-200" : "bg-border"}`} />
                              )}
                              {/* Dot */}
                              <div className={`absolute left-[-20px] top-1.5 w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                                isDone && !isStepRejected ? "bg-emerald-500 border-emerald-500" :
                                isStepRejected ? "bg-red-500 border-red-500" :
                                step.status === "pending" ? "bg-amber-400 border-amber-400" :
                                "bg-background border-border"
                              }`}>
                                {isDone && !isStepRejected && <CheckCircle2 className="w-2.5 h-2.5 text-white" />}
                                {isStepRejected && <XCircle className="w-2.5 h-2.5 text-white" />}
                                {step.status === "pending" && <Circle className="w-2 h-2 text-white fill-white" />}
                              </div>

                              <div className={`mb-4 rounded-xl border p-3 ${
                                isDone && !isStepRejected ? "bg-emerald-50/60 border-emerald-100" :
                                isStepRejected ? "bg-red-50/60 border-red-100" :
                                step.status === "pending" ? "bg-amber-50/60 border-amber-100" :
                                "bg-muted/20 border-border"
                              }`}>
                                <div className="flex items-center justify-between gap-2 mb-1">
                                  <span className="text-xs font-semibold">Step {step.stepNumber} · {approverLabel(step)}</span>
                                  <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                                    isDone && !isStepRejected ? "bg-emerald-100 text-emerald-700" :
                                    isStepRejected ? "bg-red-100 text-red-700" :
                                    step.status === "pending" ? "bg-amber-100 text-amber-700" :
                                    "bg-muted text-muted-foreground"
                                  }`}>
                                    {step.status}
                                  </span>
                                </div>
                                {step.actionBy && (
                                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                                    <User className="w-3 h-3" />
                                    {toPersonLabel(step.actionBy)}
                                    {step.actionAt && (
                                      <> · <Clock className="w-3 h-3" /> {formatDateTimeInOrgTimeZone(step.actionAt, {}, timeZone)}</>
                                    )}
                                  </p>
                                )}
                                {step.remarks && (
                                  <p className="text-xs text-muted-foreground mt-1 italic">"{step.remarks}"</p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t bg-muted/20 flex justify-end">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setAttendanceRequestDetailOpen(false);
                      setSelectedAttendanceRequest(null);
                    }}
                  >
                    Close
                  </Button>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
};

export default Timesheets;
