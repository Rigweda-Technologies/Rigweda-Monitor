import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CalendarDays, Clock3, LogIn, LogOut, Timer } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { getApiWithToken } from "@/services/apiWrapper";
import { toast } from "sonner";
import {
  formatDateInOrgTimeZone,
  formatDateTimeInOrgTimeZone,
  formatTimeInOrgTimeZone
} from "@/utils/timezone";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts";

type AttendanceMode = "present" | "absent" | "late" | "missed" | "general";

type EmployeeRecord = {
  _id?: string;
  firstName?: string;
  lastName?: string;
  employeeCode?: string;
  departmentId?: { name?: string } | null;
  designationId?: { name?: string } | null;
  profileImage?: string;
};

type AttendanceRow = {
  _id?: string;
  date?: string;
  checkInAt?: string | null;
  checkOutAt?: string | null;
  totalMinutes?: number;
  lateByMinutes?: number;
  overtimeMinutes?: number;
  missedCheckout?: boolean;
  shiftName?: string;
  shiftStartTime?: string;
  shiftEndTime?: string;
};

const toDateInput = (value: Date) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const shiftDays = (value: Date, delta: number) => {
  const next = new Date(value);
  next.setDate(next.getDate() + delta);
  return next;
};

const minutesToHours = (value?: number) => Number(((value || 0) / 60).toFixed(2));

const EmployeeAttendanceDetails = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();
  const searchParams = new URLSearchParams(location.search);
  const rawMode = searchParams.get("mode");
  const mode: AttendanceMode =
    rawMode === "present" || rawMode === "absent" || rawMode === "late" || rawMode === "missed"
      ? rawMode
      : "general";

  const [employee, setEmployee] = useState<EmployeeRecord | null>(null);
  const [attendanceRows, setAttendanceRows] = useState<AttendanceRow[]>([]);
  const [period, setPeriod] = useState<"weekly" | "monthly">("weekly");
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const endDate = new Date();
      const startDate = period === "weekly" ? shiftDays(endDate, -6) : shiftDays(endDate, -29);

      const [employeeRes, attendanceRes] = await Promise.all([
        getApiWithToken(`/employees/${id}`),
        getApiWithToken(
          `/timesheets/attendance?employeeId=${encodeURIComponent(id)}&startDate=${toDateInput(startDate)}&endDate=${toDateInput(endDate)}`
        )
      ]);

      if (!employeeRes?.success) {
        toast.error(employeeRes?.message || "Failed to load employee");
        return;
      }
      if (!attendanceRes?.success) {
        toast.error(attendanceRes?.message || "Failed to load attendance");
        return;
      }

      setEmployee(employeeRes.data || null);
      setAttendanceRows(attendanceRes.data || []);
    } finally {
      setLoading(false);
    }
  }, [id, period]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const employeeName = `${employee?.firstName || ""} ${employee?.lastName || ""}`.trim() || "Employee";
  const backTarget = (location.state as { from?: string } | null)?.from || "/dashboard";
  const rangeDays = period === "weekly" ? 7 : 30;

  const rangeKeys = useMemo(() => {
    const endDate = new Date();
    const startDate = period === "weekly" ? shiftDays(endDate, -6) : shiftDays(endDate, -29);
    const keys: string[] = [];
    const cursor = new Date(startDate);
    while (cursor <= endDate) {
      keys.push(toDateInput(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return keys;
  }, [period]);

  const summary = useMemo(() => {
    const presentDays = attendanceRows.length;
    const totalHours = attendanceRows.reduce((sum, row) => sum + minutesToHours(row.totalMinutes), 0);
    const lateDays = attendanceRows.filter((row) => Number(row.lateByMinutes || 0) > 0).length;
    const missedCheckoutDays = attendanceRows.filter((row) => row.missedCheckout || (row.checkInAt && !row.checkOutAt)).length;
    const totalLateMinutes = attendanceRows.reduce((sum, row) => sum + Number(row.lateByMinutes || 0), 0);
    const avgHours = presentDays ? Number((totalHours / presentDays).toFixed(2)) : 0;
    const avgLateMinutes = lateDays ? Math.round(totalLateMinutes / lateDays) : 0;
    const absentLikeDays = Math.max(0, rangeKeys.length - presentDays);
    const lastPresentDate = [...attendanceRows]
      .sort((a, b) => new Date(b.date || "").getTime() - new Date(a.date || "").getTime())
      .find((row) => row.checkInAt || row.checkOutAt)?.date || null;
    return {
      presentDays,
      totalHours: Number(totalHours.toFixed(2)),
      lateDays,
      missedCheckoutDays,
      avgHours,
      totalLateMinutes,
      avgLateMinutes,
      absentLikeDays,
      lastPresentDate
    };
  }, [attendanceRows, rangeKeys.length]);

  const trendData = useMemo(() => {
    const attendanceByDate = new Map(
      attendanceRows.map((row) => [row.date ? toDateInput(new Date(row.date)) : "", row] as const)
    );

    return rangeKeys.map((key) => {
      const row = attendanceByDate.get(key);
      const present = row?.checkInAt || row?.checkOutAt ? 1 : 0;
      return {
        key,
        date: formatDateInOrgTimeZone(`${key}T00:00:00`, { month: "short", day: "numeric" }),
        hours: minutesToHours(row?.totalMinutes),
        late: Number(row?.lateByMinutes || 0),
        overtime: minutesToHours(row?.overtimeMinutes),
        missed: row?.missedCheckout || (row?.checkInAt && !row?.checkOutAt) ? 1 : 0,
        present,
        absent: present ? 0 : 1
      };
    });
  }, [attendanceRows, rangeKeys]);

  const modeMeta = {
    general: {
      pageTitle: "Attendance Details",
      panelTitle: "Attendance Snapshot",
      subtitle: "Recent attendance, check-in, and performance details",
      card1: { label: "Present Days", value: `${summary.presentDays}` },
      card2: { label: "Total Hours", value: `${summary.totalHours}h` },
      card3: { label: "Avg Hours / Day", value: `${summary.avgHours}h` },
      card4: { label: "Late / Missed Checkout", value: `${summary.lateDays} / ${summary.missedCheckoutDays}` },
      chart1Title: "Working Hours Trend",
      chart1Subtitle: "Daily worked hours in the selected period",
      chart2Title: "Punctuality Snapshot",
      chart2Subtitle: "Late arrival minutes and overtime trend",
      tableTitle: "Check-in / Check-out Details"
    },
    present: {
      pageTitle: "Present Employee Details",
      panelTitle: "Present Today",
      subtitle: "Attendance performance for an employee who is marked present today",
      card1: { label: "Present Days", value: `${summary.presentDays}` },
      card2: { label: "Total Hours", value: `${summary.totalHours}h` },
      card3: { label: "Avg Hours / Day", value: `${summary.avgHours}h` },
      card4: { label: "Late Days", value: `${summary.lateDays}` },
      chart1Title: "Working Hours Consistency",
      chart1Subtitle: "Daily worked hours across the selected period",
      chart2Title: "Late And Overtime Trend",
      chart2Subtitle: "Late arrival and overtime pattern",
      tableTitle: "Present Attendance Details"
    },
    absent: {
      pageTitle: "Absent Employee Details",
      panelTitle: "Absent Today",
      subtitle: "Attendance history and consistency view for an employee marked absent today",
      card1: { label: "Days With Attendance", value: `${summary.presentDays}` },
      card2: { label: "Days Without Attendance", value: `${summary.absentLikeDays}` },
      card3: { label: "Last Present Date", value: summary.lastPresentDate ? formatDateInOrgTimeZone(summary.lastPresentDate) : "-" },
      card4: { label: "Avg Hours / Present Day", value: `${summary.avgHours}h` },
      chart1Title: "Presence Vs Gap Timeline",
      chart1Subtitle: "Presence compared with missing attendance days",
      chart2Title: "Worked Hours History",
      chart2Subtitle: "Recent work history before the absence",
      tableTitle: "Recent Attendance Records"
    },
    late: {
      pageTitle: "Late Arrival Details",
      panelTitle: "Late Arrivals",
      subtitle: "Late arrival pattern, minutes lost, and work output",
      card1: { label: "Late Days", value: `${summary.lateDays}` },
      card2: { label: "Late Minutes", value: `${summary.totalLateMinutes}` },
      card3: { label: "Avg Late Minutes", value: `${summary.avgLateMinutes}` },
      card4: { label: "Worked Hours", value: `${summary.totalHours}h` },
      chart1Title: "Late Arrival Trend",
      chart1Subtitle: "Late minutes across the selected period",
      chart2Title: "Hours And Overtime Trend",
      chart2Subtitle: "Work output around late arrivals",
      tableTitle: "Late Arrival Attendance Records"
    },
    missed: {
      pageTitle: "Missed Checkout Details",
      panelTitle: "Missed Checkout",
      subtitle: "Incomplete attendance days and related work pattern",
      card1: { label: "Missed Checkouts", value: `${summary.missedCheckoutDays}` },
      card2: { label: "Present Days", value: `${summary.presentDays}` },
      card3: { label: "Total Hours", value: `${summary.totalHours}h` },
      card4: { label: "Late Days", value: `${summary.lateDays}` },
      chart1Title: "Missed Checkout Incidents",
      chart1Subtitle: "Days with incomplete checkout",
      chart2Title: "Hours And Late Pattern",
      chart2Subtitle: "Work duration and lateness around missed checkout",
      tableTitle: "Pending Checkout Attendance Records"
    }
  }[mode];

  return (
    <MainLayout
      title={modeMeta.pageTitle}
      breadcrumb={[
        { label: "Home", href: "/" },
        { label: "Dashboard", href: "/dashboard" },
        { label: modeMeta.pageTitle }
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
                  <Badge variant="outline">{modeMeta.panelTitle}</Badge>
                  <Badge variant="secondary">{period === "weekly" ? "Last 7 Days" : "Last 30 Days"}</Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  {employee?.employeeCode || "-"} • {employee?.departmentId?.name || "Unassigned"} • {employee?.designationId?.name || "-"}
                </p>
                <p className="text-sm text-muted-foreground mt-1">{modeMeta.subtitle}</p>
              </div>
              <Button variant="outline" onClick={() => navigate(`/employees/${id}`)}>
                Open Employee Profile
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
            <div className="stat-card">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                <CalendarDays className="w-4 h-4" /> {modeMeta.card1.label}
              </div>
              <div className="text-2xl font-semibold">{modeMeta.card1.value}</div>
            </div>
            <div className="stat-card">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                <Timer className="w-4 h-4" /> {modeMeta.card2.label}
              </div>
              <div className="text-2xl font-semibold">{modeMeta.card2.value}</div>
            </div>
            <div className="stat-card">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                <Clock3 className="w-4 h-4" /> {modeMeta.card3.label}
              </div>
              <div className="text-2xl font-semibold">{modeMeta.card3.value}</div>
            </div>
            <div className="stat-card">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                <LogOut className="w-4 h-4" /> {modeMeta.card4.label}
              </div>
              <div className="text-2xl font-semibold">{modeMeta.card4.value}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
            <div className="stat-card">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="font-semibold">{modeMeta.chart1Title}</h3>
                  <p className="text-sm text-muted-foreground">{modeMeta.chart1Subtitle}</p>
                </div>
                <Badge variant="outline">Performance</Badge>
              </div>
              <ChartContainer config={{ hours: { label: "Hours", color: "#2563eb" } }} className="h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trendData}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={24} />
                    <YAxis tickLine={false} axisLine={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    {mode === "absent" ? (
                      <>
                        <Area type="monotone" dataKey="present" stroke="#22c55e" fill="#22c55e" fillOpacity={0.18} />
                        <Area type="monotone" dataKey="absent" stroke="#f97316" fill="#f97316" fillOpacity={0.18} />
                      </>
                    ) : mode === "late" ? (
                      <Area type="monotone" dataKey="late" stroke="#f97316" fill="#f97316" fillOpacity={0.2} />
                    ) : mode === "missed" ? (
                      <Area type="monotone" dataKey="missed" stroke="#ef4444" fill="#ef4444" fillOpacity={0.2} />
                    ) : (
                      <Area type="monotone" dataKey="hours" stroke="#2563eb" fill="#2563eb" fillOpacity={0.2} />
                    )}
                  </AreaChart>
                </ResponsiveContainer>
              </ChartContainer>
            </div>

            <div className="stat-card">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="font-semibold">{modeMeta.chart2Title}</h3>
                  <p className="text-sm text-muted-foreground">{modeMeta.chart2Subtitle}</p>
                </div>
                <Badge variant="outline">Attendance</Badge>
              </div>
              <ChartContainer
                config={{
                  late: { label: "Late Minutes", color: "#f97316" },
                  overtime: { label: "Overtime Hours", color: "#22c55e" }
                }}
                className="h-[280px] w-full"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trendData}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={24} />
                    <YAxis tickLine={false} axisLine={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    {mode === "absent" ? (
                      <Bar dataKey="hours" fill="#2563eb" radius={[8, 8, 0, 0]} />
                    ) : mode === "missed" ? (
                      <>
                        <Bar dataKey="hours" fill="#2563eb" radius={[8, 8, 0, 0]} />
                        <Bar dataKey="late" fill="#f97316" radius={[8, 8, 0, 0]} />
                      </>
                    ) : (
                      <>
                        <Bar dataKey="late" fill="#f97316" radius={[8, 8, 0, 0]} />
                        <Bar dataKey="overtime" fill="#22c55e" radius={[8, 8, 0, 0]} />
                      </>
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            </div>
          </div>

          <div className="stat-card">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold">{modeMeta.tableTitle}</h3>
                <p className="text-sm text-muted-foreground">Attendance details for the selected period</p>
              </div>
              <Badge variant="outline">{attendanceRows.length} Records</Badge>
            </div>

            {attendanceRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No attendance records found for this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-3 pr-4 font-medium">Date</th>
                      <th className="py-3 pr-4 font-medium">Check In</th>
                      <th className="py-3 pr-4 font-medium">Check Out</th>
                      <th className="py-3 pr-4 font-medium">Worked</th>
                      <th className="py-3 pr-4 font-medium">Late</th>
                      <th className="py-3 pr-4 font-medium">Shift</th>
                      <th className="py-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...attendanceRows]
                      .sort((a, b) => new Date(b.date || "").getTime() - new Date(a.date || "").getTime())
                      .map((row) => {
                        const missedCheckout = row.missedCheckout || (row.checkInAt && !row.checkOutAt);
                        return (
                          <tr key={row._id || `${row.date}-${row.checkInAt}`} className="border-b last:border-b-0">
                            <td className="py-3 pr-4">{row.date ? formatDateInOrgTimeZone(row.date) : "-"}</td>
                            <td className="py-3 pr-4">
                              <div className="flex items-center gap-2">
                                <LogIn className="w-4 h-4 text-muted-foreground" />
                                <span>{row.checkInAt ? formatTimeInOrgTimeZone(row.checkInAt) : "-"}</span>
                              </div>
                            </td>
                            <td className="py-3 pr-4">
                              <div className="flex items-center gap-2">
                                <LogOut className="w-4 h-4 text-muted-foreground" />
                                <span>{row.checkOutAt ? formatTimeInOrgTimeZone(row.checkOutAt) : "-"}</span>
                              </div>
                            </td>
                            <td className="py-3 pr-4">{minutesToHours(row.totalMinutes)}h</td>
                            <td className="py-3 pr-4">{Number(row.lateByMinutes || 0)} min</td>
                            <td className="py-3 pr-4">
                              <div>
                                <p>{row.shiftName || "-"}</p>
                                <p className="text-xs text-muted-foreground">
                                  {row.shiftStartTime || "-"} to {row.shiftEndTime || "-"}
                                </p>
                              </div>
                            </td>
                            <td className="py-3">
                              <Badge variant={missedCheckout ? "destructive" : "secondary"}>
                                {missedCheckout ? "Pending Checkout" : "Present"}
                              </Badge>
                              {(row.checkInAt || row.checkOutAt) && (
                                <p className="text-xs text-muted-foreground mt-1">
                                  Updated {formatDateTimeInOrgTimeZone(row.checkOutAt || row.checkInAt || "")}
                                </p>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </MainLayout>
  );
};

export default EmployeeAttendanceDetails;
