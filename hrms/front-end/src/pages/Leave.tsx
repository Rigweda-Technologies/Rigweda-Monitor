import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { MainLayout } from "@/components/layout/MainLayout";
import {
  Search,
  Download,
  MoreHorizontal,
  CheckCircle,
  XCircle,
  Clock,
  Eye,
  RefreshCw,
  Palmtree,
  Stethoscope,
  Briefcase,
  Settings2
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { getApiWithToken, postApiWithToken, putApiWithToken } from "@/services/apiWrapper";
import { toast } from "sonner";
import PermissionGate from "@/components/PermissionGate";
import { useAuth } from "@/context/useAuth";
import { useNavigate } from "react-router-dom";
import { formatDateInOrgTimeZone, toDateKeyInOrgCalendar, toDateKeyInOrgTimeZone } from "@/utils/timezone";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type PersonRef = {
  _id?: string;
  firstName?: string;
  lastName?: string;
  employeeCode?: string;
  designationId?: {
    _id?: string;
    name?: string;
  } | null;
};

type ApprovalStep = {
  stepNumber?: number;
  approverType?: "manager" | "role" | "employee";
  approverRoleSlug?: string;
  approverEmployeeId?: PersonRef | null;
  status?: "queued" | "pending" | "approved" | "rejected";
  actionBy?: PersonRef | null;
  actionByName?: string | null;
};

type LeaveTypeRef = {
  _id?: string;
  name?: string;
  code?: string;
  status?: string;
  daysPerYear?: number;
};

type NormalizedLeaveType = {
  _id: string;
  name: string;
  code: string;
  status: string | undefined;
  daysPerYear: number | undefined;
};

type ApprovalFlowRef = {
  _id?: string;
  name?: string;
  moduleKey?: string;
  minDays?: number | null;
  maxDays?: number | null;
};

type LeaveRecord = {
  _id?: string;
  employeeId?: PersonRef | null;
  actionBy?: PersonRef | null;
  actionByName?: string | null;
  leaveTypeId?: LeaveTypeRef | null;
  leaveTypeName?: string;
  fromDate?: string;
  toDate?: string;
  totalDays?: number;
  duration?: "full_day" | "half_day";
  halfDaySession?: "first_half" | "second_half";
  status?: "pending" | "approved" | "rejected" | "cancelled";
  reason?: string;
  rejectionReason?: string;
  approvalFlowId?: ApprovalFlowRef | null;
  approvalSteps?: ApprovalStep[];
  effectiveDateKeys?: string[];
  sandwichRuleEnabled?: boolean;
  sandwichSummary?: {
    applied?: boolean;
    deductedDays?: number;
    deductedDateKeys?: string[];
    holidayDateKeys?: string[];
    weekOffDateKeys?: string[];
    description?: string;
  } | null;
  revertRequest?: {
    fromDate?: string;
    toDate?: string;
    effectiveDateKeys?: string[];
    totalDays?: number;
    reason?: string;
    status?: "pending" | "approved" | "rejected";
    requestedBy?: PersonRef | null;
    requestedByName?: string | null;
    requestedAt?: string;
    actionBy?: PersonRef | null;
    actionByName?: string | null;
    actionAt?: string;
    rejectionReason?: string;
  } | null;
};

type LeaveApplyWindow = {
  attendanceLockEnabled?: boolean;
  earliestAllowedDateKey?: string;
  attendanceLockMode?: string;
  attendanceLockAfterDays?: number;
  attendanceLockDay?: number;
  payrollCutoffDay?: number;
};

type EmployeeOption = {
  _id?: string;
  firstName?: string;
  lastName?: string;
  employeeCode?: string;
};

type LeaveBalanceRow = {
  _id?: string;
  leaveTypeId?: string;
  leaveType?: string;
  code?: string;
  total?: number;
  used?: number;
  pending?: number;
  remaining?: number;
};

type LeaveBalanceOption = {
  _id?: string;
  leaveTypeId: string;
  leaveType: string;
  code: string;
  total?: number;
  used?: number;
  pending?: number;
  remaining?: number;
};

const ALL_EMPLOYEES_VALUE = "__all_employees__";
const ADMIN_OVERRIDE_ROLE_SLUGS = new Set(["admin", "org-admin", "superadmin"]);

const normalizeLeaveTypes = (payload: unknown, options: { includeInactive?: boolean } = {}): NormalizedLeaveType[] => {
  const includeInactive = Boolean(options.includeInactive);
  const candidateLists = [
    payload,
    (payload as { data?: unknown } | null | undefined)?.data,
    (payload as { items?: unknown } | null | undefined)?.items,
    (payload as { leaveTypes?: unknown } | null | undefined)?.leaveTypes
  ];

  const rawList = candidateLists.find(Array.isArray);
  if (!Array.isArray(rawList)) return [];

  const seenIds = new Set<string>();
  return rawList
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const leaveType = item as LeaveTypeRef;
      const id = typeof leaveType._id === "string" ? leaveType._id : "";
      const name = typeof leaveType.name === "string" ? leaveType.name.trim() : "";
      if (!id || !name) return null;
      return {
        _id: id,
        name,
        code: typeof leaveType.code === "string" ? leaveType.code.trim() : "",
        status: typeof leaveType.status === "string" ? leaveType.status : undefined,
        daysPerYear: Number.isFinite(Number((leaveType as { daysPerYear?: number }).daysPerYear))
          ? Number((leaveType as { daysPerYear?: number }).daysPerYear)
          : undefined
      };
    })
    .filter((leaveType): leaveType is NormalizedLeaveType => {
      if (!leaveType) return false;
      if (!includeInactive && leaveType.status === "inactive") return false;
      if (seenIds.has(leaveType._id!)) return false;
      seenIds.add(leaveType._id!);
      return true;
    });
};

const getStatusBadge = (status: string) => {
  switch (status) {
    case "approved":
      return (
        <Badge className="status-badge status-active gap-1">
          <CheckCircle className="w-3 h-3" /> Approved
        </Badge>
      );
    case "pending":
      return (
        <Badge className="status-badge status-pending gap-1">
          <Clock className="w-3 h-3" /> Pending
        </Badge>
      );
    case "rejected":
      return (
        <Badge className="status-badge status-rejected gap-1">
          <XCircle className="w-3 h-3" /> Rejected
        </Badge>
      );
    case "cancelled":
      return (
        <Badge variant="secondary" className="gap-1">
          <XCircle className="w-3 h-3" /> Cancelled
        </Badge>
      );
    default:
      return <Badge variant="secondary">{status || "-"}</Badge>;
  }
};

const getLeaveTypeIcon = (type: string) => {
  switch (type) {
    case "Vacation":
      return <Palmtree className="w-4 h-4 text-green-600" />;
    case "Sick Leave":
      return <Stethoscope className="w-4 h-4 text-red-600" />;
    case "Business Trip":
      return <Briefcase className="w-4 h-4 text-emerald-600" />;
    default:
      return null;
  }
};

const toActorName = (employee: PersonRef | null | undefined) => {
  if (!employee) return "-";
  const full = `${employee.firstName || ""} ${employee.lastName || ""}`.trim();
  return employee.employeeCode ? `${full || "Employee"} (${employee.employeeCode})` : full || "Employee";
};

const getStepApproverLabel = (step: ApprovalStep | null | undefined) => {
  if (!step) return "-";
  if (step.approverType === "manager") return "Reporting Manager";
  if (step.approverType === "role") return step.approverRoleSlug ? `Role: ${step.approverRoleSlug}` : "Role";
  return step.approverEmployeeId ? `Employee: ${toActorName(step.approverEmployeeId)}` : "Employee";
};

const getApprovalProgressLabel = (record: LeaveRecord) => {
  if (record?.revertRequest?.status === "pending") return "Revert request pending";
  if (record?.revertRequest?.status === "approved") return "Revert approved";
  if (record?.revertRequest?.status === "rejected") return "Revert rejected";
  const steps = Array.isArray(record?.approvalSteps) ? record.approvalSteps : [];
  if (!steps.length) return "Single-step";
  const pending = steps.find((s) => s.status === "pending");
  if (record?.status === "approved") return `Completed (${steps.length} steps)`;
  if (record?.status === "rejected") {
    const rejectedStep = steps.find((s) => s.status === "rejected");
    return rejectedStep ? `Rejected at S${rejectedStep.stepNumber}` : "Rejected";
  }
  if (record?.status === "cancelled") return "Cancelled";
  if (!pending) return "Pending";
  return `S${pending.stepNumber}/${steps.length} • ${getStepApproverLabel(pending)}`;
};

const toIdString = (value: unknown) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "_id" in value) return String((value as { _id?: string })._id || "");
  return String(value);
};

const mergeLeavePages = (existing: LeaveRecord[], incoming: LeaveRecord[]) => {
  const merged = new Map<string, LeaveRecord>();
  existing.forEach((item) => {
    const itemId = toIdString(item?._id);
    if (itemId) merged.set(itemId, item);
  });
  incoming.forEach((item) => {
    const itemId = toIdString(item?._id);
    if (itemId) merged.set(itemId, item);
  });
  return Array.from(merged.values());
};

const getLeaveDurationLabel = (leave: LeaveRecord) => {
  const duration = leave?.duration || "full_day";
  if (duration !== "half_day") return "Full Day";
  const session = leave?.halfDaySession === "second_half" ? "Second Half" : "First Half";
  return `Half Day (${session})`;
};

const getActorDisplayName = (employee: PersonRef | null | undefined) => {
  if (!employee) return "-";
  const fullName = `${employee.firstName || ""} ${employee.lastName || ""}`.trim();
  return fullName || employee.employeeCode || "Employee";
};

const getActionActor = (leave: LeaveRecord) => {
  if (!["approved", "rejected", "cancelled"].includes(String(leave.status || ""))) return null;
  if (leave.actionBy) return leave.actionBy;
  const steps = Array.isArray(leave.approvalSteps) ? [...leave.approvalSteps] : [];
  const latestActionStep = steps
    .filter((step) => step.status === leave.status && step.actionBy)
    .sort((a, b) => Number(b.stepNumber || 0) - Number(a.stepNumber || 0))[0];
  return latestActionStep?.actionBy || null;
};

const getActionActorName = (leave: LeaveRecord) => {
  const actor = getActionActor(leave);
  if (actor) return toActorName(actor);
  if (leave.actionByName) return leave.actionByName;
  const steps = Array.isArray(leave.approvalSteps) ? [...leave.approvalSteps] : [];
  const latestActionStep = steps
    .filter((step) => step?.status === leave.status && (step?.actionBy || step?.actionByName))
    .sort((a, b) => Number(b.stepNumber || 0) - Number(a.stepNumber || 0))[0];
  if (latestActionStep?.actionBy) return toActorName(latestActionStep.actionBy);
  return latestActionStep?.actionByName || "";
};

const getApprovalStepActorName = (leave: LeaveRecord, step: ApprovalStep) => {
  if (step?.actionBy) return toActorName(step.actionBy);
  if (step?.actionByName) return step.actionByName;
  const finalActorName = getActionActorName(leave);
  if (!finalActorName) return "";
  if (leave.status === "approved" && step?.status === "approved") return finalActorName;
  if (leave.status === "rejected" && step?.status === "rejected") return finalActorName;
  return "";
};

const canEmployeeRequestRevert = (leave: LeaveRecord) => {
  if (leave.status !== "approved" || !leave.fromDate) return false;
  if (leave.revertRequest?.status === "pending") return false;
  const todayKey = toDateKeyInOrgTimeZone(new Date());
  const fromKey = toDateKeyInOrgCalendar(leave.fromDate);
  return Boolean(fromKey && fromKey > todayKey);
};

const canAdminActionRevertRequest = (leave: LeaveRecord, roleSlug: string) =>
  ADMIN_OVERRIDE_ROLE_SLUGS.has(roleSlug) && leave.revertRequest?.status === "pending";

const getCurrentMonthValue = () => {
  return toDateKeyInOrgTimeZone(new Date()).slice(0, 7);
};

const getMonthBoundary = (monthValue: string) => {
  const [year, month] = monthValue.split("-").map(Number);
  if (!year || !month) return null;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    startKey: `${year}-${String(month).padStart(2, "0")}-01`,
    endKey: `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`
  };
};

const leaveMatchesMonth = (leave: LeaveRecord, monthValue: string) => {
  if (leave?.status === "pending") return true;
  const boundary = getMonthBoundary(monthValue);
  if (!boundary) return true;
  const fromKey = leave.fromDate ? toDateKeyInOrgCalendar(leave.fromDate) : "";
  const toKey = leave.toDate ? toDateKeyInOrgCalendar(leave.toDate) : fromKey;
  if (!fromKey || !toKey) return false;
  return fromKey <= boundary.endKey && toKey >= boundary.startKey;
};

const isLeaveActiveToday = (leave: LeaveRecord) => {
  if (leave.status !== "approved" || !leave.fromDate || !leave.toDate) return false;
  const todayKey = toDateKeyInOrgTimeZone(new Date());
  const fromKey = toDateKeyInOrgCalendar(leave.fromDate);
  const toKey = toDateKeyInOrgCalendar(leave.toDate);
  return todayKey >= fromKey && todayKey <= toKey;
};

const Leave = () => {
  const { hasAnyPermission, profile } = useAuth();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "approved" | "rejected" | "on_leave_today">("all");
  const [monthFilter, setMonthFilter] = useState(getCurrentMonthValue);
  const [actionDialogOpen, setActionDialogOpen] = useState(false);
  const [revertDialogOpen, setRevertDialogOpen] = useState(false);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [selectedLeave, setSelectedLeave] = useState<LeaveRecord | null>(null);
  const [actionType, setActionType] = useState<"approve" | "reject" | "revert_approve" | "revert_reject">("approve");
  const [comment, setComment] = useState("");
  const [revertForm, setRevertForm] = useState({
    fromDate: "",
    toDate: "",
    reason: ""
  });
  const [leaves, setLeaves] = useState<LeaveRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [summaryCounts, setSummaryCounts] = useState({ pending: 0, approved: 0, rejected: 0, onLeaveToday: 0 });
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const leavePageSize = 200;
  const tableViewportRef = useRef<HTMLDivElement | null>(null);
  const loadingMoreRef = useRef(false);
  const hasInitializedFiltersRef = useRef(false);
  const [viewMode, setViewMode] = useState<"all" | "my">("all");
  const [applyOpen, setApplyOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [leaveTypes, setLeaveTypes] = useState<NormalizedLeaveType[]>([]);
  const [allLeaveTypes, setAllLeaveTypes] = useState<NormalizedLeaveType[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [employeeBalances, setEmployeeBalances] = useState<LeaveBalanceRow[]>([]);
  const [loadingBalances, setLoadingBalances] = useState(false);
  const [savingAdjustment, setSavingAdjustment] = useState(false);
  const [leaveApplyWindow, setLeaveApplyWindow] = useState<LeaveApplyWindow | null>(null);
  const [applyForm, setApplyForm] = useState({
    leaveTypeId: "",
    fromDate: "",
    toDate: "",
    duration: "full_day",
    halfDaySession: "first_half",
    reason: ""
  });
  const [adjustForm, setAdjustForm] = useState({
    employeeId: "",
    leaveTypeId: "",
    note: ""
  });
  const canViewAll = hasAnyPermission(["LEAVE_VIEW_ALL"]);
  const canViewSelf = hasAnyPermission(["LEAVE_VIEW_SELF"]);
  const canViewAny = canViewAll || canViewSelf;
  const canApply = hasAnyPermission(["LEAVE_APPLY"]);
  const canAction = hasAnyPermission(["LEAVE_ACTION"]);
  const canViewEmployees = hasAnyPermission(["EMP_VIEW"]);
  const canAdjustBalances = canViewAll && canViewEmployees;
  const currentEmployeeId = toIdString(profile?.employeeId);
  const currentRoleSlug = profile?.activeRole?.slug || "";
  const isEmployeeRole = currentRoleSlug === "employee";
  const revertDateError = useMemo(() => {
    if (!selectedLeave || !revertForm.fromDate || !revertForm.toDate) return "";
    if (revertForm.fromDate > revertForm.toDate) {
      return "Revert from date cannot be greater than revert to date.";
    }
    const leaveFrom = selectedLeave.fromDate ? toDateKeyInOrgCalendar(selectedLeave.fromDate) : "";
    const leaveTo = selectedLeave.toDate ? toDateKeyInOrgCalendar(selectedLeave.toDate) : "";
    if (!leaveFrom || !leaveTo) return "";
    if (revertForm.fromDate < leaveFrom || revertForm.toDate > leaveTo) {
      return "Select revert dates within the approved leave range.";
    }
    return "";
  }, [revertForm.fromDate, revertForm.toDate, selectedLeave]);
  const applyDateError = useMemo(() => {
    if (!applyForm.fromDate || !applyForm.toDate) return "";
    if (applyForm.fromDate > applyForm.toDate) {
      return "Please check the selected dates. From Date cannot be greater than To Date.";
    }
    if (leaveApplyWindow?.earliestAllowedDateKey) {
      if (
        applyForm.fromDate < leaveApplyWindow.earliestAllowedDateKey ||
        applyForm.toDate < leaveApplyWindow.earliestAllowedDateKey
      ) {
        if (leaveApplyWindow.attendanceLockMode === "payroll_cutoff") {
          return `Leave cannot be applied before ${leaveApplyWindow.earliestAllowedDateKey}.`;
        }
        return `Leave cannot be applied for dates older than ${leaveApplyWindow.attendanceLockAfterDays || 0} days.`;
      }
    }
    return "";
  }, [applyForm.fromDate, applyForm.toDate, leaveApplyWindow]);

  const canCurrentActorActionLeave = (leave: LeaveRecord) => {
    if (ADMIN_OVERRIDE_ROLE_SLUGS.has(currentRoleSlug)) return true;
    const steps = Array.isArray(leave?.approvalSteps) ? leave.approvalSteps : [];
    if (!steps.length) return true;
    const pendingStep = steps.find((s) => s.status === "pending");
    if (!pendingStep) return false;

    if (pendingStep.approverType === "role") {
      return Boolean(pendingStep.approverRoleSlug && currentRoleSlug === pendingStep.approverRoleSlug);
    }
    const stepEmployeeId = toIdString(pendingStep.approverEmployeeId);
    return Boolean(stepEmployeeId && currentEmployeeId && stepEmployeeId === currentEmployeeId);
  };

  const fetchLeaves = useCallback(async (pageToLoad = 1) => {
    try {
      const isLoadMoreRequest = pageToLoad > 1;
      if (isLoadMoreRequest) setLoadingMore(true);
      else setLoading(true);
      if (!canViewAny) {
        setLeaves([]);
        setViewMode("my");
        return;
      }

      const params = new URLSearchParams({
        page: String(pageToLoad),
        limit: String(leavePageSize)
      });
      if (searchQuery.trim()) params.set("search", searchQuery.trim());
      if (monthFilter) params.set("month", monthFilter);
      if (statusFilter !== "all" && statusFilter !== "on_leave_today") {
        params.set("status", statusFilter);
      }

      let res = null;

      if (!isEmployeeRole) {
        res = await getApiWithToken(`/leaves?${params.toString()}`, null, {
          requiredPermissions: ["LEAVE_VIEW_ALL"]
        });
      }

      if (res?.success) {
        const payload = res?.data;
        const nextLeaves = Array.isArray(payload) ? payload : (payload?.items || []);
        const pagination = Array.isArray(payload)
          ? { page: 1, totalPages: 1, total: nextLeaves.length }
          : payload?.pagination;
        setLeaves((prev) => (pageToLoad > 1 ? mergeLeavePages(prev, nextLeaves) : nextLeaves));
        setTotalItems(Number(pagination?.total || nextLeaves.length));
        setTotalPages(Math.max(1, Number(pagination?.totalPages || 1)));
        setSummaryCounts(payload?.stats || { pending: 0, approved: 0, rejected: 0, onLeaveToday: 0 });
        setViewMode("all");
        return;
      }

      // employee/self view
      res = await getApiWithToken(`/leaves/my?${params.toString()}`, null, {
        requiredPermissions: ["LEAVE_VIEW_SELF"]
      });
      if (res?.skipped) {
        setLeaves([]);
        setViewMode("my");
        return;
      }
      if (res?.success) {
        const payload = res?.data;
        const nextLeaves = Array.isArray(payload) ? payload : (payload?.items || []);
        const pagination = Array.isArray(payload)
          ? { page: 1, totalPages: 1, total: nextLeaves.length }
          : payload?.pagination;
        setLeaves((prev) => (pageToLoad > 1 ? mergeLeavePages(prev, nextLeaves) : nextLeaves));
        setTotalItems(Number(pagination?.total || nextLeaves.length));
        setTotalPages(Math.max(1, Number(pagination?.totalPages || 1)));
        setSummaryCounts(payload?.stats || { pending: 0, approved: 0, rejected: 0, onLeaveToday: 0 });
        setViewMode("my");
      } else {
        toast.error(res?.message || "Failed to load leaves");
      }
    } finally {
      loadingMoreRef.current = false;
      setLoading(false);
      setLoadingMore(false);
    }
  }, [canViewAny, isEmployeeRole, leavePageSize, monthFilter, searchQuery, statusFilter]);

  const refreshLeaveList = useCallback(async () => {
    setLeaves([]);
    if (currentPage === 1) {
      await fetchLeaves(1);
      return;
    }
    setCurrentPage(1);
  }, [currentPage, fetchLeaves]);

  useEffect(() => {
    if (!hasInitializedFiltersRef.current) {
      hasInitializedFiltersRef.current = true;
      return;
    }
    loadingMoreRef.current = false;
    if (tableViewportRef.current) {
      tableViewportRef.current.scrollTop = 0;
    }
    setLeaves([]);
    setTotalItems(0);
    setTotalPages(1);
    if (currentPage === 1) {
      fetchLeaves(1);
      return;
    }
    setCurrentPage(1);
  }, [currentPage, fetchLeaves, monthFilter, searchQuery, statusFilter]);

  useEffect(() => {
    fetchLeaves(currentPage);
  }, [currentPage, fetchLeaves]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      setCurrentPage(1);
      await refreshLeaveList();
    } finally {
      setRefreshing(false);
    }
  };

  const fetchLeaveTypes = async () => {
    let res = await getApiWithToken("/employees/leave-types");
    if (!res?.success) {
      res = await getApiWithToken("/leave-types", null, {
        requiredPermissions: ["LEAVE_TYPE_VIEW"]
      });
    }
    if (res?.success) {
      const normalizedLeaveTypes = normalizeLeaveTypes(res?.data);
      if (normalizedLeaveTypes.length > 0) {
        setLeaveTypes(normalizedLeaveTypes);
        return;
      }
    }

    const leaveTypeListRes = await getApiWithToken("/leave-types", null, {
      requiredPermissions: ["LEAVE_TYPE_VIEW"]
    });
    if (leaveTypeListRes?.success) {
      setLeaveTypes(normalizeLeaveTypes(leaveTypeListRes?.data));
      return;
    }

    const applyContextRes = await getApiWithToken("/leaves/apply-context", null, {
      requiredPermissions: ["LEAVE_APPLY"]
    });
    if (applyContextRes?.success) {
      setLeaveTypes(normalizeLeaveTypes(applyContextRes?.data?.leaveTypes));
      setLeaveApplyWindow(applyContextRes?.data?.leaveApplyWindow || null);
    }
  };

  const fetchAllLeaveTypes = useCallback(async () => {
    const res = await getApiWithToken("/leave-types", null, {
      requiredPermissions: ["LEAVE_TYPE_VIEW"]
    });
    if (res?.success) {
      const normalizedLeaveTypes = normalizeLeaveTypes(res?.data, { includeInactive: true });
      if (normalizedLeaveTypes.length > 0) {
        setAllLeaveTypes(normalizedLeaveTypes);
        return;
      }
    }

    const fallbackRes = await getApiWithToken("/employees/leave-types");
    if (fallbackRes?.success) {
      setAllLeaveTypes(normalizeLeaveTypes(fallbackRes?.data, { includeInactive: true }));
    }
  }, []);

  useEffect(() => {
    fetchLeaveTypes();
  }, []);

  useEffect(() => {
    if (!canAdjustBalances) return;
    fetchAllLeaveTypes();
  }, [canAdjustBalances, fetchAllLeaveTypes]);

  const fetchEmployees = useCallback(async () => {
    if (!canAdjustBalances) return;
    setLoadingEmployees(true);
    try {
      const res = await getApiWithToken("/employees?limit=500", null, {
        requiredPermissions: ["EMP_VIEW"]
      });
      if (res?.skipped) return;
      if (res?.success) {
        const payload = res.data;
        setEmployees(Array.isArray(payload) ? payload : payload?.items || []);
      } else {
        toast.error(res?.message || "Failed to load employees");
      }
    } finally {
      setLoadingEmployees(false);
    }
  }, [canAdjustBalances]);

  const fetchEmployeeBalances = useCallback(async (employeeId: string) => {
    if (!employeeId || employeeId === ALL_EMPLOYEES_VALUE) {
      setEmployeeBalances([]);
      return;
    }
    setLoadingBalances(true);
    try {
      const res = await getApiWithToken(`/leave-balances/employee/${encodeURIComponent(employeeId)}`, null, {
        requiredPermissions: ["LEAVE_VIEW_ALL"]
      });
      if (res?.skipped) return;
      if (res?.success) {
        setEmployeeBalances(res.data || []);
      } else {
        setEmployeeBalances([]);
        toast.error(res?.message || "Failed to load leave balances");
      }
    } finally {
      setLoadingBalances(false);
    }
  }, []);

  useEffect(() => {
    if (!adjustOpen || employees.length > 0 || loadingEmployees || !canAdjustBalances) return;
    fetchEmployees();
  }, [adjustOpen, employees.length, loadingEmployees, canAdjustBalances, fetchEmployees]);

  useEffect(() => {
    if (!adjustOpen) return;
    fetchEmployeeBalances(adjustForm.employeeId);
  }, [adjustForm.employeeId, adjustOpen, fetchEmployeeBalances]);

  useEffect(() => {
    if (!adjustOpen || adjustForm.employeeId !== ALL_EMPLOYEES_VALUE || allLeaveTypes.length > 0) return;
    fetchAllLeaveTypes();
  }, [adjustForm.employeeId, adjustOpen, allLeaveTypes.length, fetchAllLeaveTypes]);

  const submitApply = async () => {
    if (!applyForm.leaveTypeId || !applyForm.fromDate || !applyForm.toDate) {
      toast.error("Leave type and dates are required");
      return;
    }
    if (applyDateError) {
      toast.error(applyDateError);
      return;
    }

    const res = await postApiWithToken(
      "/leaves/apply",
      applyForm,
      null,
      { requiredPermissions: ["LEAVE_APPLY"] }
    );
    if (res?.skipped) return;
    if (res?.success) {
      toast.success("Leave applied");
      setApplyOpen(false);
      setApplyForm({
        leaveTypeId: "",
        fromDate: "",
        toDate: "",
        duration: "full_day",
        halfDaySession: "first_half",
        reason: ""
      });
      refreshLeaveList();
    } else {
      toast.error(res?.message || "Apply failed");
    }
  };

  const submitAdjustment = async () => {
    if (!adjustForm.employeeId || !adjustForm.leaveTypeId) {
      toast.error("Employee and leave type are required");
      return;
    }

    const days = Number(selectedLeaveTypeMeta?.daysPerYear ?? 0);
    if (!Number.isFinite(days) || days <= 0) {
      toast.error("Selected leave type does not have a valid configured leave count");
      return;
    }

    setSavingAdjustment(true);
    try {
      const res = adjustForm.employeeId === ALL_EMPLOYEES_VALUE
        ? await postApiWithToken(
            "/leave-balances/adjust-all",
            {
              leaveTypeId: adjustForm.leaveTypeId,
              leaveTypeName: selectedBalance?.leaveType || "",
              days,
              note: adjustForm.note.trim()
            },
            null,
            { requiredPermissions: ["LEAVE_VIEW_ALL"] }
          )
        : await postApiWithToken(
            `/leave-balances/employee/${encodeURIComponent(adjustForm.employeeId)}/adjust`,
            {
              balanceId: selectedBalance?._id || "",
              leaveTypeId: adjustForm.leaveTypeId,
              leaveTypeName: selectedBalance?.leaveType || "",
              days,
              note: adjustForm.note.trim()
            },
            null,
            { requiredPermissions: ["LEAVE_VIEW_ALL"] }
          );
      if (res?.skipped) return;
      if (res?.success) {
        toast.success(
          adjustForm.employeeId === ALL_EMPLOYEES_VALUE
            ? `Configured leave count synced for ${res?.data?.count || "all"} assigned employees`
            : "Configured leave count synced"
        );
        await fetchEmployeeBalances(adjustForm.employeeId);
        setAdjustOpen(false);
        setAdjustForm({
          employeeId: "",
          leaveTypeId: "",
          note: ""
        });
      } else {
        toast.error(res?.message || "Failed to update leave balance");
      }
    } finally {
      setSavingAdjustment(false);
    }
  };

  const hasMoreLeaves = currentPage < totalPages;

  const selectedEmployeeOption = useMemo(
    () => employees.find((employee) => employee._id === adjustForm.employeeId) || null,
    [employees, adjustForm.employeeId]
  );

  const availableBalanceOptions = useMemo<LeaveBalanceOption[]>(() => {
    if (adjustForm.employeeId === ALL_EMPLOYEES_VALUE) {
      return allLeaveTypes.map((leaveType) => ({
        _id: leaveType._id,
        leaveTypeId: leaveType._id,
        leaveType: leaveType.name,
        code: leaveType.code || ""
      }));
    }
    return employeeBalances.map((balance) => ({
      _id: balance._id,
      leaveTypeId: balance.leaveTypeId || "",
      leaveType: balance.leaveType || "",
      code: balance.code || "",
      total: balance.total,
      used: balance.used,
      pending: balance.pending,
      remaining: balance.remaining
    }));
  }, [adjustForm.employeeId, employeeBalances, allLeaveTypes]);

  const selectedBalance = useMemo(
    () => availableBalanceOptions.find((balance) => balance.leaveTypeId === adjustForm.leaveTypeId) || null,
    [availableBalanceOptions, adjustForm.leaveTypeId]
  );

  const selectedLeaveTypeMeta = useMemo(
    () => allLeaveTypes.find((leaveType) => leaveType._id === adjustForm.leaveTypeId) || null,
    [allLeaveTypes, adjustForm.leaveTypeId]
  );

  const handleLeaveTableScroll = () => {
    const viewport = tableViewportRef.current;
    if (!viewport || loading || loadingMore || loadingMoreRef.current || !hasMoreLeaves) return;
    const { scrollTop, scrollHeight, clientHeight } = viewport;
    if (scrollTop <= 0 || scrollHeight <= clientHeight) return;
    const progress = (scrollTop + clientHeight) / scrollHeight;
    if (progress < 0.5) return;
    loadingMoreRef.current = true;
    setCurrentPage((prev) => {
      if (prev >= totalPages) {
        loadingMoreRef.current = false;
        return prev;
      }
      return prev + 1;
    });
  };

  const handleAction = (leave: LeaveRecord, action: "approve" | "reject" | "revert_approve" | "revert_reject") => {
    if (!canCurrentActorActionLeave(leave)) {
      if (!action.startsWith("revert_")) {
        toast.error("You are not the current approver for this request");
        return;
      }
    }
    if (action.startsWith("revert_") && !canAdminActionRevertRequest(leave, currentRoleSlug)) {
      toast.error("You do not have permission to action this revert request");
      return;
    }
    setSelectedLeave(leave);
    setActionType(action);
    setActionDialogOpen(true);
  };

  const handleOpenRevertRequest = (leave: LeaveRecord) => {
    if (!canEmployeeRequestRevert(leave)) {
      toast.error("Only approved future leave can be reverted");
      return;
    }
    setSelectedLeave(leave);
    setRevertForm({
      fromDate: leave.fromDate ? toDateKeyInOrgCalendar(leave.fromDate) : "",
      toDate: leave.toDate ? toDateKeyInOrgCalendar(leave.toDate) : "",
      reason: ""
    });
    setRevertDialogOpen(true);
  };

  const handleView = (leave: LeaveRecord) => {
    setSelectedLeave(leave);
    setViewDialogOpen(true);
  };

  const confirmAction = async () => {
    if (!selectedLeave) return;
    if (!canAction) {
      toast.error("You do not have permission to take action");
      return;
    }

    const payload: { status: "approved" | "rejected"; rejectionReason?: string } = {
      status: actionType === "approve" || actionType === "revert_approve" ? "approved" : "rejected",
    };
    if (actionType === "reject" || actionType === "revert_reject") {
      payload.rejectionReason = comment || "Rejected";
    }

    const res = await putApiWithToken(
      actionType.startsWith("revert_")
        ? `/leaves/${selectedLeave._id}/revert-request/action`
        : `/leaves/${selectedLeave._id}/action`,
      payload,
      null,
      { requiredPermissions: ["LEAVE_ACTION"] }
    );
    if (res?.skipped) return;
    if (res?.success) {
      toast.success(
        actionType.startsWith("revert_")
          ? `Revert request ${payload.status}`
          : `Leave ${payload.status}`
      );
      setActionDialogOpen(false);
      setSelectedLeave(null);
      setComment("");
      refreshLeaveList();
    } else {
      toast.error(res?.message || "Action failed");
    }
  };

  const submitRevertRequest = async () => {
    if (!selectedLeave?._id) return;
    if (!revertForm.fromDate || !revertForm.toDate) {
      toast.error("Select revert from and to dates");
      return;
    }
    if (revertDateError) {
      toast.error(revertDateError);
      return;
    }

    const res = await postApiWithToken(
      `/leaves/${selectedLeave._id}/revert-request`,
      {
        fromDate: revertForm.fromDate,
        toDate: revertForm.toDate,
        reason: revertForm.reason.trim()
      },
      null,
      { requiredPermissions: ["LEAVE_VIEW_SELF"] }
    );
    if (res?.skipped) return;
    if (res?.success) {
      toast.success("Leave revert request sent");
      setRevertDialogOpen(false);
      setSelectedLeave(null);
      setRevertForm({ fromDate: "", toDate: "", reason: "" });
      refreshLeaveList();
    } else {
      toast.error(res?.message || "Failed to request leave revert");
    }
  };

  const handleStatusCardClick = (nextStatus: "all" | "pending" | "approved" | "rejected" | "on_leave_today") => {
    setStatusFilter(nextStatus);
  };

  const getCardClassName = (active: boolean) =>
    `stat-card transition-all cursor-pointer ${active ? "ring-2 ring-primary shadow-md" : "hover:-translate-y-0.5 hover:shadow-md"}`;

  const monthScopedLeaves = useMemo(
    () => leaves.filter((leave) => leaveMatchesMonth(leave, monthFilter)),
    [leaves, monthFilter]
  );

  const filteredLeaves = useMemo(() => {
    if (statusFilter === "on_leave_today") {
      return monthScopedLeaves.filter((leave) => isLeaveActiveToday(leave));
    }
    if (statusFilter === "all") return monthScopedLeaves;
    return monthScopedLeaves.filter((leave) => leave.status === statusFilter);
  }, [monthScopedLeaves, statusFilter]);

  return (
    <MainLayout
      title="Leave Management"
      breadcrumb={[{ label: "Home", href: "/" }, { label: "Leave" }]}
    >
      {!canViewAny && !canApply && (
        <div className="bg-card rounded-xl card-shadow p-6 text-sm text-muted-foreground">
          You do not have permission to view or apply leave.
        </div>
      )}
      {/* Stats Cards */}
      {canViewAny && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <motion.div
          className={getCardClassName(statusFilter === "pending")}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={() => handleStatusCardClick("pending")}
        >
          <p className="text-sm text-muted-foreground mb-1">Pending Requests</p>
          <p className="text-3xl font-bold text-warning">{summaryCounts.pending}</p>
          <p className="text-sm text-muted-foreground mt-1">requires action</p>
        </motion.div>
        <motion.div
          className={getCardClassName(statusFilter === "approved")}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          onClick={() => handleStatusCardClick("approved")}
        >
          <p className="text-sm text-muted-foreground mb-1">Approved</p>
          <p className="text-3xl font-bold text-success">{summaryCounts.approved}</p>
          <p className="text-sm text-muted-foreground mt-1">total</p>
        </motion.div>
        <motion.div
          className={getCardClassName(statusFilter === "rejected")}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          onClick={() => handleStatusCardClick("rejected")}
        >
          <p className="text-sm text-muted-foreground mb-1">Rejected</p>
          <p className="text-3xl font-bold text-destructive">{summaryCounts.rejected}</p>
          <p className="text-sm text-muted-foreground mt-1">total</p>
        </motion.div>
        <motion.div
          className={getCardClassName(statusFilter === "on_leave_today")}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          onClick={() => handleStatusCardClick("on_leave_today")}
        >
          <p className="text-sm text-muted-foreground mb-1">On Leave Today</p>
          <p className="text-3xl font-bold text-primary">{summaryCounts.onLeaveToday}</p>
          <p className="text-sm text-muted-foreground mt-1">employees on approved leave</p>
        </motion.div>
        </div>
      )}

      {/* Action Bar */}
      {canViewAny && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search leaves..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <Input
            type="month"
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value || getCurrentMonthValue())}
            className="w-full sm:w-44"
          />
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="on_leave_today">On Leave Today</SelectItem>
            </SelectContent>
          </Select>
          {/* <Button variant="outline" className="gap-2">
            <Download className="w-4 h-4" />
            Export
          </Button> */}
          <Button
            variant="outline"
            className="gap-2"
            onClick={handleRefresh}
            disabled={loading || refreshing}
          >
            <RefreshCw className={`w-4 h-4 ${loading || refreshing ? "animate-spin" : ""}`} />
            {loading || refreshing ? "Refreshing..." : "Refresh"}
          </Button>
          {canAdjustBalances && (
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => setAdjustOpen(true)}
            >
              <Settings2 className="w-4 h-4" />
              Sync Leave Count
            </Button>
          )}
          <PermissionGate permissions={["LEAVE_APPLY"]}>
            <Button className="gap-2" onClick={() => navigate("/leave/apply")}>
              Apply Leave
            </Button>
          </PermissionGate>
        </div>
        </div>
      )}

      {/* Leave Table */}
      {canViewAny && (
        <motion.div
        className="bg-card rounded-xl card-shadow overflow-hidden"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        <div
          ref={tableViewportRef}
          onScroll={handleLeaveTableScroll}
          className="max-h-[60vh] overflow-auto"
        >
        <Table>
          <TableHeader>
            <TableRow className="table-header">
              <TableHead>Employee</TableHead>
              <TableHead>Leave Type</TableHead>
              <TableHead>From</TableHead>
              <TableHead>To</TableHead>
              <TableHead>Days</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Action By</TableHead>
              <TableHead>Approval</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && leaves.length === 0 && Array.from({ length: 6 }).map((_, idx) => (
              <TableRow key={`leave-skeleton-${idx}`}>
                <TableCell><Skeleton className="h-10 w-40" /></TableCell>
                <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                <TableCell><Skeleton className="h-6 w-20 rounded-full" /></TableCell>
                <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                <TableCell className="text-right"><Skeleton className="ml-auto h-8 w-20" /></TableCell>
              </TableRow>
            ))}
            {!loading && filteredLeaves.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="text-center py-10">
                  No leave requests found
                </TableCell>
              </TableRow>
            )}
            {filteredLeaves.map((leave) => {
              const employeeName = leave.employeeId
                ? `${leave.employeeId.firstName || ""} ${leave.employeeId.lastName || ""}`.trim()
                : "You";
              const actionActor = getActionActor(leave);
              const actionActorName = getActorDisplayName(actionActor);
              const actionActorDesignation = actionActor?.designationId?.name || "";
              return (
                <TableRow key={leave._id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar>
                        <AvatarImage src="" />
                        <AvatarFallback>
                          {(employeeName || "U")
                            .split(" ")
                            .map((n: string) => n[0])
                            .join("")}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium">{employeeName}</p>
                        <p className="text-sm text-muted-foreground">
                          {leave.employeeId?.employeeCode || "SELF"}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {getLeaveTypeIcon(leave.leaveTypeId?.name)}
                      {leave.leaveTypeId?.name || "-"}
                    </div>
                  </TableCell>
                  <TableCell>
                    {leave.fromDate ? formatDateInOrgTimeZone(leave.fromDate) : "-"}
                  </TableCell>
                  <TableCell>
                    {leave.toDate ? formatDateInOrgTimeZone(leave.toDate) : "-"}
                  </TableCell>
                  <TableCell>{leave.totalDays ?? "-"}</TableCell>
                  <TableCell>{getLeaveDurationLabel(leave)}</TableCell>
                  <TableCell>{getStatusBadge(leave.status)}</TableCell>
                  <TableCell>
                    {actionActor ? (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex cursor-default font-medium text-foreground">
                              {actionActorName}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            {actionActorDesignation || "Designation not available"}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[280px]">
                    {getApprovalProgressLabel(leave)}
                  </TableCell>
                  <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleView(leave)}>
                            <Eye className="w-4 h-4 mr-2" /> View
                          </DropdownMenuItem>
                          {canAction && viewMode === "all" && leave.status === "pending" && canCurrentActorActionLeave(leave) && (
                            <>
                              <DropdownMenuItem onClick={() => handleAction(leave, "approve")}>
                                <CheckCircle className="w-4 h-4 mr-2 text-green-600" /> Approve
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleAction(leave, "reject")}>
                                <XCircle className="w-4 h-4 mr-2 text-red-600" /> Reject
                              </DropdownMenuItem>
                            </>
                          )}
                          {viewMode === "my" && canEmployeeRequestRevert(leave) && (
                            <DropdownMenuItem onClick={() => handleOpenRevertRequest(leave)}>
                              <RefreshCw className="w-4 h-4 mr-2 text-amber-600" /> Request Revert
                            </DropdownMenuItem>
                          )}
                          {canAction && viewMode === "all" && canAdminActionRevertRequest(leave, currentRoleSlug) && (
                            <>
                              <DropdownMenuItem onClick={() => handleAction(leave, "revert_approve")}>
                                <CheckCircle className="w-4 h-4 mr-2 text-green-600" /> Approve Revert
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleAction(leave, "revert_reject")}>
                                <XCircle className="w-4 h-4 mr-2 text-red-600" /> Reject Revert
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        </div>
        <div className="border-t px-4 py-3 text-sm text-muted-foreground flex items-center justify-between">
          <span>Showing {filteredLeaves.length} of {monthScopedLeaves.length} leave records</span>
          <span>
            {loadingMore
              ? "Loading more leave records..."
              : hasMoreLeaves
                ? "Scroll past 50% to load more"
                : "You have reached the end"}
          </span>
        </div>
        </motion.div>
      )}

      {/* Action Dialog */}
      <Dialog open={actionDialogOpen} onOpenChange={setActionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionType === "approve"
                ? "Approve Leave"
                : actionType === "reject"
                  ? "Reject Leave"
                  : actionType === "revert_approve"
                    ? "Approve Leave Revert"
                    : "Reject Leave Revert"}
            </DialogTitle>
            <DialogDescription>
              {actionType === "approve"
                ? "Confirm approval for this leave request."
                : actionType === "reject"
                  ? "Provide a reason for rejection."
                  : actionType === "revert_approve"
                    ? "Approve this leave revert request and credit the leave days back to the employee."
                    : "Provide a reason for rejecting this leave revert request."}
            </DialogDescription>
          </DialogHeader>

          {(actionType === "reject" || actionType === "revert_reject") && (
            <div className="space-y-2">
              <Label>Rejection Reason</Label>
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Enter reason"
              />
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setActionDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmAction}>
              {actionType === "approve"
                ? "Approve"
                : actionType === "reject"
                  ? "Reject"
                  : actionType === "revert_approve"
                    ? "Approve Revert"
                    : "Reject Revert"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet
        open={revertDialogOpen}
        onOpenChange={(open) => {
          setRevertDialogOpen(open);
          if (!open) {
            setRevertForm({ fromDate: "", toDate: "", reason: "" });
            setSelectedLeave(null);
          }
        }}
      >
        <SheetContent className="flex flex-col gap-0 bg-white p-0">
          <SheetHeader className="border-b border-slate-100 px-6 py-5 text-left">
            <SheetTitle className="text-2xl font-semibold text-slate-950">Request Leave Revert</SheetTitle>
            <SheetDescription>
              Select full or partial approved leave dates to request credit back to the employee balance.
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              Approved leave range: {selectedLeave?.fromDate ? formatDateInOrgTimeZone(selectedLeave.fromDate) : "-"}
              {" "}to{" "}
              {selectedLeave?.toDate ? formatDateInOrgTimeZone(selectedLeave.toDate) : "-"}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label>Revert From</Label>
                <Input
                  type="date"
                  value={revertForm.fromDate}
                  min={selectedLeave?.fromDate ? toDateKeyInOrgCalendar(selectedLeave.fromDate) : undefined}
                  max={selectedLeave?.toDate ? toDateKeyInOrgCalendar(selectedLeave.toDate) : undefined}
                  onChange={(e) => setRevertForm((prev) => ({ ...prev, fromDate: e.target.value }))}
                />
              </div>
              <div>
                <Label>Revert To</Label>
                <Input
                  type="date"
                  value={revertForm.toDate}
                  min={revertForm.fromDate || (selectedLeave?.fromDate ? toDateKeyInOrgCalendar(selectedLeave.fromDate) : undefined)}
                  max={selectedLeave?.toDate ? toDateKeyInOrgCalendar(selectedLeave.toDate) : undefined}
                  onChange={(e) => setRevertForm((prev) => ({ ...prev, toDate: e.target.value }))}
                />
              </div>
            </div>

            {revertDateError && <p className="text-sm text-destructive">{revertDateError}</p>}

            <div>
              <Label>Reason</Label>
              <Textarea
                value={revertForm.reason}
                onChange={(e) => setRevertForm((prev) => ({ ...prev, reason: e.target.value }))}
                placeholder="Optional reason for revert request"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-5">
            <Button variant="outline" onClick={() => setRevertDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitRevertRequest} disabled={Boolean(revertDateError)}>
              Raise Revert Request
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-h-[88vh] overflow-y-auto border-slate-200 bg-white p-0 shadow-2xl sm:max-w-3xl">
          <DialogHeader className="border-b border-slate-200 bg-gradient-to-r from-slate-50 via-white to-emerald-50/40 px-6 py-5">
            <DialogTitle className="text-xl font-semibold text-slate-900">Leave Details</DialogTitle>
          </DialogHeader>
          {selectedLeave && (
            <div className="space-y-5 px-6 py-6 text-sm">
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-emerald-50/40 p-5 shadow-sm">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-2">
                    <p className="text-xs font-medium uppercase tracking-[0.22em] text-slate-500">Leave Request</p>
                    <div>
                      <h3 className="text-2xl font-semibold text-slate-900">
                        {selectedLeave.leaveTypeId?.name || "-"}
                      </h3>
                      <p className="mt-1 text-sm text-slate-500">
                        {selectedLeave.employeeId
                          ? `${selectedLeave.employeeId.firstName || ""} ${selectedLeave.employeeId.lastName || ""}`.trim()
                          : "You"}
                        {selectedLeave.employeeId?.employeeCode ? ` • ${selectedLeave.employeeId.employeeCode}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {getStatusBadge(selectedLeave.status || "-")}
                    <Badge variant="outline" className="border-slate-300 bg-white/80 text-slate-700">
                      {getLeaveDurationLabel(selectedLeave)}
                    </Badge>
                    <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                      {selectedLeave.totalDays ?? "-"} day{Number(selectedLeave.totalDays) === 1 ? "" : "s"}
                    </Badge>
                  </div>
                </div>
                <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-white/80 p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">From</p>
                    <p className="mt-1 text-base font-semibold text-slate-900">
                      {selectedLeave.fromDate ? formatDateInOrgTimeZone(selectedLeave.fromDate) : "-"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white/80 p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">To</p>
                    <p className="mt-1 text-base font-semibold text-slate-900">
                      {selectedLeave.toDate ? formatDateInOrgTimeZone(selectedLeave.toDate) : "-"}
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.15fr_0.85fr]">
                <div className="space-y-4">
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <p className="text-sm font-semibold text-slate-900">Request Summary</p>
                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Approval</p>
                        <p className="mt-1 font-medium text-slate-900">{getApprovalProgressLabel(selectedLeave)}</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Flow</p>
                        <p className="mt-1 font-medium text-slate-900">
                          {selectedLeave.approvalFlowId?.name || "No named flow attached"}
                        </p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Sandwich Rule</p>
                        <p className="mt-1 font-medium text-slate-900">
                          {selectedLeave.sandwichRuleEnabled ? "Enabled" : "Disabled"}
                        </p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Saved Steps</p>
                        <p className="mt-1 font-medium text-slate-900">
                          {Array.isArray(selectedLeave.approvalSteps) ? selectedLeave.approvalSteps.length : 0}
                        </p>
                      </div>
                    </div>
                    {(!Array.isArray(selectedLeave.approvalSteps) || selectedLeave.approvalSteps.length === 0) && (
                      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                        This request has no saved approval steps, so it behaves like a single-step request.
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <p className="text-sm font-semibold text-slate-900">Reason</p>
                    <div className="mt-3 rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                      {selectedLeave.reason || "-"}
                    </div>
                    {selectedLeave.revertRequest && (
                      <>
                        <p className="mt-4 text-sm font-semibold text-slate-900">Leave Revert Request</p>
                        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                          <p className="font-medium capitalize">
                            Status: {selectedLeave.revertRequest.status || "-"}
                          </p>
                          <p className="mt-2">
                            Revert dates: {selectedLeave.revertRequest.fromDate ? formatDateInOrgTimeZone(selectedLeave.revertRequest.fromDate) : "-"}
                            {" "}to{" "}
                            {selectedLeave.revertRequest.toDate ? formatDateInOrgTimeZone(selectedLeave.revertRequest.toDate) : "-"}
                          </p>
                          <p className="mt-1">
                            Requested days: {selectedLeave.revertRequest.totalDays ?? "-"}
                          </p>
                          {selectedLeave.revertRequest.reason && (
                            <p className="mt-2">Reason: {selectedLeave.revertRequest.reason}</p>
                          )}
                          {selectedLeave.revertRequest.rejectionReason && (
                            <p className="mt-2 text-red-700">
                              Rejection reason: {selectedLeave.revertRequest.rejectionReason}
                            </p>
                          )}
                        </div>
                      </>
                    )}
                    {selectedLeave.rejectionReason && (
                      <>
                        <p className="mt-4 text-sm font-semibold text-slate-900">Rejection Reason</p>
                        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-700">
                          {selectedLeave.rejectionReason}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <p className="text-sm font-semibold text-slate-900">Sandwich Impact</p>
                    <div className={`mt-3 rounded-xl border px-4 py-3 ${
                      selectedLeave.sandwichSummary?.applied
                        ? "border-amber-200 bg-amber-50"
                        : "border-emerald-200 bg-emerald-50"
                    }`}>
                      <p className={`font-medium ${
                        selectedLeave.sandwichSummary?.applied ? "text-amber-800" : "text-emerald-800"
                      }`}>
                        {selectedLeave.sandwichSummary?.applied
                          ? `${selectedLeave.sandwichSummary?.deductedDays || 0} non-working day(s) deducted`
                          : "No holiday or week off deducted"}
                      </p>
                      {selectedLeave.sandwichSummary?.description && (
                        <p className={`mt-2 text-xs leading-5 ${
                          selectedLeave.sandwichSummary?.applied ? "text-amber-700" : "text-emerald-700"
                        }`}>
                          {selectedLeave.sandwichSummary.description}
                        </p>
                      )}
                      {selectedLeave.sandwichSummary?.applied && (
                        <p className="mt-2 text-xs text-slate-500">
                          Deducted dates: {(selectedLeave.sandwichSummary.deductedDateKeys || []).join(", ")}
                        </p>
                      )}
                    </div>
                  </div>

                  {Array.isArray(selectedLeave.approvalSteps) && selectedLeave.approvalSteps.length > 0 && (
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <p className="text-sm font-semibold text-slate-900">Approval Steps</p>
                      <div className="mt-4 space-y-3">
                        {[...selectedLeave.approvalSteps]
                          .sort((a, b) => Number(a.stepNumber) - Number(b.stepNumber))
                          .map((step) => {
                            const stepActorName = getApprovalStepActorName(selectedLeave, step);
                            return (
                              <div
                                key={`leave-step-${selectedLeave._id}-${step.stepNumber}`}
                                className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                                      Step {step.stepNumber}
                                    </p>
                                    <p className="mt-1 font-medium text-slate-900">{getStepApproverLabel(step)}</p>
                                    {stepActorName && (
                                      <p className="mt-1 text-xs text-slate-500">Approved by {stepActorName}</p>
                                    )}
                                  </div>
                                  <Badge
                                    variant="outline"
                                    className={`capitalize ${
                                      step.status === "approved"
                                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                        : step.status === "rejected"
                                          ? "border-red-200 bg-red-50 text-red-700"
                                          : step.status === "pending"
                                            ? "border-amber-200 bg-amber-50 text-amber-700"
                                            : "border-slate-200 bg-white text-slate-600"
                                    }`}
                                  >
                                    {step.status || "-"}
                                  </Badge>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="border-t border-slate-200 bg-slate-50/70 px-6 py-4">
            <Button variant="outline" className="min-w-28" onClick={() => setViewDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Apply Leave Dialog */}
      <Sheet open={applyOpen} onOpenChange={setApplyOpen}>
        <SheetContent className="flex flex-col gap-0 bg-white p-0">
          <SheetHeader className="border-b border-slate-100 px-6 py-5 text-left">
            <SheetTitle className="text-2xl font-semibold text-slate-950">Apply Leave</SheetTitle>
            <SheetDescription>Submit a new leave request.</SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
            <div>
              <Label>Leave Type</Label>
              <Select
                value={applyForm.leaveTypeId}
                onValueChange={(value) =>
                  setApplyForm({ ...applyForm, leaveTypeId: value })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select leave type" />
                </SelectTrigger>
                <SelectContent>
                  {leaveTypes.map((lt) => (
                    <SelectItem key={lt._id} value={lt._id}>
                      {lt.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Duration</Label>
                <Select
                  value={applyForm.duration}
                  onValueChange={(value) =>
                    setApplyForm((prev) => ({
                      ...prev,
                      duration: value,
                      toDate: value === "half_day" ? prev.fromDate : prev.toDate
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select duration" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full_day">Full Day</SelectItem>
                    <SelectItem value="half_day">Half Day</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {applyForm.duration === "half_day" && (
                <div>
                  <Label>Session</Label>
                  <Select
                    value={applyForm.halfDaySession}
                    onValueChange={(value) =>
                      setApplyForm({ ...applyForm, halfDaySession: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select session" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="first_half">First Half</SelectItem>
                      <SelectItem value="second_half">Second Half</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>From Date</Label>
                <Input
                  type="date"
                  min={leaveApplyWindow?.earliestAllowedDateKey || undefined}
                  value={applyForm.fromDate}
                  onChange={(e) =>
                    setApplyForm((prev) => ({
                      ...prev,
                      fromDate: e.target.value,
                      toDate: prev.duration === "half_day" ? e.target.value : prev.toDate
                    }))
                  }
                />
              </div>
              <div>
                <Label>To Date</Label>
                <Input
                  type="date"
                  value={applyForm.toDate}
                  min={applyForm.fromDate || leaveApplyWindow?.earliestAllowedDateKey || undefined}
                  disabled={applyForm.duration === "half_day"}
                  onChange={(e) =>
                    setApplyForm({ ...applyForm, toDate: e.target.value })
                  }
                />
              </div>
            </div>

            {applyDateError && <p className="text-sm text-destructive">{applyDateError}</p>}
            {!applyDateError && leaveApplyWindow?.attendanceLockEnabled && leaveApplyWindow?.earliestAllowedDateKey && (
              <p className="text-sm text-muted-foreground">
                {leaveApplyWindow.attendanceLockMode === "payroll_cutoff"
                  ? `You can apply leave from ${leaveApplyWindow.earliestAllowedDateKey} onwards based on attendance lock day ${leaveApplyWindow.attendanceLockDay ?? leaveApplyWindow.payrollCutoffDay ?? "-"}.`
                  : `You can apply leave for dates within the last ${leaveApplyWindow.attendanceLockAfterDays || 0} days.`}
              </p>
            )}

            <div>
              <Label>Reason</Label>
              <Textarea
                value={applyForm.reason}
                onChange={(e) =>
                  setApplyForm({ ...applyForm, reason: e.target.value })
                }
                placeholder="Optional reason"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-5">
            <Button variant="outline" onClick={() => setApplyOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitApply} disabled={Boolean(applyDateError)}>
              Submit
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet
        open={adjustOpen}
        onOpenChange={(open) => {
          setAdjustOpen(open);
          if (!open) {
            setAdjustForm({
              employeeId: "",
              leaveTypeId: "",
              note: ""
            });
            setEmployeeBalances([]);
          }
        }}
      >
        <SheetContent className="flex flex-col gap-0 bg-white p-0">
          <SheetHeader className="border-b border-slate-100 px-6 py-5 text-left">
            <SheetTitle className="text-2xl font-semibold text-slate-950">Sync Leave Type Count</SheetTitle>
            <SheetDescription>
              Sync the selected leave type's configured count to one employee or to all assigned employees. This sets the leave total from the leave type configuration instead of adding extra days.
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
            <div className="space-y-2">
              <Label>Employee</Label>
              <Select
                value={adjustForm.employeeId}
                onValueChange={(value) =>
                  setAdjustForm({ employeeId: value, leaveTypeId: "", note: "" })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder={loadingEmployees ? "Loading employees..." : "Select employee"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_EMPLOYEES_VALUE}>All Employees</SelectItem>
                  {employees.map((employee) => {
                    const fullName = `${employee.firstName || ""} ${employee.lastName || ""}`.trim() || "Employee";
                    return (
                      <SelectItem key={employee._id} value={employee._id || ""}>
                        {fullName}{employee.employeeCode ? ` (${employee.employeeCode})` : ""}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Leave Type</Label>
              <Select
                value={adjustForm.leaveTypeId}
                onValueChange={(value) => setAdjustForm((prev) => ({ ...prev, leaveTypeId: value }))}
                disabled={!adjustForm.employeeId || (adjustForm.employeeId !== ALL_EMPLOYEES_VALUE && loadingBalances)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={adjustForm.employeeId !== ALL_EMPLOYEES_VALUE && loadingBalances ? "Loading balances..." : "Select leave type"} />
                </SelectTrigger>
                <SelectContent>
                  {availableBalanceOptions.map((balance) => (
                    <SelectItem key={`${balance.leaveTypeId}-${balance.leaveType}`} value={balance.leaveTypeId || ""}>
                      {balance.leaveType} {balance.code ? `(${balance.code})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {adjustForm.employeeId === ALL_EMPLOYEES_VALUE && selectedBalance && (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <p className="font-medium text-foreground">All Employees</p>
                <p className="text-muted-foreground mt-1">
                  This will sync {selectedLeaveTypeMeta?.daysPerYear ?? 0} total days from the selected leave type to every employee who currently has that leave balance assigned.
                </p>
              </div>
            )}

            {selectedEmployeeOption && selectedBalance && adjustForm.employeeId !== ALL_EMPLOYEES_VALUE && (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <p className="font-medium text-foreground">
                  {`${selectedEmployeeOption.firstName || ""} ${selectedEmployeeOption.lastName || ""}`.trim() || "Employee"}
                </p>
                <p className="text-muted-foreground mt-1">
                  Current {selectedBalance.leaveType}: Total {selectedBalance.total ?? 0}, Used {selectedBalance.used ?? 0}, Pending {selectedBalance.pending ?? 0}, Remaining {selectedBalance.remaining ?? 0}
                </p>
                <p className="text-muted-foreground mt-1">
                  After sync, total will be set to {selectedLeaveTypeMeta?.daysPerYear ?? 0} and remaining will be recalculated as total minus used and pending.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label>Leave Count</Label>
              <div className="rounded-lg border bg-muted/30 px-3 py-3 text-sm">
                <p className="font-medium text-foreground">{selectedLeaveTypeMeta?.daysPerYear ?? 0} days</p>
                <p className="mt-1 text-muted-foreground">
                  This value is fetched automatically from the selected leave type configuration.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Note</Label>
              <Textarea
                placeholder="Optional note for this adjustment"
                value={adjustForm.note}
                onChange={(e) => setAdjustForm((prev) => ({ ...prev, note: e.target.value }))}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-5">
            <Button variant="outline" onClick={() => setAdjustOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitAdjustment} disabled={savingAdjustment}>
              {savingAdjustment ? "Syncing..." : "Sync Leave Count"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </MainLayout>
  );
};

export default Leave;
