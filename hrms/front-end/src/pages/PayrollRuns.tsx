import { useCallback, useEffect, useMemo, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle
} from "@/components/ui/sheet";
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
import { getApiWithToken, postApiWithToken } from "@/services/apiWrapper";
import { hasAnyPermission } from "@/utils/auth";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Download,
  Eye,
  RefreshCcw,
  Search,
  ShieldCheck
} from "lucide-react";
import PayrollSectionNav from "@/components/payroll/PayrollSectionNav";
import {
  buildMonthOptions,
  formatCurrency,
  getStatusBadge,
  normalizeWarnings,
  type EmployeeListPayload,
  type EmployeeOption,
  type EmployeePayrollProfile,
  type PayGroup,
  type PayrollRun,
  type PayrollRunEmployee,
  type PayslipData
} from "@/components/payroll/payrollShared";

const PayrollRuns = () => {
  const [settings, setSettings] = useState<any>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const monthOptions = useMemo(
    () =>
      buildMonthOptions({
        payrollCutoffDay: settings?.payrollCutoffDay,
        payrollSalaryPayDay: settings?.payrollSalaryPayDay
      }),
    [settings?.payrollCutoffDay, settings?.payrollSalaryPayDay]
  );
  const [monthFilter, setMonthFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [payGroups, setPayGroups] = useState<PayGroup[]>([]);
  const [selectedPayGroupId, setSelectedPayGroupId] = useState("");
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>("");
  const [runDetail, setRunDetail] = useState<any>(null);
  const [runPreview, setRunPreview] = useState<any>(null);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadingRunDetail, setLoadingRunDetail] = useState(false);
  const [loadingAction, setLoadingAction] = useState("");
  const [payslipOpen, setPayslipOpen] = useState(false);
  const [payslipData, setPayslipData] = useState<PayslipData | null>(null);
  const [employeeNameMap, setEmployeeNameMap] = useState<Record<string, string>>({});
  const [employeeCodeMap, setEmployeeCodeMap] = useState<Record<string, string>>({});
  const [createRunDialogOpen, setCreateRunDialogOpen] = useState(false);
  const [employeeProfiles, setEmployeeProfiles] = useState<EmployeePayrollProfile[]>([]);
  const [eligibleEmployees, setEligibleEmployees] = useState<EmployeeOption[]>([]);
  const [employeePickerSearch, setEmployeePickerSearch] = useState("");
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const [loadingEmployeePicker, setLoadingEmployeePicker] = useState(false);
  const [coveredEmployeeCount, setCoveredEmployeeCount] = useState(0);

  const canManageConfig = hasAnyPermission(["PAYROLL_CONFIG_MANAGE"]);
  const canCreateRun = hasAnyPermission(["PAYROLL_RUN_CREATE"]);
  const canApproveRun = hasAnyPermission(["PAYROLL_RUN_APPROVE"]);
  const canLockRun = hasAnyPermission(["PAYROLL_RUN_LOCK"]);
  const canViewReports = hasAnyPermission(["PAYROLL_REPORT_VIEW"]);
  const canViewPayslip = hasAnyPermission(["PAYROLL_PAYSLIP_VIEW"]);
  const payrollReady = !settingsLoaded || settings?.payrollEnabled !== false;

  const loadSettings = async () => {
    const res = await getApiWithToken("/payroll/settings");
    if (res?.success) {
      setSettings(res.data || null);
    }
    setSettingsLoaded(true);
  };

  const loadPayGroups = useCallback(async () => {
    const res = await getApiWithToken("/payroll/pay-groups?includeInactive=true", null, {
      requiredPermissions: ["PAYROLL_CONFIG_MANAGE"]
    });
    if (res?.success) {
      setPayGroups(Array.isArray(res.data) ? res.data : []);
    }
  }, []);

  const fetchAllEmployees = useCallback(async () => {
    const allEmployees: EmployeeOption[] = [];
    let page = 1;
    let totalPages = 1;

    do {
      const res = await getApiWithToken(`/employees?page=${page}&limit=500`);
      if (!res?.success) {
        return {
          success: false,
          message: res?.message || "Failed to load employees",
          items: [] as EmployeeOption[]
        };
      }

      const payload = (res.data || {}) as EmployeeListPayload;
      const items = Array.isArray(payload.items) ? payload.items : [];
      allEmployees.push(...items);
      totalPages = Math.max(1, Number(payload.pagination?.totalPages || 1));
      page += 1;
    } while (page <= totalPages);

    return { success: true, items: allEmployees };
  }, []);

  const loadEmployeeDirectory = useCallback(async () => {
    const res = await fetchAllEmployees();
    if (!res?.success) return;

    const nextNameMap: Record<string, string> = {};
    const nextCodeMap: Record<string, string> = {};
    for (const emp of res.items) {
      const id = String(emp?._id || "").trim();
      if (!id) continue;
      const fullName = `${emp?.firstName || ""} ${emp?.lastName || ""}`.trim();
      if (fullName) nextNameMap[id] = fullName;
      if (emp?.employeeCode) nextCodeMap[id] = String(emp.employeeCode);
    }
    setEmployeeNameMap(nextNameMap);
    setEmployeeCodeMap(nextCodeMap);
  }, [fetchAllEmployees]);

  const loadEmployeeProfiles = useCallback(async (payGroupId: string) => {
    if (!canManageConfig || !payGroupId) {
      setEmployeeProfiles([]);
      return;
    }
    const res = await getApiWithToken(
      `/payroll/employee-profiles?includeLatest=true&payGroupId=${payGroupId}&limit=200&offset=0`,
      null,
      { requiredPermissions: ["PAYROLL_CONFIG_MANAGE"] }
    );
    if (res?.success) {
      setEmployeeProfiles(Array.isArray(res.data) ? res.data : []);
    }
  }, [canManageConfig]);

  const loadRuns = useCallback(async (month: string, payGroupId?: string) => {
    setLoadingRuns(true);
    try {
      const query = payGroupId
        ? `/payroll/runs?payMonth=${month}&payGroupId=${payGroupId}`
        : `/payroll/runs?payMonth=${month}`;
      const res = await getApiWithToken(query);
      if (res?.success) {
        const data = Array.isArray(res.data) ? res.data : [];
        setRuns(data);
        if (!data.find((r: PayrollRun) => r.id === selectedRunId)) {
          setSelectedRunId(data[0]?.id || "");
        }
      } else {
        setRuns([]);
        toast.error(res?.message || "Failed to load payroll runs");
      }
    } finally {
      setLoadingRuns(false);
    }
  }, [selectedRunId]);

  const loadRunDetail = useCallback(async (runId: string) => {
    if (!runId) {
      setRunDetail(null);
      setRunPreview(null);
      return;
    }
    setLoadingRunDetail(true);
    try {
      const [detailRes, previewRes] = await Promise.all([
        getApiWithToken(`/payroll/runs/${runId}`),
        postApiWithToken(`/payroll/runs/${runId}/preview`, {
          includeComponents: true,
          includeEmployees: true,
          limitEmployees: 300
        })
      ]);
      if (detailRes?.success) {
        setRunDetail(detailRes.data || null);
      } else {
        setRunDetail(null);
      }
      if (previewRes?.success) {
        setRunPreview(previewRes.data || null);
      } else {
        setRunPreview(null);
      }
    } finally {
      setLoadingRunDetail(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
    loadEmployeeDirectory();
  }, [loadEmployeeDirectory]);

  useEffect(() => {
    if (!monthOptions.length) return;
    if (!monthFilter || !monthOptions.includes(monthFilter)) {
      setMonthFilter(monthOptions[0]);
    }
  }, [monthFilter, monthOptions]);

  useEffect(() => {
    if (!settingsLoaded || settings?.payrollEnabled === false) return;
    loadPayGroups();
  }, [loadPayGroups, settingsLoaded, settings?.payrollEnabled]);

  useEffect(() => {
    if (!payGroups.length) return;
    if (selectedPayGroupId && payGroups.some((group) => group.id === selectedPayGroupId)) return;
    const preferredPayGroupId =
      settings?.default_pay_group_id ||
      settings?.defaultPayGroupId ||
      payGroups.find((group) => group.is_active)?.id ||
      payGroups[0]?.id ||
      "";
    setSelectedPayGroupId(String(preferredPayGroupId || ""));
  }, [payGroups, selectedPayGroupId, settings?.defaultPayGroupId, settings?.default_pay_group_id]);

  useEffect(() => {
    if (!settingsLoaded || settings?.payrollEnabled === false || !monthFilter) return;
    loadRuns(monthFilter, selectedPayGroupId || undefined);
  }, [loadRuns, monthFilter, selectedPayGroupId, settingsLoaded, settings?.payrollEnabled]);

  useEffect(() => {
    if (!selectedPayGroupId) {
      setEmployeeProfiles([]);
      return;
    }
    loadEmployeeProfiles(selectedPayGroupId);
  }, [loadEmployeeProfiles, selectedPayGroupId]);

  useEffect(() => {
    if (selectedRunId) {
      loadRunDetail(selectedRunId);
    } else {
      setRunDetail(null);
      setRunPreview(null);
    }
  }, [loadRunDetail, selectedRunId]);

  const selectedRun = useMemo(
    () => runs.find((r) => r.id === selectedRunId) || null,
    [runs, selectedRunId]
  );
  const selectedRunStatus = String(selectedRun?.status || "").toLowerCase();
  const isDraftRun = !selectedRunStatus || selectedRunStatus === "draft";
  const isValidationFailedRun = selectedRunStatus === "validation_failed";
  const isReadyForApprovalRun = selectedRunStatus === "ready_for_approval";
  const isApprovedRun = selectedRunStatus === "approved";
  const isLockedRun = selectedRunStatus === "locked";
  const isFinalRun = ["locked", "paid", "cancelled"].includes(selectedRunStatus);
  const workflowHint = useMemo(() => {
    if (!selectedRun) return "Select a run to continue.";
    if (isDraftRun) return "Next step: Compute this run.";
    if (isValidationFailedRun) return "Next step: Recompute or validate the run.";
    if (isReadyForApprovalRun) return "Next step: Approve or reject the run.";
    if (isApprovedRun) return "Next step: Lock the approved run.";
    if (isLockedRun) return "Next step: Reopen only if changes are needed.";
    if (isFinalRun) return "This run is finalized.";
    return "Review the run state before taking the next action.";
  }, [
    isApprovedRun,
    isDraftRun,
    isFinalRun,
    isLockedRun,
    isReadyForApprovalRun,
    isValidationFailedRun,
    selectedRun
  ]);
  const salaryProrationRule = String(
    settings?.metadata?.attendance?.salaryProrationRule ||
      settings?.salaryProrationRule ||
      "payable_days"
  );

  const runEmployees = useMemo(() => {
    const rows: PayrollRunEmployee[] = Array.isArray(runDetail?.employees) ? runDetail.employees : [];
    if (!searchQuery.trim()) return rows;
    const query = searchQuery.toLowerCase();
    return rows.filter((row) =>
      [
        row.employee_external_id,
        employeeNameMap[row.employee_external_id] || "",
        String(row.payroll_status || "")
      ]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [runDetail?.employees, searchQuery, employeeNameMap]);

  const getEmployeeLabel = (employeeId: string) => {
    const name = employeeNameMap[employeeId];
    if (!name) return employeeCodeMap[employeeId] || employeeId;
    return `${name} (${employeeCodeMap[employeeId] || employeeId})`;
  };

  const filteredEligibleEmployees = useMemo(() => {
    const query = employeePickerSearch.trim().toLowerCase();
    if (!query) return eligibleEmployees;
    return eligibleEmployees.filter((emp) => {
      const fullName = `${emp.firstName || ""} ${emp.lastName || ""}`.trim().toLowerCase();
      return [fullName, emp.employeeCode || "", emp._id].join(" ").toLowerCase().includes(query);
    });
  }, [eligibleEmployees, employeePickerSearch]);

  const executeAction = async (label: string, fn: () => Promise<any>, onSuccess?: () => void) => {
    setLoadingAction(label);
    try {
      const res = await fn();
      if (res?.success) {
        toast.success(res.message || `${label} success`);
        await loadRuns(monthFilter, selectedPayGroupId || undefined);
        if (selectedRunId) await loadRunDetail(selectedRunId);
        if (selectedPayGroupId) await loadEmployeeProfiles(selectedPayGroupId);
        onSuccess?.();
      } else {
        toast.error(res?.message || `${label} failed`);
      }
    } finally {
      setLoadingAction("");
    }
  };

  const onGenerateSnapshot = () =>
    executeAction("Generate snapshot", () =>
      postApiWithToken("/payroll/attendance-snapshots/generate", {
        month: monthFilter,
        forceRebuild: true,
        ...(employeeProfiles.length
          ? { employeeIds: employeeProfiles.map((profile) => profile.employee_external_id) }
          : {})
      })
    );

  const onCreateRun = async (employeeIds: string[] = []) => {
    const payGroupId = selectedPayGroupId || settings?.default_pay_group_id || settings?.defaultPayGroupId;
    if (!payGroupId) {
      toast.error("Select a pay group before creating a payroll run");
      return;
    }
    const hasSelectedEmployees = employeeIds.length > 0;
    await executeAction(
      hasSelectedEmployees ? "Create supplementary run" : "Create run",
      () =>
        postApiWithToken("/payroll/runs", {
          payGroupId,
          payMonth: monthFilter,
          runType: hasSelectedEmployees ? "supplementary" : "regular",
          ...(employeeIds.length ? { employeeIds } : {})
        }),
      async () => {
        const res = await getApiWithToken(`/payroll/runs?payMonth=${monthFilter}&payGroupId=${payGroupId}`);
        if (res?.success && Array.isArray(res.data) && res.data[0]?.id) {
          setSelectedRunId(res.data[0].id);
        }
        setCreateRunDialogOpen(false);
        setSelectedEmployeeIds([]);
        setEmployeePickerSearch("");
      }
    );
  };

  const openCreateRunDialog = async () => {
    setCreateRunDialogOpen(true);
    setLoadingEmployeePicker(true);
    setSelectedEmployeeIds([]);
    setEmployeePickerSearch("");
    try {
      if (!selectedPayGroupId) {
        toast.error("Select a pay group first");
        setEligibleEmployees([]);
        setCoveredEmployeeCount(0);
        return;
      }
      const existingRunsRes = await getApiWithToken(
        `/payroll/runs?payMonth=${monthFilter}&payGroupId=${selectedPayGroupId}`
      );
      const existingRuns: PayrollRun[] =
        existingRunsRes?.success && Array.isArray(existingRunsRes.data) ? existingRunsRes.data : [];
      const activeExistingRuns = existingRuns.filter(
        (run) => !["rejected", "cancelled"].includes(String(run.status || "").toLowerCase())
      );
      const existingRunDetails = await Promise.all(
        activeExistingRuns.map((run) => getApiWithToken(`/payroll/runs/${run.id}`))
      );
      const coveredEmployeeIds = new Set(
        existingRunDetails.flatMap((res) =>
          res?.success && Array.isArray(res.data?.employees)
            ? res.data.employees
                .map((row: PayrollRunEmployee) => String(row.employee_external_id || "").trim())
                .filter(Boolean)
            : []
        )
      );
      const assignedEmployees = employeeProfiles
        .filter((profile) => String(profile.payroll_status || "active") !== "exited")
        .filter((profile) => !coveredEmployeeIds.has(String(profile.employee_external_id || "").trim()))
        .map((profile) => ({
          _id: String(profile.employee_external_id),
          firstName: profile.employee_name || employeeNameMap[profile.employee_external_id] || "",
          lastName: "",
          employeeCode: profile.employee_code || employeeCodeMap[profile.employee_external_id] || ""
        }));
      setEligibleEmployees(assignedEmployees);
      setCoveredEmployeeCount(coveredEmployeeIds.size);
    } finally {
      setLoadingEmployeePicker(false);
    }
  };

  const toggleSelectedEmployee = (employeeId: string) => {
    setSelectedEmployeeIds((prev) =>
      prev.includes(employeeId) ? prev.filter((id) => id !== employeeId) : [...prev, employeeId]
    );
  };

  const onRunAction = (path: string, body: any = {}) => {
    if (!selectedRunId) return;
    return executeAction(path, () => postApiWithToken(`/payroll/runs/${selectedRunId}/${path}`, body));
  };

  const onReject = async () => {
    const reason = window.prompt("Enter rejection reason");
    if (!reason || reason.trim().length < 3) {
      toast.error("Reason should be at least 3 characters");
      return;
    }
    await onRunAction("reject", { reason: reason.trim() });
  };

  const onReopen = async () => {
    const reason = window.prompt("Enter reopen reason");
    if (!reason || reason.trim().length < 3) {
      toast.error("Reason should be at least 3 characters");
      return;
    }
    await onRunAction("reopen", { reason: reason.trim() });
  };

  const onViewPayslip = async (employeeExternalId: string) => {
    if (!selectedRunId) return;
    const res = await getApiWithToken(`/payroll/runs/${selectedRunId}/payslips/${employeeExternalId}`);
    if (res?.success) {
      setPayslipData(res.data || null);
      setPayslipOpen(true);
    } else {
      toast.error(res?.message || "Failed to fetch payslip");
    }
  };

  const onExportBankTransfer = async () => {
    if (!selectedRunId) return;
    const res = await getApiWithToken(
      `/payroll/reports/bank-transfer-export?runId=${selectedRunId}&exportFormat=csv`
    );
    if (!res?.success) {
      toast.error(res?.message || "Failed to export bank transfer report");
      return;
    }

    const csv = res?.data?.csv;
    if (!csv) {
      toast.error("CSV data not available");
      return;
    }

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bank-transfer-${selectedRun?.pay_month || monthFilter}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const validationRows = runEmployees.filter(
    (row) => String(row.payroll_status) === "error" || !!row.error_message
  );
  const canRunCompute = Boolean(selectedRunId) && canCreateRun && !loadingAction && isDraftRun;
  const canRunRecompute =
    Boolean(selectedRunId) && canCreateRun && !loadingAction && !isDraftRun && !isFinalRun && !isApprovedRun;
  const canRunValidate =
    Boolean(selectedRunId) &&
    canCreateRun &&
    !loadingAction &&
    (isValidationFailedRun || isReadyForApprovalRun);
  const canRunSubmit =
    Boolean(selectedRunId) &&
    canCreateRun &&
    !loadingAction &&
    (isDraftRun || isValidationFailedRun);
  const canRunApproveReject =
    Boolean(selectedRunId) && canApproveRun && !loadingAction && isReadyForApprovalRun;
  const canRunLock = Boolean(selectedRunId) && canLockRun && !loadingAction && isApprovedRun;
  const canRunReopen =
    Boolean(selectedRunId) &&
    canLockRun &&
    !loadingAction &&
    (isApprovedRun || isLockedRun || isReadyForApprovalRun || isValidationFailedRun);
  const payslipJson = payslipData?.payslipJson || null;
  const payslipAttendance = payslipJson?.attendanceSummary || null;
  const payslipEarnings = Array.isArray(payslipJson?.earnings) ? payslipJson.earnings : [];
  const payslipDeductions = Array.isArray(payslipJson?.deductions) ? payslipJson.deductions : [];
  const payslipReimbursements = Array.isArray(payslipJson?.reimbursements) ? payslipJson.reimbursements : [];
  const payslipEmployerContributions = Array.isArray(payslipJson?.employerContributions)
    ? payslipJson.employerContributions
    : [];
  const payslipProcessedGross = Number(payslipJson?.totals?.grossEarnings || 0);
  const payslipEmployerContributionTotal = Number(
    payslipJson?.totals?.employerContributions || 0
  );
  const payslipFullMonthGross = Math.max(
    payslipProcessedGross,
    ...payslipEarnings.map((item) =>
      Number(item?.formulaSnapshot?.inputs?.MONTHLY_GROSS || 0)
    )
  );
  const payslipAttendanceAdjustment = Math.max(
    0,
    payslipFullMonthGross - payslipProcessedGross
  );
  const payslipProcessedCtc = payslipProcessedGross + payslipEmployerContributionTotal;
  const payslipWarnings = normalizeWarnings(payslipJson?.warnings);
  const runWarnings = normalizeWarnings(runDetail?.metadata?.runWarnings || runPreview?.metadata?.runWarnings);
  const runDaysColumnLabel = "Payable Days";

  const renderPayslipLineItems = (title: string, items: any[], emptyLabel: string) => (
    <div className="rounded-lg border">
      <div className="border-b px-4 py-3">
        <p className="font-medium">{title}</p>
      </div>
      {!items.length ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="divide-y">
          {items.map((item, index) => (
            <div key={`${title}-${item.code || item.name || index}`} className="flex items-center justify-between gap-4 px-4 py-3">
              <div>
                <p className="font-medium">{item.name || item.code || "-"}</p>
                <p className="text-xs text-muted-foreground">
                  {item.code || "-"}
                  {item.sourceType ? ` • ${item.sourceType}` : ""}
                  {item.calculationMode ? ` • ${item.calculationMode}` : ""}
                  {typeof item.taxable === "boolean" ? ` • ${item.taxable ? "Taxable" : "Non-taxable"}` : ""}
                </p>
                {item.formulaSnapshot?.expression && (
                  <div className="mt-2 space-y-1 rounded-md bg-muted/60 px-2 py-1.5 text-xs">
                    <p>
                      <span className="font-medium">Formula:</span>{" "}
                      <code className="break-all">{item.formulaSnapshot.expression}</code>
                    </p>
                    {!!Object.keys(item.formulaSnapshot.inputs || {}).length && (
                      <p className="text-muted-foreground">
                        <span className="font-medium text-foreground">Inputs:</span>{" "}
                        {Object.entries(item.formulaSnapshot.inputs)
                          .map(
                            ([key, value]) =>
                              `${key}=${formatCurrency(Number(value || 0))}`
                          )
                          .join(", ")}
                      </p>
                    )}
                    {Number(item.formulaSnapshot.prorationFactor ?? 1) !== 1 && (
                      <p className="text-muted-foreground">
                        <span className="font-medium text-foreground">Attendance factor:</span>{" "}
                        {Number(item.formulaSnapshot.prorationFactor || 0).toFixed(4)}
                      </p>
                    )}
                  </div>
                )}
              </div>
              <p className="font-semibold">{formatCurrency(Number(item.amount || 0))}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <MainLayout
      title="Payroll Runs"
      breadcrumb={[{ label: "Home", href: "/" }, { label: "Payroll" }, { label: "Runs" }]}
    >
      <PayrollSectionNav />

      <div className="mb-6 flex flex-col gap-4 lg:flex-row">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={monthFilter} onValueChange={setMonthFilter}>
            <SelectTrigger className="w-44">
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
          <Select
            value={selectedPayGroupId || "__none"}
            onValueChange={(value) => setSelectedPayGroupId(value === "__none" ? "" : value)}
          >
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Select pay group" />
            </SelectTrigger>
            <SelectContent>
              {!payGroups.length ? (
                <SelectItem value="__none">No pay groups</SelectItem>
              ) : (
                payGroups.map((group) => (
                  <SelectItem key={group.id} value={group.id}>
                    {group.name} ({group.code})
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => loadRuns(monthFilter, selectedPayGroupId || undefined)} disabled={loadingRuns}>
            <RefreshCcw className={`mr-2 h-4 w-4 ${loadingRuns ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onGenerateSnapshot} disabled={!canCreateRun || !!loadingAction || !payrollReady}>
            Refresh From Attendance
          </Button>
          <Button onClick={openCreateRunDialog} disabled={!canCreateRun || !!loadingAction || !payrollReady || !selectedPayGroupId}>
            Create Run
          </Button>
          <Button variant="outline" onClick={onExportBankTransfer} disabled={!canViewReports || !selectedRunId || !payrollReady}>
            <Download className="mr-2 h-4 w-4" />
            Bank Export
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="rounded-2xl border bg-card shadow-sm xl:col-span-1">
          <div className="border-b p-4 font-semibold">Run List</div>
          <div className="max-h-[620px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Run</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingRuns &&
                  Array.from({ length: 5 }).map((_, idx) => (
                    <TableRow key={`run-skeleton-${idx}`}>
                      <TableCell><Skeleton className="h-10 w-full" /></TableCell>
                      <TableCell><Skeleton className="h-6 w-20 rounded-full" /></TableCell>
                    </TableRow>
                  ))}
                {!loadingRuns &&
                  runs.map((run) => (
                    <TableRow
                      key={run.id}
                      className={`cursor-pointer ${selectedRunId === run.id ? "bg-muted/40" : ""}`}
                      onClick={() => setSelectedRunId(run.id)}
                    >
                      <TableCell>
                        <p className="font-medium">{run.run_code}</p>
                        <p className="text-xs text-muted-foreground">{run.run_name}</p>
                        <p className="text-xs text-muted-foreground">Emp: {run.employee_count || 0}</p>
                      </TableCell>
                      <TableCell>{getStatusBadge(run.status)}</TableCell>
                    </TableRow>
                  ))}
                {!runs.length && !loadingRuns && (
                  <TableRow>
                    <TableCell colSpan={2} className="text-center text-muted-foreground">
                      No payroll runs found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        <div className="rounded-2xl border bg-card shadow-sm xl:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
            <div>
              <p className="font-semibold">Run Detail</p>
              {selectedRun ? (
                <p className="text-sm text-muted-foreground">
                  {selectedRun.run_code} | {selectedRun.pay_month} | {selectedRun.status}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">Select a run</p>
              )}
              <p className="text-xs text-muted-foreground">{workflowHint}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => onRunAction("compute")} disabled={!canRunCompute}>
                Compute
              </Button>
              <Button size="sm" variant="outline" onClick={() => onRunAction("recompute", { forceRecompute: true })} disabled={!canRunRecompute}>
                Recompute
              </Button>
              <Button size="sm" variant="outline" onClick={() => onRunAction("validate")} disabled={!canRunValidate}>
                Validate
              </Button>
              <Button size="sm" onClick={() => onRunAction("submit", { remarks: "Submitted from payroll UI" })} disabled={!canRunSubmit}>
                Submit
              </Button>
              <Button size="sm" onClick={() => onRunAction("approve", { remarks: "Approved from payroll UI" })} disabled={!canRunApproveReject}>
                Approve
              </Button>
              <Button size="sm" variant="destructive" onClick={onReject} disabled={!canRunApproveReject}>
                Reject
              </Button>
              <Button size="sm" onClick={() => onRunAction("lock", { remarks: "Locked from payroll UI" })} disabled={!canRunLock}>
                Lock
              </Button>
              <Button size="sm" variant="outline" onClick={onReopen} disabled={!canRunReopen}>
                Reopen
              </Button>
            </div>
          </div>

          {loadingRunDetail ? (
            <div className="space-y-4 p-4">
              {Array.from({ length: 6 }).map((_, idx) => (
                <Skeleton key={`detail-skeleton-${idx}`} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 border-b p-4 md:grid-cols-3">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Gross</p>
                  <p className="font-semibold">{formatCurrency(Number(runDetail?.gross_total || runPreview?.gross_total || 0))}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Deductions</p>
                  <p className="font-semibold">{formatCurrency(Number(runDetail?.deduction_total || runPreview?.deduction_total || 0))}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Net Pay</p>
                  <p className="font-semibold text-green-600">{formatCurrency(Number(runDetail?.net_pay_total || runPreview?.net_pay_total || 0))}</p>
                </div>
              </div>

              {runWarnings.length > 0 && (
                <div className="border-b border-amber-200 bg-amber-50 p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <p className="font-medium text-amber-900">Run Warnings ({runWarnings.length})</p>
                  </div>
                  <div className="space-y-1">
                    {runWarnings.slice(0, 3).map((warning, index) => (
                      <p key={`run-warning-${index}`} className="text-sm text-amber-800">
                        {index + 1}. {warning}
                      </p>
                    ))}
                    {runWarnings.length > 3 && (
                      <p className="text-xs text-amber-700">
                        +{runWarnings.length - 3} more warning{runWarnings.length - 3 > 1 ? "s" : ""}
                      </p>
                    )}
                  </div>
                </div>
              )}

              <div className="border-b p-4">
                <div className="mb-3 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <p className="font-medium">Validation Errors ({validationRows.length})</p>
                </div>
                {!validationRows.length ? (
                  <p className="text-sm text-muted-foreground">No validation errors in selected run.</p>
                ) : (
                  <div className="space-y-2">
                    {validationRows.slice(0, 8).map((row) => (
                      <div key={row.id} className="rounded border bg-red-50 p-2 text-sm text-red-700">
                        <span className="font-medium">{getEmployeeLabel(row.employee_external_id)}:</span>{" "}
                        {row.error_message}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="p-4">
                <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="font-medium">Employee Breakdown</p>
                  <div className="relative w-full sm:w-72">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input className="pl-9" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search employee/status" />
                  </div>
                </div>

                <div className="max-h-[420px] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">{runDaysColumnLabel}</TableHead>
                        <TableHead className="text-right">LOP</TableHead>
                        <TableHead className="text-right">Gross</TableHead>
                        <TableHead className="text-right">Net</TableHead>
                        <TableHead>Issues</TableHead>
                        <TableHead className="w-12" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {runEmployees.map((row) => {
                        const warnings = normalizeWarnings(row.warnings);
                        return (
                          <TableRow key={row.id}>
                            <TableCell>
                              <p className="font-medium">{employeeNameMap[row.employee_external_id] || employeeCodeMap[row.employee_external_id] || "Employee"}</p>
                              <p className="font-mono text-xs text-muted-foreground">{employeeCodeMap[row.employee_external_id] || row.employee_external_id}</p>
                            </TableCell>
                            <TableCell>{getStatusBadge(row.payroll_status)}</TableCell>
                            <TableCell className="text-right">
                              {Number(row.payable_days || 0).toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right text-red-600">{Number(row.lop_days || 0).toFixed(2)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(Number(row.gross_earnings || 0))}</TableCell>
                            <TableCell className="text-right font-semibold">{formatCurrency(Number(row.net_pay || 0))}</TableCell>
                            <TableCell>
                              {row.error_message ? (
                                <div className="space-y-2">
                                  <Badge className="bg-red-600 text-white gap-1">
                                    <AlertTriangle className="h-3 w-3" /> Error
                                  </Badge>
                                  <p className="max-w-xs text-xs text-red-700">{row.error_message}</p>
                                </div>
                              ) : warnings.length ? (
                                <div className="space-y-2">
                                  <Badge className="bg-amber-600 text-white gap-1">
                                    <Clock3 className="h-3 w-3" /> {warnings.length} warning
                                  </Badge>
                                  <div className="space-y-1">
                                    {warnings.slice(0, 2).map((warning, index) => (
                                      <p key={`${row.id}-warning-${index}`} className="max-w-xs text-xs text-amber-700">
                                        {index + 1}. {warning}
                                      </p>
                                    ))}
                                    {warnings.length > 2 && (
                                      <p className="text-xs text-muted-foreground">
                                        +{warnings.length - 2} more warning{warnings.length - 2 > 1 ? "s" : ""}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              ) : (
                                <Badge className="bg-green-600 text-white gap-1">
                                  <CheckCircle2 className="h-3 w-3" /> OK
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              <Button size="sm" variant="ghost" onClick={() => onViewPayslip(row.employee_external_id)} disabled={!canViewPayslip}>
                                <Eye className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {!runEmployees.length && !loadingRunDetail && (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center text-muted-foreground">
                            No employee rows for selected run
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <Dialog open={payslipOpen} onOpenChange={setPayslipOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" /> Employee Payroll Review
            </DialogTitle>
          </DialogHeader>
          {!payslipData ? (
            <p className="text-muted-foreground">No payslip data</p>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded border p-3">
                  <p className="text-xs text-muted-foreground">Employee</p>
                  <p className="font-medium">{payslipJson?.employee?.name || "-"}</p>
                  <p className="text-xs text-muted-foreground">{payslipJson?.employee?.employeeCode || "-"}</p>
                </div>
                <div className="rounded border p-3">
                  <p className="text-xs text-muted-foreground">Month</p>
                  <p className="font-medium">{payslipJson?.payMonth || "-"}</p>
                </div>
                <div className="rounded border p-3">
                  <p className="text-xs text-muted-foreground">Net Pay</p>
                  <p className="font-semibold text-green-600">{formatCurrency(Number(payslipJson?.totals?.netPay || 0))}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded border p-3">
                  <p className="text-xs text-muted-foreground">Full-Month Fixed Gross</p>
                  <p className="font-semibold">{formatCurrency(payslipFullMonthGross)}</p>
                </div>
                <div className="rounded border p-3">
                  <p className="text-xs text-muted-foreground">Attendance Adjustment</p>
                  <p className="font-semibold text-red-600">
                    -{formatCurrency(payslipAttendanceAdjustment)}
                  </p>
                </div>
                <div className="rounded border p-3">
                  <p className="text-xs text-muted-foreground">Processed Gross</p>
                  <p className="font-semibold">{formatCurrency(payslipProcessedGross)}</p>
                </div>
                <div className="rounded border p-3">
                  <p className="text-xs text-muted-foreground">Employer Contributions</p>
                  <p className="font-semibold">{formatCurrency(payslipEmployerContributionTotal)}</p>
                </div>
                <div className="rounded border p-3">
                  <p className="text-xs text-muted-foreground">Processed CTC</p>
                  <p className="font-semibold">{formatCurrency(payslipProcessedCtc)}</p>
                </div>
                <div className="rounded border p-3">
                  <p className="text-xs text-muted-foreground">Total Deductions</p>
                  <p className="font-semibold">{formatCurrency(Number(payslipJson?.totals?.totalDeductions || 0))}</p>
                </div>
                <div className="rounded border p-3">
                  <p className="text-xs text-muted-foreground">Taxable Income</p>
                  <p className="font-semibold">{formatCurrency(Number(payslipJson?.totals?.taxableIncome || 0))}</p>
                </div>
              </div>

              {!!payslipWarnings.length && (
                <div className="rounded-lg border border-amber-200 bg-amber-50">
                  <div className="border-b border-amber-200 px-4 py-3">
                    <p className="font-medium text-amber-900">Warnings</p>
                  </div>
                  <div className="space-y-2 px-4 py-3">
                    {payslipWarnings.map((warning, index) => (
                      <p key={`preview-warning-${index}`} className="text-sm text-amber-900">
                        {index + 1}. {warning}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {payslipAttendance && (
                <div className="rounded-lg border">
                  <div className="border-b px-4 py-3">
                    <p className="font-medium">
                      Attendance Basis
                      {payslipAttendance.effectiveFrom && (
                        <span className="ml-2 text-sm font-normal text-muted-foreground">
                          ({payslipAttendance.effectiveFrom} to {payslipAttendance.effectiveTo || payslipAttendance.effectiveFrom})
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 px-4 py-3 md:grid-cols-6">
                    <div>
                      <p className="text-xs text-muted-foreground">Payable Days</p>
                      <p className="font-semibold">
                        {Number(payslipAttendance.payableDays || 0).toFixed(2)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">LOP Days</p>
                      <p className="font-semibold text-red-600">{Number(payslipAttendance.lopDays || 0).toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Present</p>
                      <p className="font-semibold">
                        {(
                          Number(payslipAttendance.presentDays || 0) +
                          Number(payslipAttendance.halfDays || 0)
                        ).toFixed(2)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Half Day</p>
                      <p className="font-semibold">{Number(payslipAttendance.halfDays || 0).toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Paid Leave</p>
                      <p className="font-semibold">{Number(payslipAttendance.paidLeaveDays || 0).toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Week Off + Holiday</p>
                      <p className="font-semibold">
                        {(Number(payslipAttendance.weekOffDays || 0) + Number(payslipAttendance.holidayDays || 0)).toFixed(2)}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {renderPayslipLineItems("Earnings", payslipEarnings, "No earning components in this run.")}
                {renderPayslipLineItems("Deductions", payslipDeductions, "No deduction components in this run.")}
                {renderPayslipLineItems("Reimbursements", payslipReimbursements, "No reimbursements in this run.")}
                {renderPayslipLineItems(
                  "Employer Contributions",
                  payslipEmployerContributions,
                  "No employer contribution components in this run."
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Sheet open={createRunDialogOpen} onOpenChange={setCreateRunDialogOpen}>
        <SheetContent className="flex flex-col gap-0 bg-white p-0">
          <SheetHeader className="border-b border-slate-100 px-6 py-5 text-left">
            <SheetTitle className="text-2xl font-semibold text-slate-950">
              Create Payroll Run{selectedPayGroupId ? ` - ${payGroups.find((group) => group.id === selectedPayGroupId)?.name || ""}` : ""}
            </SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-5">
            <p className="text-sm text-muted-foreground">
              Choose employees from the selected pay group. If none are selected, the run will include every assigned active employee in that pay group.
            </p>
            {coveredEmployeeCount > 0 && (
              <p className="text-sm text-muted-foreground">
                {coveredEmployeeCount} employee{coveredEmployeeCount === 1 ? "" : "s"} already included in another run for {monthFilter} are hidden here to avoid duplicate payroll processing.
              </p>
            )}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" value={employeePickerSearch} onChange={(e) => setEmployeePickerSearch(e.target.value)} placeholder="Search name / employee code / id" />
            </div>
            <div className="max-h-72 overflow-auto rounded-lg border">
              {loadingEmployeePicker ? (
                <p className="p-3 text-sm text-muted-foreground">Loading employees...</p>
              ) : (
                <div className="divide-y">
                  {filteredEligibleEmployees.map((emp) => {
                    const fullName = `${emp.firstName || ""} ${emp.lastName || ""}`.trim() || "Employee";
                    const checked = selectedEmployeeIds.includes(emp._id);
                    return (
                      <label key={emp._id} className="flex cursor-pointer items-center justify-between gap-3 p-3 hover:bg-muted/40">
                        <div>
                          <p className="font-medium">{fullName}</p>
                          <p className="text-xs text-muted-foreground">{emp.employeeCode || "-"} | {emp._id}</p>
                        </div>
                        <input type="checkbox" checked={checked} onChange={() => toggleSelectedEmployee(emp._id)} />
                      </label>
                    );
                  })}
                  {!filteredEligibleEmployees.length && (
                    <p className="p-3 text-sm text-muted-foreground">No employees found</p>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-5">
            <Button variant="outline" onClick={() => setCreateRunDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => onCreateRun(selectedEmployeeIds)} disabled={!!loadingAction || loadingEmployeePicker}>
              {loadingAction === "Create run"
                ? "Creating..."
                : selectedEmployeeIds.length
                  ? `Create Run for ${selectedEmployeeIds.length} Employee(s)`
                  : "Create Run for All"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </MainLayout>
  );
};

export default PayrollRuns;
