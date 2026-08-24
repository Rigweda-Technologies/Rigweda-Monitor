import { useCallback, useEffect, useState } from "react";
import { Activity, Circle, RefreshCw } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getMonitorEmployeeActivity, MonitorEmployeeActivity } from "@/services/monitorActivity";
import { formatDateTimeInOrgTimeZone, getOrgTimeZone, subscribeToOrgTimeZone, toDateKeyInOrgTimeZone } from "@/utils/timezone";
import { toast } from "sonner";

const today = () => toDateKeyInOrgTimeZone(new Date());

const formatDuration = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
};

const getDisplayStatus = (employee: MonitorEmployeeActivity) => employee.status;

const MonitorActivity = () => {
  const [date, setDate] = useState(today);
  const [employees, setEmployees] = useState<MonitorEmployeeActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [timeZone, setTimeZone] = useState(() => getOrgTimeZone());

  const load = useCallback(async (manual = false) => {
    manual ? setRefreshing(true) : setLoading(true);
    try {
      const data = await getMonitorEmployeeActivity(date);
      if (data.timezone) {
        setTimeZone(data.timezone);
      }
      setEmployees(data.employees || []);
    } catch (error) {
      if (manual) toast.error("Could not refresh monitor activity.");
      console.error("Could not load monitor activity", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [date]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => subscribeToOrgTimeZone(setTimeZone), []);
  useEffect(() => {
    setDate(toDateKeyInOrgTimeZone(new Date()));
  }, [timeZone]);

  const onlineCount = employees.filter((employee) => getDisplayStatus(employee) === "online").length;
  const awayCount = employees.filter((employee) => getDisplayStatus(employee) === "away").length;
  const offlineCount = employees.filter((employee) => getDisplayStatus(employee) === "offline").length;
  const productiveSeconds = employees.reduce((total, employee) => total + Number(employee.productiveSeconds || 0), 0);
  const idleSeconds = employees.reduce((total, employee) => total + Number(employee.idleSeconds || 0), 0);
  const totalSeconds = employees.reduce((total, employee) => total + Number(employee.totalSeconds || 0), 0);

  return (
    <MainLayout title="Mouse Movement" breadcrumb={[{ label: "Home", href: "/" }, { label: "Employee Monitor" }, { label: "Mouse Movement" }]}>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold">Employee mouse movement</h2>
            <p className="text-sm text-muted-foreground">
              Refresh manually to load the latest desktop activity. Online status now reflects both mouse and keyboard activity.
            </p>
            <p className="text-xs text-muted-foreground">Displayed in {timeZone} time.</p>
          </div>
          <div className="flex items-center gap-2">
            <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="w-[155px]" />
            <Button variant="outline" onClick={() => void load(true)} disabled={refreshing}>
              <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Tracked employees</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{employees.length}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Online now</CardTitle></CardHeader><CardContent className="flex items-center gap-2 text-2xl font-bold text-emerald-600"><Circle className="h-3 w-3 fill-current" />{onlineCount}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Away now</CardTitle></CardHeader><CardContent className="text-2xl font-bold text-amber-500">{awayCount}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Offline now</CardTitle></CardHeader><CardContent className="text-2xl font-bold text-slate-600">{offlineCount}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Productive time</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{formatDuration(productiveSeconds)}</CardContent></Card>
        </div>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5" />Employee-wise activity</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Employee ID</TableHead><TableHead>Status</TableHead><TableHead>Last seen</TableHead><TableHead className="text-right">Productive time</TableHead></TableRow></TableHeader>
              <TableBody>
                {!loading && employees.map((employee) => {
                  const status = getDisplayStatus(employee);
                  const statusLabel = status === "online" ? "Online" : status === "away" ? "Away" : "Offline";
                  const statusClass = status === "online"
                    ? "bg-emerald-600 hover:bg-emerald-600"
                    : status === "away"
                      ? "bg-amber-500 hover:bg-amber-500"
                      : "bg-slate-500 hover:bg-slate-500";
                  return (
                    <TableRow key={employee.employeeId}>
                      <TableCell className="font-medium">{employee.employeeName || "Employee"}</TableCell>
                      <TableCell>{employee.employeeId}</TableCell>
                      <TableCell><Badge className={statusClass}>{statusLabel}</Badge></TableCell>
                      <TableCell>{employee.lastSeenAt ? formatDateTimeInOrgTimeZone(employee.lastSeenAt, {}, timeZone) : "-"}</TableCell>
                      <TableCell className="text-right">{formatDuration(Number(employee.productiveSeconds || 0))}</TableCell>
                    </TableRow>
                  );
                })}
                {!loading && employees.length === 0 && <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">No desktop activity was recorded for this date.</TableCell></TableRow>}
                {loading && <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">Loading activity...</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
};

export default MonitorActivity;
