import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  NativeModules,
  Modal,
  KeyboardAvoidingView,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRef } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { getApiWithToken, postApiWithToken } from '../services/api';
import { useAuth } from '../context/AuthContext';
import Geolocation from 'react-native-geolocation-service';
import AttendanceTab from '../components/AttendanceTab';
import { AttendanceDay } from '../types/attendance';
import { useResetScrollOnFocus } from '../utils/useResetScrollOnFocus';
import { getDeviceId } from '../utils/deviceId';

const pressedStyle = {
  transform: [{ scale: 0.96 }],
  shadowOffset: { width: 2, height: 2 },
  shadowOpacity: 0.2,
};

type CheckInPolicy = {
  attendanceIpEnabled: boolean;
  attendanceSelfieRequired: boolean;
  attendanceMultiPunchEnabled: boolean;
  attendanceGeoFenceEnabled: boolean;
  attendanceGeoRadiusMeters: number;
};

type SelectedStatCard = 'leave-balance' | 'team' | 'pending-requests' | 'on-leave-today' | null;

type AttendanceRequestType = 'missed_checkout' | 'correction' | 'work_from_home';

const attendanceRequestTypeOptions: Array<{ value: AttendanceRequestType; label: string }> = [
  { value: 'missed_checkout', label: 'Missed Checkout' },
  { value: 'correction', label: 'Correction' },
  { value: 'work_from_home', label: 'Work From Home' },
];

type AttendanceWfhDuration = 'full_day' | 'half_day';
type AttendanceWfhSession = 'first_half' | 'second_half';

const attendanceWfhDurationOptions: Array<{ value: AttendanceWfhDuration; label: string }> = [
  { value: 'full_day', label: 'Full Day WFH' },
  { value: 'half_day', label: 'Half Day WFH' },
];

const attendanceWfhSessionOptions: Array<{ value: AttendanceWfhSession; label: string }> = [
  { value: 'first_half', label: 'First Half' },
  { value: 'second_half', label: 'Second Half' },
];

const getAttendanceRequestTypeLabel = (value: AttendanceRequestType) =>
  attendanceRequestTypeOptions.find((option) => option.value === value)?.label || value;

const getAttendanceWfhDurationLabel = (value: AttendanceWfhDuration) =>
  attendanceWfhDurationOptions.find((option) => option.value === value)?.label || 'Full Day WFH';

const getAttendanceWfhSessionLabel = (value: AttendanceWfhSession) =>
  attendanceWfhSessionOptions.find((option) => option.value === value)?.label || 'First Half';
const getAttendanceRequestStatusLabel = (value?: string | null) => {
  if (value === 'approved') return 'Approved';
  if (value === 'rejected') return 'Rejected';
  if (value === 'pending') return 'Pending';
  return 'Draft';
};

const getAttendanceRequestStatusColor = (value?: string | null) => {
  if (value === 'approved') return '#16934f';
  if (value === 'rejected') return '#d94b4b';
  if (value === 'pending') return '#d48a00';
  return '#64748b';
};

const getDefaultAttendanceRequestType = (attendance: any): AttendanceRequestType => {
  if (attendance?.checkInAt && !attendance?.checkOutAt) return 'missed_checkout';
  if (attendance?.checkInAt && attendance?.checkOutAt) return 'correction';
  return 'work_from_home';
};

const parseDateInput = (value: string) => {
  const [year, month, day] = value.split('-').map((part) => Number(part));
  if (!year || !month || !day) {
    return new Date();
  }

  return new Date(year, month - 1, day);
};

const formatDateInputLabel = (value: string) =>
  parseDateInput(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HEADER_TITLE_FONT = Platform.select({
  android: 'sans-serif-medium',
  ios: 'System',
  default: 'sans-serif',
});
const HEADER_META_FONT = Platform.select({
  android: 'sans-serif-medium',
  ios: 'System',
  default: 'sans-serif',
});

const toDateInput = (value: Date) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
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

const formatDate = (value: string | Date) =>
  new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

const formatDateLong = (value: string | Date) =>
  new Date(value).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });

const formatTime = (value: string | Date) =>
  new Date(value).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

let publicIpLookupPromise: Promise<string | null> | null = null;

const getPublicIpAddress = async () => {
  if (publicIpLookupPromise) return publicIpLookupPromise;

  publicIpLookupPromise = (async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const response = await fetch('https://api.ipify.org?format=json', {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) return null;
      const data = await response.json();
      return typeof data?.ip === 'string' && data.ip.trim() ? data.ip.trim() : null;
    } catch {
      return null;
    }
  })();

  return publicIpLookupPromise;
};

const getOrganizationName = (...sources: any[]) => {
  for (const source of sources) {
    const candidates = [
      source?.organization?.name,
      source?.activeOrganization?.name,
      source?.organizationId?.name,
      source?.activeOrganizationId?.name,
      source?.organizationName,
      source?.activeOrganizationName,
      source?.organizationId?.displayName,
      source?.organizationId?.legalName,
      source?.activeOrganizationId?.displayName,
      source?.activeOrganizationId?.legalName,
      source?.organization?.displayName,
      source?.organization?.legalName,
      source?.activeOrganization?.displayName,
      source?.activeOrganization?.legalName,
      source?.organizationDisplayName,
      source?.organizationLegalName,
      source?.company?.name,
      source?.org?.name,
      source?.tenant?.name,
      source?.companyDisplayName,
      source?.companyLegalName,
      source?.companyName,
      source?.company?.displayName,
      source?.company?.legalName,
      source?.orgDisplayName,
      source?.orgLegalName,
      source?.orgName,
      source?.org?.displayName,
      source?.org?.legalName,
      source?.tenant?.displayName,
      source?.tenant?.legalName,
    ];

    for (const value of candidates) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
  }

  return 'Organization';
};

const getOrganizationId = (...sources: any[]) => {
  for (const source of sources) {
    const value =
      source?.organization?._id ||
      source?.activeOrganization?._id ||
      source?.organizationId?._id ||
      source?.activeOrganizationId?._id ||
      source?.organizationId ||
      source?.activeOrganizationId ||
      source?.companyId ||
      source?.orgId ||
      source?.tenantId;

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
};

const getEmployeeDisplayName = (...sources: any[]) => {
  for (const source of sources) {
    const candidates = [
      source?.fullName,
      source?.displayName,
      source?.name,
      source?.employeeName,
      source?.profile?.fullName,
      source?.profile?.displayName,
      source?.profile?.name,
      source?.employee?.fullName,
      source?.employee?.displayName,
      source?.employee?.name,
      source?.employee?.employeeName,
      source?.employeeId?.fullName,
      source?.employeeId?.displayName,
      source?.employeeId?.name,
      source?.employeeId?.employeeName,
      source?.user?.fullName,
      source?.user?.displayName,
      source?.user?.name,
      source?.firstName && source?.lastName ? `${source.firstName} ${source.lastName}` : '',
      source?.employee?.firstName && source?.employee?.lastName ? `${source.employee.firstName} ${source.employee.lastName}` : '',
      source?.employeeId?.firstName && source?.employeeId?.lastName ? `${source.employeeId.firstName} ${source.employeeId.lastName}` : '',
      source?.profile?.firstName && source?.profile?.lastName ? `${source.profile.firstName} ${source.profile.lastName}` : '',
      source?.user?.firstName && source?.user?.lastName ? `${source.user.firstName} ${source.user.lastName}` : '',
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }
  }

  return '';
};

const today = new Date();
const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
const currentYear = today.getFullYear();

function EmployeeDashboardScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const scrollViewRef = useRef<ScrollView | null>(null);
  const {
    session,
    logout,
    loginSuccessMessage,
    clearLoginSuccessMessage,
    setLogoutSuccessMessage,
    refreshPermissions,
  } = useAuth();
  const token = session?.token || '';
  const profile = session?.profile || session?.loginData || null;
  const permissions = session?.permissions || [];
  const hasAnyPermission = (...codes: string[]) => codes.some((code) => permissions.includes(code));
  const canCheckIn = permissions.includes('TIMESHEET_CHECKIN_SELF');
  const canCheckOut = permissions.includes('TIMESHEET_CHECKOUT_SELF');
  const canApplyLeave = permissions.includes('LEAVE_APPLY');
  const canViewTimesheets = hasAnyPermission('TIMESHEET_VIEW_SELF', 'TIMESHEET_VIEW_ALL');
  const canViewAttendance = hasAnyPermission('ATTENDANCE_VIEW_SELF', 'TIMESHEET_VIEW_SELF');
  const canViewLeaveBalances = hasAnyPermission('LEAVE_VIEW_SELF', 'LEAVE_VIEW_ALL', 'LEAVE_APPLY');
  const canViewHolidays = hasAnyPermission('HOLIDAY_VIEW', 'LEAVE_VIEW_SELF', 'LEAVE_APPLY');
  const canViewWeekOffs = permissions.includes('WEEK_OFF_VIEW');
  const canViewNotifications = permissions.includes('NOTIFICATION_VIEW_SELF');
  const canManageNotifications = permissions.includes('NOTIFICATION_MANAGE_SELF');
  const canOpenNotifications = canViewNotifications && canManageNotifications;
  const canViewOnlineTeam = permissions.includes('TIMESHEET_VIEW_ONLINE');
  const canViewOnLeaveTeam = permissions.includes('TIMESHEET_VIEW_ALL');
  const canViewUpcomingEvents = hasAnyPermission('EMP_SELF_VIEW', 'EMP_VIEW');
  const canViewPlanning = canViewLeaveBalances || canViewHolidays || canViewWeekOffs;
  const safeAreaInsets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<'overview' | 'attendance' | 'planning'>('overview');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [riseAttendanceOpen, setRiseAttendanceOpen] = useState(false);
  const [attendanceRequestMenuOpen, setAttendanceRequestMenuOpen] = useState(false);
  const [attendanceCalendarOpen, setAttendanceCalendarOpen] = useState(false);
  const [attendanceCalendarMonth, setAttendanceCalendarMonth] = useState(() => new Date());
  const [attendanceWfhDuration, setAttendanceWfhDuration] = useState<AttendanceWfhDuration>('full_day');
  const [attendanceWfhDurationMenuOpen, setAttendanceWfhDurationMenuOpen] = useState(false);
  const [attendanceWfhSession, setAttendanceWfhSession] = useState<AttendanceWfhSession>('first_half');
  const [attendanceWfhSessionMenuOpen, setAttendanceWfhSessionMenuOpen] = useState(false);
  const [attendanceRequestType, setAttendanceRequestType] = useState<AttendanceRequestType>('work_from_home');
  const [attendanceRequestDate, setAttendanceRequestDate] = useState(toDateInput(new Date()));
  const [attendanceRequestedCheckInTime, setAttendanceRequestedCheckInTime] = useState('');
  const [attendanceRequestedCheckOutTime, setAttendanceRequestedCheckOutTime] = useState('');
  const [attendanceRequestReason, setAttendanceRequestReason] = useState('');
  const [attendanceRequestSubmitting, setAttendanceRequestSubmitting] = useState(false);
  const [attendanceRequestError, setAttendanceRequestError] = useState('');
  const [attendanceRequestStatusMessage, setAttendanceRequestStatusMessage] = useState('');
  const [attendanceRequests, setAttendanceRequests] = useState<any[]>([]);
  const [selectedStatCard, setSelectedStatCard] = useState<SelectedStatCard>(null);

  const [weeklyStatus, setWeeklyStatus] = useState<string | null>(null);
  const [weeklyHours, setWeeklyHours] = useState(0);
  const [weeklyEntries, setWeeklyEntries] = useState<any[]>([]);
  const [onlineList, setOnlineList] = useState<any[]>([]);
  const [onLeaveList, setOnLeaveList] = useState<any[]>([]);
  const [attendanceToday, setAttendanceToday] = useState<any | null>(null);
  const [leaveBalances, setLeaveBalances] = useState<any[]>([]);
  const [myLeaves, setMyLeaves] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [upcomingHolidays, setUpcomingHolidays] = useState<any[]>([]);
  const [weekOffDays, setWeekOffDays] = useState<number[]>([]);
  const [upcomingEvents, setUpcomingEvents] = useState<{ birthdays: any[]; anniversaries: any[] }>({
    birthdays: [],
    anniversaries: [],
  });
  const [matrixDays, setMatrixDays] = useState<Record<number, AttendanceDay>>({});
  const [daysInMonth, setDaysInMonth] = useState<number>(31);
  const [myProfile, setMyProfile] = useState<any>(profile || null);
  const [organizationProfile, setOrganizationProfile] = useState<any>(null);
  const [checkInPolicy, setCheckInPolicy] = useState<CheckInPolicy>({
    attendanceIpEnabled: false,
    attendanceSelfieRequired: false,
    attendanceMultiPunchEnabled: false,
    attendanceGeoFenceEnabled: false,
    attendanceGeoRadiusMeters: 200,
  });
  const [policyWarning, setPolicyWarning] = useState('');
  const [checkinLoading, setCheckinLoading] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [showLoginToast, setShowLoginToast] = useState(false);
  const [permissionsReady, setPermissionsReady] = useState(false);

  const weekStart = useMemo(() => getWeekStart(new Date()), []);
  useResetScrollOnFocus(scrollViewRef);

  useEffect(() => {
    let active = true;
    if (!token) {
      setPermissionsReady(false);
      return undefined;
    }

    setPermissionsReady(false);
    refreshPermissions()
      .catch(() => undefined)
      .finally(() => {
        if (active) {
          setPermissionsReady(true);
        }
      });

    return () => {
      active = false;
    };
  }, [token, refreshPermissions]);

  const applyCheckInPolicy = (policyData?: Partial<CheckInPolicy> | null) => {
    const nextPolicy: CheckInPolicy = {
      attendanceIpEnabled: Boolean(policyData?.attendanceIpEnabled),
      attendanceSelfieRequired: Boolean(policyData?.attendanceSelfieRequired),
      attendanceMultiPunchEnabled: Boolean(policyData?.attendanceMultiPunchEnabled),
      attendanceGeoFenceEnabled: Boolean(policyData?.attendanceGeoFenceEnabled),
      attendanceGeoRadiusMeters: Number(policyData?.attendanceGeoRadiusMeters || 200),
    };

    setCheckInPolicy(nextPolicy);

    return nextPolicy;
  };

  const loadLatestCheckInPolicy = async () => {
    if (!token || (!canCheckIn && !canCheckOut)) {
      return applyCheckInPolicy(null);
    }

    const response = await getApiWithToken<any>('/timesheets/checkin-policy', token);
    if (response?.success && response?.data) {
      return applyCheckInPolicy(response.data);
    }

    return applyCheckInPolicy(null);
  };
  
  const loadAttendanceRequests = async () => {
    if (!token || !canViewAttendance) {
      setAttendanceRequests([]);
      return [];
    }

    const response = await getApiWithToken<any>('/timesheets/attendance/requests/my', token);
    if (response?.success) {
      const rows = Array.isArray(response.data) ? response.data : response.data?.items || [];
      setAttendanceRequests(rows || []);
      return rows || [];
    }

    setAttendanceRequests([]);
    return [];
  };

  const loadAttendanceRequestDefaults = async (dateKey: string, requestType: AttendanceRequestType) => {
    if (!token) return null;

    const response = await getApiWithToken<any>(`/timesheets/attendance/requests/defaults/my?date=${encodeURIComponent(dateKey)}&requestType=${requestType}`, token);
    const parsedDate = parseDateInput(dateKey);
    const selectedDay =
      toDateInput(parsedDate) === toDateInput(new Date())
        ? attendanceToday || matrixDays[parsedDate.getDate()] || null
        : matrixDays[parsedDate.getDate()] || null;
    const formatAttendanceTime = (value?: string | null) => {
      if (!value) return '';
      if (/^\d{1,2}:\d{2}/.test(value)) return value.slice(0, 5);
      const parsedTime = new Date(value);
      if (Number.isNaN(parsedTime.getTime())) return '';
      return parsedTime.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    };
    const selectedCheckIn = formatAttendanceTime(selectedDay?.checkInAt);
    const selectedCheckOut = formatAttendanceTime(selectedDay?.checkOutAt);

    if (requestType === 'work_from_home') {
      setAttendanceRequestedCheckInTime(selectedCheckIn);
      setAttendanceRequestedCheckOutTime(selectedCheckOut);
      return selectedDay;
    }

    if (response?.success && response?.data) {
      setAttendanceRequestedCheckInTime(response.data.requestedCheckInTime || '');
      setAttendanceRequestedCheckOutTime(response.data.requestedCheckOutTime || '');
      return response.data;
    }

    setAttendanceRequestedCheckInTime('');
    setAttendanceRequestedCheckOutTime('');

    return null;
  };  const openAttendanceCalendar = () => {
    const parsedDate = parseDateInput(attendanceRequestDate);
    setAttendanceCalendarMonth(new Date(parsedDate.getFullYear(), parsedDate.getMonth(), 1));
    setAttendanceCalendarOpen(true);
  };

  const closeAttendanceCalendar = () => {
    setAttendanceCalendarOpen(false);
  };

  const changeAttendanceCalendarMonth = (offset: number) => {
    setAttendanceCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  };

  const handleAttendanceCalendarSelect = async (day: number) => {
    const nextDate = new Date(attendanceCalendarMonth.getFullYear(), attendanceCalendarMonth.getMonth(), day);
    const nextDateKey = toDateInput(nextDate);
    setAttendanceRequestDate(nextDateKey);
    setAttendanceCalendarOpen(false);
    await loadAttendanceRequestDefaults(nextDateKey, attendanceRequestType);
  };
  const openRiseAttendanceRequest = async () => {
    const nextType = getDefaultAttendanceRequestType(attendanceToday);
    const nextDate = toDateInput(new Date());
    setAttendanceRequestError('');
    setAttendanceRequestStatusMessage('');
    setAttendanceRequestMenuOpen(false);
    setAttendanceWfhDurationMenuOpen(false);
    setAttendanceWfhSessionMenuOpen(false);
    setAttendanceCalendarOpen(false);
    setRiseAttendanceOpen(true);
    setAttendanceRequestType(nextType);
    setAttendanceWfhDuration('full_day');
    setAttendanceWfhSession('first_half');
    setAttendanceRequestDate(nextDate);
    setAttendanceRequestReason('');
    await loadAttendanceRequestDefaults(nextDate, nextType);
    await loadAttendanceRequests();
  };

  const closeRiseAttendanceRequest = () => {
    setRiseAttendanceOpen(false);
    setAttendanceRequestMenuOpen(false);
    setAttendanceWfhDurationMenuOpen(false);
    setAttendanceWfhSessionMenuOpen(false);
    setAttendanceCalendarOpen(false);
    setAttendanceRequestError('');
  };

  const normalizeAttendanceTimeInput = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return '';
    const match = trimmed.match(/^([0-9]{1,2})(?:[:. ]?([0-9]{1,2}))?$/);
    if (!match) return trimmed;
    const hours = String(Number(match[1])).padStart(2, '0');
    const minutes = String(Number(match[2] || '0')).padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  const submitAttendanceRequest = async () => {
    const trimmedReason = attendanceRequestReason.trim();
    const trimmedCheckIn = normalizeAttendanceTimeInput(attendanceRequestedCheckInTime);
    const trimmedCheckOut = normalizeAttendanceTimeInput(attendanceRequestedCheckOutTime);

    if (!attendanceRequestDate) {
      setAttendanceRequestError('Please select a date.');
      return;
    }
    if (!trimmedReason) {
      setAttendanceRequestError('Please enter a reason.');
      return;
    }
    if (attendanceRequestType === 'missed_checkout' && !trimmedCheckOut) {
      setAttendanceRequestError('Please enter the checkout time.');
      return;
    }
    if (attendanceRequestType === 'correction' && (!trimmedCheckIn || !trimmedCheckOut)) {
      setAttendanceRequestError('Please enter both check-in and check-out times.');
      return;
    }
    if (attendanceRequestType === 'work_from_home' && (!trimmedCheckIn || !trimmedCheckOut)) {
      setAttendanceRequestError('Shift timings are required for work from home.');
      return;
    }

    setAttendanceRequestSubmitting(true);
    setAttendanceRequestError('');
    try {
      const payload: Record<string, unknown> = {
        date: attendanceRequestDate,
        requestType: attendanceRequestType,
        requestedCheckInTime: attendanceRequestType === 'missed_checkout' ? null : trimmedCheckIn || null,
        requestedCheckOutTime: trimmedCheckOut || null,
        reason: trimmedReason,
      };

      const response = await postApiWithToken<any>('/timesheets/attendance/requests/my', payload, token);
      if (!response?.success) {
        setAttendanceRequestError(response?.message || 'Unable to submit attendance request.');
        return;
      }

      const submitted = response.data || null;
      setAttendanceRequestStatusMessage(`${submitted?.status || 'pending'} request submitted successfully.`);
      await loadAttendanceRequests();
    } catch {
      setAttendanceRequestError('Unable to submit attendance request.');
    } finally {
      setAttendanceRequestSubmitting(false);
    }
  };
  const loadDashboard = async (silent = false) => {
    if (!silent) setLoading(true);
    if (silent) setRefreshing(true);
    try {
      const todayIso = toDateInput(new Date());
      const weekStartIso = toDateInput(weekStart);
      const organizationId = getOrganizationId(profile, session?.loginData, myProfile);

      const [
        weeklyRes,
        attendanceRes,
        leaveRes,
        balanceRes,
        onlineRes,
        onLeaveRes,
        notifRes,
        holidayRes,
        weekOffRes,
        matrixRes,
        profileRes,
        organizationRes,
        eventsRes,
        checkInPolicyRes,
        attendanceRequestsRes,
      ] = await Promise.all([
        canViewTimesheets ? getApiWithToken<any>(`/timesheets/weekly/my?weekStart=${weekStartIso}`, token) : Promise.resolve(null),
        canViewTimesheets || canCheckIn || canCheckOut
          ? getApiWithToken<any>(`/timesheets/attendance/my?date=${todayIso}`, token)
          : Promise.resolve(null),
        canViewLeaveBalances ? getApiWithToken<any>('/leaves/my', token) : Promise.resolve(null),
        canViewLeaveBalances ? getApiWithToken<any>('/leave-balances/my', token) : Promise.resolve(null),
        canViewOnlineTeam ? getApiWithToken<any>('/timesheets/online', token) : Promise.resolve(null),
        canViewOnLeaveTeam ? getApiWithToken<any>('/timesheets/on-leave', token) : Promise.resolve(null),
        canOpenNotifications ? getApiWithToken<any>('/notifications/my?limit=6', token) : Promise.resolve(null),
        canViewHolidays ? getApiWithToken<any>(`/holidays?year=${currentYear}`, token) : Promise.resolve(null),
        canViewWeekOffs ? getApiWithToken<any>('/week-offs', token) : Promise.resolve(null),
        canViewAttendance ? getApiWithToken<any>(`/timesheets/attendance/matrix/my?month=${currentMonth}`, token) : Promise.resolve(null),
        getApiWithToken<any>('/employees/me', token),
        organizationId ? getApiWithToken<any>(`/organizations/${organizationId}`, token) : Promise.resolve(null),
        canViewUpcomingEvents ? getApiWithToken<any>('/employees/upcoming-events?days=7', token) : Promise.resolve(null),
        canViewAttendance ? getApiWithToken<any>('/timesheets/checkin-policy', token) : Promise.resolve(null),
        canViewAttendance ? getApiWithToken<any>('/timesheets/attendance/requests/my', token) : Promise.resolve(null),
      ]);

    if (weeklyRes?.success && weeklyRes?.data) {
      setWeeklyStatus(weeklyRes.data.status || 'draft');
      const entries = weeklyRes.data.entries || [];
      setWeeklyEntries(entries);
      const total = entries.reduce((sum: number, e: any) => sum + (Number(e?.hours) || 0), 0);
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

    setMyLeaves(leaveRes?.success ? leaveRes.data || [] : []);
    setLeaveBalances(balanceRes?.success ? balanceRes.data || [] : []);
    setOnlineList(onlineRes?.success ? onlineRes.data || [] : []);
    setOnLeaveList(onLeaveRes?.success ? onLeaveRes.data || [] : []);
    setNotifications(notifRes?.success ? notifRes.data?.items || [] : []);

    if (holidayRes?.success) {
      const now = new Date();
      const upcoming = (holidayRes.data || [])
        .filter((h: any) => h?.date && new Date(h.date) >= new Date(now.getFullYear(), now.getMonth(), now.getDate()))
        .slice(0, 6);
      setUpcomingHolidays(upcoming);
    } else {
      setUpcomingHolidays([]);
    }

    setWeekOffDays(weekOffRes?.success ? weekOffRes.data?.weekOffDays || [] : []);
    setUpcomingEvents(
      eventsRes?.success
        ? {
            birthdays: eventsRes.data?.birthdays || [],
            anniversaries: eventsRes.data?.anniversaries || [],
          }
        : { birthdays: [], anniversaries: [] }
    );

    if (matrixRes?.success) {
      const row = matrixRes.data?.employees?.[0];
      setMatrixDays(row?.days || {});
      setDaysInMonth(Number(matrixRes.data?.daysInMonth || 31));
    } else {
      setMatrixDays({});
      setDaysInMonth(31);
    }

    const nextProfile = profileRes?.success ? profileRes.data || null : null;
    setMyProfile(nextProfile);
    let nextOrganizationProfile = organizationRes?.success ? organizationRes.data || null : null;
    if (!nextOrganizationProfile) {
      const nextOrganizationId = getOrganizationId(nextProfile);
      if (nextOrganizationId) {
        const fallbackOrganizationRes = await getApiWithToken<any>(`/organizations/${nextOrganizationId}`, token);
        nextOrganizationProfile = fallbackOrganizationRes?.success ? fallbackOrganizationRes.data || null : null;
      }
    }
    setOrganizationProfile(nextOrganizationProfile);

    applyCheckInPolicy(checkInPolicyRes?.success ? checkInPolicyRes.data : null);
    setAttendanceRequests(attendanceRequestsRes?.success ? attendanceRequestsRes.data || [] : []);

    } catch (error) {
      console.warn('Dashboard load failed', error);
      setPolicyWarning('Unable to load dashboard data. Pull to refresh.');
    } finally {
      if (!silent) setLoading(false);
      if (silent) setRefreshing(false);
    }
  };

  useEffect(() => {
    const unsubscribeFocus = navigation.addListener?.('focus', () => {
      setProfileMenuOpen(false);
    });
    const unsubscribeBlur = navigation.addListener?.('blur', () => {
      setProfileMenuOpen(false);
    });
    let timer: ReturnType<typeof setInterval> | undefined;

    if (token) {
      loadDashboard();
      timer = setInterval(() => {
        loadDashboard(true);
      }, 30000);
    }

    return () => {
      if (timer) clearInterval(timer);
      unsubscribeFocus?.();
      unsubscribeBlur?.();
    };
  }, [
    navigation,
    weekStart,
    token,
    canCheckIn,
    canCheckOut,
    canViewTimesheets,
    canViewAttendance,
    canViewLeaveBalances,
    canViewHolidays,
    canViewWeekOffs,
    canOpenNotifications,
    canViewOnlineTeam,
    canViewOnLeaveTeam,
    canViewUpcomingEvents,
  ]);

  const pendingLeaves = useMemo(
    () => (myLeaves || []).filter((l: any) => l?.status === 'pending').length,
    [myLeaves]
  );

  const pendingTimesheets = useMemo(() => (weeklyStatus === 'submitted' ? 1 : 0), [weeklyStatus]);
  const latestAttendanceRequest = useMemo(() => attendanceRequests[0] || null, [attendanceRequests]);
  const attendanceCalendarMonthLabel = useMemo(
    () => attendanceCalendarMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    [attendanceCalendarMonth]
  );
  const attendanceCalendarWeeks = useMemo(() => {
    const firstDayOffset = new Date(
      attendanceCalendarMonth.getFullYear(),
      attendanceCalendarMonth.getMonth(),
      1
    ).getDay();
    const daysInMonthValue = new Date(
      attendanceCalendarMonth.getFullYear(),
      attendanceCalendarMonth.getMonth() + 1,
      0
    ).getDate();
    const cells: Array<Array<number | null>> = [];
    let week: Array<number | null> = [];

    for (let index = 0; index < firstDayOffset; index += 1) {
      week.push(null);
    }

    for (let day = 1; day <= daysInMonthValue; day += 1) {
      week.push(day);
      if (week.length === 7) {
        cells.push(week);
        week = [];
      }
    }

    if (week.length > 0) {
      while (week.length < 7) {
        week.push(null);
      }
      cells.push(week);
    }

    return cells;
  }, [attendanceCalendarMonth]);

  const closeStatCard = () => setSelectedStatCard(null);

  const selectedStatDetail = useMemo(() => {
    if (!selectedStatCard) return null;

    if (selectedStatCard === 'leave-balance') {
      return {
        title: 'Leave Balance',
        subtitle: `${leaveBalances.length} leave type${leaveBalances.length === 1 ? '' : 's'} available`,
        icon: 'wallet-outline',
        accent: '#3b63db',
        rows: leaveBalances.length
          ? leaveBalances.map((balance: any, index: number) => ({
              label: balance?.leaveType || balance?.name || `Leave ${index + 1}`,
              value: `${Number(balance?.remaining || 0).toFixed(1)}/${Number(balance?.total || 0).toFixed(1)}`,
              meta: `Used ${Number(balance?.used || 0).toFixed(1)} � Pending ${Number(balance?.pending || 0).toFixed(1)}`,
            }))
          : [],
        emptyText: 'No leave balances found.',
      };
    }

    if (selectedStatCard === 'team') {
      return {
        title: 'Team',
        subtitle: String(onlineList.length) + ' employee' + (onlineList.length === 1 ? ' ' : 's ') + 'online now',
        icon: 'account-group-outline',
        accent: '#16934f',
        rows: onlineList.length
          ? onlineList.map((member: any, index: number) => {
              const name = getEmployeeDisplayName(member) || ('Employee ' + (index + 1));
              const checkInText = member?.checkInAt ? 'Check-in: ' + formatTime(member.checkInAt) : 'Check-in: Pending';
              const checkOutText = member?.checkOutAt ? 'Check-out: ' + formatTime(member.checkOutAt) : 'Check-out: Pending';

              return {
                label: name,
                value: checkInText,
                meta: checkOutText,
              };
            })
          : [],
        emptyText: 'No one is online right now.',
      };
    }
    if (selectedStatCard === 'pending-requests') {
      const pendingLeaveItems = (myLeaves || [])
        .filter((leave: any) => leave?.status === 'pending')
        .slice(0, 6)
        .map((leave: any, index: number) => ({
          label:
            leave?.leaveTypeName || leave?.leaveTypeId?.name || leave?.leaveType || `Leave request ${index + 1}`,
          value: `${formatDateLong(leave?.fromDate || leave?.startDate || leave?.date || new Date())}`,
          meta: leave?.reason || `${Number(leave?.totalDays || leave?.days || 0).toFixed(1)} day(s)`,
        }));

      return {
        title: 'Pending Requests',
        subtitle: `${pendingLeaves} leave${pendingLeaves === 1 ? '' : 's'} and ${pendingTimesheets} timesheet${pendingTimesheets === 1 ? '' : 's'} pending`,
        icon: 'clock-outline',
        accent: '#d48a00',
        rows: [
          {
            label: 'Leaves',
            value: String(pendingLeaves),
            meta: pendingLeaveItems.length ? 'Tap to review your pending leave requests below.' : 'No pending leave requests.',
          },
          {
            label: 'Timesheets',
            value: String(pendingTimesheets),
            meta: pendingTimesheets ? 'Your weekly timesheet is pending submission.' : 'No pending timesheets right now.',
          },
          ...pendingLeaveItems,
        ],
        emptyText: pendingLeaves === 0 && pendingTimesheets === 0 ? 'No pending requests.' : '',
      };
    }

    if (selectedStatCard === 'on-leave-today') {
      return {
        title: 'On Leave Today',
        subtitle: `${onLeaveList.length} employee${onLeaveList.length === 1 ? '' : 's'} on leave`,
        icon: 'calendar-remove-outline',
        accent: '#d94b4b',
        rows: onLeaveList.length
          ? onLeaveList.map((member: any, index: number) => ({
              label: getEmployeeDisplayName(member) || `Employee ${index + 1}`,
              value: member?.leaveType || member?.leaveTypeName || member?.reason || 'On leave',
              meta: member?.date ? formatDateLong(member.date) : member?.department || '',
            }))
          : [],
        emptyText: 'No employees are on leave today.',
      };
    }

    return null;
  }, [
    selectedStatCard,
    leaveBalances,
    onlineList,
    pendingLeaves,
    pendingTimesheets,
    myLeaves,
    onLeaveList,
  ]);

  const missingProfileFields = useMemo(() => {
    if (!myProfile) return [];
    const missing: string[] = [];
    if (!myProfile.phone) missing.push('Phone');
    if (!myProfile.dob) missing.push('Date of birth');
    if (!myProfile.gender) missing.push('Gender');
    if (!myProfile.address?.line1) missing.push('Address');
    if (!Array.isArray(myProfile.emergencyContacts) || myProfile.emergencyContacts?.length === 0) {
      missing.push('Emergency contact');
    }
    return missing;
  }, [myProfile]);

  const totalLeaveRemaining = useMemo(
    () => (leaveBalances || []).reduce((sum: number, b: any) => sum + Number(b?.remaining || 0), 0),
    [leaveBalances]
  );

  const weeklyProgress = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayKey = toDateInput(todayStart);
    const sundayStart = new Date(todayStart);
    sundayStart.setDate(todayStart.getDate() - todayStart.getDay());

    let todayLiveHours = 0;
    if (attendanceToday?.checkInAt) {
      const inAt = new Date(attendanceToday.checkInAt);
      const outAt = attendanceToday?.checkOutAt ? new Date(attendanceToday.checkOutAt) : now;
      todayLiveHours = Math.max(0, (outAt.getTime() - inAt.getTime()) / (1000 * 60 * 60));
    }

    const dayRows = Array.from({ length: 7 }, (_, idx) => {
      const dayDate = new Date(sundayStart);
      dayDate.setDate(sundayStart.getDate() + idx);
      dayDate.setHours(0, 0, 0, 0);
      const dayKey = toDateInput(dayDate);

      const dayName = dayNames[dayDate.getDay()];
      const entryForDay = (weeklyEntries || []).find((e: any) => {
        if (!e?.date) return false;
        return toDateInput(new Date(e.date)) === dayKey;
      });
      const timesheetHours = Number(entryForDay?.hours || 0);

      const matrixCell =
        dayDate.getMonth() === today.getMonth() && dayDate.getFullYear() === today.getFullYear()
          ? matrixDays[dayDate.getDate()]
          : null;

      let attendanceHours = 0;
      if (matrixCell?.checkInAt) {
        const inAt = new Date(matrixCell.checkInAt);
        const outAt = matrixCell?.checkOutAt ? new Date(matrixCell.checkOutAt) : now;
        attendanceHours = Math.max(0, (outAt.getTime() - inAt.getTime()) / (1000 * 60 * 60));
      }

      const completedHours =
        dayKey === todayKey
          ? Math.max(timesheetHours, attendanceHours, todayLiveHours)
          : Math.max(timesheetHours, attendanceHours);

      const entryNotes = entryForDay?.notes || entryForDay?.note || '';
      return {
        dayName,
        date: dayDate,
        timesheetHours,
        attendanceHours,
        completedHours,
        notes: entryNotes,
      };
    });

    const completedIncludingToday = dayRows
      .filter((d) => toDateInput(new Date(d.date)) <= todayKey)
      .reduce((sum, d) => sum + Number(d.completedHours || 0), 0);

    const todayTimesheetHours =
      dayRows.find((d) => toDateInput(new Date(d.date)) === todayKey)?.timesheetHours || 0;

    return {
      completedIncludingToday,
      todayTimesheetHours,
      todayLiveHours,
      dayRows,
    };
  }, [weeklyEntries, attendanceToday, matrixDays]);

  const weekEndDate = useMemo(() => {
    const end = new Date(weekStart);
    end.setDate(end.getDate() + 6);
    return end;
  }, [weekStart]);
  const weeklyRangeLabel = `${toDateInput(weekStart)} - ${toDateInput(weekEndDate)}`;
  const weekStatusLabel =
    weeklyStatus && weeklyStatus.length > 0
      ? `${weeklyStatus[0].toUpperCase()}${weeklyStatus.slice(1)}`
      : 'Draft';
  const requiredWeeklyHours = 56;
  const timesheetDays = weeklyProgress.dayRows;
  const workedHoursText = `${weeklyHours.toFixed(2)} / ${requiredWeeklyHours}`;

  const hasCheckedInToday = Boolean(attendanceToday?.checkInAt);
  const isCheckedIn = hasCheckedInToday && !attendanceToday?.checkOutAt;
  const isCheckInDisabled = checkinLoading || (!checkInPolicy.attendanceMultiPunchEnabled && hasCheckedInToday);
  const isCheckOutDisabled = checkoutLoading || (!isCheckedIn && !checkInPolicy.attendanceMultiPunchEnabled);

  const firstCheckInAt = useMemo(() => {
    const punches = attendanceToday?.dayHistory || [];
    const firstCheckIn = punches.find((entry: any) => entry?.action === 'check_in' && entry?.at);
    return firstCheckIn?.at || attendanceToday?.checkInAt || null;
  }, [attendanceToday]);

  const checkInTimeText = firstCheckInAt ? formatTime(firstCheckInAt) : '-';
  const checkOutTimeText = attendanceToday?.checkOutAt
    ? formatTime(attendanceToday.checkOutAt)
    : '-';
  const shiftStartText = attendanceToday?.shiftStartTime || myProfile?.shiftId?.startTime || null;
  const shiftEndText = attendanceToday?.shiftEndTime || myProfile?.shiftId?.endTime || null;
  const shiftNameText =
    attendanceToday?.shiftName ||
    myProfile?.shiftId?.name ||
    myProfile?.shiftId?.code ||
    'General Shift';
  const shiftTimeText =
    shiftStartText && shiftEndText ? `${shiftStartText} - ${shiftEndText}` : 'Not assigned';

  const lateFlag = useMemo(() => Number(attendanceToday?.lateByMinutes || 0) > 0, [attendanceToday]);

  type PermissionValue = typeof PermissionsAndroid.PERMISSIONS[keyof typeof PermissionsAndroid.PERMISSIONS];
  const requestAndroidPermission = async (permission: PermissionValue) => {
    const granted = await PermissionsAndroid.request(permission);
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  };

  const requestLocationPermission = async () => {
    if (Platform.OS !== 'android') return true;
    return requestAndroidPermission(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
  };

  const requestCameraPermission = async () => {
    if (Platform.OS !== 'android') return true;
    return requestAndroidPermission(PermissionsAndroid.PERMISSIONS.CAMERA);
  };

  const getCurrentLocation = async () =>
    new Promise<{ latitude: number; longitude: number }>((resolve, reject) => {
      Geolocation.getCurrentPosition(
        (position) =>
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          }),
        (error) => reject(error),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
      );
    });

  const captureSelfie = async () => {
    const ok = await requestCameraPermission();
    if (!ok) {
      setPolicyWarning('Camera permission is required for attendance selfie.');
      return null;
    }

    const attendanceSelfie = NativeModules.AttendanceSelfie as
      | {
          captureSelfie: () => Promise<string>;
        }
      | undefined;

    if (!attendanceSelfie?.captureSelfie) {
      setPolicyWarning('Attendance camera is unavailable on this device.');
      return null;
    }

    try {
      return await attendanceSelfie.captureSelfie();
    } catch {
      setPolicyWarning('Selfie capture cancelled.');
      return null;
    }
  };

  const handleCheckIn = async () => {
    if (!canCheckIn) {
      return;
    }
    const latestPolicy = await loadLatestCheckInPolicy();
    const payload: Record<string, unknown> = {};
    const clientIp = await getPublicIpAddress();
    if (clientIp) {
      payload.clientIp = clientIp;
    }
    payload.deviceId = await getDeviceId();
    if (latestPolicy.attendanceGeoFenceEnabled) {
      const ok = await requestLocationPermission();
      if (!ok) {
        setPolicyWarning('Location permission is required for check-in.');
        return;
      }
      try {
        const location = await getCurrentLocation();
        payload.latitude = location.latitude;
        payload.longitude = location.longitude;
      } catch {
        setPolicyWarning('Unable to get current location.');
        return;
      }
    }
    if (latestPolicy.attendanceSelfieRequired) {
      const selfie = await captureSelfie();
      if (!selfie) {
        setPolicyWarning('Selfie capture cancelled.');
        return;
      }
      payload.selfieImage = selfie;
    }
    setCheckinLoading(true);
    const res = await postApiWithToken('/timesheets/check-in', payload, token);
    setCheckinLoading(false);
    if (res?.success) {
      loadDashboard();
      setPolicyWarning('');
    } else if (res?.message) {
      await loadDashboard(true);
      setPolicyWarning(res.message);
    }
  };

  const handleCheckOut = async () => {
    if (!canCheckOut) {
      return;
    }
    const latestPolicy = await loadLatestCheckInPolicy();
    const payload: Record<string, unknown> = {};
    const clientIp = await getPublicIpAddress();
    if (clientIp) {
      payload.clientIp = clientIp;
    }
    payload.deviceId = await getDeviceId();
    if (latestPolicy.attendanceSelfieRequired) {
      const selfie = await captureSelfie();
      if (!selfie) {
        setPolicyWarning('Selfie capture cancelled.');
        return;
      }
      payload.selfieImage = selfie;
    }
    setCheckoutLoading(true);
    const res = await postApiWithToken('/timesheets/check-out', payload, token);
    setCheckoutLoading(false);
    if (res?.success) {
      loadDashboard();
      setPolicyWarning('');
    } else if (res?.message) {
      await loadDashboard(true);
      setPolicyWarning(res.message);
    }
  };

  const employeeName = [myProfile?.firstName, myProfile?.lastName].filter(Boolean).join(' ');
  const organizationName = useMemo(
    () =>
      getOrganizationName(
        organizationProfile,
        myProfile?.organizationId,
        myProfile?.activeOrganizationId,
        myProfile,
        session?.loginData?.organizationId,
        session?.loginData?.activeOrganizationId,
        session?.loginData,
        profile
      ),
    [organizationProfile, myProfile, session?.loginData, profile]
  );
  const profileInitials =
    (myProfile?.firstName?.[0] || '') + (myProfile?.lastName?.[0] || '');
  const avatarLabel =
    profileInitials.trim() || myProfile?.email?.[0]?.toUpperCase() || 'U';
  const profileImage = myProfile?.profileImage || myProfile?.profilePhoto || null;
  
  useEffect(() => {
    const nextTab = (route?.params?.initialTab || 'overview') as
      | 'overview'
      | 'attendance'
      | 'planning';
    if (nextTab === 'attendance' && !canViewAttendance) {
      setActiveTab(canViewPlanning ? 'planning' : 'overview');
      return;
    }
    if (nextTab === 'planning' && !canViewPlanning) {
      setActiveTab(canViewAttendance ? 'attendance' : 'overview');
      return;
    }
    setActiveTab(nextTab);
  }, [route?.params?.initialTab, canViewAttendance, canViewPlanning]);

  useEffect(() => {
    if (activeTab === 'attendance' && !canViewAttendance) {
      setActiveTab(canViewPlanning ? 'planning' : 'overview');
      return;
    }
    if (activeTab === 'planning' && !canViewPlanning) {
      setActiveTab(canViewAttendance ? 'attendance' : 'overview');
    }
  }, [activeTab, canViewAttendance, canViewPlanning]);

  useEffect(() => {
    if (!loginSuccessMessage) return;

    setShowLoginToast(true);
    const timer = setTimeout(() => {
      setShowLoginToast(false);
      clearLoginSuccessMessage();
    }, 2600);

    return () => clearTimeout(timer);
  }, [loginSuccessMessage, clearLoginSuccessMessage]);

  return (
    <LinearGradient
      colors={['#f3f5f9', '#f3f5f9', '#eef1f6']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.container}
    >
      <View style={styles.main}>
        <ScrollView
          ref={scrollViewRef}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingTop: Math.max(safeAreaInsets.top, 16) },
          ]}
        >
          <View style={styles.shell}>
            <View style={styles.topBar}>
              <View style={styles.topBarLeft}>
                <Text
                  style={styles.topBarTitle}
                  numberOfLines={1}
                  ellipsizeMode="clip"
                  adjustsFontSizeToFit
                  minimumFontScale={0.82}
                >
                  Dashboard
                </Text>
              </View>
              <View style={styles.topBarCenter}>
                <View style={styles.topBarOrg}>
                  <Text
                    style={styles.topBarOrgText}
                    numberOfLines={2}
                    ellipsizeMode="tail"
                    adjustsFontSizeToFit
                    minimumFontScale={0.72}
                  >
                    {organizationName}
                  </Text>
                </View>
              </View>
              <View style={styles.topBarRight}>
                {permissionsReady && canOpenNotifications && (
                  <Pressable
                    style={({ pressed }) => [styles.iconButton, pressed && styles.surfacePressed]}
                    onPress={() => {
                      setProfileMenuOpen(false);
                      const parentNavigation = navigation.getParent?.();
                      if (parentNavigation?.push) {
                        parentNavigation.push('Notifications');
                        return;
                      }
                      if (navigation.push) {
                        navigation.push('Notifications');
                        return;
                      }
                      navigation.navigate('Notifications');
                    }}
                  >
                    <MaterialCommunityIcons name="bell-outline" size={18} color="#0f172a" />
                  </Pressable>
                )}
                <Pressable
                  style={({ pressed }) => [styles.avatar, pressed && styles.surfacePressed]}
                  onPress={() => setProfileMenuOpen((current) => !current)}
                >
                  {profileImage ? (
                    <Image source={{ uri: profileImage }} style={styles.avatarImage} />
                  ) : (
                    <Text style={styles.avatarText}>{avatarLabel}</Text>
                  )}
                  <MaterialCommunityIcons
                    name="chevron-down"
                    size={14}
                    color="#0f172a"
                    style={styles.avatarChevron}
                  />
                </Pressable>
              </View>
            </View>
            {loading ? (
              <View style={styles.loadingCard}>
                <ActivityIndicator />
                <Text style={styles.loadingText}>Loading dashboard...</Text>
              </View>
            ) : (
              <>
                {activeTab === 'overview' && (
                  <>
                    {policyWarning ? (
                      <View style={styles.warningCard}>
                        <MaterialCommunityIcons name="alert-circle-outline" size={16} color="#b45309" />
                        <Text style={styles.warningText}>{policyWarning}</Text>
                      </View>
                    ) : null}

                    <View style={styles.card}>
                      <View style={styles.cardHeader}>
                        <Text style={styles.cardTitle}>Today Status</Text>
                        {lateFlag && (
                          <View style={styles.pillLate}>
                            <Text style={styles.pillLateText}>Late</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.bigStatus}>
                        {isCheckedIn ? 'Checked In' : hasCheckedInToday ? 'Checked Out' : 'Not Checked In'}
                      </Text>
                      <Text style={styles.cardSubText}>
                        Check-in: {checkInTimeText} � Check-out: {checkOutTimeText}
                      </Text>
                      <Text style={styles.cardSubText}>
                        Shift: {shiftNameText} ({shiftTimeText})
                      </Text>
                      {(canCheckIn || canCheckOut) && (
                        <View style={styles.actionRow}>
                          {canCheckIn && (
                            <Pressable
                              style={({ pressed }) => [
                                styles.primaryAction,
                                isCheckedIn && styles.primaryActionInactive,
                                pressed && styles.surfacePressed,
                                isCheckInDisabled && styles.primaryDisabled,
                              ]}
                              onPress={handleCheckIn}
                              disabled={isCheckInDisabled}
                            >
                              <LinearGradient
                                colors={isCheckedIn ? ['#ffffff', '#f7f9fd'] : ['#5a7bea', '#456bde', '#3559cc']}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 0, y: 1 }}
                                style={styles.primaryActionInner}
                              >
                                {checkinLoading ? (
                                  <ActivityIndicator color={isCheckedIn ? '#94a3b8' : '#fff'} />
                                ) : (
                                  <MaterialCommunityIcons
                                    name="login"
                                    size={16}
                                    color={isCheckedIn ? '#94a3b8' : '#fff'}
                                  />
                                )}
                                <Text style={[styles.primaryActionText, isCheckedIn && styles.primaryActionTextInactive]}>Check In</Text>
                              </LinearGradient>
                            </Pressable>
                          )}
                          {canCheckOut && (
                            <Pressable
                              style={({ pressed }) => [
                                styles.secondaryAction,
                                isCheckedIn && styles.secondaryActionActive,
                                pressed && styles.surfacePressed,
                                isCheckOutDisabled && styles.secondaryDisabled,
                              ]}
                              onPress={handleCheckOut}
                              disabled={isCheckOutDisabled}
                            >
                              <LinearGradient
                                colors={isCheckedIn ? ['#5a7bea', '#456bde', '#3559cc'] : ['#ffffff', '#f7f9fd']}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 0, y: 1 }}
                                style={styles.secondaryActionInner}
                              >
                                {checkoutLoading ? (
                                  <ActivityIndicator color={isCheckedIn ? '#fff' : '#64748b'} />
                                ) : (
                                  <MaterialCommunityIcons
                                    name="logout"
                                    size={16}
                                    color={isCheckedIn ? '#fff' : '#0f172a'}
                                  />
                                )}
                                <Text style={[styles.secondaryActionText, isCheckedIn && styles.secondaryActionTextActive]}>Check Out</Text>
                              </LinearGradient>
                            </Pressable>
                          )}
                        </View>
                      )}
                      {(canApplyLeave || canViewAttendance) && (
                        <View style={styles.actionRow}>
                          {canApplyLeave && (
                            <Pressable
                              style={({ pressed }) => [styles.secondaryAction, pressed && styles.surfacePressed]}
                              onPress={() => navigation.navigate('Leaves', { openApplyModal: true })}
                            >
                              <LinearGradient
                                colors={['#ffffff', '#f7f9fd']}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 0, y: 1 }}
                                style={styles.secondaryActionInner}
                              >
                                <Text style={styles.secondaryActionText}>Apply Leave</Text>
                              </LinearGradient>
                            </Pressable>
                          )}
                          {canViewAttendance && (
                            <Pressable
                              style={({ pressed }) => [styles.secondaryAction, pressed && styles.surfacePressed]}
                              onPress={openRiseAttendanceRequest}
                            >
                              <LinearGradient
                                colors={['#ffffff', '#f7f9fd']}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 0, y: 1 }}
                                style={styles.secondaryActionInner}
                              >
                                <Text style={styles.secondaryActionText}>Rise Attendance</Text>
                              </LinearGradient>
                            </Pressable>
                          )}
                        </View>
                      )}
                    </View>

                    <View style={styles.statsGrid}>
                      {canViewLeaveBalances && (
                        <Pressable
                          style={({ pressed }) => [styles.statCard, pressed && styles.surfacePressed]}
                          onPress={() => setSelectedStatCard('leave-balance')}
                        >
                          <Text style={styles.statLabel}>Leave Balance</Text>
                          <Text style={[styles.statValue, styles.statValueBlue]}>{totalLeaveRemaining.toFixed(1)}</Text>
                          <Text style={styles.cardSubText}>Total remaining</Text>
                        </Pressable>
                      )}
                      {canViewOnlineTeam && (
                        <Pressable
                          style={({ pressed }) => [styles.statCard, pressed && styles.surfacePressed]}
                          onPress={() => setSelectedStatCard('team')}
                        >
                          <Text style={styles.statLabel}>Team</Text>
                          <Text style={[styles.statValue, styles.statValueGreen]}>{onlineList.length}</Text>
                          <Text style={styles.cardSubText}>Online now</Text>
                        </Pressable>
                      )}
                      {(canViewLeaveBalances || canViewTimesheets) && (
                        <Pressable
                          style={({ pressed }) => [styles.statCard, pressed && styles.surfacePressed]}
                          onPress={() => setSelectedStatCard('pending-requests')}
                        >
                          <Text style={styles.statLabel}>Pending Requests</Text>
                          <Text style={[styles.statValue, styles.statValueAmber]}>{pendingLeaves + pendingTimesheets}</Text>
                          <View style={styles.pendingRequestMeta}>
                            {canViewLeaveBalances && (
                              <View style={styles.pendingRequestMetaItem}>
                                <Text style={styles.pendingRequestMetaLabel}>Leaves : </Text>
                                <Text style={styles.pendingRequestMetaValue}>{pendingLeaves}</Text>
                              </View>
                            )}
                            {canViewTimesheets && (
                              <View style={styles.pendingRequestMetaItem}>
                                <Text style={styles.pendingRequestMetaLabel}>Timesheets : </Text>
                                <Text style={styles.pendingRequestMetaValue}>{pendingTimesheets}</Text>
                              </View>
                            )}
                          </View>
                        </Pressable>
                      )}
                      {canViewOnLeaveTeam && (
                        <Pressable
                          style={({ pressed }) => [styles.statCard, pressed && styles.surfacePressed]}
                          onPress={() => setSelectedStatCard('on-leave-today')}
                        >
                          <Text style={styles.statLabel}>On Leave Today</Text>
                          <Text style={[styles.statValue, styles.statValueRed]}>{onLeaveList.length}</Text>
                          <Text style={styles.cardSubText}>Employees</Text>
                        </Pressable>
                      )}
                    </View>
                  </>
                )}

                {activeTab === 'overview' && canViewUpcomingEvents && (
                  <>
                    <View style={styles.card}>
                      <View style={styles.cardHeader}>
                        <Text style={styles.cardTitle}>Next 7 Days Events</Text>
                        <MaterialCommunityIcons name="calendar-month-outline" size={18} color="#64748b" />
                      </View>
                      <Text style={styles.sectionTitle}>Birthdays</Text>
                      {(upcomingEvents.birthdays || []).length === 0 && (
                        <Text style={styles.cardSubText}>No upcoming birthdays</Text>
                      )}
                      {(upcomingEvents.birthdays || []).slice(0, 4).map((e: any) => (
                        <View key={`b-${e?.employeeId || Math.random()}-${e?.eventDate || ''}`} style={styles.eventRow}>
                          <Text style={styles.eventName}>{e?.name || ''}</Text>
                          <Text style={styles.eventMeta}>
                            {e?.eventDate ? formatDate(e.eventDate) : ''} ({e?.daysAway === 0 ? 'Today' : `${e?.daysAway || 0}d`})
                          </Text>
                        </View>
                      ))}
                      <Text style={styles.sectionTitle}>Anniversaries</Text>
                      {(upcomingEvents.anniversaries || []).length === 0 && (
                        <Text style={styles.cardSubText}>No upcoming anniversaries</Text>
                      )}
                      {(upcomingEvents.anniversaries || []).slice(0, 4).map((e: any) => (
                        <View key={`a-${e?.employeeId || Math.random()}-${e?.eventDate || ''}`} style={styles.eventRow}>
                          <Text style={styles.eventName}>{e?.name || ''}</Text>
                          <Text style={styles.eventMeta}>
                            {e?.eventDate ? formatDate(e.eventDate) : ''} ({e?.years || 0}y)
                          </Text>
                        </View>
                      ))}
                    </View>
                  </>
                )}

                {activeTab === 'attendance' && canViewAttendance && (
                  <AttendanceTab
                    matrixDays={matrixDays}
                    daysInMonth={daysInMonth}
                    onRefresh={() => loadDashboard()}
                    referenceDate={today}
                    dayNames={dayNames}
                    formatTime={formatTime}
                    employeeName={employeeName || 'Employee'}
                    attendancePolicy={checkInPolicy}
                  />
                )}
                
                {activeTab === 'planning' && canViewPlanning && (
                  <>
                    {canViewLeaveBalances && (
                      <View style={styles.card}>
                        <Text style={styles.cardTitle}>Leave Balances</Text>
                        {leaveBalances.length === 0 && (
                          <Text style={styles.cardSubText}>No balances found</Text>
                        )}
                        {leaveBalances.map((b: any) => (
                          <View key={b?.leaveTypeId || Math.random()} style={styles.noticeCard}>
                            <View style={styles.leaveRow}>
                              <Text style={styles.noticeTitle}>{b?.leaveType || ''}</Text>
                              <Text style={styles.noticeText}>
                                {Number(b?.remaining || 0).toFixed(1)}/{Number(b?.total || 0).toFixed(1)}
                              </Text>
                            </View>
                            <Text style={styles.cardSubText}>
                              Used: {Number(b?.used || 0).toFixed(1)} | Pending:{' '}
                              {Number(b?.pending || 0).toFixed(1)}
                            </Text>
                          </View>
                        ))}
                      </View>
                    )}

                    {(canViewHolidays || canViewWeekOffs) && (
                      <View style={styles.card}>
                        {canViewHolidays && (
                          <>
                            <Text style={styles.cardTitle}>Upcoming Holidays</Text>
                            {upcomingHolidays.length === 0 && (
                              <Text style={styles.cardSubText}>No upcoming holidays</Text>
                            )}
                            {upcomingHolidays.map((h: any) => (
                              <View key={h?._id || Math.random()} style={styles.eventRow}>
                                <Text style={styles.eventName}>{h?.name || ''}</Text>
                                <Text style={styles.eventMeta}>{h?.date ? formatDate(h.date) : ''}</Text>
                              </View>
                            ))}
                          </>
                        )}
                        {canViewWeekOffs && (
                          <>
                            <Text style={styles.sectionTitle}>Week Off Days</Text>
                            <View style={styles.weekOffRow}>
                              {weekOffDays.length === 0 ? (
                                <Text style={styles.cardSubText}>Not configured</Text>
                              ) : (
                                weekOffDays.map((d) => (
                                  <View key={d} style={styles.weekOffPill}>
                                    <Text style={styles.weekOffText}>{dayNames[d]}</Text>
                                  </View>
                                ))
                              )}
                            </View>
                          </>
                        )}
                      </View>
                    )}
                  </>
                )}

              </>
            )}

            {refreshing && (
              <View style={styles.refreshBar}>
                <ActivityIndicator size="small" />
                <Text style={styles.refreshText}>Refreshing</Text>
              </View>
            )}
          </View>
        </ScrollView>

        {selectedStatDetail && (
          <Modal visible transparent animationType="fade" onRequestClose={closeStatCard}>
            <View style={styles.statModalBackdrop}>
              <Pressable
                style={StyleSheet.absoluteFill}
                onPress={closeStatCard}
              />
              <View style={styles.statModalCard}>
                <View style={styles.statModalHeader}>
                  <View style={styles.statModalIconWrap}>
                    <MaterialCommunityIcons
                      name={selectedStatDetail.icon}
                      size={20}
                      color={selectedStatDetail.accent}
                    />
                  </View>
                  <View style={styles.statModalHeaderText}>
                    <Text style={styles.statModalTitle}>{selectedStatDetail.title}</Text>
                    <Text style={styles.statModalSubtitle}>{selectedStatDetail.subtitle}</Text>
                  </View>
                  <Pressable style={styles.statModalClose} onPress={closeStatCard}>
                    <MaterialCommunityIcons name="close" size={18} color="#0f172a" />
                  </Pressable>
                </View>

                <ScrollView
                  style={styles.statModalScroll}
                  contentContainerStyle={styles.statModalBody}
                  showsVerticalScrollIndicator={false}
                  nestedScrollEnabled
                >
                  {selectedStatCard === 'team' ? (
                    onlineList.length > 0 ? (
                      onlineList.map((member: any, index: number) => {
                        const firstName = member?.employeeId?.firstName || member?.firstName || member?.profile?.firstName || '';
                        const lastName = member?.employeeId?.lastName || member?.lastName || member?.profile?.lastName || '';
                        const employeeName = [firstName, lastName].filter(Boolean).join(' ').trim()
                          || member?.employeeId?.displayName
                          || member?.employeeId?.name
                          || member?.name
                          || `Employee ${index + 1}`;
                        const employeeCode = member?.employeeId?.employeeCode || member?.employeeCode || 'Employee';
                        const checkInLabel = member?.checkInAt ? formatTime(member.checkInAt) : 'Pending';
                        const checkOutLabel = member?.checkOutAt ? formatTime(member.checkOutAt) : 'Pending';

                        return (
                          <View key={`team-${index}`} style={styles.statModalRow}>
                            <View style={styles.statModalRowText}>
                              <Text style={styles.statModalRowLabel}>{employeeName}</Text>
                              <Text style={styles.statModalRowMeta}>Code: {employeeCode}</Text>
                              <Text style={styles.statModalRowMeta}>Check-in: {checkInLabel}</Text>
                              <Text style={styles.statModalRowMeta}>Check-out: {checkOutLabel}</Text>
                            </View>
                          </View>
                        );
                      })
                    ) : (
                      <View style={styles.statModalEmpty}>
                        <Text style={styles.statModalEmptyText}>{selectedStatDetail.emptyText}</Text>
                      </View>
                    )
                  ) : selectedStatDetail.rows.length > 0 ? (
                    selectedStatDetail.rows.map((row: any, index: number) => (
                      <View key={`${selectedStatDetail.title}-${index}`} style={styles.statModalRow}>
                        <View style={styles.statModalRowText}>
                          <Text style={styles.statModalRowLabel}>{row.label}</Text>
                          {row.meta ? <Text style={styles.statModalRowMeta}>{row.meta}</Text> : null}
                        </View>
                        <Text style={styles.statModalRowValue}>{row.value}</Text>
                      </View>
                    ))
                  ) : (
                    <View style={styles.statModalEmpty}>
                      <Text style={styles.statModalEmptyText}>{selectedStatDetail.emptyText}</Text>
                    </View>
                  )}
                </ScrollView>
              </View>
            </View>
          </Modal>
        )}
        {riseAttendanceOpen && (
          <Modal visible transparent animationType="fade" onRequestClose={closeRiseAttendanceRequest}>
            <View style={styles.attendanceModalBackdrop}>
              <Pressable
                style={StyleSheet.absoluteFill}
                onPress={closeRiseAttendanceRequest}
              />
              <KeyboardAvoidingView
                style={styles.attendanceKeyboardAvoiding}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                keyboardVerticalOffset={Platform.OS === 'ios' ? 18 : 0}
              >
                <View style={styles.attendanceModalCard}>
                  <View style={styles.attendanceModalHeader}>
                    <View style={styles.attendanceModalTitleWrap}>
                      <Text style={styles.attendanceModalTitle}>Raise Attendance Request</Text>
                      <Text style={styles.attendanceModalSubtitle}>Submit a correction, missed checkout, or work from home request.</Text>
                    </View>
                    <Pressable style={styles.attendanceModalClose} onPress={closeRiseAttendanceRequest}>
                      <MaterialCommunityIcons name="close" size={18} color="#0f172a" />
                    </Pressable>
                  </View>

                  <ScrollView
                    style={styles.attendanceModalScroll}
                    contentContainerStyle={styles.attendanceModalBody}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode="on-drag"
                    nestedScrollEnabled
                  >
                    {latestAttendanceRequest ? (
                      <View style={styles.attendanceStatusCard}>
                        <View
                          style={[
                            styles.attendanceStatusDot,
                            { backgroundColor: getAttendanceRequestStatusColor(latestAttendanceRequest?.status) },
                          ]}
                        />
                        <View style={styles.attendanceStatusContent}>
                          <Text style={styles.attendanceStatusTitle}>
                            Latest request: {getAttendanceRequestStatusLabel(latestAttendanceRequest?.status)}
                          </Text>
                          <Text style={styles.attendanceStatusMeta}>
                            {getAttendanceRequestTypeLabel(latestAttendanceRequest?.requestType || attendanceRequestType)} - {latestAttendanceRequest?.date || attendanceRequestDate}
                          </Text>
                        </View>
                      </View>
                    ) : null}

                    {attendanceRequestStatusMessage ? (
                      <View style={styles.attendanceNoticeSuccess}>
                        <Text style={styles.attendanceNoticeText}>{attendanceRequestStatusMessage}</Text>
                      </View>
                    ) : null}

                    <View style={styles.attendanceFieldGrid}>
                      <View style={styles.attendanceFieldHalf}>
                        <Text style={styles.attendanceFieldLabel}>Date</Text>
                        <Pressable
                          style={({ pressed }) => [
                            styles.attendanceInputShell,
                            styles.attendancePickerShell,
                            pressed && styles.attendancePickerShellPressed,
                          ]}
                          onPress={openAttendanceCalendar}
                        >
                          <Text style={styles.attendancePickerText}>{formatDateInputLabel(attendanceRequestDate)}</Text>
                          <MaterialCommunityIcons name="calendar-month-outline" size={18} color="#2563eb" />
                        </Pressable>
                      </View>

                      <View style={styles.attendanceFieldHalf}>
                        <Text style={styles.attendanceFieldLabel}>Request Type</Text>
                        <View style={[styles.attendanceSelectWrap, attendanceRequestMenuOpen && styles.attendanceSelectWrapTop]}>
                          <Pressable
                            style={[
                              styles.attendanceSelect,
                              attendanceRequestMenuOpen && styles.attendanceSelectActive,
                            ]}
                            onPress={() => {
                              setAttendanceWfhDurationMenuOpen(false);
                              setAttendanceWfhSessionMenuOpen(false);
                              setAttendanceRequestMenuOpen((current) => !current);
                            }}
                          >
                            <Text style={styles.attendanceSelectText}>{getAttendanceRequestTypeLabel(attendanceRequestType)}</Text>
                            <MaterialCommunityIcons
                              name={attendanceRequestMenuOpen ? 'chevron-up' : 'chevron-down'}
                              size={18}
                              color="#64748b"
                            />
                          </Pressable>
                          {attendanceRequestMenuOpen && (
                            <View style={styles.attendanceDropdown}>
                              {attendanceRequestTypeOptions.map((option) => {
                                const active = option.value === attendanceRequestType;
                                return (
                                  <Pressable
                                    key={option.value}
                                    style={[styles.attendanceDropdownItem, active && styles.attendanceDropdownItemActive]}
                                    onPress={async () => {
                                      setAttendanceRequestType(option.value);
                                      setAttendanceRequestMenuOpen(false);
                                      await loadAttendanceRequestDefaults(attendanceRequestDate, option.value);
                                    }}
                                  >
                                    <Text style={[styles.attendanceDropdownItemText, active && styles.attendanceDropdownItemTextActive]}>
                                      {option.label}
                                    </Text>
                                  </Pressable>
                                );
                              })}
                            </View>
                          )}
                        </View>
                      </View>
                    </View>

                    {attendanceRequestType === 'missed_checkout' ? (
                      <View style={styles.attendanceFieldBlock}>
                        <Text style={styles.attendanceFieldLabel}>Check-out Time</Text>
                        <View style={styles.attendanceInputShell}>
                          <TextInput
                            style={styles.attendanceTextInput}
                            value={attendanceRequestedCheckOutTime}
                            onChangeText={setAttendanceRequestedCheckOutTime}
                            placeholder="HH:MM"
                            placeholderTextColor="#94a3b8"
                            autoCapitalize="none"
                            autoCorrect={false}
                          />
                        </View>
                        <Text style={styles.attendanceHelperText}>
                          Please enter the missing checkout time for the selected day.
                        </Text>
                      </View>
                    ) : null}

                    {attendanceRequestType === 'correction' ? (
                      <View style={styles.attendanceFieldBlock}>
                        <View style={styles.attendanceFieldGrid}>
                          <View style={styles.attendanceFieldHalf}>
                            <Text style={styles.attendanceFieldLabel}>Check-in Time</Text>
                            <View style={styles.attendanceInputShell}>
                              <TextInput
                                style={styles.attendanceTextInput}
                                value={attendanceRequestedCheckInTime}
                                onChangeText={setAttendanceRequestedCheckInTime}
                                placeholder="HH:MM"
                                placeholderTextColor="#94a3b8"
                                autoCapitalize="none"
                                autoCorrect={false}
                              />
                            </View>
                          </View>
                          <View style={styles.attendanceFieldHalf}>
                            <Text style={styles.attendanceFieldLabel}>Check-out Time</Text>
                            <View style={styles.attendanceInputShell}>
                              <TextInput
                                style={styles.attendanceTextInput}
                                value={attendanceRequestedCheckOutTime}
                                onChangeText={setAttendanceRequestedCheckOutTime}
                                placeholder="HH:MM"
                                placeholderTextColor="#94a3b8"
                                autoCapitalize="none"
                                autoCorrect={false}
                              />
                            </View>
                          </View>
                        </View>
                        <Text style={styles.attendanceHelperText}>
                          Please enter both check-in and check-out times for the selected day.
                        </Text>
                      </View>
                    ) : null}


                    {attendanceRequestType === 'work_from_home' ? (
                      <View style={styles.attendanceFieldBlock}>
                        <View style={styles.attendanceFieldGrid}>
                          <View style={styles.attendanceFieldHalf}>
                            <Text style={styles.attendanceFieldLabel}>Work Pattern</Text>
                            <View style={styles.attendanceSelectWrap}>
                              <Pressable
                                style={[
                                  styles.attendanceSelect,
                                  attendanceWfhDurationMenuOpen && styles.attendanceSelectActive,
                                ]}
                                onPress={() => {
                                  setAttendanceRequestMenuOpen(false);
                                  setAttendanceWfhSessionMenuOpen(false);
                                  setAttendanceWfhDurationMenuOpen((current) => !current);
                                }}
                              >
                                <Text style={styles.attendanceSelectText}>{getAttendanceWfhDurationLabel(attendanceWfhDuration)}</Text>
                                <MaterialCommunityIcons
                                  name={attendanceWfhDurationMenuOpen ? 'chevron-up' : 'chevron-down'}
                                  size={18}
                                  color="#64748b"
                                />
                              </Pressable>
                              {attendanceWfhDurationMenuOpen && (
                                <View style={styles.attendanceDropdown}>
                                  {attendanceWfhDurationOptions.map((option) => {
                                    const active = option.value === attendanceWfhDuration;
                                    return (
                                      <Pressable
                                        key={option.value}
                                        style={[styles.attendanceDropdownItem, active && styles.attendanceDropdownItemActive]}
                                        onPress={() => {
                                          setAttendanceWfhDuration(option.value);
                                          setAttendanceWfhDurationMenuOpen(false);
                                          if (option.value === 'full_day') {
                                            setAttendanceWfhSessionMenuOpen(false);
                                          }
                                        }}
                                      >
                                        <Text style={[styles.attendanceDropdownItemText, active && styles.attendanceDropdownItemTextActive]}>
                                          {option.label}
                                        </Text>
                                      </Pressable>
                                    );
                                  })}
                                </View>
                              )}
                            </View>
                          </View>

                          <View style={styles.attendanceFieldHalf}>
                            <Text style={styles.attendanceFieldLabel}>Session</Text>
                            <View style={styles.attendanceSelectWrap}>
                              <Pressable
                                style={[
                                  styles.attendanceSelect,
                                  attendanceWfhSessionMenuOpen && styles.attendanceSelectActive,
                                  attendanceWfhDuration === 'full_day' && styles.attendanceSelectDisabled,
                                ]}
                                onPress={() => {
                                  if (attendanceWfhDuration === 'full_day') return;
                                  setAttendanceRequestMenuOpen(false);
                                  setAttendanceWfhDurationMenuOpen(false);
                                  setAttendanceWfhSessionMenuOpen((current) => !current);
                                }}
                                disabled={attendanceWfhDuration === 'full_day'}
                              >
                                <Text style={[styles.attendanceSelectText, attendanceWfhDuration === 'full_day' && styles.attendanceSelectTextDisabled]}>
                                  {attendanceWfhDuration === 'full_day' ? 'Full Day' : getAttendanceWfhSessionLabel(attendanceWfhSession)}
                                </Text>
                                <MaterialCommunityIcons
                                  name={attendanceWfhSessionMenuOpen ? 'chevron-up' : 'chevron-down'}
                                  size={18}
                                  color="#64748b"
                                />
                              </Pressable>
                              {attendanceWfhSessionMenuOpen && attendanceWfhDuration === 'half_day' && (
                                <View style={styles.attendanceDropdown}>
                                  {attendanceWfhSessionOptions.map((option) => {
                                    const active = option.value === attendanceWfhSession;
                                    return (
                                      <Pressable
                                        key={option.value}
                                        style={[styles.attendanceDropdownItem, active && styles.attendanceDropdownItemActive]}
                                        onPress={() => {
                                          setAttendanceWfhSession(option.value);
                                          setAttendanceWfhSessionMenuOpen(false);
                                        }}
                                      >
                                        <Text style={[styles.attendanceDropdownItemText, active && styles.attendanceDropdownItemTextActive]}>
                                          {option.label}
                                        </Text>
                                      </Pressable>
                                    );
                                  })}
                                </View>
                              )}
                            </View>
                          </View>
                        </View>

                        <View style={styles.attendanceFieldGrid}>
                          <View style={styles.attendanceFieldHalf}>
                            <Text style={styles.attendanceFieldLabel}>Check-in Time</Text>
                            <View style={styles.attendanceInputShell}>
                              <TextInput
                                style={styles.attendanceTextInput}
                                value={attendanceRequestedCheckInTime}
                                editable={false}
                                placeholder="HH:MM"
                                placeholderTextColor="#94a3b8"
                                autoCapitalize="none"
                                autoCorrect={false}
                              />
                            </View>
                          </View>
                          <View style={styles.attendanceFieldHalf}>
                            <Text style={styles.attendanceFieldLabel}>Check-out Time</Text>
                            <View style={styles.attendanceInputShell}>
                              <TextInput
                                style={styles.attendanceTextInput}
                                value={attendanceRequestedCheckOutTime}
                                editable={false}
                                placeholder="HH:MM"
                                placeholderTextColor="#94a3b8"
                                autoCapitalize="none"
                                autoCorrect={false}
                              />
                            </View>
                          </View>
                        </View>
                        <Text style={styles.attendanceHelperText}>
                          Times are derived from the assigned shift and selected day.
                        </Text>
                      </View>
                    ) : null}

                    <View style={styles.attendanceFieldBlock}>
                      <Text style={styles.attendanceFieldLabel}>Reason</Text>
                      <TextInput
                        style={styles.attendanceReasonInput}
                        placeholder="Enter reason"
                        placeholderTextColor="#94a3b8"
                        value={attendanceRequestReason}
                        onChangeText={setAttendanceRequestReason}
                        multiline
                      />
                    </View>

                    {attendanceRequestError ? <Text style={styles.attendanceErrorText}>{attendanceRequestError}</Text> : null}
                  </ScrollView>

                  <View style={styles.attendanceActionRow}>
                    <Pressable
                      style={({ pressed }) => [styles.attendanceSecondaryButton, pressed && styles.surfacePressed]}
                      onPress={closeRiseAttendanceRequest}
                    >
                      <Text style={styles.attendanceSecondaryButtonText}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [styles.attendancePrimaryButton, pressed && styles.surfacePressed]}
                      onPress={submitAttendanceRequest}
                      disabled={attendanceRequestSubmitting}
                    >
                      <LinearGradient
                        colors={['#2563eb', '#2563eb', '#1d4ed8']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 0, y: 1 }}
                        style={styles.attendancePrimaryButtonInner}
                      >
                        {attendanceRequestSubmitting ? (
                          <ActivityIndicator color="#fff" />
                        ) : (
                          <Text style={styles.attendancePrimaryButtonText}>Submit Request</Text>
                        )}
                      </LinearGradient>
                    </Pressable>
                  </View>
                </View>
              </KeyboardAvoidingView>
            </View>
          </Modal>
        )}        {attendanceCalendarOpen && (
          <Modal visible transparent animationType="fade" onRequestClose={closeAttendanceCalendar}>
            <Pressable style={styles.attendanceCalendarBackdrop} onPress={closeAttendanceCalendar}>
              <Pressable style={styles.attendanceCalendarCard} onPress={(event) => event.stopPropagation()}>
                <View style={styles.attendanceCalendarHeader}>
                  <View style={styles.attendanceCalendarTitleWrap}>
                    <Text style={styles.attendanceCalendarTitle}>Select Date</Text>
                    <Text style={styles.attendanceCalendarSubtitle}>{attendanceCalendarMonthLabel}</Text>
                  </View>
                  <Pressable style={styles.attendanceCalendarClose} onPress={closeAttendanceCalendar}>
                    <MaterialCommunityIcons name="close" size={18} color="#0f172a" />
                  </Pressable>
                </View>

                <View style={styles.attendanceCalendarNavRow}>
                  <Pressable style={styles.attendanceCalendarNavButton} onPress={() => changeAttendanceCalendarMonth(-1)}>
                    <MaterialCommunityIcons name="chevron-left" size={22} color="#2563eb" />
                  </Pressable>
                  <View style={styles.attendanceCalendarNavCenter}>
                    <MaterialCommunityIcons name="calendar-month-outline" size={16} color="#2563eb" />
                    <Text style={styles.attendanceCalendarNavText}>{attendanceCalendarMonthLabel}</Text>
                  </View>
                  <Pressable style={styles.attendanceCalendarNavButton} onPress={() => changeAttendanceCalendarMonth(1)}>
                    <MaterialCommunityIcons name="chevron-right" size={22} color="#2563eb" />
                  </Pressable>
                </View>

                <View style={styles.attendanceCalendarWeekRow}>
                  {dayNames.map((day) => (
                    <Text key={day} style={styles.attendanceCalendarWeekday}>
                      {day.toUpperCase()}
                    </Text>
                  ))}
                </View>

                <View style={styles.attendanceCalendarGrid}>
                  {attendanceCalendarWeeks.map((week, weekIndex) => (
                    <View key={`attendance-week-${weekIndex}`} style={styles.attendanceCalendarWeek}>
                      {week.map((day, dayIndex) => {
                        if (!day) {
                          return <View key={`attendance-empty-${weekIndex}-${dayIndex}`} style={styles.attendanceCalendarEmpty} />;
                        }

                        const isSelected = attendanceRequestDate === toDateInput(new Date(attendanceCalendarMonth.getFullYear(), attendanceCalendarMonth.getMonth(), day));

                        return (
                          <Pressable
                            key={`attendance-day-${weekIndex}-${dayIndex}-${day}`}
                            style={({ pressed }) => [
                              styles.attendanceCalendarDay,
                              isSelected && styles.attendanceCalendarDaySelected,
                              pressed && styles.attendanceCalendarDayPressed,
                            ]}
                            onPress={() => handleAttendanceCalendarSelect(day)}
                          >
                            <Text style={[styles.attendanceCalendarDayText, isSelected && styles.attendanceCalendarDayTextSelected]}>
                              {day}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ))}
                </View>

                <View style={styles.attendanceCalendarFooter}>
                  <Text style={styles.attendanceCalendarFooterText}>Selected: {formatDateInputLabel(attendanceRequestDate)}</Text>
                  <Pressable style={styles.attendanceCalendarFooterButton} onPress={closeAttendanceCalendar}>
                    <Text style={styles.attendanceCalendarFooterButtonText}>Done</Text>
                  </Pressable>
                </View>
              </Pressable>
            </Pressable>
          </Modal>
        )}
        {profileMenuOpen && (
          <>
            <Pressable
              style={styles.profileBackdrop}
              onPress={() => setProfileMenuOpen(false)}
            />
            <View style={styles.profileMenu}>
              <Text style={styles.profileMenuHeader}>My Account</Text>
              <View style={styles.profileMenuDivider} />
              <Pressable
                style={styles.profileMenuItem}
                onPress={() => {
                  setProfileMenuOpen(false);
                  navigation.navigate('Profile');
                }}
              >
                <Text style={styles.profileMenuText}>Profile</Text>
              </Pressable>
              <Pressable
                style={styles.profileMenuItem}
                onPress={() => {
                  setProfileMenuOpen(false);
                  navigation.navigate('ChangePassword');
                }}
              >
                <Text style={styles.profileMenuText}>Change Password</Text>
              </Pressable>
              <View style={styles.profileMenuDivider} />
              <Pressable
                style={styles.profileMenuItem}
                onPress={() => {
                  setProfileMenuOpen(false);
                  setLogoutSuccessMessage('Logout successful. See you again soon.');
                  logout();
                }}
              >
                <Text style={styles.profileMenuLogout}>Log out</Text>
              </Pressable>
            </View>
          </>
        )}

        {showLoginToast && loginSuccessMessage ? (
          <View pointerEvents="none" style={styles.loginToastWrap}>
            <View style={styles.loginToast}>
              <MaterialCommunityIcons name="check-circle" size={16} color="#22c55e" />
              <Text style={styles.loginToastText}>{loginSuccessMessage}</Text>
            </View>
          </View>
        ) : null}
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  main: {
    flex: 1,
    minWidth: 0,
  },
  calendarCellPressable: {
    minHeight: 64,
    borderRadius: 12,
    padding: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  calendarShortLabel: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  legendCard: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  legendGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 20,
    minWidth: 100,
  },
  legendDot: {
    fontSize: 12,
    fontWeight: 'bold',
    width: 16,
  },
  legendText: {
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
  },
  // Web color matches (Tailwind equivalents)
  calendarPresent: {
    backgroundColor: '#d1fae5', // emerald-100
    borderColor: '#10b981', // emerald-500
  },
  calendarPending: {
    backgroundColor: '#fed7aa', // orange-100
    borderColor: '#f59e0b', // orange-500
  },
  calendarAbsent: {
    backgroundColor: '#fee2e2', // rose-100
    borderColor: '#ef4444', // rose-500
  },
  calendarLeave: {
    backgroundColor: '#e0e7ff', // violet-100 -> indigo-100
    borderColor: '#8b5cf6', // violet-500
  },
  calendarWeekOff: {
    backgroundColor: '#e0f2fe', // sky-100
    borderColor: '#0ea5e9', // sky-500
  },
  calendarHoliday: {
    backgroundColor: '#fef3c7', // amber-100
    borderColor: '#f59e0b', // amber-500
  },
  calendarNeutral: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingBottom: 120,
  },
  shell: {
    gap: 14,
  },
  dashboardHeader: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 16,
  },
  dashboardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  organizationLabel: {
    marginTop: 4,
    fontSize: 11,
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    shadowColor: '#c6d1e4',
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 4, height: 8 },
    elevation: 4,
  },
  topBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 88,
    flexShrink: 0,
  },
  topBarCenter: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  topBarOrg: {
    width: '100%',
    maxWidth: 224,
    minHeight: 34,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 16,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#ffffff',
    shadowOpacity: 0.9,
    shadowRadius: 4,
    shadowOffset: { width: -2, height: -2 },
    elevation: 1,
  },
  topBarOrgText: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '600',
    fontFamily: HEADER_META_FONT,
    color: '#526071',
    textAlign: 'center',
    includeFontPadding: false,
  },
  topBarTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontFamily: HEADER_TITLE_FONT,
    fontWeight: '700',
    letterSpacing: 0.2,
    includeFontPadding: false,
    color: '#0f172a',
  },
  topBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
  },
  iconButton: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    shadowColor: '#d4ddec',
    shadowOpacity: 0.18,
    shadowRadius: 5,
    shadowOffset: { width: 2, height: 3 },
    elevation: 1,
  },
  avatar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 4,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    shadowColor: '#d4ddec',
    shadowOpacity: 0.18,
    shadowRadius: 5,
    shadowOffset: { width: 2, height: 3 },
    elevation: 1,
  },
  avatarText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  avatarImage: {
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  avatarChevron: {
    marginLeft: 2,
  },
  profileBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
    zIndex: 55,
  },
  profileMenu: {
    position: 'absolute',
    top: 72,
    right: 16,
    width: 200,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOpacity: 0.15,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
    zIndex: 60,
  },
  profileMenuHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
  },
  profileMenuDivider: {
    height: 1,
    backgroundColor: '#e2e8f0',
  },
  profileMenuItem: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  profileMenuText: {
    fontSize: 12,
    color: '#0f172a',
    fontWeight: '600',
  },
  profileMenuLogout: {
    fontSize: 12,
    color: '#dc2626',
    fontWeight: '700',
  },
  tabs: {
    flexDirection: 'row',
    gap: 10,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: '#f1f5ff',
    borderColor: '#c7d2fe',
  },
  tabText: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '600',
  },
  tabTextActive: {
    fontSize: 12,
    color: '#1d4ed8',
    fontWeight: '700',
  },
  loadingCard: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 16,
    alignItems: 'center',
    gap: 8,
    shadowColor: '#c6d1e4',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 4, height: 7 },
    elevation: 3,
  },
  loadingText: {
    color: '#64748b',
    fontSize: 12,
  },
  warningCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fef3c7',
    borderRadius: 12,
    padding: 12,
    shadowColor: '#dcc27d',
    shadowOpacity: 0.14,
    shadowRadius: 8,
    shadowOffset: { width: 2, height: 4 },
    elevation: 2,
  },
  warningText: {
    flex: 1,
    fontSize: 11,
    color: '#92400e',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 18,
    shadowColor: '#c6d1e4',
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 4, height: 8 },
    elevation: 4,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  cardSubText: {
    marginTop: 6,
    fontSize: 12,
    color: '#6b7280',
  },
  bigStatus: {
    marginTop: 6,
    fontSize: 19,
    fontWeight: '700',
    color: '#0f172a',
  },
  pillLate: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#fee2e2',
    shadowColor: '#f0c4c4',
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 1, height: 2 },
    elevation: 1,
  },
  pillLateText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#dc2626',
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  pillText: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  primaryAction: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#456bde',
    shadowColor: '#2f58c7',
    shadowOpacity: 0.26,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
  },
  primaryDisabled: {
    opacity: 1,
  },
  primaryActionInactive: {
    backgroundColor: '#f3f6fb',
    shadowColor: '#d6deeb',
    shadowOpacity: 0.16,
    shadowRadius: 7,
    shadowOffset: { width: 2, height: 4 },
    elevation: 2,
  },
  primaryActionInner: {
    flex: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  primaryActionText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
  },
  primaryActionTextInactive: {
    color: '#94a3b8',
  },
  secondaryAction: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    shadowColor: '#d4ddec',
    shadowOpacity: 0.18,
    shadowRadius: 7,
    shadowOffset: { width: 2, height: 4 },
    elevation: 2,
  },
  secondaryActionActive: {
    backgroundColor: '#456bde',
    shadowColor: '#2f58c7',
    shadowOpacity: 0.26,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
  },
  secondaryDisabled: {
    opacity: 0.5,
  },
  secondaryActionInner: {
    flex: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  secondaryActionText: {
    color: '#0f172a',
    fontWeight: '600',
    fontSize: 12,
  },
  secondaryActionTextActive: {
    color: '#fff',
    fontWeight: '700',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  statCard: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 16,
    minHeight: 116,
    width: '48%',
    marginBottom: 10,
    shadowColor: '#c6d1e4',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 4, height: 8 },
    elevation: 3,
  },
  statModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  statModalCard: {
    flex: 1,
    width: '100%',
    maxWidth: 360,
    maxHeight: '85%',
    borderRadius: 22,
    backgroundColor: '#fbfdff',
    padding: 16,
    borderWidth: 1,
    borderColor: '#dbe4f0',
    shadowColor: '#0f172a',
    shadowOpacity: 0.22,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 14,
  },
  statModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 10,
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e6edf6',
  },
  statModalIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f3f7fc',
    borderWidth: 1,
    borderColor: '#e3eaf4',
    shadowColor: '#ffffff',
    shadowOffset: { width: -1, height: -1 },
    shadowOpacity: 0.9,
    shadowRadius: 2,
    elevation: 1,
  },
  statModalHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  statModalTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  statModalSubtitle: {
    marginTop: 2,
    fontSize: 11,
    color: '#64748b',
  },
  statModalClose: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f3f7fc',
    borderWidth: 1,
    borderColor: '#e3eaf4',
    shadowColor: '#ffffff',
    shadowOffset: { width: -1, height: -1 },
    shadowOpacity: 0.85,
    shadowRadius: 2,
    elevation: 1,
  },
  statModalScroll: {
    flex: 1,
    minHeight: 0,
    marginTop: 12,
  },
  statModalBody: {
    gap: 10,
    paddingBottom: 6,
  },
  statModalRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    borderRadius: 16,
    backgroundColor: '#f7fbff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#e2e9f3',
    shadowColor: '#ffffff',
    shadowOffset: { width: -1, height: -1 },
    shadowOpacity: 0.85,
    shadowRadius: 1,
    elevation: 1,
  },
  statModalRowText: {
    flex: 1,
    minWidth: 0,
  },
  statModalRowLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0f172a',
  },
  statModalRowMeta: {
    marginTop: 3,
    fontSize: 11,
    color: '#5f6f86',
  },
  statModalRowValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
    textAlign: 'right',
  },
  statModalEmpty: {
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statModalEmptyText: {
    fontSize: 12,
    color: '#64748b',
    textAlign: 'center',
  },
  attendanceModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.42)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  attendanceKeyboardAvoiding: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  attendanceModalCard: {
    flex: 1,
    width: '100%',
    maxWidth: 420,
    maxHeight: '88%',
    borderRadius: 22,
    backgroundColor: '#fbfcfe',
    padding: 16,
    paddingBottom: 12,
    overflow: 'hidden',
    shadowColor: '#0f172a',
    shadowOpacity: 0.22,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 14 },
    elevation: 16,
  },
  attendanceModalScroll: {
    flex: 1,
    minHeight: 0,
  },
  attendanceModalBody: {
    gap: 10,
    paddingBottom: 12,
  },
  attendanceModalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 12,
  },
  attendanceModalTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  attendanceModalTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
    color: '#111827',
  },
  attendanceModalSubtitle: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 17,
    color: '#64748b',
  },
  attendanceModalClose: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f4f7fb',
    borderWidth: 1,
    borderColor: '#d7dfec',
  },
  attendanceStatusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    padding: 12,
    backgroundColor: '#f7f9fd',
    borderWidth: 1,
    borderColor: '#d7dfec',
    marginBottom: 10,
  },
  attendanceStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  attendanceStatusContent: {
    flex: 1,
    minWidth: 0,
  },
  attendanceStatusTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  attendanceStatusMeta: {
    marginTop: 3,
    fontSize: 11,
    color: '#64748b',
  },
  attendanceNoticeSuccess: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    backgroundColor: '#f0fff5',
    borderWidth: 1,
    borderColor: '#b6e8c8',
  },
  attendanceNoticeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#166534',
  },
  attendanceFieldGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  attendanceFieldHalf: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  attendanceFieldBlock: {
    gap: 6,
    marginBottom: 12,
  },
  attendanceFieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  attendanceInputShell: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d7dfec',
    backgroundColor: '#fcfdff',
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  attendanceTextInput: {
    paddingVertical: 0,
    fontSize: 13,
    color: '#0f172a',
  },
  attendanceSelect: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d7dfec',
    backgroundColor: '#fcfdff',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  attendanceSelectActive: {
    borderColor: '#8fb2ff',
    backgroundColor: '#f2f7ff',
  },
  attendanceSelectText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#0f172a',
  },
  attendanceSelectTextDisabled: {
    color: '#94a3b8',
  },
  attendanceSelectDisabled: {
    backgroundColor: '#f8fafc',
    borderColor: '#d7dfec',
  },
  attendanceSelectWrap: {
    position: 'relative',
    zIndex: 10,
    elevation: 2,
  },
  attendanceSelectWrapTop: {
    zIndex: 40,
    elevation: 12,
  },
  attendancePickerShell: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  attendancePickerShellPressed: {
    borderColor: '#8fb2ff',
    backgroundColor: '#f2f7ff',
  },
  attendancePickerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#0f172a',
  },
  attendanceDropdown: {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d7dfec',
    backgroundColor: '#ffffff',
    overflow: 'hidden',
    zIndex: 50,
    elevation: 12,
    shadowColor: '#0f172a',
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  attendanceDropdownItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  attendanceDropdownItemActive: {
    backgroundColor: '#e0ecff',
  },
  attendanceDropdownItemText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0f172a',
  },
  attendanceDropdownItemTextActive: {
    color: '#1d4ed8',
  },
  attendanceHelperText: {
    fontSize: 11,
    lineHeight: 16,
    color: '#64748b',
  },
  attendanceInfoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: 14,
    padding: 12,
    backgroundColor: '#f5f8ff',
    borderWidth: 1,
    borderColor: '#dbe4f0',
    marginBottom: 12,
  },
  attendanceInfoContent: {
    flex: 1,
    minWidth: 0,
  },
  attendanceInfoTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0f172a',
  },
  attendanceInfoText: {
    marginTop: 3,
    fontSize: 11,
    lineHeight: 16,
    color: '#475569',
  },
  attendanceReasonInput: {
    minHeight: 92,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#d7dfec',
    backgroundColor: '#fcfdff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    textAlignVertical: 'top',
    color: '#0f172a',
  },
  attendanceErrorText: {
    marginTop: 2,
    marginBottom: 10,
    fontSize: 11,
    fontWeight: '600',
    color: '#dc2626',
  },
  attendanceActionRow: {
    marginTop: 4,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    flexShrink: 0,
  },
  attendanceSecondaryButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d7dfec',
    backgroundColor: '#f5f7fb',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0f172a',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  attendanceSecondaryButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  attendancePrimaryButton: {
    flex: 1,
    shadowColor: '#1d4ed8',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: '#2563eb',
    overflow: 'hidden',
  },
  attendancePrimaryButtonInner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  attendancePrimaryButtonText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#ffffff',
  },
  attendanceCalendarBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  attendanceCalendarHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  attendanceCalendarTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  attendanceCalendarTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
    color: '#111827',
  },
  attendanceCalendarSubtitle: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 17,
    color: '#64748b',
  },
  attendanceCalendarClose: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  attendanceCalendarNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 12,
  },
  attendanceCalendarNavButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#dbeafe',
  },
  attendanceCalendarNavCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  attendanceCalendarNavText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  attendanceCalendarWeekRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  attendanceCalendarWeekday: {
    flex: 1,
    textAlign: 'center',
    fontSize: 10,
    fontWeight: '700',
    color: '#64748b',
    letterSpacing: 0.4,
  },
  attendanceCalendarGrid: {
    gap: 8,
  },
  attendanceCalendarWeek: {
    flexDirection: 'row',
    gap: 8,
  },
  attendanceCalendarEmpty: {
    flex: 1,
    aspectRatio: 1,
  },
  attendanceCalendarDay: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attendanceCalendarDayPressed: {
    transform: [{ scale: 0.96 }],
  },
  attendanceCalendarDaySelected: {
    backgroundColor: '#2563eb',
    borderColor: '#1d4ed8',
    shadowColor: '#2563eb',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  attendanceCalendarDayText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  attendanceCalendarDayTextSelected: {
    color: '#ffffff',
  },
  attendanceCalendarFooter: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  attendanceCalendarFooterText: {
    flex: 1,
    fontSize: 11,
    color: '#64748b',
  },
  attendanceCalendarFooterButton: {
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#dbeafe',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attendanceCalendarFooterButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1d4ed8',
  },
  surfacePressed: {
    ...pressedStyle,
  },
  statLabel: {
    fontSize: 12,
    color: '#475569',
    fontWeight: '700',
  },
  statValue: {
    marginTop: 6,
    fontSize: 20,
    fontWeight: '700',
    color: '#0f172a',
  },
  statValueBlue: {
    color: '#3b63db',
  },
  statValueGreen: {
    color: '#16934f',
  },
  statValueAmber: {
    color: '#d48a00',
  },
  statValueRed: {
    color: '#d94b4b',
  },
  pendingRequestMeta: {
    marginTop: 8,
    gap: 6,
  },
  pendingRequestMetaItem: {
    minHeight: 30,
    paddingVertical: 4,
    paddingHorizontal: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 2,
  },
  pendingRequestMetaLabel: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
  },
  pendingRequestMetaValue: {
    fontSize: 12,
    color: '#0f172a',
    fontWeight: '700',
  },
  noticeCard: {
    marginTop: 12,
    borderRadius: 14,
    backgroundColor: '#f8fafc',
    padding: 12,
    shadowColor: '#d4ddec',
    shadowOpacity: 0.16,
    shadowRadius: 6,
    shadowOffset: { width: 2, height: 4 },
    elevation: 1,
  },
  noticeTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  noticeText: {
    marginTop: 4,
    fontSize: 11,
    color: '#64748b',
  },
  linkText: {
    marginTop: 6,
    fontSize: 12,
    color: '#2563eb',
    fontWeight: '600',
  },
  snapshotRow: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: '#f8fafc',
  },
  snapshotLabel: {
    fontSize: 12,
    color: '#64748b',
  },
  snapshotValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  sectionTitle: {
    marginTop: 10,
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  eventRow: {
    marginTop: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    shadowColor: '#d4ddec',
    shadowOpacity: 0.14,
    shadowRadius: 6,
    shadowOffset: { width: 2, height: 4 },
    elevation: 1,
  },
  eventName: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0f172a',
  },
  eventMeta: {
    marginTop: 4,
    fontSize: 11,
    color: '#64748b',
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 10,
  },
  summaryItem: {
    width: '48%',
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  summaryLabel: {
    fontSize: 11,
    color: '#64748b',
  },
  summaryValue: {
    marginTop: 4,
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  leaveTableHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    paddingBottom: 6,
  },
  leaveTableHeading: {
    flex: 1,
    fontSize: 10,
    fontWeight: '600',
    color: '#94a3b8',
  },
  leaveTableRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  leaveTableValue: {
    flex: 1,
    fontSize: 12,
    color: '#0f172a',
  },
  timesheetCard: {
    marginTop: 12,
  },
  timesheetCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  timesheetNav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  timesheetNavButton: {
    padding: 6,
    borderRadius: 10,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  timesheetWorkedRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  timesheetWorkedLabel: {
    fontSize: 11,
    color: '#64748b',
  },
  timesheetWorkedBadge: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: '#e0f2fe',
  },
  timesheetWorkedValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  timesheetRangeText: {
    marginTop: 4,
    fontSize: 11,
    color: '#475569',
  },
  timesheetStatusPill: {
    marginTop: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#c7d2fe',
    backgroundColor: '#eef2ff',
  },
  timesheetStatusText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1d4ed8',
  },
  timesheetTableHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  timesheetTableField: {
    width: '15%',
    justifyContent: 'center',
  },
  timesheetTableHeaderText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  timesheetTableDayCell: {
    width: '11%',
    alignItems: 'center',
  },
  timesheetDayLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#0f172a',
  },
  timesheetDayDate: {
    fontSize: 10,
    color: '#64748b',
  },
  timesheetTableRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    alignItems: 'center',
  },
  timesheetFieldLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748b',
  },
  timesheetTableCell: {
    width: '11%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timesheetCellValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  timesheetCellNote: {
    fontSize: 9,
    color: '#475569',
    textAlign: 'center',
  },
  timesheetFooterText: {
    marginTop: 10,
    fontSize: 10,
    color: '#94a3b8',
  },
  timesheetActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  timesheetButtonOutline: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  timesheetButtonOutlineText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0f172a',
  },
  timesheetButtonPrimary: {
    flex: 1,
    backgroundColor: '#2563eb',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  timesheetButtonPrimaryText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
  attendanceTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0f172a',
  },
  attendanceTip: {
    marginTop: 6,
    fontSize: 12,
    color: '#475569',
  },
  attendanceCalendarCard: {
    width: '100%',
    maxWidth: 360,
    maxHeight: '90%',
    borderRadius: 20,
    backgroundColor: '#ffffff',
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  attendanceCalendarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  attendanceCalendarIntro: {
    flex: 1,
  },
  monthChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: '#eef2ff',
  },
  monthChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0f172a',
  },
  refreshChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#c7d2fe',
    backgroundColor: '#ffffff',
  },
  refreshChipText: {
    fontSize: 12,
    color: '#1d4ed8',
    fontWeight: '700',
  },
  weekRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  weekDayLabel: {
    fontSize: 10,
    color: '#94a3b8',
    width: '14%',
    textAlign: 'center',
    fontWeight: '600',
  },
  attendanceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 6,
    marginTop: 10,
  },
  attendanceCellBase: {
    width: '13.6%',
    minHeight: 96,
    borderRadius: 14,
    padding: 6,
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  attendanceCellPlaceholder: {
    width: '13.6%',
    minHeight: 96,
    marginBottom: 6,
  },
  attendanceCellDay: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  attendanceCellStatus: {
    fontSize: 9,
    fontWeight: '600',
    color: '#0f172a',
    marginTop: 4,
  },
  attendanceCellDetail: {
    fontSize: 9,
    color: '#0f172a',
    marginTop: 2,
    lineHeight: 12,
  },
  calendarRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  calendarDayName: {
    width: '13%',
    textAlign: 'center',
    fontSize: 10,
    color: '#64748b',
  },
  leaveRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  weekOffRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  weekOffPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  weekOffText: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
  },
  refreshBar: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  refreshText: {
    fontSize: 11,
    color: '#64748b',
  },
  loginToastWrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 90,
    alignItems: 'center',
    zIndex: 80,
  },
  loginToast: {
    minHeight: 44,
    maxWidth: 360,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    shadowColor: '#0f172a',
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  loginToastText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: '#0f172a',
  },
});

export default EmployeeDashboardScreen;










































