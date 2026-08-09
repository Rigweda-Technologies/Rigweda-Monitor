import { useEffect, useMemo, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { getApiWithToken } from "@/services/apiWrapper";
import { Calculator, IndianRupee, Layers3, Search, UsersRound } from "lucide-react";
import { toast } from "sonner";
import PayrollSectionNav from "@/components/payroll/PayrollSectionNav";
import {
  buildMonthOptions,
  formatCurrency,
  getStatusBadge
} from "@/components/payroll/payrollShared";

type PayrollRun = {
  id: string;
  run_code: string;
  run_name: string;
  pay_month: string;
  status: string;
};

type BreakdownComponent = {
  component_scope: "earning" | "deduction" | "employer_contribution";
  component_code: string;
  component_name: string;
  amount: number;
};

type BreakdownEmployee = {
  id: string;
  employee_external_id: string;
  employee_name?: string | null;
  employee_code?: string | null;
  payroll_status: string;
  net_pay: number;
  error_message?: string | null;
  components: BreakdownComponent[];
};

const componentBadgeClass = (scope: string) => {
  if (scope === "earning") return "bg-green-100 text-green-800";
  if (scope === "deduction") return "bg-red-100 text-red-800";
  return "bg-blue-100 text-blue-800";
};

const PayrollEmployeeBreakdown = () => {
  const [settings, setSettings] = useState<any>(null);
  const monthOptions = useMemo(
    () =>
      buildMonthOptions({
        payrollCutoffDay: settings?.payrollCutoffDay,
        payrollSalaryPayDay: settings?.payrollSalaryPayDay
      }),
    [settings?.payrollCutoffDay, settings?.payrollSalaryPayDay]
  );
  const [monthFilter, setMonthFilter] = useState("");
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [rows, setRows] = useState<BreakdownEmployee[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadingRows, setLoadingRows] = useState(false);

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) || null,
    [runs, selectedRunId]
  );

  const summary = useMemo(() => {
    const componentCount = rows.reduce((total, row) => total + row.components.length, 0);
    const errorCount = rows.filter((row) => row.error_message || row.payroll_status === "error").length;
    const netPay = rows.reduce((total, row) => total + Number(row.net_pay || 0), 0);

    return {
      employeeCount: rows.length,
      componentCount,
      errorCount,
      netPay
    };
  }, [rows]);

  const loadRuns = async (month: string) => {
    setLoadingRuns(true);
    try {
      const res = await getApiWithToken(`/payroll/runs?payMonth=${month}`);
      if (!res?.success) {
        setRuns([]);
        setSelectedRunId("");
        toast.error(res?.message || "Failed to load payroll runs");
        return;
      }
      const data = Array.isArray(res.data) ? res.data : [];
      setRuns(data);
      setSelectedRunId(data[0]?.id || "");
    } finally {
      setLoadingRuns(false);
    }
  };

  const loadSettings = async () => {
    const res = await getApiWithToken("/payroll/settings");
    if (res?.success) {
      setSettings(res.data || null);
    }
  };

  const loadBreakdown = async (runId: string, query: string) => {
    if (!runId) {
      setRows([]);
      return;
    }
    setLoadingRows(true);
    try {
      const suffix = query.trim() ? `?search=${encodeURIComponent(query.trim())}` : "";
      const res = await getApiWithToken(`/payroll/runs/${runId}/employee-breakdown${suffix}`);
      if (!res?.success) {
        setRows([]);
        toast.error(res?.message || "Failed to load employee breakdown");
        return;
      }
      setRows(Array.isArray(res?.data?.employees) ? res.data.employees : []);
    } finally {
      setLoadingRows(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    if (!monthFilter) return;
    loadRuns(monthFilter);
  }, [monthFilter]);

  useEffect(() => {
    if (!monthOptions.length) return;
    if (!monthFilter || !monthOptions.includes(monthFilter)) {
      setMonthFilter(monthOptions[0]);
    }
  }, [monthFilter, monthOptions]);

  useEffect(() => {
    loadBreakdown(selectedRunId, submittedSearch);
  }, [selectedRunId, submittedSearch]);

  const onSearch = () => setSubmittedSearch(search);

  return (
    <MainLayout
      title="Payroll Employee Breakdown"
      breadcrumb={[
        { label: "Home", href: "/" },
        { label: "Payroll", href: "/payroll" },
        { label: "Employee Breakdown" }
      ]}
    >
      <PayrollSectionNav />

      <div className="mb-6 rounded-lg border bg-card p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[180px_minmax(220px,1fr)_minmax(280px,380px)]">
          <div>
            <p className="mb-1 text-sm font-medium">Month</p>
            <Select value={monthFilter} onValueChange={setMonthFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {monthOptions.map((month) => (
                  <SelectItem key={month} value={month}>
                    {month}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <p className="mb-1 text-sm font-medium">Payroll Run</p>
            <Select value={selectedRunId || undefined} onValueChange={setSelectedRunId}>
              <SelectTrigger>
                <SelectValue placeholder={loadingRuns ? "Loading runs..." : "Select run"} />
              </SelectTrigger>
              <SelectContent>
                {runs.map((run) => (
                  <SelectItem key={run.id} value={run.id}>
                    {run.run_code} | {run.run_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <p className="mb-1 text-sm font-medium">Search Employee</p>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Name / code / id / status"
                />
              </div>
              <Button variant="outline" onClick={onSearch}>
                Search
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">Employees</p>
            <UsersRound className="h-4 w-4 text-slate-500" />
          </div>
          <p className="mt-2 text-2xl font-semibold">{summary.employeeCount}</p>
        </div>
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">Components</p>
            <Layers3 className="h-4 w-4 text-slate-500" />
          </div>
          <p className="mt-2 text-2xl font-semibold">{summary.componentCount}</p>
        </div>
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">Net Pay</p>
            <IndianRupee className="h-4 w-4 text-slate-500" />
          </div>
          <p className="mt-2 text-2xl font-semibold text-green-700">
            {formatCurrency(summary.netPay)}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">Issues</p>
            <Calculator className="h-4 w-4 text-slate-500" />
          </div>
          <p className="mt-2 text-2xl font-semibold">{summary.errorCount}</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
        <div className="flex flex-col gap-2 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold">Employee Salary Components</p>
            <p className="text-sm text-muted-foreground">
              {selectedRun
                ? `${selectedRun.run_code} | ${selectedRun.run_name}`
                : "Select a payroll run to inspect earnings, deductions, and employer contributions."}
            </p>
          </div>
          {selectedRun && getStatusBadge(selectedRun.status)}
        </div>
        <div className="max-h-[68vh] overflow-auto p-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Salary Components</TableHead>
                <TableHead className="text-right">Net Pay</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingRows &&
                Array.from({ length: 5 }).map((_, index) => (
                  <TableRow key={`breakdown-skeleton-${index}`}>
                    <TableCell colSpan={4}>
                      <Skeleton className="h-12 w-full" />
                    </TableCell>
                  </TableRow>
                ))}

              {!loadingRows && rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <p className="font-medium">{row.employee_name || "Employee"}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.employee_code || "-"} | {row.employee_external_id}
                    </p>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      {getStatusBadge(row.payroll_status)}
                      {row.error_message && (
                        <p className="text-xs text-red-600">{row.error_message}</p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      {row.components.map((component, index) => (
                        <span
                          key={`${component.component_scope}-${component.component_code}-${index}`}
                          className={`text-xs px-2 py-1 rounded ${componentBadgeClass(
                            component.component_scope
                          )}`}
                          title={`${component.component_name}`}
                        >
                          {component.component_code}: {formatCurrency(Number(component.amount || 0))}
                        </span>
                      ))}
                      {!row.components.length && (
                        <span className="text-xs text-muted-foreground">No components</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    {formatCurrency(Number(row.net_pay || 0))}
                  </TableCell>
                </TableRow>
              ))}
              {!rows.length && !loadingRows && (
                <TableRow>
                  <TableCell colSpan={4} className="h-32 text-center text-muted-foreground">
                    {selectedRunId
                      ? "No employee breakdown rows found"
                      : "Select a payroll run to view employee breakdown"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </MainLayout>
  );
};

export default PayrollEmployeeBreakdown;
