import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock3, Monitor, RefreshCw } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getMonitorAppUsage, MonitorAppUsageEmployee, MonitorAppUsageSession } from "@/services/monitorActivity";
import { getOrgTimeZone, subscribeToOrgTimeZone, toDateKeyInOrgTimeZone } from "@/utils/timezone";
import { toast } from "sonner";

const today = () => toDateKeyInOrgTimeZone(new Date());

const formatDuration = (seconds: number) => {
  const total = Math.max(Number(seconds || 0), 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${hours}h ${minutes}m`;
};

const formatTime = (value: string | null) => {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
};

const MonitorAppUsage = () => {
  const [date, setDate] = useState(today);
  const [employees, setEmployees] = useState<MonitorAppUsageEmployee[]>([]);
  const [sessions, setSessions] = useState<MonitorAppUsageSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [timeZone, setTimeZone] = useState(() => getOrgTimeZone());

  const load = useCallback(async (manual = false) => {
    manual ? setRefreshing(true) : setLoading(true);
    try {
      const data = await getMonitorAppUsage(date);
      setEmployees(data.employees || []);
      setSessions(data.sessions || []);
    } catch (error) {
      if (manual) toast.error("Could not refresh app usage.");
      console.error("Could not load app usage", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => subscribeToOrgTimeZone(setTimeZone), []);

  useEffect(() => {
    setDate(toDateKeyInOrgTimeZone(new Date()));
  }, [timeZone]);

  useEffect(() => {
    const interval = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(interval);
  }, [load]);

  const employeeCount = employees.length;
  const sessionCount = sessions.length;
  const totalSeconds = employees.reduce((sum, employee) => sum + Number(employee.totalSeconds || 0), 0);
  const totalKeyPresses = employees.reduce((sum, employee) => sum + Number(employee.totalKeyPresses || 0), 0);
  const topEmployee = useMemo(() => employees[0] || null, [employees]);

  return (
    <MainLayout title="App Usage" breadcrumb={[{ label: "Home", href: "/" }, { label: "Employee Monitor" }, { label: "App Usage" }]}>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold">Foreground app usage</h2>
            <p className="text-sm text-muted-foreground">
              Tracks which application was active and how long it stayed in focus.
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

        <div className="grid gap-4 sm:grid-cols-5">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Tracked employees</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{employeeCount}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">App sessions</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{sessionCount}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Focused time</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{formatDuration(totalSeconds)}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Key presses</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{totalKeyPresses}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Top employee</CardTitle></CardHeader><CardContent className="truncate text-lg font-bold">{topEmployee?.employeeName || topEmployee?.employeeCode || "None"}</CardContent></Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Monitor className="h-5 w-5" /> Employee app usage</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Employee ID</TableHead>
                  <TableHead>Sessions</TableHead>
                  <TableHead className="text-right">Focused time</TableHead>
                  <TableHead className="text-right">Key presses</TableHead>
                  <TableHead>Top apps</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!loading && employees.map((employee) => (
                  <TableRow key={employee.employeeId}>
                    <TableCell className="font-medium">{employee.employeeName || "Employee"}</TableCell>
                    <TableCell>{employee.employeeCode || employee.employeeId}</TableCell>
                    <TableCell>{employee.sessionCount}</TableCell>
                    <TableCell className="text-right">{formatDuration(employee.totalSeconds)}</TableCell>
                    <TableCell className="text-right">{employee.totalKeyPresses}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        {(employee.apps || []).slice(0, 3).map((app) => (
                          <Badge key={`${employee.employeeId}-${app.appName}-${app.processName}`} variant="secondary">
                            {app.appName} {app.sessionCount > 1 ? `(${app.sessionCount})` : ""} {app.keyPressCount ? `• ${app.keyPressCount}` : ""}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {!loading && employees.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">No app usage was recorded for this date.</TableCell></TableRow>
                )}
                {loading && (
                  <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">Loading app usage...</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Clock3 className="h-5 w-5" /> Session timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>App</TableHead>
                  <TableHead>Process</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Ended</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead className="text-right">Key presses</TableHead>
                  <TableHead>Keys</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!loading && sessions.map((session) => (
                  <TableRow key={session.sessionId}>
                    <TableCell className="font-medium">{session.employeeName || session.employeeCode || session.employeeId}</TableCell>
                    <TableCell>{session.appName}</TableCell>
                    <TableCell className="text-muted-foreground">{session.processName}</TableCell>
                    <TableCell>{formatTime(session.startedAt)}</TableCell>
                    <TableCell>{formatTime(session.endedAt)}</TableCell>
                    <TableCell className="text-right">{formatDuration(session.activeSeconds)}</TableCell>
                    <TableCell className="text-right">{session.keyPressCount}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {session.keyNames?.slice(0, 20).join(", ") || "-"}
                      {session.keyNames?.length > 20 ? "..." : ""}
                    </TableCell>
                  </TableRow>
                ))}
                {!loading && sessions.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">No sessions found for the selected date.</TableCell></TableRow>
                )}
                {loading && (
                  <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">Loading session timeline...</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
};

export default MonitorAppUsage;
