import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CalendarDays, CircleCheck, Clock3, Wallet } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { getApiWithToken } from "@/services/apiWrapper";
import { toast } from "sonner";
import { formatDateInOrgTimeZone } from "@/utils/timezone";

type EmployeeRecord = {
  _id?: string;
  firstName?: string;
  lastName?: string;
  employeeCode?: string;
  departmentId?: { name?: string } | null;
  designationId?: { name?: string } | null;
};

type LeaveBalance = {
  leaveTypeId?: string;
  leaveType?: string;
  total?: number;
  used?: number;
  pending?: number;
  remaining?: number;
};

type LeaveRecord = {
  _id?: string;
  status?: string;
  fromDate?: string;
  toDate?: string;
  createdAt?: string;
  totalDays?: number;
  duration?: string;
  reason?: string;
  leaveTypeId?: { name?: string; code?: string } | null;
};

const shiftDays = (value: Date, delta: number) => {
  const next = new Date(value);
  next.setDate(next.getDate() + delta);
  return next;
};

const toDateInput = (value: Date) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const EmployeeLeaveDetails = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();

  const [employee, setEmployee] = useState<EmployeeRecord | null>(null);
  const [leaveBalances, setLeaveBalances] = useState<LeaveBalance[]>([]);
  const [leaveRows, setLeaveRows] = useState<LeaveRecord[]>([]);
  const [period, setPeriod] = useState<"weekly" | "monthly">("monthly");
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const endDate = new Date();
      const startDate = period === "weekly" ? shiftDays(endDate, -6) : shiftDays(endDate, -29);
      const leaveParams = new URLSearchParams({
        employeeId: id,
        page: "1",
        limit: "100"
      });

      const [employeeRes, balanceRes, leaveRes] = await Promise.all([
        getApiWithToken(`/employees/${id}`),
        getApiWithToken(`/leave-balances/employee/${encodeURIComponent(id)}`),
        getApiWithToken(`/leaves?${leaveParams.toString()}`)
      ]);

      if (!employeeRes?.success) {
        toast.error(employeeRes?.message || "Failed to load employee");
        return;
      }
      if (!balanceRes?.success) {
        toast.error(balanceRes?.message || "Failed to load leave balance");
        return;
      }
      if (!leaveRes?.success) {
        toast.error(leaveRes?.message || "Failed to load leave history");
        return;
      }

      const allLeaves = leaveRes?.data?.items || [];
      const filteredLeaves = allLeaves.filter((leave: LeaveRecord) => {
        const compareDate = new Date(leave.createdAt || leave.fromDate || "");
        return compareDate >= startDate && compareDate <= endDate;
      });

      setEmployee(employeeRes.data || null);
      setLeaveBalances(balanceRes.data || []);
      setLeaveRows(filteredLeaves);
    } finally {
      setLoading(false);
    }
  }, [id, period]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const employeeName = `${employee?.firstName || ""} ${employee?.lastName || ""}`.trim() || "Employee";
  const backTarget = (location.state as { from?: string } | null)?.from || "/dashboard";

  const leaveSummary = useMemo(() => {
    const pending = leaveRows.filter((leave) => leave.status === "pending").length;
    const approved = leaveRows.filter((leave) => leave.status === "approved").length;
    const rejected = leaveRows.filter((leave) => leave.status === "rejected").length;
    const units = leaveRows.reduce((sum, leave) => sum + Number(leave.totalDays || 0), 0);
    return { pending, approved, rejected, units: Number(units.toFixed(1)) };
  }, [leaveRows]);

  const leaveStatusGraph = useMemo(
    () => [
      { label: "Approved", value: leaveSummary.approved, fill: "#22c55e" },
      { label: "Pending", value: leaveSummary.pending, fill: "#f59e0b" },
      { label: "Rejected", value: leaveSummary.rejected, fill: "#ef4444" }
    ],
    [leaveSummary]
  );

  const leaveTrend = useMemo(() => {
    return [...leaveRows]
      .sort((a, b) => new Date(a.fromDate || a.createdAt || "").getTime() - new Date(b.fromDate || b.createdAt || "").getTime())
      .map((leave) => ({
        date: formatDateInOrgTimeZone(leave.fromDate || leave.createdAt || "", { month: "short", day: "numeric" }),
        days: Number(leave.totalDays || 0),
        approved: leave.status === "approved" ? Number(leave.totalDays || 0) : 0,
        pending: leave.status === "pending" ? Number(leave.totalDays || 0) : 0,
        rejected: leave.status === "rejected" ? Number(leave.totalDays || 0) : 0
      }));
  }, [leaveRows]);

  return (
    <MainLayout
      title="Leave Details"
      breadcrumb={[
        { label: "Home", href: "/" },
        { label: "Dashboard", href: "/dashboard" },
        { label: "Leave Details" }
      ]}
    >
      <div className="flex flex-col gap-4 mb-6 md:flex-row md:items-center md:justify-between">
        <button
          onClick={() => navigate(backTarget)}
          className="flex items-center gap-2 text-muted-foreground"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </button>

        <Tabs value={period} onValueChange={(value) => setPeriod(value as "weekly" | "monthly")}>
          <TabsList className="grid grid-cols-2 w-[220px]">
            <TabsTrigger value="weekly">Weekly</TabsTrigger>
            <TabsTrigger value="monthly">Monthly</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-28 w-full rounded-xl" />
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, idx) => (
              <Skeleton key={idx} className="h-28 w-full rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      ) : (
        <>
          <div className="stat-card mb-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-2xl font-semibold">{employeeName}</h2>
                  <Badge variant="outline">{period === "weekly" ? "Last 7 Days" : "Last 30 Days"}</Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  {employee?.employeeCode || "-"} • {employee?.departmentId?.name || "Unassigned"} • {employee?.designationId?.name || "-"}
                </p>
              </div>
              <Button variant="outline" onClick={() => navigate(`/employees/${id}`)}>
                Open Employee Profile
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
            <div className="stat-card">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                <CalendarDays className="w-4 h-4" /> Applied Leaves
              </div>
              <div className="text-2xl font-semibold">{leaveRows.length}</div>
            </div>
            <div className="stat-card">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                <CircleCheck className="w-4 h-4" /> Approved Leaves
              </div>
              <div className="text-2xl font-semibold">{leaveSummary.approved}</div>
            </div>
            <div className="stat-card">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                <Clock3 className="w-4 h-4" /> Pending Leaves
              </div>
              <div className="text-2xl font-semibold">{leaveSummary.pending}</div>
            </div>
            <div className="stat-card">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                <Wallet className="w-4 h-4" /> Leave Units
              </div>
              <div className="text-2xl font-semibold">{leaveSummary.units}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
            <div className="stat-card">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="font-semibold">Leave Status Graph</h3>
                  <p className="text-sm text-muted-foreground">Status split for the selected period</p>
                </div>
                <Badge variant="outline">Overview</Badge>
              </div>
              <ChartContainer
                config={{
                  value: { label: "Requests", color: "#3b82f6" }
                }}
                className="h-[260px] w-full"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={leaveStatusGraph}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} />
                    <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                      {leaveStatusGraph.map((entry) => (
                        <Cell key={entry.label} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            </div>

            <div className="stat-card">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="font-semibold">Leave Usage Trend</h3>
                  <p className="text-sm text-muted-foreground">Leave days consumed across the selected period</p>
                </div>
                <Badge variant="outline">Trend</Badge>
              </div>
              <ChartContainer
                config={{
                  approved: { label: "Approved", color: "#22c55e" },
                  pending: { label: "Pending", color: "#f59e0b" },
                  rejected: { label: "Rejected", color: "#ef4444" }
                }}
                className="h-[260px] w-full"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={leaveTrend}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={24} />
                    <YAxis tickLine={false} axisLine={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Area type="monotone" dataKey="approved" stroke="#22c55e" fill="#22c55e" fillOpacity={0.18} />
                    <Area type="monotone" dataKey="pending" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.18} />
                    <Area type="monotone" dataKey="rejected" stroke="#ef4444" fill="#ef4444" fillOpacity={0.18} />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartContainer>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
            <div className="stat-card">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold">Leave Balances</h3>
                  <p className="text-sm text-muted-foreground">Current entitlement, used, pending, and remaining balance</p>
                </div>
                <Badge variant="outline">{leaveBalances.length} Types</Badge>
              </div>
              <div className="space-y-3">
                {leaveBalances.length === 0 && (
                  <p className="text-sm text-muted-foreground">No leave balance data available.</p>
                )}
                {leaveBalances.map((balance) => (
                  <div key={balance.leaveTypeId || balance.leaveType} className="rounded-xl border p-4">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{balance.leaveType || "-"}</span>
                      <span className="text-muted-foreground">Remaining {balance.remaining || 0}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-4 gap-2 text-xs text-muted-foreground">
                      <div>Total: <span className="font-semibold text-foreground">{balance.total || 0}</span></div>
                      <div>Used: <span className="font-semibold text-foreground">{balance.used || 0}</span></div>
                      <div>Pending: <span className="font-semibold text-foreground">{balance.pending || 0}</span></div>
                      <div>Left: <span className="font-semibold text-foreground">{balance.remaining || 0}</span></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="stat-card">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold">Applied Leaves</h3>
                  <p className="text-sm text-muted-foreground">Detailed leave requests for the selected period</p>
                </div>
                <Badge variant="outline">{leaveRows.length} Records</Badge>
              </div>
              <div className="space-y-3 max-h-[420px] overflow-auto pr-1">
                {leaveRows.length === 0 && (
                  <p className="text-sm text-muted-foreground">No leave records found for this period.</p>
                )}
                {leaveRows.map((leave) => (
                  <div key={leave._id || `${leave.fromDate}-${leave.toDate}`} className="rounded-xl border p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium">{leave.leaveTypeId?.name || "-"}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {leave.fromDate ? formatDateInOrgTimeZone(leave.fromDate) : "-"} to {leave.toDate ? formatDateInOrgTimeZone(leave.toDate) : "-"}
                        </p>
                      </div>
                      <Badge variant="outline" className="capitalize">{leave.status || "-"}</Badge>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                      <div>Days: <span className="font-semibold text-foreground">{leave.totalDays || 0}</span></div>
                      <div>Duration: <span className="font-semibold text-foreground">{leave.duration || "-"}</span></div>
                    </div>
                    {leave.reason && (
                      <p className="text-xs text-muted-foreground mt-3">{leave.reason}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </MainLayout>
  );
};

export default EmployeeLeaveDetails;
