import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clock3, Monitor, RefreshCw } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getMonitorAppUsage, MonitorAppUsageEmployee, MonitorAppUsageSession } from "@/services/monitorActivity";
import { formatDateTimeInOrgTimeZone, getOrgTimeZone, setOrgTimeZone, subscribeToOrgTimeZone, toDateKeyInOrgTimeZone } from "@/utils/timezone";
import { toast } from "sonner";

const today = () => toDateKeyInOrgTimeZone(new Date());
const INITIAL_SESSION_LIMIT = 100;
const APP_DETAIL_LIMIT = 1000;

type AppUsageGroup = {
  appName: string;
  processName: string;
  totalSeconds: number;
  keyPressCount: number;
  sessionCount: number;
};

const formatDuration = (seconds: number) => {
  const total = Math.max(Number(seconds || 0), 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${hours}h ${minutes}m`;
};

const formatTime = (value: string | null, timeZone: string) => {
  if (!value) return "-";
  try {
    return formatDateTimeInOrgTimeZone(value, {}, timeZone);
  } catch {
    return value;
  }
};

const formatKeys = (keys: string[] | undefined) => {
  const filtered = (keys || []).map((key) => String(key || "").trim()).filter(Boolean);
  return filtered.length > 0 ? filtered.join(", ") : "-";
};

const formatTypedText = (value: string | null | undefined) => {
  const text = String(value || "").trim();
  return text.length > 0 ? text : "-";
};

const groupAppSessions = (sessions: MonitorAppUsageSession[]) => {
  const grouped = new Map<string, AppUsageGroup>();

  for (const session of sessions) {
    const key = `${session.appName}::${session.processName}`;
    const current = grouped.get(key) || {
      appName: session.appName,
      processName: session.processName,
      totalSeconds: 0,
      keyPressCount: 0,
      sessionCount: 0
    };

    current.totalSeconds += Number(session.activeSeconds || 0);
    current.keyPressCount += Number(session.keyPressCount || 0);
    current.sessionCount += 1;
    grouped.set(key, current);
  }

  return Array.from(grouped.values()).sort(
    (a, b) => b.totalSeconds - a.totalSeconds || a.appName.localeCompare(b.appName) || a.processName.localeCompare(b.processName)
  );
};

const MonitorAppUsage = () => {
  const [date, setDate] = useState(today);
  const [employees, setEmployees] = useState<MonitorAppUsageEmployee[]>([]);
  const [sessions, setSessions] = useState<MonitorAppUsageSession[]>([]);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [timeZone, setTimeZone] = useState(() => getOrgTimeZone());
  const [selectedGroup, setSelectedGroup] = useState<AppUsageGroup | null>(null);
  const [detailSessions, setDetailSessions] = useState<MonitorAppUsageSession[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const detailRequestSeqRef = useRef(0);

  const loadSessions = useCallback(async (manual = false) => {
    if (manual) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const data = await getMonitorAppUsage(date, { limit: INITIAL_SESSION_LIMIT, offset: 0 });
      if (data.timezone) {
        setTimeZone(data.timezone);
        setOrgTimeZone(data.timezone);
      }
      setEmployees(data.employees || []);
      setSessions(data.sessions || []);
      setSessionTotal(Number(data.sessionPage?.total || (data.sessions || []).length || 0));
    } catch (error) {
      if (manual) toast.error("Could not refresh app usage.");
      console.error("Could not load app usage", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [date]);

  const loadAppDetails = useCallback(async (group: AppUsageGroup) => {
    const requestSeq = ++detailRequestSeqRef.current;
    setSelectedGroup(group);
    setDetailSessions([]);
    setDetailLoading(true);

    try {
      const data = await getMonitorAppUsage(date, {
        appName: group.appName,
        processName: group.processName,
        limit: APP_DETAIL_LIMIT,
        offset: 0
      });

      if (requestSeq !== detailRequestSeqRef.current) return;
      setDetailSessions(data.sessions || []);
    } catch (error) {
      if (requestSeq === detailRequestSeqRef.current) {
        toast.error("Could not load app details.");
      }
      console.error("Could not load app details", error);
    } finally {
      if (requestSeq === detailRequestSeqRef.current) {
        setDetailLoading(false);
      }
    }
  }, [date]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => subscribeToOrgTimeZone(setTimeZone), []);

  useEffect(() => {
    setDate(toDateKeyInOrgTimeZone(new Date()));
  }, [timeZone]);

  useEffect(() => {
    setSelectedGroup(null);
    setDetailSessions([]);
    setDetailLoading(false);
  }, [date]);

  const employeeCount = employees.length;
  const sessionCount = sessionTotal || sessions.length;
  const totalSeconds = employees.reduce((sum, employee) => sum + Number(employee.totalSeconds || 0), 0);
  const totalKeyPresses = employees.reduce((sum, employee) => sum + Number(employee.totalKeyPresses || 0), 0);
  const topEmployee = useMemo(() => employees[0] || null, [employees]);
  const groupedApps = useMemo(() => groupAppSessions(sessions), [sessions]);

  const closeDetails = () => {
    setSelectedGroup(null);
    setDetailSessions([]);
    setDetailLoading(false);
  };

  return (
    <MainLayout title="App Usage" breadcrumb={[{ label: "Home", href: "/" }, { label: "Employee Monitor" }, { label: "App Usage" }]}>
      <TooltipProvider>
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
              <Button variant="outline" onClick={() => void loadSessions(true)} disabled={refreshing}>
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
                              {app.appName} {app.sessionCount > 1 ? `(${app.sessionCount})` : ""} {app.keyPressCount ? `- ${app.keyPressCount}` : ""}
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
              <CardTitle className="flex items-center gap-2"><Clock3 className="h-5 w-5" /> App timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-4 text-sm text-muted-foreground">
                Showing app groups from the first {INITIAL_SESSION_LIMIT} sessions. Use Refresh if you want the latest data.
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>App</TableHead>
                    <TableHead>Process</TableHead>
                    <TableHead className="text-right">Sessions</TableHead>
                    <TableHead className="text-right">Focused time</TableHead>
                    <TableHead className="text-right">Key presses</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && (
                    <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">Loading app timeline...</TableCell></TableRow>
                  )}
                  {!loading && groupedApps.map((group) => (
                    <TableRow key={`${group.appName}::${group.processName}`}>
                      <TableCell className="font-medium">{group.appName}</TableCell>
                      <TableCell className="text-muted-foreground">{group.processName}</TableCell>
                      <TableCell className="text-right">{group.sessionCount}</TableCell>
                      <TableCell className="text-right">{formatDuration(group.totalSeconds)}</TableCell>
                      <TableCell className="text-right">{group.keyPressCount}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void loadAppDetails(group)}
                              >
                                <Clock3 className="mr-2 h-4 w-4" />
                                Show details
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Show all sessions for this app</TooltipContent>
                          </Tooltip>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!loading && groupedApps.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">No sessions found for the selected date.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <Dialog open={Boolean(selectedGroup)} onOpenChange={(open) => { if (!open) closeDetails(); }}>
          <DialogContent
            className="overflow-hidden p-0"
            style={{ width: "96vw", maxWidth: "96vw", height: "96vh" }}
          >
            <div className="flex h-full flex-col">
              <DialogHeader className="border-b px-4 py-4 sm:px-6">
                <DialogTitle>Show details</DialogTitle>
                <DialogDescription className="break-words">
                  {selectedGroup ? `${selectedGroup.appName} - ${selectedGroup.processName}` : ""}
                </DialogDescription>
              </DialogHeader>

              <div className="flex flex-1 flex-col gap-4 overflow-hidden px-4 py-4 sm:px-6">
                <div className="grid gap-2 text-sm sm:grid-cols-3">
                  <div className="rounded-md border p-3">
                    <div className="text-muted-foreground">App</div>
                    <div className="font-medium break-words">{selectedGroup?.appName || "-"}</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-muted-foreground">Process</div>
                    <div className="font-medium break-words">{selectedGroup?.processName || "-"}</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-muted-foreground">Sessions</div>
                    <div className="font-medium">{detailSessions.length || selectedGroup?.sessionCount || 0}</div>
                  </div>
                </div>

                <div className="min-h-0 flex-1 rounded-md border">
                  <div className="h-full overflow-auto" style={{ maxHeight: "calc(96vh - 18rem)" }}>
                    <table className="min-w-[60rem] w-full border-separate border-spacing-0 text-sm">
                      <thead>
                        <tr>
                          <th className="sticky top-0 z-40 min-w-[12rem] whitespace-nowrap bg-background px-4 py-3 text-left font-medium text-muted-foreground">Session start</th>
                          <th className="sticky top-0 z-40 min-w-[12rem] whitespace-nowrap bg-background px-4 py-3 text-left font-medium text-muted-foreground">Session end</th>
                          <th className="sticky top-0 z-40 min-w-[18rem] bg-background px-4 py-3 text-left font-medium text-muted-foreground">Keys</th>
                          <th className="sticky top-0 z-40 min-w-[20rem] bg-background px-4 py-3 text-left font-medium text-muted-foreground">Typed text</th>
                          <th className="sticky right-0 top-0 z-40 min-w-[8rem] whitespace-nowrap bg-background px-4 py-3 text-right font-medium text-muted-foreground">Key strokes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailLoading && (
                          <tr>
                            <td colSpan={5} className="py-10 text-center text-muted-foreground">
                              Loading session details...
                            </td>
                          </tr>
                        )}
                        {!detailLoading && detailSessions.map((session) => (
                          <tr key={session.sessionId} className="hover:bg-muted/50">
                            <td className="px-4 py-4 align-middle whitespace-nowrap">{formatTime(session.startedAt, timeZone)}</td>
                            <td className="px-4 py-4 align-middle whitespace-nowrap">{formatTime(session.endedAt, timeZone)}</td>
                            <td className="min-w-[18rem] bg-background px-4 py-4 align-middle text-muted-foreground">
                              <div className="max-w-[26rem] whitespace-pre-wrap break-words">
                                {formatKeys(session.keyNames)}
                              </div>
                            </td>
                            <td className="min-w-[20rem] bg-background px-4 py-4 align-middle text-muted-foreground">
                              <div className="max-w-[28rem] whitespace-pre-wrap break-words">
                                {formatTypedText(session.typedText)}
                              </div>
                            </td>
                            <td className="sticky right-0 z-20 min-w-[8rem] bg-background px-4 py-4 align-middle whitespace-nowrap text-right">{session.keyPressCount}</td>
                          </tr>
                        ))}
                        {!detailLoading && detailSessions.length === 0 && (
                          <tr>
                            <td colSpan={5} className="py-10 text-center text-muted-foreground">
                              No session details found for this app.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </TooltipProvider>
    </MainLayout>
  );
};

export default MonitorAppUsage;
