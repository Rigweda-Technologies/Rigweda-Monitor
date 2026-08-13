import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, Globe, LayoutGrid, RefreshCw, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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

const formatLastSeen = (value: string | null) => {
  if (!value) return "-";
  return formatDateTimeInOrgTimeZone(value);
};

const getStatusMeta = (status: MonitorEmployeeActivity["status"], lastSeenAt: string | null) => {
  const lastSeenLabel = lastSeenAt ? `Last seen: ${formatLastSeen(lastSeenAt)}` : "Last seen: -";
  switch (status) {
    case "online":
      return {
        label: "Online",
        dotClassName: "bg-emerald-500",
        tooltip: "Online"
      };
    case "away":
      return {
        label: "Away",
        dotClassName: "bg-amber-400",
        tooltip: `Away\n${lastSeenLabel}`
      };
    default:
      return {
        label: "Offline",
        dotClassName: "bg-slate-400",
        tooltip: `Offline\n${lastSeenLabel}`
      };
  }
};

const MonitorEmployees = () => {
  const navigate = useNavigate();
  const [date, setDate] = useState(today);
  const [employees, setEmployees] = useState<MonitorEmployeeActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [timeZone, setTimeZone] = useState(() => getOrgTimeZone());

  const load = useCallback(async (manual = false) => {
    manual ? setRefreshing(true) : setLoading(true);
    try {
      const data = await getMonitorEmployeeActivity(date);
      setEmployees(data.employees || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load monitor employees.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => subscribeToOrgTimeZone(setTimeZone), []);

  const { onlineCount, awayCount, offlineCount, totalProductiveSeconds, totalIdleSeconds, totalSeconds } = useMemo(() => {
    const online = employees.filter((employee) => employee.status === "online").length;
    const away = employees.filter((employee) => employee.status === "away").length;
    const offline = employees.filter((employee) => employee.status === "offline").length;
    return {
      onlineCount: online,
      awayCount: away,
      offlineCount: offline,
      totalProductiveSeconds: employees.reduce((total, employee) => total + Number(employee.productiveSeconds || 0), 0),
      totalIdleSeconds: employees.reduce((total, employee) => total + Number(employee.idleSeconds || 0), 0),
      totalSeconds: employees.reduce((total, employee) => total + Number(employee.totalSeconds || 0), 0)
    };
  }, [employees]);

  return (
    <MainLayout title="Employees" breadcrumb={[{ label: "Home", href: "/" }, { label: "Employee Monitor" }, { label: "Employees" }]}>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold">Monitored employees</h2>
            <p className="text-sm text-muted-foreground">
              View the employees reporting monitor activity and jump straight into their screenshots.
            </p>
            <p className="text-xs text-muted-foreground">Date and time are shown in {timeZone} time.</p>
          </div>
          <div className="flex items-center gap-2">
            <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="w-[155px]" />
            <Button variant="outline" onClick={() => void load(true)} disabled={refreshing}>
              <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Tracked employees</CardTitle></CardHeader>
            <CardContent className="flex items-center gap-2 text-2xl font-bold"><Users className="h-5 w-5 text-muted-foreground" />{employees.length}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Online now</CardTitle></CardHeader>
            <CardContent className="text-2xl font-bold text-emerald-600">{onlineCount}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Away now</CardTitle></CardHeader>
            <CardContent className="text-2xl font-bold text-amber-500">{awayCount}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Offline now</CardTitle></CardHeader>
            <CardContent className="text-2xl font-bold text-slate-600">{offlineCount}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Total time</CardTitle></CardHeader>
            <CardContent className="text-2xl font-bold">{formatDuration(totalSeconds)}</CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Employee monitor table
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Employee ID</TableHead>
                    <TableHead className="text-right">Productive hours</TableHead>
                    <TableHead className="text-right">Idle hours</TableHead>
                    <TableHead className="text-right">Total hours</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!loading && employees.map((employee) => {
                    const statusMeta = getStatusMeta(employee.status, employee.lastSeenAt);
                    return (
                      <TableRow key={employee.employeeId}>
                        <TableCell className="font-medium">
                          <div className="flex items-start gap-3">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span
                                  className={`mt-1 inline-flex h-2.5 w-2.5 shrink-0 rounded-full ${statusMeta.dotClassName}`}
                                  aria-hidden="true"
                                />
                              </TooltipTrigger>
                              <TooltipContent>
                                <div className="whitespace-pre-line text-left">{statusMeta.tooltip}</div>
                              </TooltipContent>
                            </Tooltip>
                            <div className="flex flex-col">
                              <span>{employee.employeeName || "Employee"}</span>
                              <span className="text-xs text-muted-foreground">{employee.employeeCode || "-"}</span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>{employee.employeeId}</TableCell>
                        <TableCell className="text-right">{formatDuration(Number(employee.productiveSeconds || 0))}</TableCell>
                        <TableCell className="text-right">{formatDuration(Number(employee.idleSeconds || 0))}</TableCell>
                        <TableCell className="text-right">{formatDuration(Number(employee.totalSeconds || 0))}</TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-2">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="outline"
                                  className="h-9 w-9"
                                  aria-label="View screenshots"
                                  onClick={() =>
                                    navigate(
                                      `/monitor/screenshots?employeeId=${encodeURIComponent(employee.employeeId)}&date=${encodeURIComponent(date)}&onlyWithImage=true`
                                    )
                                  }
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>View screenshots</TooltipContent>
                            </Tooltip>

                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="outline"
                                  className="h-9 w-9"
                                  aria-label="View webhistory"
                                  onClick={() =>
                                    navigate(
                                      `/monitor/activity?date=${encodeURIComponent(date)}`
                                    )
                                  }
                                >
                                  <Globe className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>View webhistory</TooltipContent>
                            </Tooltip>

                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="outline"
                                  className="h-9 w-9"
                                  aria-label="View apps used"
                                  onClick={() =>
                                    navigate(
                                      `/monitor/apps?date=${encodeURIComponent(date)}`
                                    )
                                  }
                                >
                                  <LayoutGrid className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>View apps used</TooltipContent>
                            </Tooltip>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!loading && employees.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                        No monitored employees were found for this date.
                      </TableCell>
                    </TableRow>
                  )}
                  {loading && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                        Loading monitored employees...
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            <div className="mt-4 text-sm text-muted-foreground">
              Productive time: {formatDuration(totalProductiveSeconds)} | Idle time: {formatDuration(totalIdleSeconds)} | Total time: {formatDuration(totalSeconds)}
            </div>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
};

export default MonitorEmployees;
