import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { motion } from "framer-motion";
import {
  CalendarCheck,
  Timer,
  ClipboardCheck,
  Users,
  CheckCircle2,
  Clock3,
  Bell,
  CalendarDays,
  AlertCircle,
  LogIn,
  LogOut,
  Network,
  UserCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useNavigate } from "react-router-dom";
import { getApiWithToken, postApiWithToken } from "@/services/apiWrapper";
import {
  RealtimeNotification,
  subscribeAttendanceUpdates,
  subscribeNotifications
} from "@/services/attendanceSocket";
import PermissionGate from "@/components/PermissionGate";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { getDeviceId } from "@/utils/deviceId";
import {
  formatDateInOrgTimeZone,
  formatDateTimeInOrgTimeZone,
  formatTimeInOrgTimeZone,
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
  const diff = (day + 6) % 7;
  d.setDate(d.getDate() - diff);
  return d;
};

const formatDuration = (milliseconds: number) => {
  const safeMilliseconds = Math.max(0, Math.floor(milliseconds));
  const totalSeconds = Math.floor(safeMilliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

let publicIpLookupPromise: Promise<string | null> | null = null;

const getPublicIpAddress = async () => {
  if (publicIpLookupPromise) return publicIpLookupPromise;

  publicIpLookupPromise = (async () => {
    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 4000);
      const response = await fetch("https://api.ipify.org?format=json", {
        signal: controller.signal
      });
      window.clearTimeout(timeout);
      if (!response.ok) return null;
      const data = await response.json();
      return typeof data?.ip === "string" && data.ip.trim() ? data.ip.trim() : null;
    } catch {
      return null;
    }
  })();

  return publicIpLookupPromise;
};


type AttendanceDay = {
  status: "present" | "half_day_present" | "full_day_present" | "absent" | "pending_checkout";
  checkInAt: string | null;
  checkOutAt: string | null;
  displayStatus?: string;
  displayLabel?: string;
  displayShortLabel?: string;
  displayTone?: string;
  workedMinutes?: number;
  workedDuration?: string;
  attendanceDateKey?: string;
  isFuture?: boolean;
  excludeFromPayroll?: boolean;
  missedCheckout?: boolean;
  isOnLeave: boolean;
  leaveType: string | null;
  isWeekOff: boolean;
  holidayName: string | null;
};

type AttendanceMatrixSummary = {
  presentDays: number;
  pendingCheckoutDays: number;
  absentDays: number;
  onLeaveDays: number;
  weekOffDays: number;
  holidayDays: number;
  selfieDays: number;
  payrollExcludedDays: number;
  totalDays: number;
};

type CheckInPolicy = {
  attendanceIpEnabled: boolean;
  attendanceSelfieRequired: boolean;
  attendanceMultiPunchEnabled: boolean;
  attendanceGeoFenceEnabled: boolean;
  attendanceGeoLatitude: number | null;
  attendanceGeoLongitude: number | null;
  localGeoFenceFallbackEnabled: boolean;
  attendanceGeoRadiusMeters: number;
  minWorkHoursPerDay: number;
  attendanceHoursSource: "monitor_agent" | "manual" | "biometric" | "access_card";
};

type WeeklyEntry = {
  date?: string;
  hours?: number;
  notes?: string;
};

type PersonSummary = {
  _id?: string;
  firstName?: string;
  lastName?: string;
  employeeCode?: string;
};

type OnlineEmployee = {
  _id?: string;
  employeeId?: PersonSummary | null;
  checkInAt?: string | null;
  checkOutAt?: string | null;
};

type TeamLeaveEmployee = {
  _id?: string;
  employeeId?: PersonSummary | null;
  leaveTypeId?: {
    name?: string;
    code?: string;
  } | null;
  fromDate?: string;
  toDate?: string;
};

type LeaveBalance = {
  leaveTypeId?: string;
  leaveType?: string;
  remaining?: number;
  total?: number;
  used?: number;
  pending?: number;
};

type EmployeeLeave = {
  _id?: string;
  status?: string;
  fromDate?: string;
  toDate?: string;
  leaveTypeName?: string;
  leaveTypeId?: { name?: string } | null;
};

type EmployeeNotification = {
  _id?: string;
  title?: string;
  message?: string;
  type?: string;
  meta?: Record<string, unknown>;
};

type HolidayItem = {
  _id?: string;
  name?: string;
  date?: string;
};

type UpcomingEvent = {
  employeeId?: string;
  eventDate?: string;
  daysAway?: number;
  years?: number;
  name?: string;
};

type MyProfile = {
  _id?: string;
  profileCompleted?: boolean;
  phone?: string;
  dob?: string;
  gender?: string;
  address?: { line1?: string } | null;
  emergencyContacts?: unknown[];
  shiftId?: {
    name?: string;
    code?: string;
    startTime?: string | null;
    endTime?: string | null;
  } | null;
  managerId?: {
    _id?: string;
    firstName?: string;
    lastName?: string;
  } | null;
  firstName?: string;
  lastName?: string;
  employeeCode?: string;
  departmentId?: { _id?: string; name?: string } | null;
  designationId?: { _id?: string; name?: string } | null;
  profileImage?: string | null;
  status?: string;
};

type TeamMember = {
  _id?: string;
  firstName?: string;
  lastName?: string;
  employeeCode?: string;
  departmentId?: { _id?: string; name?: string } | null;
  designationId?: { _id?: string; name?: string } | null;
  profileImage?: string | null;
  status?: string;
};

type TimesheetSummary = {
  status?: string;
  entries?: WeeklyEntry[];
};

type AttendanceTodayRecord = AttendanceDay & {
  checkInIp?: string | null;
  checkInDeviceId?: string | null;
  checkInLatitude?: number | null;
  checkInLongitude?: number | null;
  checkInSelfieProvided?: boolean;
  checkOutIp?: string | null;
  checkOutDeviceId?: string | null;
  checkOutLatitude?: number | null;
  checkOutLongitude?: number | null;
  checkOutSelfieProvided?: boolean;
  lateByMinutes?: number;
  shiftStartTime?: string | null;
  shiftEndTime?: string | null;
  scheduledStartAt?: string | null;
  scheduledEndAt?: string | null;
  dayHistory?: Array<{
    action?: "check_in" | "check_out";
    at?: string | Date | null;
  }>;
};

const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const formatShiftTime = (value?: string | null) => {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [hoursText, minutesText] = value.split(":");
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return value;
  const meridiem = hours >= 12 ? "PM" : "AM";
  const normalizedHours = hours % 12 || 12;
  return `${normalizedHours}:${String(minutes).padStart(2, "0")} ${meridiem}`;
};

const shiftTimeToMinutes = (value?: string | null) => {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [hoursText, minutesText] = value.split(":");
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return (hours * 60) + minutes;
};

const formatMinutesAsShiftTime = (totalMinutes: number | null) => {
  if (!Number.isFinite(totalMinutes)) return null;
  const normalizedMinutes = ((Number(totalMinutes) % (24 * 60)) + (24 * 60)) % (24 * 60);
  const hours = Math.floor(normalizedMinutes / 60);
  const minutes = normalizedMinutes % 60;
  const meridiem = hours >= 12 ? "PM" : "AM";
  const normalizedHours = hours % 12 || 12;
  return `${normalizedHours}:${String(minutes).padStart(2, "0")} ${meridiem}`;
};

const captureSelfieFromCamera = async (): Promise<string | null> => {
  if (!navigator.mediaDevices?.getUserMedia) return null;

  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.zIndex = "9999";
    overlay.style.background = "rgba(0,0,0,0.8)";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";

    const card = document.createElement("div");
    card.style.background = "#fff";
    card.style.padding = "12px";
    card.style.borderRadius = "12px";
    card.style.width = "min(92vw, 420px)";
    card.style.display = "flex";
    card.style.flexDirection = "column";
    card.style.gap = "10px";

    const title = document.createElement("div");
    title.textContent = "Take Selfie for Check-In";
    title.style.fontWeight = "600";

    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = stream;
    video.style.width = "100%";
    video.style.borderRadius = "8px";

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "8px";
    actions.style.justifyContent = "flex-end";

    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    cancel.style.padding = "8px 10px";

    const capture = document.createElement("button");
    capture.textContent = "Capture";
    capture.style.padding = "8px 10px";

    const cleanup = () => {
      stream.getTracks().forEach((t) => t.stop());
      overlay.remove();
    };

    cancel.onclick = () => {
      cleanup();
      resolve(null);
    };

    capture.onclick = () => {
      const maxSide = 480;
      const canvas = document.createElement("canvas");
      const vw = video.videoWidth || 640;
      const vh = video.videoHeight || 480;
      const scale = Math.min(1, maxSide / Math.max(vw, vh));
      canvas.width = Math.max(1, Math.round(vw * scale));
      canvas.height = Math.max(1, Math.round(vh * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        cleanup();
        resolve(null);
        return;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = canvas.toDataURL("image/jpeg", 0.7);
      cleanup();
      resolve(image);
    };

    actions.append(cancel, capture);
    card.append(title, video, actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  });
};

const EmployeeDashboard = () => {
  const navigate = useNavigate();
  const today = new Date();
  const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const currentYear = today.getFullYear();

  const [weeklyStatus, setWeeklyStatus] = useState<string | null>(null);
  const [weeklyHours, setWeeklyHours] = useState<number>(0);
  const [weeklyEntries, setWeeklyEntries] = useState<WeeklyEntry[]>([]);
  const [onlineList, setOnlineList] = useState<OnlineEmployee[]>([]);
  const [onLeaveList, setOnLeaveList] = useState<TeamLeaveEmployee[]>([]);
  const [attendanceToday, setAttendanceToday] = useState<AttendanceTodayRecord | null>(null);
  const [leaveBalances, setLeaveBalances] = useState<LeaveBalance[]>([]);
  const [myLeaves, setMyLeaves] = useState<EmployeeLeave[]>([]);
  const [notifications, setNotifications] = useState<EmployeeNotification[]>([]);
  const [upcomingHolidays, setUpcomingHolidays] = useState<HolidayItem[]>([]);
  const [weekOffDays, setWeekOffDays] = useState<number[]>([]);
  const [upcomingEvents, setUpcomingEvents] = useState<{ birthdays: UpcomingEvent[]; anniversaries: UpcomingEvent[] }>({
    birthdays: [],
    anniversaries: []
  });
  const [matrixDays, setMatrixDays] = useState<Record<number, AttendanceDay>>({});
  const [matrixSummary, setMatrixSummary] = useState<AttendanceMatrixSummary | null>(null);
  const [daysInMonth, setDaysInMonth] = useState<number>(31);
  const [myProfile, setMyProfile] = useState<MyProfile | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [attendanceRefreshLoading, setAttendanceRefreshLoading] = useState(false);
  const [checkinLoading, setCheckinLoading] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [clockTick, setClockTick] = useState(() => Date.now());
  const [activeTab, setActiveTab] = useState("overview");
  const [leaveBalanceDialogOpen, setLeaveBalanceDialogOpen] = useState(false);
  const [onlineDialogOpen, setOnlineDialogOpen] = useState(false);
  const [pendingDialogOpen, setPendingDialogOpen] = useState(false);
  const [weeklyDialogOpen, setWeeklyDialogOpen] = useState(false);
  const [dayHistoryDialogOpen, setDayHistoryDialogOpen] = useState(false);
  const [checkInPolicy, setCheckInPolicy] = useState<CheckInPolicy>({
    attendanceIpEnabled: false,
    attendanceSelfieRequired: false,
    attendanceMultiPunchEnabled: false,
    attendanceGeoFenceEnabled: false,
    attendanceGeoLatitude: null,
    attendanceGeoLongitude: null,
    localGeoFenceFallbackEnabled: false,
    attendanceGeoRadiusMeters: 200,
    minWorkHoursPerDay: 8,
    attendanceHoursSource: "manual"
  });
  const hasShownMatrixCompatibilityErrorRef = useRef(false);

  const [directReports, setDirectReports] = useState<TeamMember[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const teamLoadedRef = useRef(false);

  const loadTeam = useCallback(async () => {
    setTeamLoading(true);
    const myId = myProfile?._id;
    if (myId) {
      const res = await getApiWithToken(`/employees?managerId=${myId}&limit=50`, null, {
        requiredPermissions: ["EMP_VIEW"],
      });
      if (res?.success) {
        setDirectReports(res.data?.items || res.data || []);
      }
    }
    setTeamLoading(false);
  }, [myProfile?._id]);

  const weekStart = useMemo(() => getWeekStart(new Date()), []);

  const loadDashboard = useCallback(async (silent = false) => {
    if (!silent) setDashboardLoading(true);
    const todayIso = toDateKeyInOrgTimeZone(new Date());
    const weekStartIso = toDateInput(weekStart);
    const [weeklyRes, attendanceRes, leaveRes, balanceRes, onlineRes, onLeaveRes, notifRes, holidayRes, weekOffRes, matrixRes, profileRes, eventsRes, checkInPolicyRes] =
      await Promise.all([
        getApiWithToken(`/timesheets/weekly/my?weekStart=${weekStartIso}`, null, {
          requiredPermissions: ["TIMESHEET_VIEW_SELF"]
        }),
        getApiWithToken(`/timesheets/attendance/my?date=${todayIso}`, null, {
          requiredPermissions: ["TIMESHEET_VIEW_SELF", "TIMESHEET_CHECKIN_SELF", "TIMESHEET_CHECKOUT_SELF"]
        }),
        getApiWithToken("/leaves/my", null, {
          requiredPermissions: ["LEAVE_VIEW_SELF"]
        }),
        getApiWithToken("/leave-balances/my", null, {
          requiredPermissions: ["LEAVE_VIEW_SELF"]
        }),
        getApiWithToken("/timesheets/online", null, {
          requiredPermissions: ["TIMESHEET_VIEW_ONLINE"]
        }),
        getApiWithToken("/timesheets/on-leave", null, {
          requiredPermissions: ["TIMESHEET_VIEW_ALL"]
        }),
        getApiWithToken("/notifications/my?limit=6", null, {
          requiredPermissions: ["NOTIFICATION_VIEW_SELF"]
        }),
        getApiWithToken(`/holidays?year=${currentYear}`, null, {
          requiredPermissions: ["HOLIDAY_VIEW", "LEAVE_VIEW_SELF", "LEAVE_APPLY"]
        }),
        getApiWithToken("/week-offs", null, {
          requiredPermissions: ["WEEK_OFF_VIEW"]
        }),
        getApiWithToken(`/timesheets/attendance/matrix/my?month=${currentMonth}`, null, {
          requiredPermissions: ["ATTENDANCE_VIEW_SELF", "TIMESHEET_VIEW_SELF"]
        }),
        getApiWithToken("/employees/me", null, {
          requiredPermissions: ["EMP_SELF_VIEW"]
        }),
        getApiWithToken("/employees/upcoming-events?days=7", null, {
          requiredPermissions: ["EMP_SELF_VIEW", "EMP_VIEW"]
        }),
        getApiWithToken("/timesheets/checkin-policy", null, {
          requiredPermissions: ["TIMESHEET_CHECKIN_SELF"]
        })
      ]);

    if (weeklyRes?.success && weeklyRes?.data) {
      setWeeklyStatus(weeklyRes.data.status || "draft");
      const entries = weeklyRes.data.entries || [];
      setWeeklyEntries(entries);
          const total = entries.reduce((sum: number, e: WeeklyEntry) => sum + (Number(e.hours) || 0), 0);
      setWeeklyHours(total);
    } else {
      setWeeklyStatus(null);
      setWeeklyHours(0);
      setWeeklyEntries([]);
    }

    if (attendanceRes?.success) {
      const record = (attendanceRes.data || [])[0];
      setAttendanceToday(record || null);
    } else {
      setAttendanceToday(null);
    }

    setMyLeaves(leaveRes?.success ? (leaveRes.data || []) : []);
    setLeaveBalances(balanceRes?.success ? (balanceRes.data || []) : []);
    setOnlineList(onlineRes?.success ? (onlineRes.data || []) : []);
    setOnLeaveList(onLeaveRes?.success ? (onLeaveRes.data || []) : []);
    setNotifications(notifRes?.success ? (notifRes.data?.items || []) : []);

    if (holidayRes?.success) {
      const now = new Date();
      const upcoming = (holidayRes.data || [])
        .filter((h: HolidayItem) => new Date(h.date || "") >= new Date(now.getFullYear(), now.getMonth(), now.getDate()))
        .slice(0, 6);
      setUpcomingHolidays(upcoming);
    } else {
      setUpcomingHolidays([]);
    }

    setWeekOffDays(weekOffRes?.success ? (weekOffRes.data?.weekOffDays || []) : []);
    setUpcomingEvents(
      eventsRes?.success
        ? {
            birthdays: eventsRes.data?.birthdays || [],
            anniversaries: eventsRes.data?.anniversaries || []
          }
        : { birthdays: [], anniversaries: [] }
    );

    if (matrixRes?.success) {
      const row = matrixRes.data?.employees?.[0];
      const decoratedDays = row?.days || {};
      const sampleDay = Object.values(decoratedDays).find(Boolean) as AttendanceDay | undefined;
      const hasDecoratedCell = sampleDay ? typeof sampleDay.displayStatus === "string" : true;

      if (!hasDecoratedCell) {
        setMatrixDays({});
        setMatrixSummary(null);
        setDaysInMonth(Number(matrixRes.data?.daysInMonth || 31));
        if (!hasShownMatrixCompatibilityErrorRef.current) {
          hasShownMatrixCompatibilityErrorRef.current = true;
          toast.error("Attendance backend is outdated. Restart backend to load dashboard attendance statuses.");
        }
      } else {
        hasShownMatrixCompatibilityErrorRef.current = false;
        setMatrixDays(decoratedDays);
        setMatrixSummary(row?.summary || null);
        setDaysInMonth(Number(matrixRes.data?.daysInMonth || 31));
      }
    } else {
      setMatrixDays({});
      setMatrixSummary(null);
      setDaysInMonth(31);
    }

    setMyProfile(profileRes?.success ? (profileRes.data || null) : null);

    if (checkInPolicyRes?.success && checkInPolicyRes?.data) {
      setCheckInPolicy({
        attendanceIpEnabled: Boolean(checkInPolicyRes.data.attendanceIpEnabled),
        attendanceSelfieRequired: Boolean(checkInPolicyRes.data.attendanceSelfieRequired),
        attendanceMultiPunchEnabled: Boolean(checkInPolicyRes.data.attendanceMultiPunchEnabled),
        attendanceGeoFenceEnabled: Boolean(checkInPolicyRes.data.attendanceGeoFenceEnabled),
        attendanceGeoLatitude:
          checkInPolicyRes.data.attendanceGeoLatitude === null || checkInPolicyRes.data.attendanceGeoLatitude === undefined
            ? null
            : Number(checkInPolicyRes.data.attendanceGeoLatitude),
        attendanceGeoLongitude:
          checkInPolicyRes.data.attendanceGeoLongitude === null || checkInPolicyRes.data.attendanceGeoLongitude === undefined
            ? null
            : Number(checkInPolicyRes.data.attendanceGeoLongitude),
        localGeoFenceFallbackEnabled: Boolean(checkInPolicyRes.data.localGeoFenceFallbackEnabled),
        attendanceGeoRadiusMeters: Number(checkInPolicyRes.data.attendanceGeoRadiusMeters || 200),
        minWorkHoursPerDay: Number(checkInPolicyRes.data.minWorkHoursPerDay || 8),
        attendanceHoursSource: checkInPolicyRes.data.attendanceHoursSource || "manual"
      });
    }
    if (!silent) setDashboardLoading(false);
  }, [weekStart]);

  const refreshAttendanceToday = useCallback(async () => {
    if (attendanceRefreshLoading) return;
    setAttendanceRefreshLoading(true);
    try {
      const todayIso = toDateKeyInOrgTimeZone(new Date());
      const attendanceRes = await getApiWithToken(`/timesheets/attendance/my?date=${todayIso}`, null, {
        requiredPermissions: ["TIMESHEET_VIEW_SELF", "TIMESHEET_CHECKIN_SELF", "TIMESHEET_CHECKOUT_SELF"]
      });

      if (attendanceRes?.success) {
        const record = (attendanceRes.data || [])[0];
        setAttendanceToday(record || null);
      }
    } finally {
      setAttendanceRefreshLoading(false);
    }
  }, [attendanceRefreshLoading]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setClockTick(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeAttendanceUpdates((payload) => {
      if (payload?.attendance) {
        setAttendanceToday(payload.attendance as AttendanceTodayRecord);
      }
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    return subscribeNotifications((notification: RealtimeNotification) => {
      setNotifications((previous) => {
        if (previous.some((item) => item._id === notification._id)) return previous;
        return [notification, ...previous].slice(0, 6);
      });

      if (notification.type === "leave_action") {
        const leaveId = String(notification.meta?.leaveId || "");
        const status = String(notification.meta?.status || "");
        if (leaveId && status) {
          setMyLeaves((previous) =>
            previous.map((leave) =>
              String(leave._id) === leaveId ? { ...leave, status } : leave
            )
          );
        }
      }
    });
  }, []);

  useEffect(() => {
    if (activeTab === "team" && !teamLoadedRef.current && myProfile?._id) {
      teamLoadedRef.current = true;
      loadTeam();
    }
  }, [activeTab, myProfile?._id, loadTeam]);

  const monthlySummary = useMemo(() => ({
    present: Number(matrixSummary?.presentDays || 0),
    pendingCheckout: Number(matrixSummary?.pendingCheckoutDays || 0),
    absent: Number(matrixSummary?.absentDays || 0),
    onLeave: Number(matrixSummary?.onLeaveDays || 0),
    weekOff: Number(matrixSummary?.weekOffDays || 0),
    total: Number(matrixSummary?.totalDays || daysInMonth)
  }), [daysInMonth, matrixSummary]);

  const pendingLeaves = useMemo(
    () => (myLeaves || []).filter((l) => l.status === "pending").length,
    [myLeaves]
  );
  const pendingLeaveItems = useMemo(
    () => (myLeaves || []).filter((l) => l.status === "pending"),
    [myLeaves]
  );

  const pendingTimesheets = useMemo(
    () => (weeklyStatus === "submitted" ? 1 : 0),
    [weeklyStatus]
  );

  const missingProfileFields = useMemo(() => {
    if (!myProfile) return [];
    const missing: string[] = [];
    if (!myProfile.phone) missing.push("Phone");
    if (!myProfile.dob) missing.push("Date of birth");
    if (!myProfile.gender) missing.push("Gender");
    if (!myProfile.address?.line1) missing.push("Address");
    if (!Array.isArray(myProfile.emergencyContacts) || myProfile.emergencyContacts.length === 0) {
      missing.push("Emergency contact");
    }
    return missing;
  }, [myProfile]);

  const totalLeaveRemaining = useMemo(
    () => (leaveBalances || []).reduce((sum: number, b) => sum + Number(b.remaining || 0), 0),
    [leaveBalances]
  );

  const weeklyProgress = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayKey = toDateInput(todayStart);
    const sundayStart = new Date(todayStart);
    sundayStart.setDate(todayStart.getDate() - todayStart.getDay());

    const dayRows = Array.from({ length: 7 }, (_, idx) => {
      const dayDate = new Date(sundayStart);
      dayDate.setDate(sundayStart.getDate() + idx);
      dayDate.setHours(0, 0, 0, 0);
      const dayKey = toDateInput(dayDate);

      const dayName = dayNames[dayDate.getDay()];
      const entryForDay = (weeklyEntries || []).find((e) => {
        if (!e?.date) return false;
        return toDateInput(new Date(e.date)) === dayKey;
      });
      const timesheetHours = Number(entryForDay?.hours || 0);

      const matrixCell = dayDate.getMonth() === today.getMonth() && dayDate.getFullYear() === today.getFullYear()
        ? matrixDays[dayDate.getDate()]
        : null;

      const attendanceHours = Number(matrixCell?.workedMinutes || 0) / 60;

      return {
        dayName,
        date: dayDate,
        timesheetHours,
        attendanceHours,
        completedHours: timesheetHours
      };
    });

    const completedTimesheetHours = dayRows
      .filter((d) => toDateInput(new Date(d.date)) <= todayKey)
      .reduce((sum, d) => sum + Number(d.timesheetHours || 0), 0);

    const todayTimesheetHours = dayRows.find((d) => toDateInput(new Date(d.date)) === todayKey)?.timesheetHours || 0;
    const authoritativeWeeklyHours = Number.isFinite(Number(weeklyHours))
      ? Number(weeklyHours)
      : completedTimesheetHours;

    return {
      completedTimesheetHours,
      todayTimesheetHours,
      todayLiveHours: Number((matrixDays[new Date().getDate()]?.workedMinutes || 0) / 60),
      completedIncludingToday: authoritativeWeeklyHours,
      dayRows
    };
  }, [weeklyEntries, matrixDays, weeklyHours]);

  const hasCheckedInToday = Boolean(attendanceToday?.checkInAt);
  const attendanceRuntimeStatus = (attendanceToday as { status?: string } | null)?.status;
  const latestPunchAction = attendanceToday?.dayHistory?.length
    ? attendanceToday.dayHistory[attendanceToday.dayHistory.length - 1]?.action
    : null;
  const isCheckedIn = hasCheckedInToday && (
    latestPunchAction === "check_in"
    || attendanceRuntimeStatus === "checked_in"
    || !attendanceToday?.checkOutAt
  );
  const isCheckedOut = hasCheckedInToday && (
    latestPunchAction === "check_out"
    || attendanceRuntimeStatus === "checked_out"
    || (Boolean(attendanceToday?.checkOutAt) && !isCheckedIn)
  );

  const firstCheckInAt = useMemo(() => {
    const punches = attendanceToday?.dayHistory || [];
    const firstCheckIn = punches.find((entry) => entry?.action === "check_in" && entry?.at);
    return firstCheckIn?.at || attendanceToday?.checkInAt || null;
  }, [attendanceToday]);

  const dayHistoryRows = useMemo(() => {
    const punches = [...(attendanceToday?.dayHistory || [])]
      .filter((entry) => entry?.action && entry?.at)
      .sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime());

    if (punches.length > 0) {
      return punches;
    }

    const fallbackRows: Array<Record<string, any>> = [];
    if (attendanceToday?.checkInAt) {
      fallbackRows.push({
        action: "check_in",
        at: attendanceToday.checkInAt,
        ip: attendanceToday.checkInIp || null,
        deviceId: attendanceToday.checkInDeviceId || null,
        latitude: attendanceToday.checkInLatitude ?? null,
        longitude: attendanceToday.checkInLongitude ?? null,
        selfieProvided: Boolean(attendanceToday.checkInSelfieProvided),
        source: "api"
      });
    }
    if (attendanceToday?.checkOutAt) {
      fallbackRows.push({
        action: "check_out",
        at: attendanceToday.checkOutAt,
        ip: attendanceToday.checkOutIp || null,
        deviceId: attendanceToday.checkOutDeviceId || null,
        latitude: null,
        longitude: null,
        selfieProvided: Boolean(attendanceToday.checkOutSelfieProvided),
        source: "api"
      });
    }
    return fallbackRows;
  }, [attendanceToday]);

  const checkInTimeText = firstCheckInAt
    ? formatTimeInOrgTimeZone(firstCheckInAt)
    : "-";
  const checkOutTimeText = attendanceToday?.checkOutAt
    ? formatTimeInOrgTimeZone(attendanceToday.checkOutAt)
    : "-";
  const assignedShift = myProfile?.shiftId || null;
  const shiftNameText = (attendanceToday as any)?.shiftName || assignedShift?.name || "Assigned Shift";
  const shiftStartText = formatShiftTime(attendanceToday?.shiftStartTime || assignedShift?.startTime);
  const shiftEndText = formatShiftTime(attendanceToday?.shiftEndTime || assignedShift?.endTime);
  const shiftTimingsText = shiftStartText && shiftEndText
    ? `${shiftStartText} - ${shiftEndText}`
    : shiftStartText || shiftEndText || "-";
  const firstCheckInDate = firstCheckInAt ? new Date(firstCheckInAt) : null;
  const checkOutDate = attendanceToday?.checkOutAt ? new Date(attendanceToday.checkOutAt) : null;
  const scheduledEndDate = attendanceToday?.scheduledEndAt ? new Date(attendanceToday.scheduledEndAt) : null;
  const minimumWorkDurationMs = Number(checkInPolicy.minWorkHoursPerDay || 8) * 60 * 60 * 1000;
  const effectiveDisplayDurationMs = firstCheckInDate
    ? (() => {
      const liveElapsedMs = clockTick - firstCheckInDate.getTime();
      if (!isCheckedOut) return liveElapsedMs;
      const actualAtCheckoutMs = checkOutDate ? checkOutDate.getTime() - firstCheckInDate.getTime() : liveElapsedMs;
      if (actualAtCheckoutMs >= minimumWorkDurationMs) return actualAtCheckoutMs;
      return Math.min(liveElapsedMs, minimumWorkDurationMs);
    })()
    : null;
  const effectiveDisplayDurationText = Number.isFinite(Number(effectiveDisplayDurationMs))
    ? formatDuration(Number(effectiveDisplayDurationMs))
    : null;
  const effectiveDisplayDurationParts = effectiveDisplayDurationText ? effectiveDisplayDurationText.split(":") : null;
  const remainingToCheckoutText = isCheckedIn && scheduledEndDate
    ? formatDuration(scheduledEndDate.getTime() - clockTick)
    : null;
  const remainingToMinimumText = firstCheckInDate
    ? formatDuration(Math.max(0, minimumWorkDurationMs - ((isCheckedOut && checkOutDate ? checkOutDate.getTime() : clockTick) - firstCheckInDate.getTime())))
    : null;
  const checkInWindowStartText = useMemo(() => {
    const startMinutes = shiftTimeToMinutes(attendanceToday?.shiftStartTime || assignedShift?.startTime);
    if (startMinutes === null) return null;
    return formatMinutesAsShiftTime(startMinutes - 120);
  }, [assignedShift?.startTime, attendanceToday?.shiftStartTime]);
  const statusHeroClassName = isCheckedOut
    ? "border-amber-200/80 bg-[linear-gradient(135deg,rgba(255,251,235,0.98),rgba(254,243,199,0.84)_42%,rgba(255,255,255,0.98))]"
    : isCheckedIn
      ? "border-emerald-200/80 bg-[linear-gradient(135deg,rgba(236,253,245,0.98),rgba(220,252,231,0.84)_42%,rgba(255,255,255,0.98))]"
      : "border-teal-200/80 bg-[linear-gradient(135deg,rgba(236,253,245,0.98),rgba(204,251,241,0.84)_42%,rgba(255,255,255,0.98))]";
  const balanceCardClassName =
    "stat-card border-emerald-200/70 bg-[linear-gradient(135deg,rgba(236,253,245,0.92),rgba(209,250,229,0.72)_48%,rgba(255,255,255,0.96))]";
  const weeklyCardClassName =
    "stat-card border-emerald-200/70 bg-[linear-gradient(135deg,rgba(236,253,245,0.94),rgba(209,250,229,0.78)_48%,rgba(255,255,255,0.96))]";
  const teamCardClassName =
    "stat-card border-amber-200/70 bg-[linear-gradient(135deg,rgba(255,251,235,0.94),rgba(254,243,199,0.72)_48%,rgba(255,255,255,0.96))]";
  const pendingCardClassName =
    "stat-card border-amber-200/70 bg-[linear-gradient(135deg,rgba(255,251,235,0.94),rgba(254,243,199,0.76)_48%,rgba(255,255,255,0.96))]";
  const panelGradientClassName =
    "border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.96)_100%)]";
  const softInsetClassName =
    "bg-[linear-gradient(135deg,rgba(255,255,255,0.82),rgba(248,250,252,0.72))]";
  const clockBoxClassName = isCheckedOut
    ? "bg-[linear-gradient(180deg,#f59e0b_0%,#fbbf24_55%,#fde68a_100%)] ring-1 ring-amber-200/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_14px_28px_rgba(245,158,11,0.18)]"
    : isCheckedIn
      ? "bg-[linear-gradient(180deg,#059669_0%,#10b981_55%,#6ee7b7_100%)] ring-1 ring-emerald-200/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_14px_28px_rgba(16,185,129,0.18)]"
      : "bg-[linear-gradient(180deg,#15803d_0%,#29b37e_55%,#6ee7b7_100%)] ring-1 ring-emerald-200/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_14px_28px_rgba(41,179,126,0.18)]";
  const secondaryHeroButtonClassName =
    "h-10 rounded-xl border-white/70 bg-white/75 px-4 text-slate-700 shadow-sm backdrop-blur transition hover:bg-white hover:text-slate-900";
  const primaryHeroButtonClassName = isCheckedOut
    ? "h-10 rounded-xl border-emerald-700 bg-[linear-gradient(135deg,#047857,#10b981)] px-4 text-white shadow-[0_10px_24px_rgba(16,185,129,0.24)] transition hover:brightness-105"
    : isCheckedIn
      ? "h-10 rounded-xl border-amber-700 bg-[linear-gradient(135deg,#b45309,#f59e0b)] px-4 text-white shadow-[0_10px_24px_rgba(245,158,11,0.24)] transition hover:brightness-105"
      : "h-10 rounded-xl border-emerald-700 bg-[linear-gradient(135deg,#15803d,#29b37e)] px-4 text-white shadow-[0_10px_24px_rgba(41,179,126,0.24)] transition hover:brightness-105";

  const lateFlag = useMemo(() => {
    return Number(attendanceToday?.lateByMinutes || 0) > 0;
  }, [attendanceToday]);

  const getCurrentLocation = async (actionLabel: "check-in" | "check-out") => {
    if (!navigator.geolocation) {
      throw new Error("Location is not supported on this browser");
    }
    if (!window.isSecureContext) {
      throw new Error("Location requires HTTPS or localhost. Please open the app on a secure URL.");
    }

    const readPosition = (options: PositionOptions) =>
      new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, options);
      });

    const watchPositionOnce = (options: PositionOptions) =>
      new Promise<GeolocationPosition>((resolve, reject) => {
        let settled = false;
        let watchId: number | null = null;
        const timer = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          if (watchId !== null) {
            navigator.geolocation.clearWatch(watchId);
          }
          reject(new Error("Location lookup timed out"));
        }, 45000);

        watchId = navigator.geolocation.watchPosition(
          (position) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            if (watchId !== null) {
              navigator.geolocation.clearWatch(watchId);
            }
            resolve(position);
          },
          (error) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            if (watchId !== null) {
              navigator.geolocation.clearWatch(watchId);
            }
            reject(error);
          },
          options
        );
      });

    const buildLocationErrorMessage = (error: GeolocationPositionError) => {
      if (error.code === error.PERMISSION_DENIED) {
        return `Location permission is required for ${actionLabel}`;
      }
      if (error.code === error.TIMEOUT) {
        return "Unable to get location. Please turn on device location and try again.";
      }
      if (error.code === error.POSITION_UNAVAILABLE) {
        return "Current location is unavailable. Please turn on device location, disable VPN/location blockers, and try again.";
      }
      return error.message || `Unable to get current location for ${actionLabel}`;
    };

    try {
      return await readPosition({ enableHighAccuracy: false, timeout: 3000, maximumAge: Infinity });
    } catch {
      // Continue to a fresh location lookup when no cached position exists.
    }

    try {
      return await readPosition({ enableHighAccuracy: true, timeout: 30000, maximumAge: 0 });
    } catch (error) {
      const geoError = error as GeolocationPositionError;
      if (geoError.code === geoError.PERMISSION_DENIED) {
        throw new Error(`Location permission is required for ${actionLabel}`);
      }
      try {
        return await readPosition({ enableHighAccuracy: false, timeout: 30000, maximumAge: 300000 });
      } catch (fallbackError) {
        const fallbackGeoError = fallbackError as GeolocationPositionError;
        if (fallbackGeoError.code === fallbackGeoError.PERMISSION_DENIED) {
          throw new Error(`Location permission is required for ${actionLabel}`);
        }
        try {
          return await watchPositionOnce({ enableHighAccuracy: false, timeout: 45000, maximumAge: 300000 });
        } catch (watchError) {
          const watchGeoError = watchError as GeolocationPositionError;
          if (watchError instanceof Error && !("code" in watchError)) {
            throw new Error("Unable to get location. Please keep this page open and try again.");
          }
          throw new Error(buildLocationErrorMessage(watchGeoError));
        }
      }
    }
  };

  const getLocalGeoFenceFallbackLocation = () => {
    const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
    const latitude = Number(checkInPolicy.attendanceGeoLatitude);
    const longitude = Number(checkInPolicy.attendanceGeoLongitude);
    if (
      !isLocalHost
      || !checkInPolicy.localGeoFenceFallbackEnabled
      || !Number.isFinite(latitude)
      || !Number.isFinite(longitude)
    ) {
      return null;
    }
    return { latitude, longitude };
  };

  const handleCheckIn = async () => {
    const payload: Record<string, unknown> = {};
    const clientIp = await getPublicIpAddress();
    if (clientIp) {
      payload.clientIp = clientIp;
    }
    payload.deviceId = getDeviceId();

    if (checkInPolicy.attendanceGeoFenceEnabled) {
      let position: GeolocationPosition | null = null;
      try {
        position = await getCurrentLocation("check-in");
      } catch (error) {
        const fallbackLocation = getLocalGeoFenceFallbackLocation();
        if (!fallbackLocation) {
          toast.error(error instanceof Error ? error.message : "Unable to get current location for check-in");
          return;
        }
        payload.latitude = fallbackLocation.latitude;
        payload.longitude = fallbackLocation.longitude;
        toast.info("Using office geofence location for local testing.");
      }
      if (position) {
        payload.latitude = position.coords.latitude;
        payload.longitude = position.coords.longitude;
        payload.accuracy = position.coords.accuracy;
      }
    }

    const shouldCaptureSelfie = checkInPolicy.attendanceSelfieRequired
      && (!checkInPolicy.attendanceMultiPunchEnabled || !hasCheckedInToday);

    if (shouldCaptureSelfie) {
      let selfieImage: string | null = null;
      try {
        selfieImage = await captureSelfieFromCamera();
      } catch {
        selfieImage = null;
      }
      if (!selfieImage) {
        toast.error("Selfie capture is required for check-in");
        return;
      }
      payload.selfieImage = selfieImage;
    }

    setCheckinLoading(true);
    const res = await postApiWithToken("/timesheets/check-in", payload, null, {
      requiredPermissions: ["TIMESHEET_CHECKIN_SELF"]
    });
    setCheckinLoading(false);
    if (!res?.success) {
      toast.error(res?.message || "Check-in failed");
      return;
    }
    if (res.data) {
      setAttendanceToday(res.data);
    }
    toast.success("Checked in");
  };

  const handleCheckOut = async () => {
    const payload: Record<string, unknown> = {};
    const clientIp = await getPublicIpAddress();
    if (clientIp) {
      payload.clientIp = clientIp;
    }
    payload.deviceId = getDeviceId();

    if (checkInPolicy.attendanceGeoFenceEnabled) {
      let position: GeolocationPosition | null = null;
      try {
        position = await getCurrentLocation("check-out");
      } catch (error) {
        const fallbackLocation = getLocalGeoFenceFallbackLocation();
        if (!fallbackLocation) {
          toast.error(error instanceof Error ? error.message : "Unable to get current location for check-out");
          return;
        }
        payload.latitude = fallbackLocation.latitude;
        payload.longitude = fallbackLocation.longitude;
        toast.info("Using office geofence location for local testing.");
      }
      if (position) {
        payload.latitude = position.coords.latitude;
        payload.longitude = position.coords.longitude;
        payload.accuracy = position.coords.accuracy;
      }
    }

    const shouldCaptureSelfie = checkInPolicy.attendanceSelfieRequired;

    if (shouldCaptureSelfie) {
      let selfieImage: string | null = null;
      try {
        selfieImage = await captureSelfieFromCamera();
      } catch {
        selfieImage = null;
      }
      if (!selfieImage) {
        toast.error("Selfie capture is required for check-out");
        return;
      }
      payload.selfieImage = selfieImage;
    }

    setCheckoutLoading(true);
    const res = await postApiWithToken("/timesheets/check-out", payload, null, {
      requiredPermissions: ["TIMESHEET_CHECKOUT_SELF"]
    });
    setCheckoutLoading(false);
    if (!res?.success) {
      toast.error(res?.message || "Check-out failed");
      return;
    }
    if (res.data) {
      setAttendanceToday(res.data);
    }
    toast.success("Checked out");
  };

  const firstDayOffset = new Date(today.getFullYear(), today.getMonth(), 1).getDay();
  const monthCells = Array.from({ length: firstDayOffset + daysInMonth }, (_, idx) => {
    if (idx < firstDayOffset) return null;
    return idx - firstDayOffset + 1;
  });

  return (
    <MainLayout title="My Dashboard" breadcrumb={[{ label: "Home" }, { label: "My Dashboard" }]}>
      {dashboardLoading ? (
        <>
          <div className="rounded-2xl border bg-gradient-to-r from-background to-muted/40 p-5 space-y-3">
            <Skeleton className="h-4 w-36 rounded-sm" />
            <Skeleton className="h-8 w-56 rounded-sm" />
            <Skeleton className="h-4 w-72 rounded-sm" />
            <div className="flex flex-wrap gap-2 pt-1">
              <Skeleton className="h-10 w-28 rounded-sm" />
              <Skeleton className="h-10 w-28 rounded-sm" />
              <Skeleton className="h-10 w-28 rounded-sm" />
              <Skeleton className="h-10 w-28 rounded-sm" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mt-5">
            {Array.from({ length: 4 }).map((_, idx) => (
              <div key={`emp-kpi-skeleton-${idx}`} className="stat-card space-y-3">
                <Skeleton className="h-4 w-28 rounded-sm" />
                <Skeleton className="h-8 w-20 rounded-sm" />
                <Skeleton className="h-3 w-40 rounded-sm" />
              </div>
            ))}
          </div>

          <div className="mt-6">
            <div className="grid grid-cols-3 w-full md:w-[480px] gap-2">
              <Skeleton className="h-10 rounded-sm" />
              <Skeleton className="h-10 rounded-sm" />
              <Skeleton className="h-10 rounded-sm" />
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-4">
              <div className="stat-card xl:col-span-2 space-y-3">
                <Skeleton className="h-5 w-44 rounded-sm" />
                {Array.from({ length: 4 }).map((_, idx) => (
                  <Skeleton key={`emp-overview-left-${idx}`} className="h-16 w-full rounded-sm" />
                ))}
              </div>
              <div className="stat-card space-y-3">
                <Skeleton className="h-5 w-32 rounded-sm" />
                <Skeleton className="h-4 w-full rounded-sm" />
                <Skeleton className="h-4 w-4/5 rounded-sm" />
                <Skeleton className="h-10 w-full rounded-sm" />
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
              <div className="stat-card space-y-3">
                <Skeleton className="h-5 w-36 rounded-sm" />
                {Array.from({ length: 3 }).map((_, idx) => (
                  <Skeleton key={`emp-overview-bottom-left-${idx}`} className="h-10 w-full rounded-sm" />
                ))}
              </div>
              <div className="stat-card space-y-3">
                <Skeleton className="h-5 w-40 rounded-sm" />
                {Array.from({ length: 4 }).map((_, idx) => (
                  <Skeleton key={`emp-overview-bottom-right-${idx}`} className="h-8 w-full rounded-sm" />
                ))}
              </div>
            </div>
          </div>
        </>
      ) : (
      <>
      <motion.div
        role="button"
        tabIndex={0}
        onClick={refreshAttendanceToday}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            refreshAttendanceToday();
          }
        }}
        className={`relative overflow-hidden rounded-2xl border p-5 shadow-sm ${attendanceRefreshLoading ? "cursor-wait" : "cursor-pointer"} ${statusHeroClassName}`}
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="pointer-events-none absolute inset-y-0 right-0 w-48 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.74),transparent_72%)]" />
        <div className="relative z-10 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
              <CalendarCheck className="w-4 h-4" />
              Today Status
              {lateFlag && <Badge variant="destructive">Late</Badge>}
              {attendanceRefreshLoading && <span className="text-xs text-muted-foreground">Refreshing…</span>}
            </div>
            <h2 className="text-2xl font-semibold tracking-tight">
              {isCheckedOut ? "Checked Out" : isCheckedIn ? "Pending Checkout" : "Attendance Not Marked"}
            </h2>
            <p className="text-sm text-muted-foreground mt-2">
              Check-in: {checkInTimeText} • Check-out: {checkOutTimeText}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Shift: {shiftNameText} • {shiftTimingsText}
            </p>
            {checkInPolicy.attendanceHoursSource === "monitor_agent" && (
              <p className="text-xs text-teal-700 mt-1">
                Working hours are collected automatically by the monitor agent. Manual check-in and checkout are disabled.
              </p>
            )}
            {!hasCheckedInToday && checkInWindowStartText && shiftStartText && (
              <p className="text-xs text-teal-700 mt-1">
                Check-in is allowed only within 2 hours before shift start, from {checkInWindowStartText} to {shiftStartText}.
              </p>
            )}
            {isCheckedIn && (
              <p className="text-xs text-orange-700 mt-1">
                Session is open and excluded from payroll until check-out.
              </p>
            )}
            {isCheckedOut && (
              <p className="text-xs text-emerald-700 mt-1">
                {checkInPolicy.attendanceMultiPunchEnabled
                  ? "You are outside now. Check in again when you return."
                  : "Check-in is allowed only once today. You can update the checkout time again if needed."}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex flex-wrap gap-2 justify-end">
              <PermissionGate permissions={["TIMESHEET_CHECKIN_SELF"]}>
                <Button
                  className={primaryHeroButtonClassName}
                  onClick={(event) => {
                    event.stopPropagation();
                    handleCheckIn();
                  }}
                  disabled={checkInPolicy.attendanceHoursSource === "monitor_agent" || checkinLoading || (!checkInPolicy.attendanceMultiPunchEnabled && hasCheckedInToday)}
                >
                  <LogIn className="w-4 h-4 mr-2" /> Check In
                </Button>
              </PermissionGate>
              <PermissionGate permissions={["TIMESHEET_CHECKOUT_SELF"]}>
                <Button
                  variant="outline"
                  className={secondaryHeroButtonClassName}
                  onClick={(event) => {
                    event.stopPropagation();
                    handleCheckOut();
                  }}
                  disabled={checkInPolicy.attendanceHoursSource === "monitor_agent" || checkoutLoading || (!isCheckedIn && !checkInPolicy.attendanceMultiPunchEnabled)}
                >
                  <LogOut className="w-4 h-4 mr-2" /> Check Out
                </Button>
              </PermissionGate>
              <Button
                variant="outline"
                className={secondaryHeroButtonClassName}
                onClick={(event) => {
                  event.stopPropagation();
                  setDayHistoryDialogOpen(true);
                }}
              >
                Day History
              </Button>
              <Button
                variant="outline"
                className={secondaryHeroButtonClassName}
                onClick={(event) => {
                  event.stopPropagation();
                  navigate("/leave/apply");
                }}
              >
                Apply Leave
              </Button>
              <Button
                variant="outline"
                className={secondaryHeroButtonClassName}
                onClick={(event) => {
                  event.stopPropagation();
                  navigate("/timesheets");
                }}
              >
                Timesheet
            </Button>
          </div>
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="w-full max-w-[420px] cursor-help">
                  <div className="flex items-center justify-end gap-2">
                    {/* <div className="text-xs font-medium text-emerald-800">
                      Completed time
                    </div> */}
                    <div className="flex items-center gap-1">
                      {(effectiveDisplayDurationParts || ["00", "00", "00"]).map((part, index) => (
                        <div key={`duration-part-${index}`} className="flex items-center gap-1">
                          <div className={`min-w-[3.25rem] rounded-2xl px-2.5 py-2.5 text-center text-5xl font-black leading-none tracking-[0.08em] text-white shadow-[0_10px_24px_rgba(11,52,81,0.18)] ${clockBoxClassName}`}>
                            {part}
                          </div>
                          {index < 2 && (
                            <div className="mx-0.5 text-3xl font-bold text-slate-400">
                              :
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="end" className="max-w-xs text-left">
                {effectiveDisplayDurationText
                  ? (isCheckedOut
                    ? `Completed time: ${effectiveDisplayDurationText}${effectiveDisplayDurationMs !== null && Number(effectiveDisplayDurationMs) < minimumWorkDurationMs ? ` • Continues until ${formatDuration(minimumWorkDurationMs)}` : ""}`
                    : `Working since first check-in: ${effectiveDisplayDurationText}${remainingToCheckoutText ? ` • Time left to checkout: ${remainingToCheckoutText}` : ""}${remainingToMinimumText ? ` • Time left to minimum hours: ${remainingToMinimumText}` : ""}`)
                  : "Time will appear after the first check-in."}
              </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mt-5">
        <motion.button
          type="button"
          onClick={() => setLeaveBalanceDialogOpen(true)}
          className={`${balanceCardClassName} text-left`}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
            <ClipboardCheck className="w-4 h-4" /> Leave Balance
          </div>
          <div className="text-2xl font-semibold">{totalLeaveRemaining.toFixed(1)}</div>
          <p className="text-sm text-muted-foreground mt-1">Total remaining • click to view</p>
        </motion.button>

        <motion.button
          type="button"
          onClick={() => setWeeklyDialogOpen(true)}
          className={`${weeklyCardClassName} text-left`}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
        >
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
            <Timer className="w-4 h-4" /> Weekly Timesheet
          </div>
          <div className="text-2xl font-semibold">{weeklyProgress.completedIncludingToday.toFixed(1)}h</div>
          <p className="text-sm text-muted-foreground mt-1">
            {weeklyStatus ? `Status: ${weeklyStatus}` : "No weekly sheet"} • click to view
          </p>
        </motion.button>

        <motion.button
          type="button"
          onClick={() => setOnlineDialogOpen(true)}
          className={`${teamCardClassName} text-left`}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
            <Users className="w-4 h-4" /> Team
          </div>
          <div className="text-2xl font-semibold">{onlineList.length}</div>
          <p className="text-sm text-muted-foreground mt-1">Online now • click to view</p>
        </motion.button>

        <motion.button
          type="button"
          onClick={() => setPendingDialogOpen(true)}
          className={`${pendingCardClassName} text-left`}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
        >
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
            <AlertCircle className="w-4 h-4" /> Pending Requests
          </div>
          <div className="text-2xl font-semibold">{pendingLeaves + pendingTimesheets}</div>
          <p className="text-sm text-muted-foreground mt-1">Leaves: {pendingLeaves} • Timesheet: {pendingTimesheets} • click to view</p>
        </motion.button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-6">
        <TabsList className="grid grid-cols-4 w-full md:w-[560px]">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
          <TabsTrigger value="planning">Planning</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <motion.div className={`stat-card xl:col-span-2 ${panelGradientClassName}`} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">Latest Notifications</h3>
                <Bell className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="space-y-2 max-h-64 overflow-auto custom-scroll pr-1">
                {notifications.length === 0 && <p className="text-sm text-muted-foreground">No notifications</p>}
                {notifications.map((n) => (
                  <div key={n._id} className={`rounded-lg border p-3 ${softInsetClassName}`}>
                    <p className="text-sm font-medium">{n.title}</p>
                    <p className="text-xs text-muted-foreground mt-1">{n.message}</p>
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div className={`stat-card ${panelGradientClassName}`} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">Profile Completion</h3>
                <Clock3 className="w-4 h-4 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">
                {myProfile?.profileCompleted ? "Profile marked completed." : "Profile is not completed yet."}
              </p>
              <div className="mt-3 text-sm">
                {missingProfileFields.length === 0 ? (
                  <span className="text-emerald-700">No pending profile tasks.</span>
                ) : (
                  <span className="text-muted-foreground">Pending: {missingProfileFields.join(", ")}</span>
                )}
              </div>
              <div className="flex gap-2 mt-3">
                <Button variant="outline" onClick={() => navigate("/profile")}>Update Profile</Button>
                <Button variant="outline" onClick={() => navigate("/leave")}>My Leaves</Button>
              </div>
            </motion.div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
            <motion.div className={`stat-card ${panelGradientClassName}`} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">Team Snapshot</h3>
                <Badge variant="outline">Today</Badge>
              </div>
              <div className="text-sm space-y-2">
                <div className={`rounded-lg p-2 ${softInsetClassName}`}>Online now: <span className="font-semibold">{onlineList.length}</span></div>
                <div className={`rounded-lg p-2 ${softInsetClassName}`}>On leave today: <span className="font-semibold">{onLeaveList.length}</span></div>
              </div>
            </motion.div>

            <motion.div className={`stat-card ${panelGradientClassName}`} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
              <div className="flex items-center gap-2 mb-3">
                <CalendarDays className="w-4 h-4 text-muted-foreground" />
                <h3 className="font-semibold">Next 7 Days Events</h3>
              </div>
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium mb-1">Birthdays</p>
                  <div className="space-y-1">
                    {(upcomingEvents.birthdays || []).length === 0 && (
                      <p className="text-xs text-muted-foreground">No upcoming birthdays</p>
                    )}
                    {(upcomingEvents.birthdays || []).slice(0, 4).map((e) => (
                      <div key={`eb-${e.employeeId}-${e.eventDate}`} className={`flex items-center justify-between rounded p-2 text-xs ${softInsetClassName}`}>
                        <span>{e.name}</span>
                        <span className="text-muted-foreground">
                          {formatDateInOrgTimeZone(e.eventDate)} ({e.daysAway === 0 ? "Today" : `${e.daysAway}d`})
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium mb-1">Anniversaries</p>
                  <div className="space-y-1">
                    {(upcomingEvents.anniversaries || []).length === 0 && (
                      <p className="text-xs text-muted-foreground">No upcoming anniversaries</p>
                    )}
                    {(upcomingEvents.anniversaries || []).slice(0, 4).map((e) => (
                      <div key={`ea-${e.employeeId}-${e.eventDate}`} className={`flex items-center justify-between rounded p-2 text-xs ${softInsetClassName}`}>
                        <span>{e.name}</span>
                        <span className="text-muted-foreground">
                          {formatDateInOrgTimeZone(e.eventDate)} ({e.years}y)
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </TabsContent>

        <TabsContent value="attendance" className="mt-4 space-y-4">
          <motion.div className={`stat-card ${panelGradientClassName}`} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Attendance Summary</h3>
              <Button variant="outline" size="sm" onClick={() => navigate("/attendance")}>Open Attendance</Button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
              <div className={`rounded-lg p-2 ${softInsetClassName}`}>Present: <span className="font-semibold">{monthlySummary.present}</span></div>
              <div className={`rounded-lg p-2 ${softInsetClassName}`}>Pending: <span className="font-semibold">{monthlySummary.pendingCheckout}</span></div>
              <div className={`rounded-lg p-2 ${softInsetClassName}`}>Absent: <span className="font-semibold">{monthlySummary.absent}</span></div>
              <div className={`rounded-lg p-2 ${softInsetClassName}`}>On Leave: <span className="font-semibold">{monthlySummary.onLeave}</span></div>
              <div className={`rounded-lg p-2 ${softInsetClassName}`}>Week Off: <span className="font-semibold">{monthlySummary.weekOff}</span></div>
            </div>
          </motion.div>

          <motion.div className={`stat-card ${panelGradientClassName}`} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">Monthly Attendance Calendar</h3>
              <Badge variant="outline">{formatDateTimeInOrgTimeZone(new Date(), { month: "long", year: "numeric" })}</Badge>
            </div>
            <div className="grid grid-cols-7 gap-2 mb-2">
              {dayNames.map((d) => (
                <div key={d} className="text-xs text-muted-foreground text-center">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-2">
              {monthCells.map((day, idx) => {
                if (!day) return <div key={`empty-${idx}`} className="h-14 rounded-lg bg-transparent" />;
                const cell = matrixDays[day];
                const baseClass = "h-14 rounded-lg border text-xs p-2 flex flex-col justify-between";
                let toneClass = "bg-muted/20";
                let label = "";
                const toneMap: Record<string, string> = {
                  holiday: "bg-rose-100 border-rose-300",
                  week_off: "bg-teal-100 border-teal-300",
                  leave: "bg-emerald-100 border-emerald-300",
                  pending_checkout: "bg-orange-100 border-orange-300",
                  present: "bg-emerald-100 border-emerald-300",
                  half_day: "bg-lime-100 border-lime-300",
                  absent_leave: "bg-orange-100 border-orange-300",
                  absent: "bg-rose-100 border-rose-300",
                  future: "bg-muted/20"
                };
                if (cell?.displayTone) {
                  toneClass = toneMap[cell.displayTone] || toneClass;
                  label = cell.displayShortLabel || cell.displayLabel || "";
                }
                return (
                  <div key={day} className={`${baseClass} ${toneClass}`}>
                    <span className="font-semibold">{day}</span>
                    <span className="text-[10px] text-muted-foreground">{label}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-2 mt-4 text-xs">
              <span className="px-2 py-1 rounded bg-emerald-100 border border-emerald-300">Present</span>
              <span className="px-2 py-1 rounded bg-orange-100 border border-orange-300">Pending Checkout</span>
              <span className="px-2 py-1 rounded bg-rose-100 border border-rose-300">Absent</span>
              <span className="px-2 py-1 rounded bg-emerald-100 border border-emerald-300">Leave</span>
              <span className="px-2 py-1 rounded bg-teal-100 border border-teal-300">Week Off</span>
              <span className="px-2 py-1 rounded bg-rose-100 border border-rose-300">Holiday</span>
            </div>
          </motion.div>
        </TabsContent>

        <TabsContent value="planning" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <motion.div className={`stat-card ${panelGradientClassName}`} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
              <div className="flex items-center gap-2 mb-3">
                <ClipboardCheck className="w-4 h-4 text-muted-foreground" />
                <h3 className="font-semibold">Leave Balances</h3>
              </div>
              <div className="space-y-2">
                {leaveBalances.length === 0 && <p className="text-sm text-muted-foreground">No balances found</p>}
                {leaveBalances.map((b) => (
                  <div key={b.leaveTypeId} className={`rounded-lg border p-2 ${softInsetClassName}`}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{b.leaveType}</span>
                      <span>{Number(b.remaining || 0).toFixed(1)}/{Number(b.total || 0).toFixed(1)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Used: {Number(b.used || 0).toFixed(1)} | Pending: {Number(b.pending || 0).toFixed(1)}
                    </p>
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div className={`stat-card ${panelGradientClassName}`} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
              <div className="flex items-center gap-2 mb-3">
                <CalendarDays className="w-4 h-4 text-muted-foreground" />
                <h3 className="font-semibold">Upcoming Holidays</h3>
              </div>
              <div className="space-y-2">
                {upcomingHolidays.length === 0 && <p className="text-sm text-muted-foreground">No upcoming holidays</p>}
                {upcomingHolidays.map((h) => (
                  <div key={h._id} className={`flex items-center justify-between rounded-lg p-2 text-sm ${softInsetClassName}`}>
                    <span>{h.name}</span>
                    <span className="text-muted-foreground">{formatDateInOrgTimeZone(h.date)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4">
                <p className="text-sm font-medium mb-2">Week Off Days</p>
                <div className="flex flex-wrap gap-2">
                  {weekOffDays.length === 0 && <span className="text-sm text-muted-foreground">Not configured</span>}
                  {weekOffDays.map((d) => (
                    <Badge key={d} variant="secondary">{dayNames[d]}</Badge>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>
        </TabsContent>

        <TabsContent value="team" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Manager card */}
            <motion.div
              className={`stat-card ${panelGradientClassName}`}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div className="flex items-center gap-2 mb-3">
                <UserCircle2 className="w-4 h-4 text-muted-foreground" />
                <h3 className="font-semibold">Reporting To</h3>
              </div>
              {myProfile?.managerId ? (
                <div className={`flex items-center gap-3 rounded-xl border p-3 ${softInsetClassName}`}>
                  <Avatar className="w-10 h-10 shrink-0">
                    <AvatarFallback className="bg-gradient-to-br from-emerald-500 to-amber-500 text-white text-sm font-semibold">
                      {`${myProfile.managerId.firstName?.[0] || ""}${myProfile.managerId.lastName?.[0] || ""}`.toUpperCase() || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">
                      {`${myProfile.managerId.firstName || ""} ${myProfile.managerId.lastName || ""}`.trim() || "Manager"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">Your direct manager</p>
                  </div>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-emerald-300 text-emerald-700 bg-emerald-50 shrink-0">
                    Manager
                  </Badge>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No manager assigned</p>
              )}
            </motion.div>

            {/* Direct reports */}
            <motion.div
              className={`stat-card ${panelGradientClassName}`}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-muted-foreground" />
                  <h3 className="font-semibold">Direct Reports</h3>
                  {directReports.length > 0 && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      {directReports.length}
                    </Badge>
                  )}
                </div>
              </div>
              {teamLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 p-2 rounded-lg border">
                      <div className="w-8 h-8 rounded-full bg-muted animate-pulse shrink-0" />
                      <div className="space-y-1 flex-1">
                        <div className="h-3.5 w-28 rounded bg-muted animate-pulse" />
                        <div className="h-3 w-20 rounded bg-muted animate-pulse" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : directReports.length === 0 ? (
                <p className="text-sm text-muted-foreground">No direct reports</p>
              ) : (
                <div className="space-y-2 max-h-56 overflow-y-auto custom-scroll pr-1">
                  {directReports.map((emp) => {
                    const initials = `${emp.firstName?.[0] || ""}${emp.lastName?.[0] || ""}`.toUpperCase() || "?";
                    const fullName = `${emp.firstName || ""} ${emp.lastName || ""}`.trim() || "Employee";
                    return (
                      <div key={emp._id} className={`flex items-center gap-3 rounded-xl border p-2.5 ${softInsetClassName}`}>
                        <Avatar className="w-8 h-8 shrink-0">
                          <AvatarImage src={emp.profileImage || undefined} />
                          <AvatarFallback className="bg-gradient-to-br from-emerald-400 to-amber-400 text-white text-xs font-semibold">
                            {initials}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{fullName}</p>
                          {emp.designationId?.name && (
                            <p className="text-xs text-muted-foreground truncate">{emp.designationId.name}</p>
                          )}
                        </div>
                        <Badge
                          variant="outline"
                          className={`text-[10px] px-1.5 py-0 capitalize shrink-0 ${
                            emp.status === "active"
                              ? "border-emerald-300 text-emerald-700 bg-emerald-50"
                              : "border-muted text-muted-foreground"
                          }`}
                        >
                          {emp.status || "active"}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          </div>

          {/* Link to full org tree */}
          <motion.div
            className={`stat-card ${panelGradientClassName} mt-4`}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Network className="w-4 h-4 text-muted-foreground" />
                <div>
                  <h3 className="font-semibold text-sm">Full Organization Tree</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    View the complete reporting hierarchy across the organization
                  </p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => navigate("/employee-tree")}>
                View Org Tree
              </Button>
            </div>
          </motion.div>
        </TabsContent>
      </Tabs>

      <Dialog open={leaveBalanceDialogOpen} onOpenChange={setLeaveBalanceDialogOpen}>
        <DialogContent className="sm:max-w-md max-h-[85vh] overflow-hidden p-0 flex flex-col">
          <DialogHeader className="px-6 pt-8">
            <DialogTitle>Leave Balances</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 space-y-3 overflow-y-auto px-6 pb-6 pt-2 pr-4 text-sm custom-scroll">
            <div className="rounded-lg bg-muted/40 p-3">
              Total remaining: <span className="font-semibold">{totalLeaveRemaining.toFixed(1)}</span>
            </div>
            {leaveBalances.length === 0 && (
              <p className="text-sm text-muted-foreground">No balances found</p>
            )}
            {leaveBalances.map((b) => (
              <div key={b.leaveTypeId} className={`rounded-lg border p-3 ${softInsetClassName}`}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{b.leaveType}</span>
                  <span>{Number(b.remaining || 0).toFixed(1)}/{Number(b.total || 0).toFixed(1)}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Used: {Number(b.used || 0).toFixed(1)} | Pending: {Number(b.pending || 0).toFixed(1)}
                </p>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={dayHistoryDialogOpen} onOpenChange={setDayHistoryDialogOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-hidden p-0 flex flex-col">
          <DialogHeader className="px-6 pt-8">
            <DialogTitle>Day History</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto px-6 pb-6 pt-2 custom-scroll">
            {dayHistoryRows.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead>Device ID</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Selfie</TableHead>
                    <TableHead>Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dayHistoryRows.map((entry: any, index: number) => (
                    <TableRow key={`${entry.action}-${entry.at}-${index}`}>
                      <TableCell className="font-medium">{formatTimeInOrgTimeZone(entry.at)}</TableCell>
                      <TableCell className="capitalize">
                        {entry.action === "check_in" ? "Check In" : "Check Out"}
                      </TableCell>
                      <TableCell>{entry.ip || "-"}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {entry.deviceId || "-"}
                      </TableCell>
                      <TableCell>
                        {entry.latitude !== null && entry.latitude !== undefined && entry.longitude !== null && entry.longitude !== undefined
                          ? `${Number(entry.latitude).toFixed(5)}, ${Number(entry.longitude).toFixed(5)}`
                          : "-"}
                      </TableCell>
                      <TableCell>{entry.selfieProvided ? "Yes" : "No"}</TableCell>
                      <TableCell>{entry.source || "web"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="py-10 text-center text-sm text-muted-foreground">
                No day history available for today.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={onlineDialogOpen} onOpenChange={setOnlineDialogOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[88vh] overflow-hidden p-0 flex flex-col">
          <DialogHeader className="px-6 pt-8">
            <DialogTitle>Team Status Today</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 px-6 pt-2 md:grid-cols-2">
            <div className={`rounded-xl border p-4 ${softInsetClassName}`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Present / Online Now</p>
                  <p className="text-xs text-muted-foreground">Currently checked in team members</p>
                </div>
                <Badge variant="outline">{onlineList.length}</Badge>
              </div>
            </div>
            <div className={`rounded-xl border p-4 ${softInsetClassName}`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">On Leave Today</p>
                  <p className="text-xs text-muted-foreground">Team members with approved leave today</p>
                </div>
                <Badge variant="outline">{onLeaveList.length}</Badge>
              </div>
            </div>
          </div>
          <div className="min-h-0 grid flex-1 gap-4 overflow-hidden px-6 pb-6 pt-4 md:grid-cols-2">
            <div className="min-h-0 rounded-xl border bg-background p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold">Present / Online</h3>
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              </div>
              <div className="max-h-[52vh] space-y-2 overflow-y-auto pr-1 custom-scroll">
                {onlineList.length === 0 && (
                  <p className="text-sm text-muted-foreground">No team members are online right now.</p>
                )}
                {onlineList.map((item) => (
                  <div key={item._id} className={`rounded-lg border p-3 text-sm ${softInsetClassName}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium">
                          {item.employeeId?.firstName} {item.employeeId?.lastName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {item.employeeId?.employeeCode || "Employee"}
                        </p>
                      </div>
                      <Badge className="status-badge status-active">Present</Badge>
                    </div>
                    {item.checkInAt && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Checked in at {formatTimeInOrgTimeZone(item.checkInAt)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="min-h-0 rounded-xl border bg-background p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold">On Leave Today</h3>
                <CalendarDays className="h-4 w-4 text-amber-600" />
              </div>
              <div className="max-h-[52vh] space-y-2 overflow-y-auto pr-1 custom-scroll">
                {onLeaveList.length === 0 && (
                  <p className="text-sm text-muted-foreground">No team members are on leave today.</p>
                )}
                {onLeaveList.map((item) => (
                  <div key={item._id} className={`rounded-lg border p-3 text-sm ${softInsetClassName}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium">
                          {item.employeeId?.firstName} {item.employeeId?.lastName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {item.employeeId?.employeeCode || "Employee"}
                        </p>
                      </div>
                      <Badge variant="outline">On Leave</Badge>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Leave type: {item.leaveTypeId?.name || item.leaveTypeId?.code || "Leave"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.fromDate ? formatDateInOrgTimeZone(item.fromDate) : "-"}
                      {" "}to{" "}
                      {item.toDate ? formatDateInOrgTimeZone(item.toDate) : "-"}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={pendingDialogOpen} onOpenChange={setPendingDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pending Requests</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-80 overflow-auto custom-scroll pr-1">
            {pendingLeaveItems.length === 0 && pendingTimesheets === 0 && (
              <p className="text-sm text-muted-foreground">No pending requests.</p>
            )}

            {pendingLeaveItems.map((leave) => (
              <div key={leave._id} className="p-2 rounded-lg border bg-background text-sm">
                <p className="font-medium">
                  Leave: {leave.leaveTypeName || leave.leaveTypeId?.name || "Leave Request"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatDateInOrgTimeZone(leave.fromDate)}
                  {leave.toDate ? ` to ${formatDateInOrgTimeZone(leave.toDate)}` : ""}
                </p>
              </div>
            ))}

            {pendingTimesheets > 0 && (
              <div className="p-2 rounded-lg border bg-background text-sm">
                <p className="font-medium">Timesheet: Weekly submission pending approval</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Current week timesheet is submitted and waiting for action.
                </p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={weeklyDialogOpen} onOpenChange={setWeeklyDialogOpen}>
        <DialogContent className="sm:max-w-md max-h-[85vh] overflow-hidden p-0 flex flex-col">
          <DialogHeader className="px-6 pt-8">
            <DialogTitle>Weekly Hours Progress</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 space-y-2 overflow-y-auto px-6 pb-6 pt-2 pr-4 text-sm custom-scroll">
            <div className="p-2 rounded-lg bg-muted/40">
              Completed till today (including today):{" "}
              <span className="font-semibold">{weeklyProgress.completedIncludingToday.toFixed(1)}h</span>
            </div>
            <div className="p-2 rounded-lg bg-muted/40">
              Weekly timesheet total: <span className="font-semibold">{weeklyHours.toFixed(1)}h</span>
            </div>
            <div className="p-2 rounded-lg bg-muted/40">
              Today logged in timesheet: <span className="font-semibold">{weeklyProgress.todayTimesheetHours.toFixed(1)}h</span>
            </div>
            <div className="p-2 rounded-lg bg-muted/40">
              Today worked (attendance): <span className="font-semibold">{weeklyProgress.todayLiveHours.toFixed(1)}h</span>
            </div>
            <div className="mt-3">
              <p className="text-xs font-medium text-muted-foreground mb-2">Sunday to Saturday</p>
              <div className="space-y-1">
                {weeklyProgress.dayRows.map((row) => (
                  <div key={row.dayName} className="flex items-center justify-between p-2 rounded-lg border bg-background">
                    <div>
                      <p className="font-medium">{row.dayName}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {row.date ? formatDateInOrgTimeZone(row.date) : "-"}
                      </p>
                    </div>
                    <span className="font-semibold">{Number(row.completedHours || 0).toFixed(1)}h</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      </>
      )}
    </MainLayout>
  );
};

export default EmployeeDashboard;
