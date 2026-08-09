import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, TrendingUp, CalendarDays, Activity } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getApiWithToken } from "@/services/apiWrapper";
import { toast } from "sonner";
import { setOrgTimeZone, formatDateInOrgTimeZone, getOrgTimeZone } from "@/utils/timezone";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts";

type NamedEntity = { _id?: string; name?: string };
type EmployeeRecord = { _id?: string; dateOfJoining?: string; status?: string };
type LeaveRecord = { status?: string; fromDate?: string; toDate?: string; createdAt?: string };
type TimesheetRecord = { status?: string; weekStart?: string; createdAt?: string; submittedAt?: string };
type HolidayRecord = { date?: string };
type NotificationRecord = { createdAt?: string };
type DashboardStats = {
  attendanceTrend?: { key: string; label?: string; present?: number; absent?: number; excluded?: number }[];
  attendanceTrendMonthly?: { key: string; label?: string; present?: number; absent?: number; excluded?: number }[];
};
type SummaryResponse = {
  employeeList?: EmployeeRecord[];
  leaveList?: LeaveRecord[];
  weeklyList?: TimesheetRecord[];
  holidays?: HolidayRecord[];
  notifications?: NotificationRecord[];
  dashboardStats?: DashboardStats | null;
  orgSettings?: { timezone?: string } | null;
};

type TrendPoint = { key: string; label: string; [key: string]: string | number };
type GraphKey = "attendance" | "leaves" | "approvals" | "timesheets" | "lifecycle" | "holidays" | "notifications" | "exceptions";
type GraphSeries = { key: string; label: string; color: string };
type GraphDefinition = { title: string; description: string; weekly: TrendPoint[]; monthly: TrendPoint[]; series: GraphSeries[]; type?: "area" | "bar" };

const shiftDateKey = (dateKey: string, deltaDays: number) => {
  const [year, month, day] = dateKey.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + deltaDays);
  return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, "0")}-${String(utc.getUTCDate()).padStart(2, "0")}`;
};

const buildRecentDateKeys = (endKey: string, days: number) =>
  Array.from({ length: days }).map((_, index) => shiftDateKey(endKey, index - (days - 1)));

const toOrgDateKey = (value: string | number | Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: getOrgTimeZone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(value));
  const read = (type: "year" | "month" | "day") => parts.find((p) => p.type === type)?.value || "00";
  return `${read("year")}-${read("month")}-${read("day")}`;
};

const formatTrendLabel = (dateKey: string, mode: "weekly" | "monthly") =>
  formatDateInOrgTimeZone(new Date(`${dateKey}T12:00:00Z`), mode === "weekly" ? { weekday: "short" } : { month: "short", day: "numeric" });

const DashboardGraphDetails = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { graphKey } = useParams();
  const graph = (graphKey || "attendance") as GraphKey;
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const today = new Date();
      const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
      const res = await getApiWithToken(`/dashboard/summary?month=${month}&year=${today.getFullYear()}`);
      if (!res?.success) {
        toast.error(res?.message || "Failed to load dashboard graph");
        return;
      }
      if (res.data?.orgSettings?.timezone) setOrgTimeZone(res.data.orgSettings.timezone);
      setData(res.data || {});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const todayKey = toOrgDateKey(new Date());
  const definitions = useMemo<Record<GraphKey, GraphDefinition>>(() => {
    const employeeList = data?.employeeList || [];
    const leaveList = data?.leaveList || [];
    const weeklyList = data?.weeklyList || [];
    const holidays = data?.holidays || [];
    const notifications = data?.notifications || [];
    const attendanceTrend = (data?.dashboardStats?.attendanceTrend || []).map((point) => ({
      key: point.key,
      label: String(point.label || formatTrendLabel(point.key, "weekly")),
      present: Number(point.present || 0),
      absent: Number(point.absent || 0),
      excluded: Number(point.excluded || 0)
    }));
    const attendanceTrendMonthly = (data?.dashboardStats?.attendanceTrendMonthly || []).map((point) => ({
      key: point.key,
      label: String(point.label || formatTrendLabel(point.key, "monthly")),
      present: Number(point.present || 0),
      absent: Number(point.absent || 0),
      excluded: Number(point.excluded || 0)
    }));

    const weeklyKeys = buildRecentDateKeys(todayKey, 7);
    const monthlyKeys = buildRecentDateKeys(todayKey, 30);
    const seedPoints = (dateKeys: string[], series: GraphSeries[], mode: "weekly" | "monthly") =>
      dateKeys.map((key) => series.reduce((acc, item) => ({ ...acc, [item.key]: 0 }), { key, label: formatTrendLabel(key, mode) } as TrendPoint));
    const addCount = (points: TrendPoint[], key: string, field: string, count = 1) => {
      const point = points.find((item) => item.key === key);
      if (point) point[field] = Number(point[field] || 0) + count;
    };

    const leaveSeries: GraphSeries[] = [
      { key: "approved", label: "Approved", color: "#22c55e" },
      { key: "pending", label: "Pending", color: "#f59e0b" },
      { key: "rejected", label: "Rejected", color: "#ef4444" }
    ];
    const leaveWeekly = seedPoints(weeklyKeys, leaveSeries, "weekly");
    const leaveMonthly = seedPoints(monthlyKeys, leaveSeries, "monthly");
    leaveList.forEach((leave) => {
      const dateKey = leave.createdAt ? toOrgDateKey(leave.createdAt) : leave.fromDate ? toOrgDateKey(leave.fromDate) : "";
      const field = String(leave.status || "pending").toLowerCase();
      if (dateKey && leaveSeries.some((item) => item.key === field)) {
        addCount(leaveWeekly, dateKey, field);
        addCount(leaveMonthly, dateKey, field);
      }
    });

    const approvalSeries: GraphSeries[] = [
      { key: "leaveRequests", label: "Leave Requests", color: "#f59e0b" },
      { key: "timesheets", label: "Timesheets", color: "#3b82f6" }
    ];
    const approvalWeekly = seedPoints(weeklyKeys, approvalSeries, "weekly");
    const approvalMonthly = seedPoints(monthlyKeys, approvalSeries, "monthly");
    leaveList.filter((leave) => leave.status === "pending").forEach((leave) => {
      const dateKey = leave.createdAt ? toOrgDateKey(leave.createdAt) : leave.fromDate ? toOrgDateKey(leave.fromDate) : "";
      if (dateKey) {
        addCount(approvalWeekly, dateKey, "leaveRequests");
        addCount(approvalMonthly, dateKey, "leaveRequests");
      }
    });
    weeklyList.filter((item) => item.status === "submitted").forEach((item) => {
      const dateKey = item.submittedAt ? toOrgDateKey(item.submittedAt) : item.createdAt ? toOrgDateKey(item.createdAt) : item.weekStart ? toOrgDateKey(item.weekStart) : "";
      if (dateKey) {
        addCount(approvalWeekly, dateKey, "timesheets");
        addCount(approvalMonthly, dateKey, "timesheets");
      }
    });

    const timesheetSeries: GraphSeries[] = [
      { key: "draft", label: "Draft", color: "#94a3b8" },
      { key: "submitted", label: "Submitted", color: "#3b82f6" },
      { key: "approved", label: "Approved", color: "#22c55e" },
      { key: "rejected", label: "Rejected", color: "#ef4444" }
    ];
    const timesheetWeekly = seedPoints(weeklyKeys, timesheetSeries, "weekly");
    const timesheetMonthly = seedPoints(monthlyKeys, timesheetSeries, "monthly");
    weeklyList.forEach((item) => {
      const field = String(item.status || "draft").toLowerCase();
      const dateKey = item.submittedAt ? toOrgDateKey(item.submittedAt) : item.createdAt ? toOrgDateKey(item.createdAt) : item.weekStart ? toOrgDateKey(item.weekStart) : "";
      if (dateKey && timesheetSeries.some((series) => series.key === field)) {
        addCount(timesheetWeekly, dateKey, field);
        addCount(timesheetMonthly, dateKey, field);
      }
    });

    const lifecycleSeries: GraphSeries[] = [
      { key: "joiners", label: "Joiners", color: "#14b8a6" },
      { key: "probation", label: "Probation", color: "#8b5cf6" }
    ];
    const lifecycleWeekly = seedPoints(weeklyKeys, lifecycleSeries, "weekly");
    const lifecycleMonthly = seedPoints(monthlyKeys, lifecycleSeries, "monthly");
    employeeList.forEach((employee) => {
      if (!employee.dateOfJoining) return;
      const dateKey = toOrgDateKey(employee.dateOfJoining);
      addCount(lifecycleWeekly, dateKey, "joiners");
      addCount(lifecycleMonthly, dateKey, "joiners");
      const daysSinceJoining = Math.floor((Date.now() - new Date(employee.dateOfJoining).getTime()) / (1000 * 60 * 60 * 24));
      if (daysSinceJoining <= 90) {
        addCount(lifecycleWeekly, dateKey, "probation");
        addCount(lifecycleMonthly, dateKey, "probation");
      }
    });

    const holidaySeries: GraphSeries[] = [{ key: "holidays", label: "Holidays", color: "#0ea5e9" }];
    const holidayWeekly = seedPoints(weeklyKeys, holidaySeries, "weekly");
    const holidayMonthly = seedPoints(monthlyKeys, holidaySeries, "monthly");
    holidays.forEach((item) => {
      const dateKey = item.date ? toOrgDateKey(item.date) : "";
      if (dateKey) {
        addCount(holidayWeekly, dateKey, "holidays");
        addCount(holidayMonthly, dateKey, "holidays");
      }
    });

    const notificationSeries: GraphSeries[] = [{ key: "notifications", label: "Notifications", color: "#6366f1" }];
    const notificationWeekly = seedPoints(weeklyKeys, notificationSeries, "weekly");
    const notificationMonthly = seedPoints(monthlyKeys, notificationSeries, "monthly");
    notifications.forEach((item) => {
      const dateKey = item.createdAt ? toOrgDateKey(item.createdAt) : "";
      if (dateKey) {
        addCount(notificationWeekly, dateKey, "notifications");
        addCount(notificationMonthly, dateKey, "notifications");
      }
    });

    return {
      attendance: {
        title: "Attendance Trend",
        description: "Present, absent, and excluded employees across the selected period.",
        weekly: attendanceTrend,
        monthly: attendanceTrendMonthly,
        series: [
          { key: "present", label: "Present", color: "#22c55e" },
          { key: "absent", label: "Absent", color: "#f97316" },
          { key: "excluded", label: "Excluded", color: "#cbd5e1" }
        ],
        type: "area"
      },
      leaves: { title: "Leave Request Flow", description: "Approved, pending, and rejected leave requests.", weekly: leaveWeekly, monthly: leaveMonthly, series: leaveSeries, type: "bar" },
      approvals: { title: "Approval Center Activity", description: "Leave requests and timesheets waiting for action.", weekly: approvalWeekly, monthly: approvalMonthly, series: approvalSeries, type: "bar" },
      timesheets: { title: "Timesheet Compliance", description: "Draft, submitted, approved, and rejected timesheets.", weekly: timesheetWeekly, monthly: timesheetMonthly, series: timesheetSeries, type: "bar" },
      lifecycle: { title: "Employee Lifecycle", description: "New joiners and probation entries over time.", weekly: lifecycleWeekly, monthly: lifecycleMonthly, series: lifecycleSeries, type: "area" },
      holidays: { title: "Holiday Outlook", description: "Holiday occurrences across the selected period.", weekly: holidayWeekly, monthly: holidayMonthly, series: holidaySeries, type: "bar" },
      notifications: { title: "Notification Activity", description: "Notifications issued in the selected period.", weekly: notificationWeekly, monthly: notificationMonthly, series: notificationSeries, type: "area" },
      exceptions: {
        title: "Attendance Exceptions",
        description: "Absent and excluded employees across the selected period.",
        weekly: attendanceTrend.map((point) => ({ key: point.key, label: point.label, absent: point.absent, excluded: point.excluded })),
        monthly: attendanceTrendMonthly.map((point) => ({ key: point.key, label: point.label, absent: point.absent, excluded: point.excluded })),
        series: [
          { key: "absent", label: "Absent", color: "#f97316" },
          { key: "excluded", label: "Excluded", color: "#cbd5e1" }
        ],
        type: "area"
      }
    };
  }, [data, todayKey]);

  const definition = definitions[graph] || definitions.attendance;
  const backTarget = (location.state as { from?: string } | null)?.from || "/dashboard";
  const sumSeries = (points: TrendPoint[]) =>
    points.reduce((acc, point) => acc + definition.series.reduce((sum, series) => sum + Number(point[series.key] || 0), 0), 0);
  const peakPoint = (points: TrendPoint[]) => {
    const withSums = points.map((point) => ({
      point,
      sum: definition.series.reduce((s, series) => s + Number(point[series.key] || 0), 0)
    }));
    return withSums.sort((a, b) => b.sum - a.sum)[0]?.point;
  };

  return (
    <MainLayout title={definition.title} breadcrumb={[{ label: "Home", href: "/" }, { label: "Dashboard", href: "/dashboard" }, { label: definition.title }]}>
      <div className="flex flex-col gap-4 mb-6 md:flex-row md:items-center md:justify-between">
        <button onClick={() => navigate(backTarget)} className="flex items-center gap-2 text-muted-foreground">
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </button>
        <Button variant="outline" onClick={() => navigate("/dashboard")}>Open Dashboard</Button>
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-28 w-full rounded-xl" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}
          </div>
          <Skeleton className="h-80 w-full rounded-xl" />
        </div>
      ) : (
        <>
          <div className="stat-card mb-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-2xl font-semibold">{definition.title}</h2>
                  <Badge variant="outline">Graph Drilldown</Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-2">{definition.description}</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="stat-card">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                <CalendarDays className="w-4 h-4" /> Weekly Total
              </div>
              <div className="text-2xl font-semibold">{sumSeries(definition.weekly)}</div>
            </div>
            <div className="stat-card">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                <TrendingUp className="w-4 h-4" /> Monthly Total
              </div>
              <div className="text-2xl font-semibold">{sumSeries(definition.monthly)}</div>
            </div>
            <div className="stat-card">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                <Activity className="w-4 h-4" /> Peak Day
              </div>
              <div className="text-2xl font-semibold">{peakPoint(definition.monthly)?.label || "-"}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="stat-card">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">Weekly Trend</h3>
                <Badge variant="outline">Last 7 Days</Badge>
              </div>
              <ChartContainer config={definition.series.reduce((acc, item) => ({ ...acc, [item.key]: { label: item.label, color: item.color } }), {})} className="h-[320px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  {definition.type === "area" ? (
                    <AreaChart data={definition.weekly}>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} />
                      <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      {definition.series.map((item) => (
                        <Area key={item.key} type="monotone" dataKey={item.key} stackId="trend" stroke={item.color} fill={item.color} fillOpacity={0.18} />
                      ))}
                    </AreaChart>
                  ) : (
                    <BarChart data={definition.weekly}>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} />
                      <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      {definition.series.map((item) => (
                        <Bar key={item.key} dataKey={item.key} fill={item.color} radius={[8, 8, 0, 0]} />
                      ))}
                    </BarChart>
                  )}
                </ResponsiveContainer>
              </ChartContainer>
            </div>

            <div className="stat-card">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">Last Month Trend</h3>
                <Badge variant="outline">Last 30 Days</Badge>
              </div>
              <ChartContainer config={definition.series.reduce((acc, item) => ({ ...acc, [item.key]: { label: item.label, color: item.color } }), {})} className="h-[320px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  {definition.type === "area" ? (
                    <AreaChart data={definition.monthly}>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} />
                      <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      {definition.series.map((item) => (
                        <Area key={item.key} type="monotone" dataKey={item.key} stackId="trend" stroke={item.color} fill={item.color} fillOpacity={0.18} />
                      ))}
                    </AreaChart>
                  ) : (
                    <BarChart data={definition.monthly}>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} />
                      <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      {definition.series.map((item) => (
                        <Bar key={item.key} dataKey={item.key} fill={item.color} radius={[8, 8, 0, 0]} />
                      ))}
                    </BarChart>
                  )}
                </ResponsiveContainer>
              </ChartContainer>
            </div>
          </div>
        </>
      )}
    </MainLayout>
  );
};

export default DashboardGraphDetails;
