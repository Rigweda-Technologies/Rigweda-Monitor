import { useCallback, useEffect, useMemo, useState } from "react";
import { Keyboard, Monitor, RefreshCw } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getApiWithToken } from "@/services/apiWrapper";
import { getMonitorAppKeyUsage, MonitorAppKeyUsage } from "@/services/monitorActivity";
import { getOrgTimeZone, subscribeToOrgTimeZone, toDateKeyInOrgTimeZone } from "@/utils/timezone";
import { toast } from "sonner";

const today = () => toDateKeyInOrgTimeZone(new Date());
const smoothCardShadow = "shadow-[0_10px_30px_rgba(15,23,42,0.08)] transition-shadow hover:shadow-[0_14px_36px_rgba(15,23,42,0.12)]";

type EmployeeOption = {
  _id: string;
  firstName?: string;
  lastName?: string;
  employeeCode?: string;
};

const getEmployeeName = (employee: EmployeeOption) =>
  [employee.firstName, employee.lastName].filter(Boolean).join(" ").trim() ||
  employee.employeeCode ||
  "Employee";

const formatDuration = (seconds: number) => {
  const total = Math.max(Number(seconds || 0), 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${hours}h ${minutes}m`;
};

const MonitorAppKeyUsage = () => {
  const [searchParams] = useSearchParams();
  const employeeIdParam = searchParams.get("employeeId") || "";
  const dateParam = searchParams.get("date") || "";
  const [date, setDate] = useState(dateParam || today());
  const [rows, setRows] = useState<MonitorAppKeyUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [timeZone, setTimeZone] = useState(() => getOrgTimeZone());
  const [employeeId, setEmployeeId] = useState(employeeIdParam || "all");
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);

  useEffect(() => {
    if (dateParam) {
      setDate(dateParam);
    }
    setEmployeeId(employeeIdParam || "all");
  }, [dateParam, employeeIdParam]);

  const loadEmployees = useCallback(async () => {
    const response = await getApiWithToken("/employees?employeeState=active&limit=500", null, {
      requiredPermissions: ["EMP_VIEW"]
    });
    if (response?.success) {
      setEmployees(response.data?.items || []);
    }
  }, []);

  const load = useCallback(async (manual = false) => {
    if (manual) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const data = await getMonitorAppKeyUsage(date, { employeeId: employeeId === "all" ? undefined : employeeId });
      setRows(data.appKeys || []);
    } catch (error) {
      if (manual) toast.error("Could not refresh key press usage.");
      console.error("Could not load key press usage", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [date, employeeId]);

  useEffect(() => {
    void loadEmployees();
  }, [loadEmployees]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => subscribeToOrgTimeZone(setTimeZone), []);

  useEffect(() => {
    if (!dateParam) {
      setDate(toDateKeyInOrgTimeZone(new Date()));
    }
  }, [timeZone, dateParam]);

  useEffect(() => {
    const interval = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(interval);
  }, [load]);

  const totalRows = rows.length;
  const totalSeconds = rows.reduce((sum, row) => sum + Number(row.totalSeconds || 0), 0);
  const totalKeyPresses = rows.reduce((sum, row) => sum + Number(row.keyPressCount || 0), 0);
  const totalSessions = rows.reduce((sum, row) => sum + Number(row.sessionCount || 0), 0);
  const topItem = useMemo(() => rows.slice().sort((a, b) => b.keyPressCount - a.keyPressCount)[0] || null, [rows]);

  return (
    <MainLayout title="Key Presses" breadcrumb={[{ label: "Home", href: "/" }, { label: "Employee Monitor" }, { label: "Key Presses" }]}>      
      <div className="space-y-6">
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-2xl font-semibold">Application key presses</h2>
            <p className="text-sm text-muted-foreground">
              Shows app-wise key press counts for monitored employee sessions.
            </p>
            <p className="text-xs text-muted-foreground">Displayed in {timeZone} time.</p>
          </div>
          <div className="grid w-full gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(220px,1fr)_minmax(160px,200px)_minmax(150px,200px)] xl:max-w-[660px] xl:self-end">
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger className="w-full min-w-0">
                <SelectValue placeholder="Employee" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All employees</SelectItem>
                {employees.map((employee) => (
                  <SelectItem key={employee._id} value={employee._id}>
                    {getEmployeeName(employee)}{employee.employeeCode ? ` (${employee.employeeCode})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="w-full min-w-0" />
            <Button variant="outline" className="w-full" onClick={() => void load(true)} disabled={refreshing}>
              <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-5">
          <Card className={smoothCardShadow}><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">App rows</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{totalRows}</CardContent></Card>
          <Card className={smoothCardShadow}><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Total sessions</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{totalSessions}</CardContent></Card>
          <Card className={smoothCardShadow}><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Focused time</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{formatDuration(totalSeconds)}</CardContent></Card>
          <Card className={smoothCardShadow}><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Key presses</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{totalKeyPresses}</CardContent></Card>
          <Card className={smoothCardShadow}><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Top app</CardTitle></CardHeader><CardContent className="truncate text-lg font-bold">{topItem ? `${topItem.appName} (${topItem.keyPressCount})` : "None"}</CardContent></Card>
        </div>

        <Card className={smoothCardShadow}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Keyboard className="h-5 w-5" /> App-wise key presses</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Employee ID</TableHead>
                  <TableHead>App</TableHead>
                  <TableHead>Process</TableHead>
                  <TableHead className="text-right">Sessions</TableHead>
                  <TableHead className="text-right">Time</TableHead>
                  <TableHead className="text-right">Keys</TableHead>
                  <TableHead>Typed text</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!loading && rows.map((row) => (
                  <TableRow key={`${row.employeeId}-${row.appName}-${row.processName}`}>
                    <TableCell className="font-medium">{row.employeeName || "Employee"}</TableCell>
                    <TableCell>{row.employeeCode || row.employeeId}</TableCell>
                    <TableCell>{row.appName}</TableCell>
                    <TableCell className="text-muted-foreground">{row.processName}</TableCell>
                    <TableCell className="text-right">{row.sessionCount}</TableCell>
                    <TableCell className="text-right">{formatDuration(row.totalSeconds)}</TableCell>
                    <TableCell className="text-right">{row.keyPressCount}</TableCell>
                    <TableCell className="text-muted-foreground">
                      <div className="max-w-[32rem] whitespace-break-spaces break-words font-mono text-xs leading-5">
                        {row.typedText || "-"}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {!loading && rows.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="py-10 text-center text-muted-foreground">No key press data was recorded for this date.</TableCell></TableRow>
                )}
                {loading && (
                  <TableRow><TableCell colSpan={8} className="py-10 text-center text-muted-foreground">Loading key press activity...</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
};

export default MonitorAppKeyUsage;
