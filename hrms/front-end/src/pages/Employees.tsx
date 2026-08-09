import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MainLayout } from "@/components/layout/MainLayout";
import {
  Search,
  Download,
  Plus,
  MoreHorizontal,
  Edit,
  Eye,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  UserCheck,
  UserX,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { TableCell, TableHead, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { getApiWithToken, postApiWithToken, putApiWithToken } from "@/services/apiWrapper";
import { toast } from "sonner";
import PermissionGate from "@/components/PermissionGate";
import { useAuth } from "@/context/useAuth";
import { getToken } from "@/utils/auth";
import { formatDateInOrgTimeZone } from "@/utils/timezone";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable, type Column } from "@/components/ui/DataTable";

const isEmployeeInactive = (employee: any) =>
  Boolean(employee?.isDeleted) ||
  employee?.status === "resigned" ||
  employee?.employmentLifecycleStatus === "terminated";

const matchesEmployeeStateFilter = (employee: any, filter: string) => {
  if (filter === "active") return !isEmployeeInactive(employee);
  if (filter === "inactive") return isEmployeeInactive(employee);
  return true;
};

const ADMIN_STATUS_ROLE_SLUGS = new Set(["admin", "org-admin", "orgadmin", "super_admin", "superadmin"]);

const getStatusBadge = (status: string, isDeleted = false) => {
  if (isDeleted) {
    return <Badge className="status-badge status-inactive">Inactive</Badge>;
  }
  switch (status) {
    case "active":
      return <Badge className="status-badge status-active">Active</Badge>;
    case "on_leave":
      return <Badge className="status-badge status-pending">On Leave</Badge>;
    case "resigned":
      return <Badge className="status-badge status-inactive">Inactive</Badge>;
    default:
      return <Badge variant="secondary">{status || "-"}</Badge>;
  }
};

const getLifecycleBadge = (status: string) => {
  const normalizedStatus = status || "confirmed";
  switch (normalizedStatus) {
    case "probation":
      return <Badge className="status-badge status-pending">Probation</Badge>;
    case "confirmed":
      return <Badge className="status-badge status-active">Confirmed</Badge>;
    case "notice":
      return <Badge className="status-badge status-inactive">Notice</Badge>;
    case "terminated":
      return <Badge className="status-badge status-inactive">Terminated</Badge>;
    default:
      return <Badge variant="secondary">{normalizedStatus}</Badge>;
  }
};

const toIdString = (value: any) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

const getEmployeeId = (employee: any) => toIdString(employee?._id || employee?.employeeId || employee);

const mergeEmployeePages = (existing: any[], incoming: any[]) => {
  const merged = new Map<string, any>();
  existing.forEach((employee) => {
    const employeeId = getEmployeeId(employee);
    if (employeeId) merged.set(employeeId, employee);
  });
  incoming.forEach((employee) => {
    const employeeId = getEmployeeId(employee);
    if (employeeId) merged.set(employeeId, employee);
  });
  return Array.from(merged.values());
};

const Employees = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { hasAnyPermission, profile, isSuperAdmin: authIsSuperAdmin } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [designationFilter, setDesignationFilter] = useState("all");
  const [managerFilter, setManagerFilter] = useState("all");
  const [employeeStateFilter, setEmployeeStateFilter] = useState("active");
  const [statusFilter, setStatusFilter] = useState("all");
  const [employmentTypeFilter, setEmploymentTypeFilter] = useState("all");
  const [orgSearch, setOrgSearch] = useState("");
  const [deptSearch, setDeptSearch] = useState("");
  const [designationSearch, setDesignationSearch] = useState("");
  const [managerSearch, setManagerSearch] = useState("");
  const [selectedEmployee, setSelectedEmployee] = useState<any | null>(null);
  const [employees, setEmployees] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [designations, setDesignations] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [leaveApprovalFlows, setLeaveApprovalFlows] = useState<any[]>([]);
  const [attendanceApprovalFlows, setAttendanceApprovalFlows] = useState<any[]>([]);
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [shifts, setShifts] = useState<any[]>([]);
  const [managers, setManagers] = useState<any[]>([]);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const [bulkShiftId, setBulkShiftId] = useState("none");
  const [bulkManagerId, setBulkManagerId] = useState("none");
  const [bulkDepartmentId, setBulkDepartmentId] = useState("none");
  const [bulkDesignationId, setBulkDesignationId] = useState("none");
  const [bulkStatus, setBulkStatus] = useState("none");
  const [bulkLifecycleStatus, setBulkLifecycleStatus] = useState("none");
  const [bulkApplying, setBulkApplying] = useState(false);
  const [bulkPanelOpen, setBulkPanelOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [sortBy, setSortBy] = useState("employeeCode");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [skipInitialFetch, setSkipInitialFetch] = useState(false);
  const tableViewportRef = useRef<HTMLDivElement | null>(null);
  const loadingMoreRef = useRef(false);
  const resetPaginationRef = useRef(false);
  const [formMode, setFormMode] = useState<"add" | "edit" | null>(null);
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);
  const [formSaving, setFormSaving] = useState(false);
  const [employeeForm, setEmployeeForm] = useState({
    email: "",
    firstName: "",
    lastName: "",
    employeeCode: "",
    departmentId: "",
    designationId: "",
    managerId: "",
    leaveApprovalFlowId: "",
    attendanceApprovalFlowId: "",
    shiftId: "",
    roleIds: [] as string[],
    employmentType: "",
    dateOfJoining: ""
  });
  const isSuperAdmin = localStorage.getItem("isSuperAdmin") === "true";
  const activeRoleSlug = String(profile?.activeRole?.slug || "").toLowerCase();
  const canManageEmployeeStatus =
    authIsSuperAdmin || isSuperAdmin || ADMIN_STATUS_ROLE_SLUGS.has(activeRoleSlug);
  const canView = hasAnyPermission(["EMP_VIEW"]);
  const canEdit = hasAnyPermission(["EMP_UPDATE"]);
  const canAnyAction = canView || canEdit;
  const tableColumnCount = 14 + (canAnyAction ? 1 : 0);

  const selectedOrgId = useMemo(
    () => searchParams.get("organizationId") || "",
    [searchParams]
  );

  useEffect(() => {
    const rawCache = sessionStorage.getItem("employees:list-cache");
    if (!rawCache) return;

    try {
      const cache = JSON.parse(rawCache);
      const cachedItems = Array.isArray(cache?.employees) ? cache.employees : [];
      if (cachedItems.length > 0) {
        const rawUpdated = sessionStorage.getItem("employees:last-updated");
        let updatedEmployee: any = null;
        if (rawUpdated) {
          try {
            updatedEmployee = JSON.parse(rawUpdated);
          } catch {
            updatedEmployee = null;
          }
        }

        const merged = updatedEmployee?._id
          ? cachedItems.map((emp: any) =>
              emp._id === updatedEmployee._id ? { ...emp, ...updatedEmployee } : emp
            )
          : cachedItems;

        setEmployees(merged);
        setTotalItems(Number(cache?.totalItems || merged.length));
        setTotalPages(Math.max(1, Number(cache?.totalPages || 1)));
        setCurrentPage(Number(cache?.currentPage || 1));
        setSkipInitialFetch(true);
      }
    } finally {
      sessionStorage.removeItem("employees:last-updated");
      sessionStorage.removeItem("employees:list-cache");
    }
  }, [location.key]);

  const filteredOrganizations = useMemo(
    () => organizations.filter((org) => (org.name || "").toLowerCase().includes(orgSearch.toLowerCase())),
    [organizations, orgSearch]
  );
  const filteredDepartments = useMemo(
    () => departments.filter((dept) => (dept.name || "").toLowerCase().includes(deptSearch.toLowerCase())),
    [departments, deptSearch]
  );
  const filteredDesignations = useMemo(
    () =>
      designations.filter((designation) =>
        (designation.name || "").toLowerCase().includes(designationSearch.toLowerCase())
      ),
    [designations, designationSearch]
  );
  const filteredManagers = useMemo(
    () => managers.filter((manager) => (manager.name || "").toLowerCase().includes(managerSearch.toLowerCase())),
    [managers, managerSearch]
  );

  const fetchDepartments = async () => {
    const params = new URLSearchParams();
    if (isSuperAdmin && selectedOrgId) {
      params.set("organizationId", selectedOrgId);
    }
    const query = params.toString();
    const res = await getApiWithToken(`/departments${query ? `?${query}` : ""}`, null, {
      requiredPermissions: ["DEPT_VIEW"]
    });
    if (res?.skipped) return;
    if (res?.success) {
      setDepartments(res.data || []);
    } else {
      toast.error(res?.message || "Failed to load departments");
    }
  };

  const fetchApprovalFlows = async () => {
    const [leaveRes, attendanceRes] = await Promise.all([
      getApiWithToken("/approval-flows?moduleKey=leave"),
      getApiWithToken("/approval-flows?moduleKey=attendance_request")
    ]);

    setLeaveApprovalFlows(Array.isArray(leaveRes?.data) ? leaveRes.data : []);
    setAttendanceApprovalFlows(Array.isArray(attendanceRes?.data) ? attendanceRes.data : []);
  };

  const fetchOrganizations = async () => {
    if (!isSuperAdmin) return;
    const res = await getApiWithToken("/organizations", null, {
      requiredPermissions: ["ORG_VIEW"]
    });
    if (res?.skipped) return;
    if (res?.success) {
      setOrganizations(res.data || []);
    }
  };

  const fetchDesignations = async () => {
    const res = await getApiWithToken("/designations", null, {
      requiredPermissions: ["DESIG_VIEW"]
    });
    if (res?.success) {
      setDesignations(res.data || []);
    } else {
      setDesignations([]);
    }
  };

  const fetchRoles = async () => {
    const res = await getApiWithToken("/roles", null, {
      requiredPermissions: ["ROLE_VIEW"]
    });
    if (res?.skipped) return;
    if (res?.success) {
      setRoles(res.data || []);
    } else {
      setRoles([]);
      toast.error(res?.message || "Failed to load roles");
    }
  };

  const fetchShifts = async () => {
    const res = await getApiWithToken("/shifts", null, {
      requiredPermissions: ["SHIFT_VIEW"]
    });
    if (res?.success) {
      setShifts(res.data || []);
    } else {
      setShifts([]);
    }
  };

  const fetchManagers = async () => {
    const params = new URLSearchParams();
    if (isSuperAdmin && selectedOrgId) {
      params.set("organizationId", selectedOrgId);
    }
    params.set("employeeState", "active");
    const managerQuery = params.toString();
    const res = await getApiWithToken(`/employees${managerQuery ? `?${managerQuery}` : ""}`, null, {
      requiredPermissions: ["EMP_VIEW"]
    });
    if (res?.success) {
      const list = res.data?.items || [];
      setManagers(
        list.map((e: any) => ({
          _id: e._id,
          name: `${e.firstName || ""} ${e.lastName || ""}`.trim()
        }))
      );
    } else {
      setManagers([]);
    }
  };

  const fetchEmployees = async (pageToLoad = currentPage) => {
    try {
      const isLoadMoreRequest = pageToLoad > 1;
      if (isLoadMoreRequest) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      if (!canView) {
        setEmployees([]);
        return;
      }
      const params = new URLSearchParams();
      if (searchQuery) params.set("search", searchQuery);
      if (departmentFilter !== "all") {
        params.set("departmentId", departmentFilter);
      }
      if (designationFilter !== "all") {
        params.set("designationId", designationFilter);
      }
      if (managerFilter !== "all") {
        params.set("managerId", managerFilter);
      }
      if (employeeStateFilter !== "all") {
        params.set("employeeState", employeeStateFilter);
      }
      if (statusFilter !== "all") {
        params.set("status", statusFilter);
      }
      if (employmentTypeFilter !== "all") {
        params.set("employmentType", employmentTypeFilter);
      }
      if (isSuperAdmin && selectedOrgId) {
        params.set("organizationId", selectedOrgId);
      }
      params.set("page", String(pageToLoad));
      params.set("limit", String(pageSize));
      params.set("sortBy", sortBy);
      params.set("sortOrder", sortOrder);
      const query = params.toString();
      const res = await getApiWithToken(
        `/employees${query ? `?${query}` : ""}`,
        null,
        { requiredPermissions: ["EMP_VIEW"] }
      );
      if (res?.skipped) return;
      if (res?.success) {
        const nextEmployees = res?.data?.items || [];
        setEmployees((prev) => (pageToLoad > 1 ? mergeEmployeePages(prev, nextEmployees) : nextEmployees));
        const pagination = res?.data?.pagination;
        setTotalItems(Number(pagination?.total || nextEmployees.length));
        setTotalPages(Math.max(1, Number(pagination?.totalPages || 1)));
        if (pageToLoad === 1) {
          setSelectedEmployeeIds((prev) =>
            prev.filter((id) => nextEmployees.some((emp: any) => getEmployeeId(emp) === id))
          );
        }
      } else {
        toast.error(res?.message || "Failed to load employees");
      }
    } finally {
      loadingMoreRef.current = false;
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const buildEmployeesFilterParams = () => {
    const params = new URLSearchParams();
    if (searchQuery) params.set("search", searchQuery);
    if (departmentFilter !== "all") params.set("departmentId", departmentFilter);
    if (designationFilter !== "all") params.set("designationId", designationFilter);
    if (managerFilter !== "all") params.set("managerId", managerFilter);
    if (employeeStateFilter !== "all") params.set("employeeState", employeeStateFilter);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (employmentTypeFilter !== "all") params.set("employmentType", employmentTypeFilter);
    if (isSuperAdmin && selectedOrgId) params.set("organizationId", selectedOrgId);
    return params;
  };

  const handleExportEmployees = async () => {
    if (!canView) {
      toast.error("You do not have permission to export employees");
      return;
    }

    try {
      setExporting(true);
      const params = buildEmployeesFilterParams();
      params.set("sortBy", sortBy);
      params.set("sortOrder", sortOrder);
      const query = params.toString();

      const baseUrl = String(import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
      const token = getToken();
      const response = await fetch(`${baseUrl}/employees/export${query ? `?${query}` : ""}`, {
        method: "GET",
        headers: {
          Authorization: token?.includes("Bearer") ? token : `Bearer ${token || ""}`
        }
      });

      if (!response.ok) {
        let message = "Failed to export employees";
        try {
          const errorPayload = await response.json();
          message = errorPayload?.message || message;
        } catch {
          // keep default message
        }
        toast.error(message);
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const disposition = response.headers.get("content-disposition") || "";
      const fileNameMatch = disposition.match(/filename="([^"]+)"/i);
      const stamp = new Date().toISOString().slice(0, 10);
      const fileName = fileNameMatch?.[1] || `employees-${stamp}.csv`;
      link.href = url;
      link.setAttribute("download", fileName);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success("Employees exported successfully");
    } finally {
      setExporting(false);
    }
  };

  const patchEmployeeInList = (employeeId: string, patch: Record<string, any>) => {
    setEmployees((prev) =>
      prev.map((emp) => (emp._id === employeeId ? { ...emp, ...patch } : emp))
    );
  };

  const patchEmployeesInList = (
    employeeIds: string[],
    buildPatch: (employee: any) => Record<string, any>
  ) => {
    const ids = new Set(employeeIds);
    setEmployees((prev) =>
      prev.map((emp) => (ids.has(emp._id) ? { ...emp, ...buildPatch(emp) } : emp))
    );
  };

  const resetEmployeeForm = () => {
    setEmployeeForm({
      email: "",
      firstName: "",
      lastName: "",
      employeeCode: "",
      departmentId: "",
      designationId: "",
      managerId: "",
      leaveApprovalFlowId: "",
      attendanceApprovalFlowId: "",
      shiftId: "",
      roleIds: [],
      employmentType: "",
      dateOfJoining: ""
    });
    setEditingEmployeeId(null);
  };

  const startAddForm = () => {
    resetEmployeeForm();
    setFormMode("add");
    void (async () => {
      const res = await getApiWithToken("/employees/next-code", null, {
        requiredPermissions: ["EMP_CREATE"]
      });
      if (res?.success && res?.data?.employeeCode) {
        setEmployeeForm((prev) => {
          if (prev.employeeCode?.trim()) return prev;
          return { ...prev, employeeCode: String(res.data.employeeCode).toUpperCase() };
        });
      }
    })();
  };

  const startEditForm = (employee: any) => {
    setEditingEmployeeId(employee._id);
    setEmployeeForm({
      email: employee?.userId?.email || "",
      firstName: employee?.firstName || "",
      lastName: employee?.lastName || "",
      employeeCode: employee?.employeeCode || "",
      departmentId: employee?.departmentId?._id || "",
      designationId: employee?.designationId?._id || "",
      managerId: employee?.managerId?._id || "",
      leaveApprovalFlowId: employee?.leaveApprovalFlowId?._id || "",
      attendanceApprovalFlowId: employee?.attendanceApprovalFlowId?._id || "",
      shiftId: employee?.shiftId?._id || "",
      roleIds: Array.isArray(employee?.roleIds)
        ? employee.roleIds
            .map((r: any) => (typeof r === "string" ? r : r?._id))
            .filter(Boolean)
        : [],
      employmentType: employee?.employmentType || "",
      dateOfJoining: employee?.dateOfJoining ? String(employee.dateOfJoining).slice(0, 10) : ""
    });
    setFormMode("edit");
  };

  const cancelForm = () => {
    setFormMode(null);
    resetEmployeeForm();
  };

  const submitEmployeeForm = async () => {
    if (
      !employeeForm.email ||
      !employeeForm.firstName ||
      !employeeForm.lastName ||
      !employeeForm.departmentId ||
      !employeeForm.designationId ||
      !employeeForm.roleIds.length ||
      !employeeForm.employmentType ||
      !employeeForm.dateOfJoining
    ) {
      toast.error("Please fill all required fields");
      return;
    }

    const payload: Record<string, any> = {
      email: employeeForm.email.trim(),
      firstName: employeeForm.firstName.trim(),
      lastName: employeeForm.lastName.trim(),
      employeeCode: employeeForm.employeeCode.trim().toUpperCase() || undefined,
      departmentId: employeeForm.departmentId,
      designationId: employeeForm.designationId,
      managerId: employeeForm.managerId || undefined,
      leaveApprovalFlowId: employeeForm.leaveApprovalFlowId || null,
      attendanceApprovalFlowId: employeeForm.attendanceApprovalFlowId || null,
      shiftId: employeeForm.shiftId || undefined,
      roleIds: employeeForm.roleIds,
      employmentType: employeeForm.employmentType,
      dateOfJoining: employeeForm.dateOfJoining
    };

    setFormSaving(true);
    const res = formMode === "edit" && editingEmployeeId
      ? await putApiWithToken(`/employees/${editingEmployeeId}`, payload)
      : await postApiWithToken("/employees", payload);
    setFormSaving(false);

    if (!res?.success) {
      toast.error(res?.message || "Failed to save employee");
      return;
    }

    const selectedDepartment = departments.find((d: any) => d._id === payload.departmentId) || null;
    const selectedDesignation = designations.find((d: any) => d._id === payload.designationId) || null;
    const selectedManager = managers.find((m: any) => m._id === payload.managerId) || null;
    const selectedLeaveApprovalFlow = leaveApprovalFlows.find((flow: any) => flow._id === payload.leaveApprovalFlowId) || null;
    const selectedAttendanceApprovalFlow = attendanceApprovalFlows.find((flow: any) => flow._id === payload.attendanceApprovalFlowId) || null;
    const selectedShift = shifts.find((s: any) => s._id === payload.shiftId) || null;
    const selectedRoles = (roles || []).filter((r: any) => payload.roleIds.includes(r._id));

    if (formMode === "edit" && editingEmployeeId) {
      patchEmployeeInList(editingEmployeeId, {
        firstName: payload.firstName,
        lastName: payload.lastName,
        employeeCode: payload.employeeCode,
        employmentType: payload.employmentType,
        dateOfJoining: payload.dateOfJoining,
        departmentId: selectedDepartment || null,
        designationId: selectedDesignation || null,
        managerId: selectedManager
          ? { _id: selectedManager._id, firstName: selectedManager.name.split(" ")[0], lastName: selectedManager.name.split(" ").slice(1).join(" ") }
          : null,
        leaveApprovalFlowId: selectedLeaveApprovalFlow || null,
        attendanceApprovalFlowId: selectedAttendanceApprovalFlow || null,
        shiftId: selectedShift || null,
        roleIds: selectedRoles,
        userId: { email: payload.email }
      });
      toast.success("Employee updated");
    } else {
      const newId = res?.data?._id || res?.data?.employeeId;
      if (newId) {
        const nextEmployee = {
          _id: newId,
          firstName: payload.firstName,
          lastName: payload.lastName,
          employeeCode: payload.employeeCode || "-",
          employmentType: payload.employmentType,
          dateOfJoining: payload.dateOfJoining,
          status: "active",
          employmentLifecycleStatus: "probation",
          benefitsEligible: false,
          profileCompleted: false,
          departmentId: selectedDepartment || null,
          designationId: selectedDesignation || null,
          managerId: selectedManager
            ? { _id: selectedManager._id, firstName: selectedManager.name.split(" ")[0], lastName: selectedManager.name.split(" ").slice(1).join(" ") }
            : null,
          leaveApprovalFlowId: selectedLeaveApprovalFlow || null,
          attendanceApprovalFlowId: selectedAttendanceApprovalFlow || null,
          shiftId: selectedShift || null,
          roleIds: selectedRoles,
          phone: "",
          userId: { email: payload.email }
        };
        setEmployees((prev) => [nextEmployee, ...prev]);
        setTotalItems((prev) => prev + 1);
      }
      toast.success("Employee created");
    }

    cancelForm();
  };

  useEffect(() => {
    fetchDesignations();
    fetchRoles();
    fetchApprovalFlows();
    fetchOrganizations();
    fetchShifts();
  }, []);

  useEffect(() => {
    fetchDepartments();
  }, [selectedOrgId]);

  useEffect(() => {
    fetchManagers();
  }, [selectedOrgId]);

  useEffect(() => {
    resetPaginationRef.current = true;
    loadingMoreRef.current = false;
    if (tableViewportRef.current) {
      tableViewportRef.current.scrollTop = 0;
    }
    setCurrentPage(1);
    setEmployees([]);
  }, [
    searchQuery,
    departmentFilter,
    designationFilter,
    managerFilter,
    employeeStateFilter,
    statusFilter,
    employmentTypeFilter,
    selectedOrgId,
    pageSize,
    sortBy,
    sortOrder
  ]);

  useEffect(() => {
    if (skipInitialFetch) {
      setSkipInitialFetch(false);
      return;
    }
    if (resetPaginationRef.current && currentPage !== 1) {
      return;
    }
    if (resetPaginationRef.current && currentPage === 1) {
      resetPaginationRef.current = false;
    }
    const timer = setTimeout(() => {
      fetchEmployees(currentPage);
    }, 300);
    return () => clearTimeout(timer);
  }, [
    searchQuery,
    departmentFilter,
    designationFilter,
    managerFilter,
    employeeStateFilter,
    statusFilter,
    employmentTypeFilter,
    selectedOrgId,
    currentPage,
    pageSize,
    sortBy,
    sortOrder,
    skipInitialFetch
  ]);

  const hasMoreEmployees = currentPage < totalPages;

  const handleTableScroll = () => {
    const viewport = tableViewportRef.current;
    if (!viewport || loading || loadingMore || loadingMoreRef.current || !hasMoreEmployees || formMode) return;

    const scrollTop = viewport.scrollTop;
    const scrollHeight = viewport.scrollHeight;
    const clientHeight = viewport.clientHeight;
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

  const handleStatusAction = (employee: any) => {
    setSelectedEmployee(employee);
    setStatusDialogOpen(true);
  };

  const [statusDialogOpen, setStatusDialogOpen] = useState(false);

  const confirmStatusChange = async () => {
    if (!selectedEmployee?._id) return;
    if (!canEdit) {
      toast.error("You do not have permission to update employee status");
      return;
    }

    if (!canManageEmployeeStatus) {
      toast.error("Only admin can activate or inactivate employees");
      return;
    }

    const nextStatus = isEmployeeInactive(selectedEmployee) ? "active" : "resigned";
    const res = await putApiWithToken(`/employees/${selectedEmployee._id}`, {
      status: nextStatus
    });
    if (res?.success) {
      toast.success(nextStatus === "active" ? "Employee marked active" : "Employee marked inactive");
      const nextEmployee = {
        ...selectedEmployee,
        status: nextStatus,
        isDeleted: false,
        employmentLifecycleStatus:
          nextStatus === "active" ? "confirmed" : selectedEmployee.employmentLifecycleStatus
      };
      const shouldRemainVisible = matchesEmployeeStateFilter(nextEmployee, employeeStateFilter);

      setEmployees((prev) =>
        shouldRemainVisible
          ? prev.map((emp) => (emp._id === selectedEmployee._id ? { ...emp, ...nextEmployee } : emp))
          : prev.filter((emp) => emp._id !== selectedEmployee._id)
      );
      if (!shouldRemainVisible) {
        setTotalItems((prev) => Math.max(0, prev - 1));
        setSelectedEmployeeIds((prev) => prev.filter((id) => id !== selectedEmployee._id));
      }
    } else {
      toast.error(res?.message || "Status update failed");
    }

    setStatusDialogOpen(false);
    setSelectedEmployee(null);
  };

  const allVisibleSelected =
    employees.length > 0 && employees.every((emp) => selectedEmployeeIds.includes(getEmployeeId(emp)));

  const toggleSelectAllVisible = (checked: boolean) => {
    if (checked) {
      setSelectedEmployeeIds(employees.map((emp) => getEmployeeId(emp)).filter(Boolean));
    } else {
      setSelectedEmployeeIds([]);
    }
  };

  const toggleSelectOne = (employeeId: any, checked: boolean) => {
    const normalizedEmployeeId = toIdString(employeeId);
    if (!normalizedEmployeeId) return;
    setSelectedEmployeeIds((prev) =>
      checked
        ? Array.from(new Set([...prev, normalizedEmployeeId]))
        : prev.filter((id) => id !== normalizedEmployeeId)
    );
  };

  const handleBulkUpdate = async () => {
    const normalizedEmployeeIds = Array.from(
      new Set(selectedEmployeeIds.map((id) => toIdString(id)).filter(Boolean))
    );

    if (!normalizedEmployeeIds.length) {
      toast.error("Select at least one employee");
      return;
    }

    const payload: any = {
      employeeIds: normalizedEmployeeIds
    };

    if (bulkShiftId !== "none") payload.shiftId = bulkShiftId === "clear" ? null : bulkShiftId;
    if (bulkManagerId !== "none") payload.managerId = bulkManagerId === "clear" ? null : bulkManagerId;
    if (bulkDepartmentId !== "none") payload.departmentId = bulkDepartmentId;
    if (bulkDesignationId !== "none") payload.designationId = bulkDesignationId;
    if (bulkStatus !== "none") payload.status = bulkStatus;
    if (bulkLifecycleStatus !== "none") payload.employmentLifecycleStatus = bulkLifecycleStatus;

    if (Object.keys(payload).length === 1) {
      toast.error("Select at least one field to update");
      return;
    }

    setBulkApplying(true);
    const res = await putApiWithToken("/employees/bulk-update", payload);
    setBulkApplying(false);

    if (res?.success) {
      toast.success(`Updated ${res?.data?.updatedCount || normalizedEmployeeIds.length} employees`);

      const selectedDepartment = bulkDepartmentId !== "none"
        ? departments.find((d: any) => d._id === bulkDepartmentId)
        : null;
      const selectedDesignation = bulkDesignationId !== "none"
        ? designations.find((d: any) => d._id === bulkDesignationId)
        : null;
      const selectedShift = bulkShiftId !== "none" && bulkShiftId !== "clear"
        ? shifts.find((s: any) => s._id === bulkShiftId)
        : null;
      const selectedManager = bulkManagerId !== "none" && bulkManagerId !== "clear"
        ? managers.find((m: any) => m._id === bulkManagerId)
        : null;

      patchEmployeesInList(normalizedEmployeeIds, (emp) => {
        const patch: Record<string, any> = {};
        if (bulkShiftId !== "none") {
          patch.shiftId = bulkShiftId === "clear"
            ? null
            : (selectedShift || emp.shiftId);
        }
        if (bulkManagerId !== "none") {
          const managerName = String(selectedManager?.name || "").trim();
          const [firstName, ...lastNameParts] = managerName.split(" ");
          patch.managerId = bulkManagerId === "clear"
            ? null
            : selectedManager
              ? { _id: selectedManager._id, firstName: firstName || managerName, lastName: lastNameParts.join(" ") }
              : emp.managerId;
        }
        if (bulkDepartmentId !== "none") {
          patch.departmentId = selectedDepartment || emp.departmentId;
        }
        if (bulkDesignationId !== "none") {
          patch.designationId = selectedDesignation || emp.designationId;
        }
        if (bulkStatus !== "none") {
          patch.status = bulkStatus;
        }
        if (bulkLifecycleStatus !== "none") {
          patch.employmentLifecycleStatus = bulkLifecycleStatus;
        }
        return patch;
      });

      setSelectedEmployeeIds([]);
      setBulkShiftId("none");
      setBulkManagerId("none");
      setBulkDepartmentId("none");
      setBulkDesignationId("none");
      setBulkStatus("none");
      setBulkLifecycleStatus("none");
    } else {
      toast.error(res?.message || "Bulk update failed");
    }
  };

  const toggleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(field);
    setSortOrder("asc");
  };

  const renderSortableHead = (label: string, field?: string, className?: string) => {
    const stickyClass = "sticky top-0 z-30 bg-card";
    if (!field) return <TableHead className={`${stickyClass} ${className || ""}`}>{label}</TableHead>;
    return (
      <TableHead
        className={`${stickyClass} cursor-pointer select-none ${className || ""}`}
        onClick={() => toggleSort(field)}
      >
        <div className="flex items-center gap-1">
          <span>{label}</span>
          <ArrowUpDown className={`w-3.5 h-3.5 ${sortBy === field ? "opacity-100" : "opacity-40"}`} />
        </div>
      </TableHead>
    );
  };

  const columns: Column<any>[] = [
    { header: "Employee", accessor: "firstName" },
    { header: "Email", accessor: "userId" },
    { header: "Phone", accessor: "phone" },
    { header: "Department", accessor: "departmentId" },
    { header: "Designation", accessor: "designationId" },
    { header: "Roles", accessor: "roleIds" },
    { header: "Manager", accessor: "managerId" },
    { header: "Shift", accessor: "shiftId" },
    { header: "Employment Type", accessor: "employmentType" },
    { header: "Status", accessor: "status" },
    { header: "Lifecycle", accessor: "employmentLifecycleStatus" },
    { header: "Benefits", accessor: "benefitsEligible" },
    { header: "Profile", accessor: "profileCompleted" },
    { header: "Join Date", accessor: "dateOfJoining" },
    ...(canAnyAction ? [{ header: "Actions", accessor: "_id" as const }] : [])
  ];

  return (
    <MainLayout
      title="Employees"
      breadcrumb={[{ label: "Home", href: "/" }, { label: "Employees" }]}
    >
      {!formMode && (
        <>
          {/* Action Bar */}
          <div className="flex flex-col items-start gap-4 mb-6">
            <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative w-full sm:w-80">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search employees..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <PermissionGate permissions={["EMP_CREATE"]}>
                <Button className="gap-2 self-end sm:self-auto" onClick={startAddForm}>
                  <Plus className="w-4 h-4" />
                  Add Employee
                </Button>
              </PermissionGate>
            </div>
            <div className="flex flex-wrap items-center gap-3 w-full">
              {canEdit && !isSuperAdmin && (
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2"
                  onClick={() => setBulkPanelOpen((prev) => !prev)}
                >
                  {bulkPanelOpen ? "Hide Bulk Update" : "Show Bulk Update"}
                  {bulkPanelOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </Button>
              )}
              {isSuperAdmin && (
                <Select
                  value={selectedOrgId}
                  onValueChange={(value) => {
                    if (value) {
                      setSearchParams({ organizationId: value });
                    } else {
                      setSearchParams({});
                    }
                  }}
                >
                  <SelectTrigger className="w-56">
                    <SelectValue placeholder="Select Organization" />
                  </SelectTrigger>
                  <SelectContent>
                    <div className="p-2">
                      <Input
                        placeholder="Search organization..."
                        value={orgSearch}
                        onChange={(e) => setOrgSearch(e.target.value)}
                        onKeyDown={(e) => e.stopPropagation()}
                      />
                    </div>
                    {filteredOrganizations.map((org) => (
                      <SelectItem key={org._id} value={org._id}>
                        {org.name}
                      </SelectItem>
                    ))}
                    {filteredOrganizations.length === 0 && (
                      <div className="px-3 py-2 text-sm text-muted-foreground">No organizations found</div>
                    )}
                  </SelectContent>
                </Select>
              )}
              <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Department" />
            </SelectTrigger>
            <SelectContent>
              <div className="p-2">
                <Input
                  placeholder="Search department..."
                  value={deptSearch}
                  onChange={(e) => setDeptSearch(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                />
              </div>
              <SelectItem value="all">All Departments</SelectItem>
              {filteredDepartments.map((dept) => (
                <SelectItem key={dept._id} value={dept._id}>
                  {dept.name}
                </SelectItem>
              ))}
              {filteredDepartments.length === 0 && (
                <div className="px-3 py-2 text-sm text-muted-foreground">No departments found</div>
              )}
            </SelectContent>
          </Select>
          <Select value={designationFilter} onValueChange={setDesignationFilter}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Designation" />
            </SelectTrigger>
            <SelectContent>
              <div className="p-2">
                <Input
                  placeholder="Search designation..."
                  value={designationSearch}
                  onChange={(e) => setDesignationSearch(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                />
              </div>
              <SelectItem value="all">All Designations</SelectItem>
              {filteredDesignations.map((designation) => (
                <SelectItem key={designation._id} value={designation._id}>
                  {designation.name}
                </SelectItem>
              ))}
              {filteredDesignations.length === 0 && (
                <div className="px-3 py-2 text-sm text-muted-foreground">No designations found</div>
              )}
            </SelectContent>
          </Select>
          <Select value={managerFilter} onValueChange={setManagerFilter}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Manager" />
            </SelectTrigger>
            <SelectContent>
              <div className="p-2">
                <Input
                  placeholder="Search manager..."
                  value={managerSearch}
                  onChange={(e) => setManagerSearch(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                />
              </div>
              <SelectItem value="all">All Managers</SelectItem>
              {filteredManagers.map((manager) => (
                <SelectItem key={manager._id} value={manager._id}>
                  {manager.name}
                </SelectItem>
              ))}
              {filteredManagers.length === 0 && (
                <div className="px-3 py-2 text-sm text-muted-foreground">No managers found</div>
              )}
            </SelectContent>
          </Select>
          <Select value={employeeStateFilter} onValueChange={setEmployeeStateFilter}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Employee View" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active Employees</SelectItem>
              <SelectItem value="inactive">Inactive Employees</SelectItem>
              <SelectItem value="all">All Employees</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="on_leave">On Leave</SelectItem>
              <SelectItem value="resigned">Resigned</SelectItem>
            </SelectContent>
          </Select>
          <Select value={employmentTypeFilter} onValueChange={setEmploymentTypeFilter}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Employment Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="full_time">Full Time</SelectItem>
              <SelectItem value="part_time">Part Time</SelectItem>
              <SelectItem value="contract">Contract</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            onClick={() => {
              setSearchQuery("");
              setDepartmentFilter("all");
              setDesignationFilter("all");
              setManagerFilter("all");
              setEmployeeStateFilter("active");
              setStatusFilter("all");
              setEmploymentTypeFilter("all");
              setSortBy("employeeCode");
              setSortOrder("asc");
            }}
          >
            Reset
          </Button>
              <Button
                variant="outline"
                className="gap-2"
                onClick={handleExportEmployees}
                disabled={exporting || !canView}
              >
                <Download className="w-4 h-4" />
                {exporting ? "Exporting..." : "Export"}
              </Button>
            </div>
          </div>

          {canEdit && (
        <div className="mb-6">
          {/* <div className="bg-card rounded-xl card-shadow p-3">
            <div className="text-sm text-muted-foreground">
              Bulk update selected employees: <span className="font-medium text-foreground">{selectedEmployeeIds.length}</span>
            </div>
          </div> */}

          <AnimatePresence initial={false}>
            {bulkPanelOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: "easeInOut" }}
                className="overflow-hidden"
              >
                <div className="bg-card rounded-xl card-shadow p-4 mt-3 space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
                    <Select value={bulkShiftId} onValueChange={setBulkShiftId}>
                      <SelectTrigger><SelectValue placeholder="Assign Shift" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Shift: No Change</SelectItem>
                        <SelectItem value="clear">Shift: Clear</SelectItem>
                        {shifts.map((shift: any) => (
                          <SelectItem key={shift._id} value={shift._id}>
                            {shift.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Select value={bulkManagerId} onValueChange={setBulkManagerId}>
                      <SelectTrigger><SelectValue placeholder="Assign Manager" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Manager: No Change</SelectItem>
                        <SelectItem value="clear">Manager: Clear</SelectItem>
                        {managers.map((manager: any) => (
                          <SelectItem key={manager._id} value={manager._id}>
                            {manager.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Select value={bulkDepartmentId} onValueChange={setBulkDepartmentId}>
                      <SelectTrigger><SelectValue placeholder="Assign Department" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Department: No Change</SelectItem>
                        {departments.map((dept: any) => (
                          <SelectItem key={dept._id} value={dept._id}>
                            {dept.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Select value={bulkDesignationId} onValueChange={setBulkDesignationId}>
                      <SelectTrigger><SelectValue placeholder="Assign Designation" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Designation: No Change</SelectItem>
                        {designations.map((designation: any) => (
                          <SelectItem key={designation._id} value={designation._id}>
                            {designation.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Select value={bulkStatus} onValueChange={setBulkStatus}>
                      <SelectTrigger><SelectValue placeholder="Update Status" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Status: No Change</SelectItem>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="on_leave">On Leave</SelectItem>
                        <SelectItem value="resigned">Resigned</SelectItem>
                      </SelectContent>
                    </Select>

                    <Select value={bulkLifecycleStatus} onValueChange={setBulkLifecycleStatus}>
                      <SelectTrigger><SelectValue placeholder="Lifecycle Status" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Lifecycle: No Change</SelectItem>
                        <SelectItem value="probation">Probation</SelectItem>
                        <SelectItem value="confirmed">Confirmed</SelectItem>
                        <SelectItem value="notice">Notice</SelectItem>
                        <SelectItem value="terminated">Terminated</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Button onClick={handleBulkUpdate} disabled={bulkApplying || selectedEmployeeIds.length === 0}>
                      {bulkApplying ? "Applying..." : "Apply Bulk Update"}
                    </Button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
          )}
        </>
      )}

      {/* Employee Table */}
      {formMode && (
        <div className="bg-card rounded-xl card-shadow p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">
              {formMode === "edit" ? "Edit Employee" : "Add Employee"}
            </h3>
            <Button variant="outline" onClick={cancelForm}>Back to List</Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input placeholder="Email" validationType="email" value={employeeForm.email} onChange={(e) => setEmployeeForm({ ...employeeForm, email: e.target.value })} />
            <Input placeholder="Employee Code (optional)" validationType="code" value={employeeForm.employeeCode} onChange={(e) => setEmployeeForm({ ...employeeForm, employeeCode: e.target.value.toUpperCase() })} />
            <Input placeholder="First Name" validationType="name" value={employeeForm.firstName} onChange={(e) => setEmployeeForm({ ...employeeForm, firstName: e.target.value })} />
            <Input placeholder="Last Name" validationType="name" value={employeeForm.lastName} onChange={(e) => setEmployeeForm({ ...employeeForm, lastName: e.target.value })} />
            <Select value={employeeForm.departmentId} onValueChange={(value) => setEmployeeForm({ ...employeeForm, departmentId: value })}>
              <SelectTrigger><SelectValue placeholder="Department" /></SelectTrigger>
              <SelectContent>{departments.map((d: any) => <SelectItem key={d._id} value={d._id}>{d.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={employeeForm.designationId} onValueChange={(value) => setEmployeeForm({ ...employeeForm, designationId: value })}>
              <SelectTrigger><SelectValue placeholder="Designation" /></SelectTrigger>
              <SelectContent>{designations.map((d: any) => <SelectItem key={d._id} value={d._id}>{d.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={employeeForm.managerId || "none"} onValueChange={(value) => setEmployeeForm({ ...employeeForm, managerId: value === "none" ? "" : value })}>
              <SelectTrigger><SelectValue placeholder="Manager" /></SelectTrigger>
              <SelectContent><SelectItem value="none">No Manager</SelectItem>{managers.map((m: any) => <SelectItem key={m._id} value={m._id}>{m.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={employeeForm.leaveApprovalFlowId || "none"} onValueChange={(value) => setEmployeeForm({ ...employeeForm, leaveApprovalFlowId: value === "none" ? "" : value })}>
              <SelectTrigger><SelectValue placeholder="Leave Approval Flow" /></SelectTrigger>
              <SelectContent><SelectItem value="none">Use Organization Default</SelectItem>{leaveApprovalFlows.map((flow: any) => <SelectItem key={flow._id} value={flow._id}>{flow.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={employeeForm.attendanceApprovalFlowId || "none"} onValueChange={(value) => setEmployeeForm({ ...employeeForm, attendanceApprovalFlowId: value === "none" ? "" : value })}>
              <SelectTrigger><SelectValue placeholder="Attendance Request Flow" /></SelectTrigger>
              <SelectContent><SelectItem value="none">Use Organization Default</SelectItem>{attendanceApprovalFlows.map((flow: any) => <SelectItem key={flow._id} value={flow._id}>{flow.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={employeeForm.shiftId || "none"} onValueChange={(value) => setEmployeeForm({ ...employeeForm, shiftId: value === "none" ? "" : value })}>
              <SelectTrigger><SelectValue placeholder="Shift" /></SelectTrigger>
              <SelectContent><SelectItem value="none">No Shift</SelectItem>{shifts.map((s: any) => <SelectItem key={s._id} value={s._id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={employeeForm.employmentType} onValueChange={(value) => setEmployeeForm({ ...employeeForm, employmentType: value })}>
              <SelectTrigger><SelectValue placeholder="Employment Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="full_time">Full Time</SelectItem>
                <SelectItem value="part_time">Part Time</SelectItem>
                <SelectItem value="contract">Contract</SelectItem>
              </SelectContent>
            </Select>
            <Input type="date" value={employeeForm.dateOfJoining} onChange={(e) => setEmployeeForm({ ...employeeForm, dateOfJoining: e.target.value })} />
            <div className="md:col-span-2">
              <p className="mb-2 text-sm text-muted-foreground">Roles</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {roles.map((role: any) => (
                  <label key={role._id} className="flex items-center gap-2 text-sm border rounded-md p-2">
                    <Checkbox
                      checked={employeeForm.roleIds.includes(role._id)}
                      onCheckedChange={(checked) =>
                        setEmployeeForm((prev) => ({
                          ...prev,
                          roleIds: checked
                            ? Array.from(new Set([...prev.roleIds, role._id]))
                            : prev.roleIds.filter((id) => id !== role._id)
                        }))
                      }
                    />
                    <span>{role.name}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-5">
            <Button onClick={submitEmployeeForm} disabled={formSaving}>
              {formSaving ? "Saving..." : formMode === "edit" ? "Update Employee" : "Create Employee"}
            </Button>
            <Button variant="outline" onClick={cancelForm}>Cancel</Button>
          </div>
        </div>
      )}

      {!formMode && (
      <motion.div
        className="bg-card rounded-xl card-shadow overflow-hidden flex flex-col max-h-[72vh] lg:h-[calc(100vh-240px)]"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        {loading && employees.length === 0 && (
          <div className="p-5 space-y-3">
            {Array.from({ length: 10 }).map((_, idx) => (
              <div key={`emp-skeleton-${idx}`} className="grid grid-cols-6 gap-3">
                <Skeleton className="h-10 w-full rounded-md col-span-2" />
                <Skeleton className="h-10 w-full rounded-md" />
                <Skeleton className="h-10 w-full rounded-md" />
                <Skeleton className="h-10 w-full rounded-md" />
                <Skeleton className="h-10 w-full rounded-md" />
              </div>
            ))}
          </div>
        )}
        {(!loading || employees.length > 0) && (
          <div className="min-h-0 flex-1">
          <DataTable
            columns={columns}
            data={employees}
            rowKey="_id"
            hideFooter
            tableClassName="min-w-[1650px]"
            containerClassName="h-full border-0 rounded-none shadow-none bg-transparent"
            viewportClassName="h-full overflow-y-auto overflow-x-auto [&>div]:overflow-visible"
            viewportRef={tableViewportRef}
            onViewportScroll={handleTableScroll}
            columnsCountOverride={tableColumnCount}
            renderHeader={() => (
              <TableRow className="table-header sticky top-0 z-30 bg-card">
                <TableHead className="sticky top-0 left-0 z-40 bg-card min-w-[300px]">
                  <div className="flex items-center gap-3">
                    {canEdit && (
                      <Checkbox
                        checked={allVisibleSelected}
                        onCheckedChange={(value) => toggleSelectAllVisible(Boolean(value))}
                      />
                    )}
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 cursor-pointer select-none"
                      onClick={() => toggleSort("firstName")}
                    >
                      <span>Employee</span>
                      <ArrowUpDown className={`w-3.5 h-3.5 ${sortBy === "firstName" ? "opacity-100" : "opacity-40"}`} />
                    </button>
                  </div>
                </TableHead>
                {renderSortableHead("Email")}
                {renderSortableHead("Phone")}
                {renderSortableHead("Department")}
                {renderSortableHead("Designation")}
                {renderSortableHead("Roles")}
                {renderSortableHead("Manager")}
                {renderSortableHead("Shift")}
                {renderSortableHead("Employment Type")}
                {renderSortableHead("Status", "status")}
                {renderSortableHead("Lifecycle", "employmentLifecycleStatus")}
                {renderSortableHead("Benefits")}
                {renderSortableHead("Profile")}
                {renderSortableHead("Join Date", "dateOfJoining")}
                {canAnyAction && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            )}
            renderRow={(employee) => (
              <>
                <TableCell className="sticky left-0 z-10 bg-card">
                  <div className="flex items-center gap-3">
                    {canEdit && (
                      <Checkbox
                        checked={selectedEmployeeIds.includes(getEmployeeId(employee))}
                        onCheckedChange={(value) => toggleSelectOne(getEmployeeId(employee), Boolean(value))}
                      />
                    )}
                    <button
                      type="button"
                      className="flex items-center gap-3 text-left"
                      onClick={() => navigate(`/employees/edit/${employee._id}`)}
                    >
                      <Avatar>
                        <AvatarImage src={employee.profileImage || ""} />
                        <AvatarFallback>
                          {`${employee.firstName?.[0] || ""}${employee.lastName?.[0] || ""}`}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium hover:text-primary">
                          {employee.firstName} {employee.lastName}
                        </p>
                        <p className="text-sm text-muted-foreground">{employee.employeeCode}</p>
                      </div>
                    </button>
                  </div>
                </TableCell>
                <TableCell>{employee.userId?.email || "-"}</TableCell>
                <TableCell>{employee.phone || "-"}</TableCell>
                <TableCell>{employee.departmentId?.name || "-"}</TableCell>
                <TableCell>{employee.designationId?.name || "-"}</TableCell>
                <TableCell>
                  {Array.isArray(employee.roleIds) && employee.roleIds.length
                    ? employee.roleIds.map((role: any) => role?.name).filter(Boolean).join(", ")
                    : "-"}
                </TableCell>
                <TableCell>
                  {employee.managerId
                    ? `${employee.managerId?.firstName || ""} ${employee.managerId?.lastName || ""}`.trim()
                    : "-"}
                </TableCell>
                <TableCell>{employee.shiftId?.name || "-"}</TableCell>
                <TableCell>{employee.employmentType || "-"}</TableCell>
                <TableCell>{getStatusBadge(employee.status, Boolean(employee.isDeleted))}</TableCell>
                <TableCell>{getLifecycleBadge(employee.employmentLifecycleStatus)}</TableCell>
                <TableCell>{employee.benefitsEligible ? "Eligible" : "Not Eligible"}</TableCell>
                <TableCell>{employee.profileCompleted ? "Completed" : "Pending"}</TableCell>
                <TableCell>
                  {employee.dateOfJoining
                    ? formatDateInOrgTimeZone(employee.dateOfJoining)
                    : "-"}
                </TableCell>
                {canAnyAction && (
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <PermissionGate permissions={["EMP_VIEW"]}>
                          <DropdownMenuItem onClick={() => navigate(`/employees/edit/${employee._id}`)}>
                            <Eye className="w-4 h-4 mr-2" /> View
                          </DropdownMenuItem>
                        </PermissionGate>
                        <PermissionGate permissions={["EMP_UPDATE"]}>
                          <DropdownMenuItem
                            onClick={() => navigate(`/employees/edit/${employee._id}?edit=true`)}
                          >
                            <Edit className="w-4 h-4 mr-2" /> Edit
                          </DropdownMenuItem>
                        </PermissionGate>
                        <PermissionGate permissions={["EMP_UPDATE"]}>
                          <DropdownMenuItem
                            onClick={async () => {
                              const res = await putApiWithToken(`/employees/${employee._id}/reopen-profile`, {});
                              if (res?.success) {
                                toast.success("Profile form enabled for employee");
                                patchEmployeeInList(employee._id, { profileCompleted: false });
                              } else {
                                toast.error(res?.message || "Failed to enable profile form");
                              }
                            }}
                          >
                            <Edit className="w-4 h-4 mr-2" /> Enable Details Form
                          </DropdownMenuItem>
                        </PermissionGate>
                        {canManageEmployeeStatus && (
                          <PermissionGate permissions={["EMP_UPDATE"]}>
                            <DropdownMenuItem onClick={() => handleStatusAction(employee)}>
                              {isEmployeeInactive(employee) ? (
                                <UserCheck className="w-4 h-4 mr-2 text-emerald-600" />
                              ) : (
                                <UserX className="w-4 h-4 mr-2 text-amber-500" />
                              )}
                              {isEmployeeInactive(employee) ? "Mark Active" : "Mark Inactive"}
                            </DropdownMenuItem>
                          </PermissionGate>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                )}
              </>
            )}
          />
          </div>
        )}
        <div className="sticky bottom-0 z-20 border-t bg-card px-4 py-3">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <p className="text-sm text-muted-foreground">
                Showing {employees.length} of {totalItems} employees
              </p>
              <Select
                value={String(pageSize)}
                onValueChange={(value) => setPageSize(Number(value))}
              >
                <SelectTrigger className="w-[130px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10 rows</SelectItem>
                  <SelectItem value="20">20 rows</SelectItem>
                  <SelectItem value="30">30 rows</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-sm text-muted-foreground">
              {loading && employees.length > 0
                ? "Loading employees..."
                : loadingMore
                  ? "Loading more employees..."
                : hasMoreEmployees
                  ? "Scroll down to load more"
                  : "You have reached the end"}
            </p>
          </div>
        </div>
      </motion.div>
      )}

      <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isEmployeeInactive(selectedEmployee) ? "Mark Employee Active" : "Mark Employee Inactive"}
            </DialogTitle>
            <DialogDescription>
              {isEmployeeInactive(selectedEmployee)
                ? "This employee will become active again and appear as active across HR flows."
                : "This employee will be marked inactive instead of being deleted."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmStatusChange}>
              {isEmployeeInactive(selectedEmployee) ? "Mark Active" : "Mark Inactive"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
};

export default Employees;
