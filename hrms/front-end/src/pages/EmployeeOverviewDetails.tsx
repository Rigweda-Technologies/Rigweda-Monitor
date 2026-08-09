import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Briefcase, CalendarDays, Clock3, User2, Wallet } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getApiWithToken } from "@/services/apiWrapper";
import { toast } from "sonner";
import { formatDateInOrgTimeZone, formatTimeInOrgTimeZone } from "@/utils/timezone";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts";

type EmployeeRecord = {
  _id?: string;
  firstName?: string;
  lastName?: string;
  employeeCode?: string;
  dateOfJoining?: string;
  status?: string;
  employmentLifecycleStatus?: string;
  departmentId?: { name?: string } | null;
  designationId?: { name?: string } | null;
  managerId?: { firstName?: string; lastName?: string } | null;
  email?: string;
};

type AttendanceRow = {
  _id?: string;
  date?: string;
  checkInAt?: string | null;
  checkOutAt?: string | null;
  totalMinutes?: number;
  lateByMinutes?: number;
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
  totalDays?: number;
  leaveTypeId?: { name?: string } | null;
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

const toHours = (minutes?: number) => Number((((minutes || 0) as number) / 60).toFixed(2));

const EmployeeOverviewDetails = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();

  const [employee, setEmployee] = useState<EmployeeRecord | null>(null);
  const [attendanceRows, setAttendanceRows] = useState<AttendanceRow[]>([]);
  const [leaveBalances, setLeaveBalances] = useState<LeaveBalance[]>([]);
  const [leaveRows, setLeaveRows] = useState<LeaveRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const endDate = new Date();
      const startDate = shiftDays(endDate, -29);
      const leaveParams = new URLSearchParams({
        employeeId: id,
        page: "1",
        limit: "20"
      });

      const [employeeRes, attendanceRes, balanceRes, leaveRes] = await Promise.all([
        getApiWithToken(`/employees/${id}`),
        getApiWithToken(`/timesheets/attendance?employeeId=${encodeURIComponent(id)}&startDate=${toDateInput(startDate)}&endDate=${toDateInput(endDate)}`),
        getApiWithToken(`/leave-balances/employee/${encodeURIComponent(id)}`),
        getApiWithToken(`/leaves?${leaveParams.toString()}`)
      ]);

      if (!employeeRes?.success) {
        toast.error(employeeRes?.message || "Failed to load employee");
        return;
      }
      if (!attendanceRes?.success) {
        toast.error(attendanceRes?.message || "Failed to load attendance");
        return;
      }
      if (!balanceRes?.success) {
        toast.error(balanceRes?.message || "Failed to load leave balances");
        return;
      }
      if (!leaveRes?.success) {
        toast.error(leaveRes?.message || "Failed to load leaves");
        return;
      }

      setEmployee(employeeRes.data || null);
      setAttendanceRows(attendanceRes.data || []);
      setLeaveBalances(balanceRes.data || []);
      setLeaveRows(leaveRes.data?.items || []);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const backTarget = (location.state as { from?: string } | null)?.from || "/dashboard";
  const employeeName = `${employee?.firstName || ""} ${employee?.lastName || ""}`.trim() || "Employee";

  const overview = useMemo(() => {
    const attendanceDays = attendanceRows.length;
    const workedHours = attendanceRows.reduce((sum, row) => sum + toHours(row.totalMinutes), 0);
    const lateDays = attendanceRows.filter((row) => Number(row.lateByMinutes || 0) > 0).length;
    const approvedLeaves = leaveRows.filter((leave) => leave.status === "approved").length;
    return {
      attendanceDays,
      workedHours: Number(workedHours.toFixed(2)),
      lateDays,
      approvedLeaves
    };
  }, [attendanceRows, leaveRows]);

  const attendanceTrend = useMemo(
    () =>
      [...attendanceRows]
        .sort((a, b) => new Date(a.date || "").getTime() - new Date(b.date || "").getTime())
        .map((row) => ({
          date: row.date ? formatDateInOrgTimeZone(row.date, { month: "short", day: "numeric" }) : "-",
          hours: toHours(row.totalMinutes),
          late: Number(row.lateByMinutes || 0)
        })),
    [attendanceRows]
  );

  const leaveTrend = useMemo(
    () =>
      [...leaveRows]
        .sort((a, b) => new Date(a.fromDate || "").getTime() - new Date(b.fromDate || "").getTime())
        .map((leave) => ({
          date: leave.fromDate ? formatDateInOrgTimeZone(leave.fromDate, { month: "short", day: "numeric" }) : "-",
          days: Number(leave.totalDays || 0)
        })),
    [leaveRows]
  );

  return (
    <MainLayout
      title="Employee Overview"
      breadcrumb={[
        { label: "Home", href: "/" },
        { label: "Dashboard", href: "/dashboard" },
        { label: "Employee Overview" }
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

        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate(`/dashboard/attendance/${id}`, { state: { from: `/dashboard/employee/${id}` } })}>
            Attendance Details
          </Button>
          <Button variant="outline" onClick={() => navigate(`/dashboard/leaves/${id}`, { state: { from: `/dashboard/employee/${id}` } })}>
            Leave Details
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-28 w-full rounded-xl" />
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, idx) => (
              <Skeleton key={idx} className="h-28 w-full rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-96 w-full rounded-xl" />
        </div>
      ) : (
        <>
          <div className="stat-card mb-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-2xl font-semibold">{employeeName}</h2>
                  <Badge variant="outline" className="capitalize">{employee?.status || "-"}</Badge>
                  <Badge variant="secondary" className="capitalize">{employee?.employmentLifecycleStatus || "confirmed"}</Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  {employee?.employeeCode || "-"} • {employee?.departmentId?.name || "Unassigned"} • {employee?.designationId?.name || "-"}
                </p>
              </div>
              <Button variant="outline" onClick={() => navigate(`/employees/${id}`)}>
                Open Full Profile
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
            <div className="stat-card">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                <User2 className="w-4 h-4" /> Joined On
              </div>
              <div className="text-lg font-semibold">{employee?.dateOfJoining ? formatDateInOrgTimeZone(employee.dateOfJoining) : "-"}</div>
            </div>
            <div className="stat-card">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                <CalendarDays className="w-4 h-4" /> Attendance Days
              </div>
              <div className="text-2xl font-semibold">{overview.attendanceDays}</div>
            </div>
            <div className="stat-card">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                <Clock3 className="w-4 h-4" /> Worked Hours
              </div>
              <div className="text-2xl font-semibold">{overview.workedHours}h</div>
            </div>
            <div className="stat-card">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                <Briefcase className="w-4 h-4" /> Approved Leaves
              </div>
              <div className="text-2xl font-semibold">{overview.approvedLeaves}</div>
            </div>
          </div>

          <Tabs defaultValue="overview" className="space-y-4">
            <TabsList className="grid grid-cols-3 w-full md:w-[420px]">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="attendance">Attendance</TabsTrigger>
              <TabsTrigger value="leaves">Leaves</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4">
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className="stat-card">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="font-semibold">Attendance Trend</h3>
                      <p className="text-sm text-muted-foreground">Last 30 days working hours</p>
                    </div>
                    <Badge variant="outline">Performance</Badge>
                  </div>
                  <ChartContainer config={{ hours: { label: "Hours", color: "#2563eb" } }} className="h-[280px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={attendanceTrend}>
                        <CartesianGrid vertical={false} strokeDasharray="3 3" />
                        <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={24} />
                        <YAxis tickLine={false} axisLine={false} />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Area type="monotone" dataKey="hours" stroke="#2563eb" fill="#2563eb" fillOpacity={0.18} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </ChartContainer>
                </div>

                <div className="stat-card">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="font-semibold">Leave Trend</h3>
                      <p className="text-sm text-muted-foreground">Recent leave units requested</p>
                    </div>
                    <Badge variant="outline">Planning</Badge>
                  </div>
                  <ChartContainer config={{ days: { label: "Leave Days", color: "#22c55e" } }} className="h-[280px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={leaveTrend}>
                        <CartesianGrid vertical={false} strokeDasharray="3 3" />
                        <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={24} />
                        <YAxis tickLine={false} axisLine={false} />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Bar dataKey="days" fill="#22c55e" radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartContainer>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className="stat-card">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="font-semibold">Profile Snapshot</h3>
                      <p className="text-sm text-muted-foreground">Quick employee context from HR records</p>
                    </div>
                  </div>
                  <div className="space-y-3 text-sm">
                    <div className="rounded-lg border p-3">Department: <span className="font-semibold">{employee?.departmentId?.name || "-"}</span></div>
                    <div className="rounded-lg border p-3">Designation: <span className="font-semibold">{employee?.designationId?.name || "-"}</span></div>
                    <div className="rounded-lg border p-3">Manager: <span className="font-semibold">{`${employee?.managerId?.firstName || ""} ${employee?.managerId?.lastName || ""}`.trim() || "-"}</span></div>
                    <div className="rounded-lg border p-3">Email: <span className="font-semibold">{employee?.email || "-"}</span></div>
                  </div>
                </div>

                <div className="stat-card">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="font-semibold">Leave Balances</h3>
                      <p className="text-sm text-muted-foreground">Current leave wallet by leave type</p>
                    </div>
                    <Wallet className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="space-y-3">
                    {leaveBalances.length === 0 && <p className="text-sm text-muted-foreground">No leave balances found.</p>}
                    {leaveBalances.map((balance) => (
                      <div key={balance.leaveTypeId || balance.leaveType} className="rounded-xl border p-4">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{balance.leaveType || "-"}</span>
                          <span className="text-sm text-muted-foreground">Remaining {balance.remaining || 0}</span>
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
              </div>
            </TabsContent>

            <TabsContent value="attendance" className="space-y-4">
              <div className="stat-card">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-semibold">Recent Attendance</h3>
                    <p className="text-sm text-muted-foreground">Last 30 days check-in and check-out history</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => navigate(`/dashboard/attendance/${id}`, { state: { from: `/dashboard/employee/${id}` } })}>
                    Open Detailed Attendance
                  </Button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-3 pr-4 font-medium">Date</th>
                        <th className="py-3 pr-4 font-medium">Check In</th>
                        <th className="py-3 pr-4 font-medium">Check Out</th>
                        <th className="py-3 pr-4 font-medium">Worked</th>
                        <th className="py-3 font-medium">Late</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...attendanceRows]
                        .sort((a, b) => new Date(b.date || "").getTime() - new Date(a.date || "").getTime())
                        .slice(0, 10)
                        .map((row) => (
                          <tr key={row._id || `${row.date}-${row.checkInAt}`} className="border-b last:border-b-0">
                            <td className="py-3 pr-4">{row.date ? formatDateInOrgTimeZone(row.date) : "-"}</td>
                            <td className="py-3 pr-4">{row.checkInAt ? formatTimeInOrgTimeZone(row.checkInAt) : "-"}</td>
                            <td className="py-3 pr-4">{row.checkOutAt ? formatTimeInOrgTimeZone(row.checkOutAt) : "-"}</td>
                            <td className="py-3 pr-4">{toHours(row.totalMinutes)}h</td>
                            <td className="py-3">{Number(row.lateByMinutes || 0)} min</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="leaves" className="space-y-4">
              <div className="stat-card">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-semibold">Recent Leave Records</h3>
                    <p className="text-sm text-muted-foreground">Latest leave requests and statuses</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => navigate(`/dashboard/leaves/${id}`, { state: { from: `/dashboard/employee/${id}` } })}>
                    Open Detailed Leaves
                  </Button>
                </div>
                <div className="space-y-3">
                  {leaveRows.length === 0 && <p className="text-sm text-muted-foreground">No leave records found.</p>}
                  {leaveRows.slice(0, 8).map((leave) => (
                    <div key={leave._id || `${leave.fromDate}-${leave.toDate}`} className="rounded-xl border p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">{leave.leaveTypeId?.name || "-"}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {leave.fromDate ? formatDateInOrgTimeZone(leave.fromDate) : "-"} to {leave.toDate ? formatDateInOrgTimeZone(leave.toDate) : "-"}
                          </p>
                        </div>
                        <Badge variant="outline" className="capitalize">{leave.status || "-"}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}
    </MainLayout>
  );
};

export default EmployeeOverviewDetails;
