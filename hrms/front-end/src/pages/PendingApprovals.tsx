import { useEffect, useMemo, useRef, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { DataTable, type Column } from "@/components/ui/DataTable";
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
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { RefreshCw, Search, Users, ClipboardList, Clock3, Sparkles, Eye, AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { getApiWithToken, putApiWithToken } from "@/services/apiWrapper";
import { useAuth } from "@/context/useAuth";
import { toast } from "sonner";
import { formatDateKeyInOrgCalendar, toDateKeyInOrgCalendar } from "@/utils/timezone";

const toIdString = (value: unknown): string => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((item) => Number.isInteger(item))) {
    return value.map((item) => Number(item).toString(16).padStart(2, "0")).join("");
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record._actionId === "string") return record._actionId;
    if (record._id) return toIdString(record._id);
    if (record.id) return toIdString(record.id);
    if (typeof record.$oid === "string") return record.$oid;
    if (record.buffer) return toIdString(record.buffer);
    if (record.type === "Buffer" && record.data) return toIdString(record.data);
    if (Array.isArray(record.data)) return toIdString(record.data);
    if (typeof (record as { toHexString?: unknown }).toHexString === "function") {
      return String((record as { toHexString: () => string }).toHexString());
    }
    if (typeof record.toString === "function" && record.toString !== Object.prototype.toString) {
      const asString = record.toString();
      if (asString && asString !== "[object Object]") return asString;
    }
  }
  return String(value);
};

const getAttendanceRequestId = (request: any) => toIdString(request?._actionId || request?._id || request?.id || request);

const normalizeAttendanceRequestRecord = (row: any) => {
  const requestId = getAttendanceRequestId(row);
  return {
    ...row,
    date: row?.date ? toDateKeyInOrgCalendar(row.date) : row?.date,
    _id: requestId,
    _actionId: requestId
  };
};

const mergeAttendanceRequestPages = (existing: any[], incoming: any[]) => {
  const merged = new Map<string, any>();
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

const getStatusBadge = (status: string) => {
  if (status === "approved") return <Badge className="status-badge status-active">Approved</Badge>;
  if (status === "rejected") return <Badge className="status-badge status-rejected">Rejected</Badge>;
  return <Badge className="status-badge status-pending">Pending</Badge>;
};

const getEmployeeName = (row: any) =>
  row?.employeeId ? `${row.employeeId.firstName || ""} ${row.employeeId.lastName || ""}`.trim() : "-";

const getRequestTypeLabel = (requestType: string | null | undefined) =>
  String(requestType || "").replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()) || "-";

type ApprovalTableRow = {
  id: string;
  employee: string;
  dateKey: string;
  dateLabel: string;
  type: string;
  requestedTime: string;
  status: string;
  request: any;
};

const PendingApprovals = () => {
  const { hasAnyPermission } = useAuth();
  const canAttendanceAction = hasAnyPermission(["ATTENDANCE_MANAGE"]);
  const canViewAny = canAttendanceAction;
  const currentMonthKey = useMemo(() => toDateKeyInOrgCalendar(new Date()).slice(0, 7), []);

  const [attendanceRows, setAttendanceRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [requestTypeFilter, setRequestTypeFilter] = useState("all");
  const [requestDateFilter, setRequestDateFilter] = useState(currentMonthKey);
  const [selectedRequest, setSelectedRequest] = useState<any | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const tableViewportRef = useRef<HTMLDivElement | null>(null);
  const loadingMoreRef = useRef(false);
  const resetPaginationRef = useRef(false);

  const loadAttendanceApprovals = async (pageToLoad = 1) => {
    if (!canAttendanceAction) {
      setAttendanceRows([]);
      setCurrentPage(1);
      setTotalPages(1);
      setTotalItems(0);
      return;
    }
    if (pageToLoad > 1) {
      setLoadingMore(true);
    }
    const attendanceRes = await getApiWithToken(`/timesheets/attendance/requests/pending/my-approvals?page=${pageToLoad}&limit=20`, null, {
      requiredPermissions: ["ATTENDANCE_MANAGE"]
    });
    if (attendanceRes?.success) {
      const payload = attendanceRes.data;
      const nextItems = (Array.isArray(payload) ? payload : (payload?.items || []))
        .map((row: any) => normalizeAttendanceRequestRecord(row));
      const pagination = Array.isArray(payload)
        ? { page: 1, totalPages: 1, total: nextItems.length }
        : payload?.pagination;
      setAttendanceRows((prev) => (pageToLoad > 1 ? mergeAttendanceRequestPages(prev, nextItems) : nextItems));
      setCurrentPage(Number(pagination?.page || pageToLoad));
      setTotalPages(Math.max(1, Number(pagination?.totalPages || 1)));
      setTotalItems(Number(pagination?.total || nextItems.length));
    } else {
      if (pageToLoad === 1) {
        setAttendanceRows([]);
        setCurrentPage(1);
        setTotalPages(1);
        setTotalItems(0);
      }
    }
    loadingMoreRef.current = false;
    setLoadingMore(false);
  };

  const loadData = async () => {
    if (!canViewAny) return;
    setLoading(true);
    try {
      await loadAttendanceApprovals();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (resetPaginationRef.current && currentPage !== 1) {
      return;
    }
    if (resetPaginationRef.current && currentPage === 1) {
      resetPaginationRef.current = false;
    }
    loadAttendanceApprovals(currentPage);
  }, [currentPage]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      setAttendanceRows([]);
      if (currentPage === 1) {
        await loadData();
      } else {
        setCurrentPage(1);
      }
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    resetPaginationRef.current = true;
    loadingMoreRef.current = false;
    if (tableViewportRef.current) {
      tableViewportRef.current.scrollTop = 0;
    }
    setAttendanceRows([]);
    setCurrentPage(1);
  }, [canAttendanceAction, canViewAny]);

  const actionAttendance = async (requestRow: any, status: "approved" | "rejected") => {
    const id = getAttendanceRequestId(requestRow);
    if (!id || id === "[object Object]") {
      toast.error("Invalid attendance request id");
      return;
    }
    if (
      status === "approved"
      && requestRow.calendarDayType
      && requestRow.calendarDayType !== "working_day"
    ) {
      const confirmed = window.confirm(
        `This request is for ${requestRow.calendarDayLabel || getRequestTypeLabel(requestRow.calendarDayType)}. Confirm that the employee actually worked on this non-working day.`
      );
      if (!confirmed) return;
    }
    const rejectionReason = status === "rejected"
      ? (window.prompt("Enter rejection reason") || "").trim()
      : "";
    if (status === "rejected" && !rejectionReason) return;

    const res = await putApiWithToken(
      `/timesheets/attendance/requests/${id}/action`,
      {
        status,
        rejectionReason
      },
      null,
      { requiredPermissions: ["ATTENDANCE_MANAGE"] }
    );
    if (res?.success) {
      toast.success(`Attendance request ${status}`);
      loadData();
    } else {
      toast.error(res?.message || "Failed to action attendance request");
    }
  };

  const filteredAttendanceRows = useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase();

    return attendanceRows.filter((row) => {
      const employeeName = getEmployeeName(row).toLowerCase();
      const requestType = String(row.requestType || "").toLowerCase();
      const reason = String(row.reason || "").toLowerCase();
      const requestedTime = `${row.requestedCheckInTime || "-"} ${row.requestedCheckOutTime || "-"}`.toLowerCase();
      const formattedDate = String(row.date || "");

      const matchesSearch =
        !normalizedSearch
        || employeeName.includes(normalizedSearch)
        || requestType.includes(normalizedSearch)
        || reason.includes(normalizedSearch)
        || requestedTime.includes(normalizedSearch)
        || formattedDate.includes(normalizedSearch);

      const matchesType = requestTypeFilter === "all" || requestType === requestTypeFilter;
      const matchesDate = !requestDateFilter || formattedDate.startsWith(requestDateFilter);

      return matchesSearch && matchesType && matchesDate;
    });
  }, [attendanceRows, requestDateFilter, requestTypeFilter, searchText]);

  const tableRows = useMemo<ApprovalTableRow[]>(() => {
    return filteredAttendanceRows.map((row) => ({
      id: row._actionId || row._id || row.id,
      employee: getEmployeeName(row),
      dateKey: String(row.date || ""),
      dateLabel: formatDateKeyInOrgCalendar(row.date),
      type: getRequestTypeLabel(row.requestType),
      requestedTime: `${row.requestedCheckInTime || "-"} / ${row.requestedCheckOutTime || "-"}`,
      status: String(row.status || "pending"),
      request: row
    }));
  }, [filteredAttendanceRows]);

  const kpis = useMemo(() => {
    const uniqueEmployees = new Set(
      filteredAttendanceRows
        .map((row) => getEmployeeName(row))
        .filter((name) => name && name !== "-")
    ).size;

    return {
      total: filteredAttendanceRows.length,
      uniqueEmployees,
      missedCheckout: filteredAttendanceRows.filter((row) => row.requestType === "missed_checkout").length,
      corrections: filteredAttendanceRows.filter((row) => row.requestType === "correction").length
    };
  }, [filteredAttendanceRows]);

  const hasMoreApprovals = currentPage < totalPages;

  const handleApprovalsScroll = () => {
    const viewport = tableViewportRef.current;
    if (
      !viewport
      || loading
      || loadingMore
      || loadingMoreRef.current
      || !hasMoreApprovals
    ) {
      return;
    }
    const { scrollTop, scrollHeight, clientHeight } = viewport;
    if (scrollTop <= 0 || scrollHeight <= clientHeight) return;
    const progress = (scrollTop + clientHeight) / scrollHeight;
    if (progress < 0.6) return;
    loadingMoreRef.current = true;
    setCurrentPage((prev) => {
      if (prev >= totalPages) {
        loadingMoreRef.current = false;
        return prev;
      }
      return prev + 1;
    });
  };

  const approvalColumns = useMemo<Column<ApprovalTableRow>[]>(() => ([
    {
      header: "Employee",
      accessor: "employee",
      sortable: true,
      className: "min-w-[220px] font-medium"
    },
    {
      header: "Date",
      accessor: "dateKey",
      sortable: true,
      render: (row) => (
        <div className="space-y-1.5">
          <div>{row.dateLabel}</div>
          {row.request.calendarDayType === "week_off" && (
            <Badge className="border-amber-300 bg-amber-100 text-amber-800 hover:bg-amber-100">
              Week Off
            </Badge>
          )}
          {row.request.calendarDayType === "holiday" && (
            <Badge className="border-amber-300 bg-amber-100 text-amber-800 hover:bg-amber-100">
              Holiday{row.request.holidayName ? `: ${row.request.holidayName}` : ""}
            </Badge>
          )}
        </div>
      ),
      className: "min-w-[140px]"
    },
    {
      header: "Type",
      accessor: "type",
      sortable: true,
      className: "min-w-[180px]"
    },
    {
      header: "Requested Time",
      accessor: "requestedTime",
      className: "min-w-[180px]"
    },
    {
      header: "Status",
      accessor: "status",
      sortable: true,
      render: (row) => getStatusBadge(row.status),
      className: "min-w-[140px]"
    },
    {
      header: "Actions",
      accessor: "id",
      render: (row) => (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="gap-2" onClick={() => setSelectedRequest(row.request)}>
            <Eye className="h-4 w-4" />
            View
          </Button>
          <Button size="sm" onClick={() => actionAttendance(row.request, "approved")}>Approve</Button>
          <Button size="sm" variant="outline" onClick={() => actionAttendance(row.request, "rejected")}>Reject</Button>
        </div>
      ),
      className: "min-w-[280px]"
    }
  ]), []);

  return (
    <MainLayout
      title="Pending Approvals"
      breadcrumb={[{ label: "Home", href: "/" }, { label: "Pending Approvals" }]}
    >
      {!canViewAny && (
        <div className="bg-card rounded-xl card-shadow p-6 text-sm text-muted-foreground">
          You do not have permission to view approvals.
        </div>
      )}

      {canViewAny && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4 mb-4">
            {[
              {
                label: "Total Pending",
                value: kpis.total,
                note: requestDateFilter ? `For ${requestDateFilter}` : "Requests waiting for your action",
                icon: ClipboardList,
                shell: "from-teal-500/15 via-emerald-500/10 to-white",
                accent: "bg-teal-500/15 text-teal-700 border-teal-200",
                glow: "shadow-[0_20px_45px_-30px_rgba(14,165,233,0.55)]"
              },
              {
                label: "Employees",
                value: kpis.uniqueEmployees,
                note: "Unique employees in queue",
                icon: Users,
                shell: "from-amber-500/15 via-orange-500/10 to-white",
                accent: "bg-amber-500/15 text-amber-700 border-amber-200",
                glow: "shadow-[0_20px_45px_-30px_rgba(139,92,246,0.55)]"
              },
              {
                label: "Missed Checkout",
                value: kpis.missedCheckout,
                note: "Checkout regularization requests",
                icon: Clock3,
                shell: "from-amber-500/20 via-orange-500/10 to-white",
                accent: "bg-amber-500/15 text-amber-700 border-amber-200",
                glow: "shadow-[0_20px_45px_-30px_rgba(245,158,11,0.6)]"
              },
              {
                label: "Corrections",
                value: kpis.corrections,
                note: "Check-in or check-out corrections",
                icon: Sparkles,
                shell: "from-emerald-500/15 via-teal-500/10 to-white",
                accent: "bg-emerald-500/15 text-emerald-700 border-emerald-200",
                glow: "shadow-[0_20px_45px_-30px_rgba(16,185,129,0.55)]"
              }
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.label}
                  className={`relative overflow-hidden rounded-2xl border border-white/70 bg-gradient-to-br ${item.shell} p-4 backdrop-blur-sm ${item.glow}`}
                >
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.9),transparent_42%)] pointer-events-none" />
                  <div className="relative flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-slate-600">{item.label}</p>
                      <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{item.value}</p>
                      <p className="text-xs text-slate-500 mt-2">{item.note}</p>
                    </div>
                    <div className={`rounded-xl border p-2.5 backdrop-blur-sm ${item.accent}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-col gap-3 mb-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3 flex-1">
              <div className="relative">
                <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                <Input
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="Search employee, type, reason or date"
                  className="pl-9"
                />
              </div>

              <Select value={requestTypeFilter} onValueChange={setRequestTypeFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="missed_checkout">Missed Checkout</SelectItem>
                  <SelectItem value="correction">Correction</SelectItem>
                  <SelectItem value="work_from_home">Work From Home</SelectItem>
                </SelectContent>
              </Select>

              <Input
                type="month"
                value={requestDateFilter}
                onChange={(event) => setRequestDateFilter(event.target.value)}
              />
            </div>

            <div className="flex flex-wrap gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setSearchText("");
                  setRequestTypeFilter("all");
                  setRequestDateFilter(currentMonthKey);
                }}
                disabled={!searchText && requestTypeFilter === "all" && requestDateFilter === currentMonthKey}
              >
                Clear Filters
              </Button>

              <Button
                variant="outline"
                className="gap-2"
                onClick={handleRefresh}
                disabled={loading || refreshing}
              >
                <RefreshCw className={`w-4 h-4 ${loading || refreshing ? "animate-spin" : ""}`} />
                {loading || refreshing ? "Refreshing..." : "Refresh"}
              </Button>
            </div>
          </div>

          <div className="mb-4 text-sm text-muted-foreground">
            Showing <span className="font-medium text-foreground">{tableRows.length}</span> of{" "}
            <span className="font-medium text-foreground">{totalItems || attendanceRows.length}</span> pending attendance approvals.
          </div>

          {canAttendanceAction && (
            <div className="rounded-2xl border border-white/70 bg-card/95 card-shadow overflow-hidden backdrop-blur-sm">
              <div className="px-6 py-4 border-b border-border">
                <h3 className="text-lg font-semibold">Attendance Approvals Assigned To Me</h3>
              </div>
              {loading ? (
                <div className="p-6 space-y-3">
                  {Array.from({ length: 4 }).map((_, idx) => (
                    <Skeleton key={`attendance-approval-skeleton-${idx}`} className="h-12 w-full" />
                  ))}
                </div>
              ) : (
                <DataTable
                  columns={approvalColumns}
                  data={tableRows}
                  rowKey="id"
                  tableClassName="w-full min-w-[960px] border-collapse"
                  containerClassName="rounded-none border-0 shadow-none bg-transparent"
                  viewportClassName="max-h-[62vh]"
                  viewportRef={tableViewportRef}
                  onViewportScroll={handleApprovalsScroll}
                  hideFooter
                />
              )}
              {!loading && (
                <div className="flex items-center justify-between border-t border-border px-6 py-3 text-xs text-muted-foreground">
                  <span>
                    Showing {tableRows.length} of {totalItems || attendanceRows.length} pending attendance approvals
                  </span>
                  {loadingMore && <span>Loading more...</span>}
                </div>
              )}
            </div>
          )}

          <Dialog open={Boolean(selectedRequest)} onOpenChange={(open) => !open && setSelectedRequest(null)}>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>Attendance Request Details</DialogTitle>
              </DialogHeader>
              {selectedRequest && (
                <div className="space-y-3 text-sm overflow-hidden">
                  {selectedRequest.calendarDayType !== "working_day" && (
                    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${
                      selectedRequest.calendarDayType === "holiday"
                        ? "border-amber-300 bg-amber-50 text-amber-900"
                        : "border-amber-300 bg-amber-50 text-amber-900"
                    }`}>
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <div>
                        <p className="font-semibold">
                          {selectedRequest.calendarDayLabel || getRequestTypeLabel(selectedRequest.calendarDayType)}
                        </p>
                        <p className="text-xs">
                          This is a non-working day. Approve only if the employee actually worked.
                        </p>
                      </div>
                    </div>
                  )}
                  <p><span className="font-medium">Employee:</span> {getEmployeeName(selectedRequest)}</p>
                  <p><span className="font-medium">Date:</span> {formatDateKeyInOrgCalendar(selectedRequest.date)}</p>
                  <p><span className="font-medium">Type:</span> {getRequestTypeLabel(selectedRequest.requestType)}</p>
                  {selectedRequest.requestType === "work_from_home" && (
                    <p><span className="font-medium">WFH Portion:</span> {getRequestTypeLabel(selectedRequest.dayPortion || "full_day")}</p>
                  )}
                  <p><span className="font-medium">Requested Check-in:</span> {selectedRequest.requestedCheckInTime || "-"}</p>
                  <p><span className="font-medium">Requested Check-out:</span> {selectedRequest.requestedCheckOutTime || "-"}</p>
                  <p><span className="font-medium">Status:</span> {getRequestTypeLabel(selectedRequest.status)}</p>
                  <div className="space-y-1">
                    <p className="font-medium">Reason:</p>
                    <div className="max-h-48 overflow-y-auto rounded-lg border bg-muted/30 px-3 py-2 text-sm whitespace-pre-wrap break-all">
                      {selectedRequest.reason || "-"}
                    </div>
                  </div>
                  {selectedRequest.rejectionReason && (
                    <div className="space-y-1">
                      <p className="font-medium">Rejection Reason:</p>
                      <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm whitespace-pre-wrap break-all">
                        {selectedRequest.rejectionReason}
                      </div>
                    </div>
                  )}
                </div>
              )}
              <DialogFooter className="pt-2">
                <Button variant="outline" onClick={() => setSelectedRequest(null)}>
                  Close
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </MainLayout>
  );
};

export default PendingApprovals;
