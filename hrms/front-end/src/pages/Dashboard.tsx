import { MainLayout } from "@/components/layout/MainLayout";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/useAuth";
import { getApiWithToken } from "@/services/apiWrapper";
import { formatDateInOrgTimeZone, setOrgTimeZone } from "@/utils/timezone";
import {
  BriefcaseBusiness,
  CalendarDays,
  CircleMinus,
  CirclePlus,
  LayoutGrid,
  Search,
  Users,
  UserRoundCheck,
  UserRoundX,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";

type NamedEntity = {
  _id?: string;
  name?: string;
};

type EmployeeRecord = {
  _id?: string;
  employeeCode?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  profileImage?: string;
  status?: string;
  departmentId?: NamedEntity | null;
  designationId?: NamedEntity | null;
  managerId?: NamedEntity | null;
};

type TodayStatusRecord = {
  employeeId?: string;
  present?: boolean;
  absent?: boolean;
  pendingCheckout?: boolean;
  isOnLeave?: boolean;
  lateByMinutes?: number;
};

type DashboardStats = {
  kpis?: {
    totalEmployees: number;
    presentToday: number;
    absentToday: number;
    checkedInOnly: number;
    lateArrivals: number;
    onLeaveToday: number;
  };
  attendanceTrendMonthly?: {
    key: string;
    label?: string;
    present?: number;
    absent?: number;
    excluded?: number;
  }[];
};

type DashboardSummary = {
  employeeList?: EmployeeRecord[];
  todayStatusList?: TodayStatusRecord[];
  dashboardStats?: DashboardStats;
  orgSettings?: {
    timezone?: string;
  };
};

const donutColors = ["#29b37e", "#f7c948", "#14b8a6", "#f05f57"];

const toMonthValue = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

const employeeName = (employee: EmployeeRecord) =>
  `${employee.firstName || ""} ${employee.lastName || ""}`.trim() || employee.email || "Employee";

const statusLabel = (status?: string) =>
  String(status || "active")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

const Dashboard = () => {
  const navigate = useNavigate();
  const { profile, permissions, isSuperAdmin } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [officeFilter, setOfficeFilter] = useState("all");
  const [jobFilter, setJobFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const today = useMemo(() => new Date(), []);
  const monthValue = toMonthValue(today);
  const yearValue = today.getFullYear();

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getApiWithToken(`/dashboard/summary?month=${monthValue}&year=${yearValue}`);
      if (!res?.success) {
        toast.error(res?.message || "Failed to load dashboard");
        return;
      }

      const data = res.data || {};
      if (data?.orgSettings?.timezone) {
        setOrgTimeZone(data.orgSettings.timezone);
      }
      setSummary(data);
    } finally {
      setLoading(false);
    }
  }, [monthValue, yearValue]);

  useEffect(() => {
    if (!isSuperAdmin && permissions.length === 0) return;
    loadDashboard();
  }, [isSuperAdmin, loadDashboard, permissions.length]);

  const employees = summary?.employeeList || [];
  const todayStatusList = summary?.todayStatusList || [];
  const kpis = summary?.dashboardStats?.kpis || {
    totalEmployees: employees.length,
    presentToday: todayStatusList.filter((item) => item.present && !item.isOnLeave).length,
    absentToday: todayStatusList.filter((item) => item.absent && !item.isOnLeave).length,
    checkedInOnly: todayStatusList.filter((item) => item.pendingCheckout).length,
    lateArrivals: todayStatusList.filter((item) => Number(item.lateByMinutes || 0) > 0).length,
    onLeaveToday: todayStatusList.filter((item) => item.isOnLeave).length,
  };

  const employeeCount = Math.max(0, Number(kpis.totalEmployees || 0));
  const activeCount = employees.filter((employee) => !["resigned", "terminated", "inactive"].includes(String(employee.status || "").toLowerCase())).length;
  const resignedCount = employees.filter((employee) => String(employee.status || "").toLowerCase() === "resigned").length;
  const newEmployeeCount = employees.filter((employee) => String(employee.status || "").toLowerCase() === "probation").length;
  const applicantCount = Math.max(0, Number(kpis.onLeaveToday || 0) + Number(kpis.lateArrivals || 0) + Number(kpis.checkedInOnly || 0));

  const topStats = [
    {
      label: "Total Employees",
      value: employeeCount,
      trend: "+25.5%",
      icon: Users,
      route: "/employees",
      tone: "text-emerald-600",
    },
    {
      label: "Present Today",
      value: Number(kpis.presentToday || 0),
      trend: "+4.10%",
      icon: BriefcaseBusiness,
      route: "/attendance",
      tone: "text-emerald-600",
    },
    {
      label: "New Employees",
      value: newEmployeeCount,
      trend: "+5.1%",
      icon: CirclePlus,
      route: "/employees",
      tone: "text-emerald-600",
    },
    {
      label: "Resigned Employees",
      value: resignedCount,
      trend: "+25.5%",
      icon: CircleMinus,
      route: "/employees",
      tone: "text-red-500",
    },
  ];

  const trendData = useMemo(() => {
    const source = summary?.dashboardStats?.attendanceTrendMonthly || [];
    return source.slice(-7).map((point) => ({
      label: point.label || formatDateInOrgTimeZone(new Date(`${point.key}T12:00:00Z`), { month: "short" }),
      project: Number(point.present || 0),
      product: Number(point.absent || 0) + Number(point.excluded || 0),
    }));
  }, [summary]);

  const totalEmployeeData = [
    { name: "Present", value: Number(kpis.presentToday || 0) },
    { name: "On Leave", value: Number(kpis.onLeaveToday || 0) },
    { name: "Late", value: Number(kpis.lateArrivals || 0) },
    { name: "Absent", value: Number(kpis.absentToday || 0) },
  ].filter((item) => item.value > 0);

  const visibleDonutData = totalEmployeeData.length ? totalEmployeeData : [{ name: "Employees", value: employeeCount || 1 }];
  const donutTotal = visibleDonutData.reduce((sum, item) => sum + item.value, 0);

  const officeOptions = useMemo(
    () => Array.from(new Set(employees.map((employee) => employee.departmentId?.name || "Unassigned"))),
    [employees]
  );
  const jobOptions = useMemo(
    () => Array.from(new Set(employees.map((employee) => employee.designationId?.name || "Unassigned"))),
    [employees]
  );
  const statusOptions = useMemo(
    () => Array.from(new Set(employees.map((employee) => statusLabel(employee.status)))),
    [employees]
  );

  const filteredEmployees = useMemo(() => {
    const query = employeeSearch.trim().toLowerCase();
    return employees
      .filter((employee) => {
        const name = employeeName(employee).toLowerCase();
        const email = String(employee.email || "").toLowerCase();
        const department = employee.departmentId?.name || "Unassigned";
        const designation = employee.designationId?.name || "Unassigned";
        const status = statusLabel(employee.status);
        if (query && !name.includes(query) && !email.includes(query)) return false;
        if (officeFilter !== "all" && department !== officeFilter) return false;
        if (jobFilter !== "all" && designation !== jobFilter) return false;
        if (statusFilter !== "all" && status !== statusFilter) return false;
        return true;
      })
      .slice(0, 6);
  }, [employeeSearch, employees, jobFilter, officeFilter, statusFilter]);

  const displayName = profile?.firstName || profile?.lastName
    ? `${profile?.firstName || ""} ${profile?.lastName || ""}`.trim()
    : profile?.email?.split("@")[0] || "there";

  return (
    <MainLayout title="Dashboard">
      <div className="min-h-full rounded-[28px] bg-[#f8f8f6] p-3 sm:p-5 lg:p-6">
        {loading ? (
          <div className="grid gap-4 xl:grid-cols-12">
            <Skeleton className="h-[360px] rounded-[20px] xl:col-span-9" />
            <Skeleton className="h-[360px] rounded-[20px] xl:col-span-3" />
            <Skeleton className="h-[360px] rounded-[20px] xl:col-span-8" />
            <Skeleton className="h-[360px] rounded-[20px] xl:col-span-4" />
          </div>
        ) : (
          <div className="space-y-5">
            <section className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">Hi, {displayName}</p>
                <h2 className="mt-1 text-2xl font-semibold tracking-normal text-slate-950">This is your HR report so far</h2>
              </div>
              <Button variant="outline" className="w-fit rounded-xl border-slate-200 bg-white" onClick={() => navigate("/performance")}>
                <LayoutGrid className="mr-2 h-4 w-4" />
                View Reports
              </Button>
            </section>

            <section className="grid gap-5 xl:grid-cols-12">
              <div className="rounded-[20px] border border-slate-100 bg-white p-4 shadow-sm xl:col-span-6">
                <div className="grid gap-0 sm:grid-cols-2">
                  {topStats.map((stat, index) => {
                    const Icon = stat.icon;
                    return (
                      <button
                        key={stat.label}
                        type="button"
                        onClick={() => navigate(stat.route)}
                        className={`min-h-[150px] text-left transition hover:bg-slate-50 ${index < 2 ? "border-b border-slate-100" : ""} ${index % 2 === 0 ? "sm:border-r sm:border-slate-100" : ""} p-5`}
                      >
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-50 text-slate-600">
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="mt-6 flex items-end gap-3">
                          <p className="text-3xl font-semibold tracking-normal text-slate-950">{stat.value.toLocaleString()}</p>
                          <Badge className={`mb-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold ${stat.tone}`} variant="secondary">
                            {stat.trend}
                          </Badge>
                        </div>
                        <p className="mt-3 text-xs font-semibold text-slate-600">{stat.label}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-[20px] border border-slate-100 bg-white p-5 shadow-sm xl:col-span-6">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-slate-950">Team Performance</h3>
                    <div className="mt-2 flex items-center gap-4 text-[11px] text-slate-500">
                      <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#29b37e]" /> Project Team</span>
                      <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#f7c948]" /> Product Team</span>
                    </div>
                  </div>
                  <Badge variant="outline" className="rounded-xl border-slate-200 bg-white">
                    Last month <CalendarDays className="ml-2 h-3.5 w-3.5" />
                  </Badge>
                </div>
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trendData}>
                      <CartesianGrid stroke="#f0f1f2" vertical />
                      <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#8b95a1", fontSize: 12 }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fill: "#8b95a1", fontSize: 12 }} width={38} />
                      <Tooltip />
                      <Area type="monotone" dataKey="project" stroke="#29b37e" fill="#29b37e" fillOpacity={0.08} strokeWidth={2.2} dot={false} />
                      <Area type="monotone" dataKey="product" stroke="#f7c948" fill="#f7c948" fillOpacity={0.08} strokeWidth={2.2} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </section>

            <section className="grid gap-5 xl:grid-cols-12">
              <div className="rounded-[20px] border border-slate-100 bg-white p-5 shadow-sm xl:col-span-8">
                <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <h3 className="text-lg font-semibold text-slate-950">Employees</h3>
                  <div className="relative w-full lg:w-64">
                    <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      value={employeeSearch}
                      onChange={(event) => setEmployeeSearch(event.target.value)}
                      placeholder="Search employee"
                      className="h-11 rounded-xl border-slate-200 bg-white pr-9"
                    />
                  </div>
                </div>

                <div className="mb-5 grid gap-3 md:grid-cols-3">
                  <Select value={officeFilter} onValueChange={setOfficeFilter}>
                    <SelectTrigger className="h-11 rounded-xl border-slate-200 bg-white">
                      <SelectValue placeholder="All Offices" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Offices</SelectItem>
                      {officeOptions.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={jobFilter} onValueChange={setJobFilter}>
                    <SelectTrigger className="h-11 rounded-xl border-slate-200 bg-white">
                      <SelectValue placeholder="All Job Titles" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Job Titles</SelectItem>
                      {jobOptions.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="h-11 rounded-xl border-slate-200 bg-white">
                      <SelectValue placeholder="All Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      {statusOptions.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left">
                    <thead>
                      <tr className="border-y border-slate-100 text-[11px] font-semibold uppercase text-slate-400">
                        <th className="w-10 py-3"><input type="checkbox" className="rounded border-slate-300" /></th>
                        <th className="py-3">Employee Name</th>
                        <th className="py-3">Job Title</th>
                        <th className="py-3">Line Manager</th>
                        <th className="py-3">Department</th>
                        <th className="py-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredEmployees.map((employee) => (
                        <tr key={employee._id || employee.email} className="text-sm text-slate-700">
                          <td className="py-4"><input type="checkbox" className="rounded border-slate-300" /></td>
                          <td className="py-4">
                            <button type="button" onClick={() => navigate(`/employees/${employee._id}`)} className="flex items-center gap-3 text-left">
                              <Avatar className="h-8 w-8">
                                <AvatarImage src={employee.profileImage} />
                                <AvatarFallback className="bg-emerald-50 text-xs font-semibold text-emerald-700">
                                  {employeeName(employee).slice(0, 2).toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                              <span>
                                <span className="block font-semibold text-slate-950">{employeeName(employee)}</span>
                                <span className="block text-xs text-slate-400">{employee.email || employee.employeeCode || "-"}</span>
                              </span>
                            </button>
                          </td>
                          <td className="py-4">{employee.designationId?.name || "Unassigned"}</td>
                          <td className="py-4">{employee.managerId?.name || "-"}</td>
                          <td className="py-4">{employee.departmentId?.name || "Unassigned"}</td>
                          <td className="py-4">
                            <Badge variant="secondary" className="rounded-full bg-slate-50 text-slate-600">
                              {statusLabel(employee.status)}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                      {filteredEmployees.length === 0 && (
                        <tr>
                          <td colSpan={6} className="py-10 text-center text-sm text-slate-400">No employees found.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-[20px] border border-slate-100 bg-white p-5 shadow-sm xl:col-span-4">
                <div className="mb-6 flex items-center justify-between">
                  <h3 className="text-base font-semibold text-slate-950">Total Employee</h3>
                  <Badge variant="outline" className="rounded-xl border-slate-200">All Time</Badge>
                </div>
                <div className="relative mx-auto h-[230px] max-w-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={visibleDonutData} dataKey="value" innerRadius={68} outerRadius={96} paddingAngle={3} stroke="#fff" strokeWidth={4}>
                        {visibleDonutData.map((entry, index) => (
                          <Cell key={entry.name} fill={donutColors[index % donutColors.length]} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="text-center">
                      <p className="text-2xl font-semibold text-slate-950">{employeeCount || donutTotal}</p>
                      <p className="text-xs text-slate-400">Total Emp.</p>
                    </div>
                  </div>
                </div>
                <div className="mt-5 space-y-3">
                  {visibleDonutData.map((item, index) => (
                    <div key={item.name} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-slate-500">
                        <i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: donutColors[index % donutColors.length] }} />
                        {item.name}
                      </span>
                      <span className="font-semibold text-slate-950">{item.value}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-6 grid grid-cols-2 gap-3">
                  <button type="button" onClick={() => navigate("/attendance")} className="rounded-2xl bg-emerald-50 p-4 text-left">
                    <UserRoundCheck className="mb-3 h-5 w-5 text-emerald-600" />
                    <p className="text-xl font-semibold text-slate-950">{activeCount}</p>
                    <p className="text-xs text-slate-500">Active</p>
                  </button>
                  <button type="button" onClick={() => navigate("/leave")} className="rounded-2xl bg-amber-50 p-4 text-left">
                    <UserRoundX className="mb-3 h-5 w-5 text-amber-600" />
                    <p className="text-xl font-semibold text-slate-950">{applicantCount}</p>
                    <p className="text-xs text-slate-500">Attention</p>
                  </button>
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </MainLayout>
  );
};

export default Dashboard;
