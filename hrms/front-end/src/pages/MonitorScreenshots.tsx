import { useCallback, useEffect, useMemo, useState } from "react";
import { Camera, ImageOff, RefreshCw } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { getApiWithToken } from "@/services/apiWrapper";
import { getMonitorScreenshots, MonitorScreenshot } from "@/services/monitorActivity";
import { getOrgTimeZone, subscribeToOrgTimeZone, toDateKeyInOrgTimeZone } from "@/utils/timezone";
import { toast } from "sonner";

const today = () => toDateKeyInOrgTimeZone(new Date());
const PAGE_SIZE = 20;

const hourOptions = Array.from({ length: 24 }, (_, hour) => {
  const labelHour = hour % 12 || 12;
  const suffix = hour < 12 ? "AM" : "PM";
  return {
    value: String(hour),
    label: `${String(hour).padStart(2, "0")}:00 - ${labelHour} ${suffix}`
  };
});

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

const MonitorScreenshots = () => {
  const [searchParams] = useSearchParams();
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [employeeId, setEmployeeId] = useState(() => searchParams.get("employeeId") || "all");
  const [date, setDate] = useState(() => searchParams.get("date") || today());
  const [hour, setHour] = useState(() => searchParams.get("hour") || "all");
  const [onlyWithImage, setOnlyWithImage] = useState(() => searchParams.get("onlyWithImage") || "true");
  const [items, setItems] = useState<MonitorScreenshot[]>([]);
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [timeZone, setTimeZone] = useState(() => getOrgTimeZone());

  const selectedEmployeeName = useMemo(() => {
    if (employeeId === "all") return "All employees";
    const employee = employees.find((item) => item._id === employeeId);
    return employee ? getEmployeeName(employee) : "Selected employee";
  }, [employeeId, employees]);

  const loadEmployees = useCallback(async () => {
    const response = await getApiWithToken("/employees?employeeState=active&limit=500", null, {
      requiredPermissions: ["EMP_VIEW"]
    });
    if (response?.success) {
      setEmployees(response.data?.items || []);
    }
  }, []);

  const loadScreenshots = useCallback(async (nextPage = 1, mode: "initial" | "manual" | "more" = "initial") => {
    if (mode === "manual") setRefreshing(true);
    else if (mode === "more") setLoadingMore(true);
    else setLoading(true);

    try {
      const data = await getMonitorScreenshots({
        employeeId: employeeId === "all" ? undefined : employeeId,
        date,
        hour: hour === "all" ? undefined : hour,
        onlyWithImage: onlyWithImage === "true" ? true : onlyWithImage === "false" ? false : undefined,
        page: nextPage,
        limit: PAGE_SIZE
      });
      setPage(data.page || nextPage);
      setCount(Number(data.count || 0));
      setTotal(Number(data.total ?? data.count ?? 0));
      setItems((prev) => (nextPage > 1 ? [...prev, ...(data.items || [])] : data.items || []));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load screenshots.");
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [date, employeeId, hour, onlyWithImage]);

  useEffect(() => {
    void loadEmployees();
  }, [loadEmployees]);

  useEffect(() => subscribeToOrgTimeZone(setTimeZone), []);

  useEffect(() => {
    setDate(toDateKeyInOrgTimeZone(new Date()));
  }, [timeZone]);

  useEffect(() => {
    void loadScreenshots(1);
  }, [loadScreenshots]);

  const visibleWithImages = items.filter((item) => item.imageUrl).length;
  const hasMore = items.length < total && count > 0;
  const getScreenshotLabel = (item: MonitorScreenshot) => {
    const rawName = item.publicId || item.screenshotId;
    const leafName = rawName.split("/").pop() || rawName;
    return leafName.length > 42 ? `${leafName.slice(0, 24)}...${leafName.slice(-12)}` : leafName;
  };

  return (
    <MainLayout title="Screenshots" breadcrumb={[{ label: "Home", href: "/" }, { label: "Employee Monitor" }, { label: "Screenshots" }]}>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h2 className="text-2xl font-semibold">Employee screenshots</h2>
            <p className="text-sm text-muted-foreground">
              Review attendance screenshots employee-wise from the monitor API.
            </p>
            <p className="text-xs text-muted-foreground">Displayed in {timeZone} time.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger className="lg:w-[220px]"><SelectValue placeholder="Employee" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All employees</SelectItem>
                {employees.map((employee) => (
                  <SelectItem key={employee._id} value={employee._id}>
                    {getEmployeeName(employee)}{employee.employeeCode ? ` (${employee.employeeCode})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            <Select value={hour} onValueChange={setHour}>
              <SelectTrigger><SelectValue placeholder="Hour" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All hours</SelectItem>
                {hourOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={onlyWithImage} onValueChange={setOnlyWithImage}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="true">With images</SelectItem>
                <SelectItem value="all">All records</SelectItem>
                <SelectItem value="false">Missing images</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => void loadScreenshots(1, "manual")} disabled={refreshing}>
              <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Employee filter</CardTitle></CardHeader><CardContent className="truncate text-lg font-bold sm:text-xl">{selectedEmployeeName}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Records loaded</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{items.length}{total ? ` / ${total}` : ""}</CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Images available</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{visibleWithImages}</CardContent></Card>
        </div>

        {loading && (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-72 rounded-lg" />
            ))}
          </div>
        )}

        {!loading && items.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {items.map((item) => (
              <Card key={item.screenshotId} className="overflow-hidden">
                <div className="flex aspect-[4/3] items-center justify-center bg-muted">
                  {item.imageUrl ? (
                    <a href={item.imageUrl} target="_blank" rel="noreferrer" className="h-full w-full">
                      <img
                        src={item.imageUrl}
                        alt={getScreenshotLabel(item)}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    </a>
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <ImageOff className="h-8 w-8" />
                      <span className="text-sm">No image captured</span>
                    </div>
                  )}
                </div>
                <CardContent className="p-4">
                  <p className="truncate text-sm font-medium" title={getScreenshotLabel(item)}>
                    {getScreenshotLabel(item)}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {!loading && items.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center text-muted-foreground">
              <Camera className="h-10 w-10" />
              <p>No screenshots found for the selected filters.</p>
            </CardContent>
          </Card>
        )}

        {!loading && items.length > 0 && (
          <div className="flex justify-center">
            <Button variant="outline" onClick={() => void loadScreenshots(page + 1, "more")} disabled={!hasMore || loadingMore}>
              {loadingMore ? "Loading..." : hasMore ? "Load more" : "No more records"}
            </Button>
          </div>
        )}
      </div>
    </MainLayout>
  );
};

export default MonitorScreenshots;
