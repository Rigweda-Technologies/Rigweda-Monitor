import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { getApiWithToken, postApiWithToken } from "@/services/apiWrapper";
import { hasAnyPermission } from "@/utils/auth";
import { toDateKeyInOrgCalendar } from "@/utils/timezone";
import { toast } from "sonner";
import PayrollSectionNav from "@/components/payroll/PayrollSectionNav";
import {
  buildMonthOptions,
  formatCurrency,
  getEmployeeBasicRuleLabel,
  getInitials,
  getStatusBadge,
  sanitizeEmployeeDisplayName,
  type AttendanceSnapshotRow,
  type EmployeeListPayload,
  type EmployeeOption,
  type EmployeePayrollProfile,
  type PayGroup
} from "@/components/payroll/payrollShared";

const PayrollEmployees = () => {
  const navigate = useNavigate();
  const canManageConfig = hasAnyPermission(["PAYROLL_CONFIG_MANAGE"]);
  const canCreateRun = hasAnyPermission(["PAYROLL_RUN_CREATE"]);
  const canViewReports = hasAnyPermission(["PAYROLL_REPORT_VIEW"]);
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
  const [payGroups, setPayGroups] = useState<PayGroup[]>([]);
  const [selectedPayGroupId, setSelectedPayGroupId] = useState("");
  const [employeeProfiles, setEmployeeProfiles] = useState<EmployeePayrollProfile[]>([]);
  const [loadingEmployeeProfiles, setLoadingEmployeeProfiles] = useState(false);
  const [attendanceSnapshots, setAttendanceSnapshots] = useState<AttendanceSnapshotRow[]>([]);
  const [loadingAttendanceSnapshots, setLoadingAttendanceSnapshots] = useState(false);
  const [employeeNameMap, setEmployeeNameMap] = useState<Record<string, string>>({});
  const [employeeCodeMap, setEmployeeCodeMap] = useState<Record<string, string>>({});
  const [employeeProfileImageMap, setEmployeeProfileImageMap] = useState<Record<string, string>>({});
  const [monthFilter, setMonthFilter] = useState("");

  const selectedPayGroup = useMemo(
    () => payGroups.find((group) => group.id === selectedPayGroupId) || null,
    [payGroups, selectedPayGroupId]
  );

  const loadSettings = async () => {
    const res = await getApiWithToken("/payroll/settings");
    if (res?.success) {
      setSettings(res.data || null);
    }
    setSettingsLoaded(true);
  };

  const loadPayGroups = useCallback(async () => {
    if (!canManageConfig) return;
    const res = await getApiWithToken("/payroll/pay-groups?includeInactive=true", null, {
      requiredPermissions: ["PAYROLL_CONFIG_MANAGE"]
    });
    if (res?.success) {
      setPayGroups(Array.isArray(res.data) ? res.data : []);
    } else if (!res?.skipped) {
      toast.error(res?.message || "Failed to load pay groups");
    }
  }, [canManageConfig]);

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

    return {
      success: true,
      items: allEmployees
    };
  }, []);

  const loadEmployeeDirectory = useCallback(async () => {
    const res = await fetchAllEmployees();
    if (!res?.success) return;

    const nextNameMap: Record<string, string> = {};
    const nextCodeMap: Record<string, string> = {};
    const nextProfileImageMap: Record<string, string> = {};

    for (const emp of res.items) {
      const id = String(emp?._id || "").trim();
      if (!id) continue;
      const fullName = `${emp?.firstName || ""} ${emp?.lastName || ""}`.trim();
      if (fullName) nextNameMap[id] = fullName;
      if (emp?.employeeCode) nextCodeMap[id] = String(emp.employeeCode);
      if (emp?.profileImage) nextProfileImageMap[id] = String(emp.profileImage);
    }

    setEmployeeNameMap(nextNameMap);
    setEmployeeCodeMap(nextCodeMap);
    setEmployeeProfileImageMap(nextProfileImageMap);
  }, [fetchAllEmployees]);

  const loadEmployeeProfiles = useCallback(async (payGroupId: string) => {
    if (!canManageConfig || !payGroupId) {
      setEmployeeProfiles([]);
      return;
    }

    setLoadingEmployeeProfiles(true);
    try {
      const res = await getApiWithToken(
        `/payroll/employee-profiles?includeLatest=true&payGroupId=${payGroupId}&limit=200&offset=0`,
        null,
        { requiredPermissions: ["PAYROLL_CONFIG_MANAGE"] }
      );
      if (res?.success) {
        setEmployeeProfiles(Array.isArray(res.data) ? res.data : []);
      } else if (!res?.skipped) {
        setEmployeeProfiles([]);
        toast.error(res?.message || "Failed to load employee payroll setup");
      }
    } finally {
      setLoadingEmployeeProfiles(false);
    }
  }, [canManageConfig]);

  const loadAttendanceSnapshots = useCallback(async (month: string) => {
    if (!month || (!canCreateRun && !canViewReports)) {
      setAttendanceSnapshots([]);
      return;
    }

    setLoadingAttendanceSnapshots(true);
    try {
      const res = await getApiWithToken(`/payroll/attendance-snapshots?month=${month}`);
      if (res?.success) {
        setAttendanceSnapshots(Array.isArray(res.data?.snapshots) ? res.data.snapshots : []);
      } else if (!res?.skipped) {
        setAttendanceSnapshots([]);
      }
    } finally {
      setLoadingAttendanceSnapshots(false);
    }
  }, [canCreateRun, canViewReports]);

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
    if (!selectedPayGroupId) {
      setEmployeeProfiles([]);
      return;
    }
    loadEmployeeProfiles(selectedPayGroupId);
  }, [loadEmployeeProfiles, selectedPayGroupId]);

  useEffect(() => {
    if (!settingsLoaded || settings?.payrollEnabled === false || !monthFilter) return;
    loadAttendanceSnapshots(monthFilter);
  }, [loadAttendanceSnapshots, monthFilter, settingsLoaded, settings?.payrollEnabled]);

  const selectedPayGroupEmployeeIds = useMemo(
    () => employeeProfiles.map((profile) => String(profile.employee_external_id || "")).filter(Boolean),
    [employeeProfiles]
  );

  const selectedPayGroupSnapshots = useMemo(() => {
    if (!selectedPayGroupEmployeeIds.length) return [];
    const employeeIdSet = new Set(selectedPayGroupEmployeeIds);
    return attendanceSnapshots.filter((row) => employeeIdSet.has(String(row.employee_external_id || "")));
  }, [attendanceSnapshots, selectedPayGroupEmployeeIds]);

  const salaryProrationRule = String(
    settings?.metadata?.attendance?.salaryProrationRule ||
      settings?.salaryProrationRule ||
      "payable_days"
  );

  const getAttendanceSyncBreakdown = (snapshot: AttendanceSnapshotRow) => {
    const presentDays = Number(snapshot.present_days || 0);
    const halfDays = Number(snapshot.half_days || 0);
    const presentEquivalentDays = presentDays + halfDays;
    const paidLeaveDays = Number(snapshot.paid_leave_days || 0);
    const weekOffDays = Number(snapshot.week_off_days || 0);
    const holidayDays = Number(snapshot.holiday_days || 0);

    return [
      presentEquivalentDays > 0 ? `Present ${presentEquivalentDays.toFixed(2)}` : null,
      paidLeaveDays > 0 ? `Paid Leave ${paidLeaveDays.toFixed(2)}` : null,
      weekOffDays > 0 ? `Week Off ${weekOffDays.toFixed(2)} excluded` : null,
      holidayDays > 0 ? `Holiday ${holidayDays.toFixed(2)} excluded` : null
    ].filter(Boolean).join(" + ");
  };

  const getAttendanceSyncHeadline = (snapshot: AttendanceSnapshotRow) => {
    if (salaryProrationRule === "present_days_on_working_days") {
      return `${(
        Number(snapshot.present_days || 0) +
        Number(snapshot.half_days || 0) +
        Number(snapshot.paid_leave_days || 0)
      ).toFixed(2)} attendance payable days`;
    }
    return `${Number(snapshot.payable_days || 0).toFixed(2)} attendance payable days`;
  };

  const getSalaryEffectiveNote = (profile: EmployeePayrollProfile) => {
    const salaryEffectiveFrom = profile.latest_salary_effective_from
      ? toDateKeyInOrgCalendar(profile.latest_salary_effective_from)
      : "";
    const confirmedDate = profile.confirmed_date
      ? toDateKeyInOrgCalendar(profile.confirmed_date)
      : "";
    const payrollStartDate = [salaryEffectiveFrom, confirmedDate].filter(Boolean).sort().pop() || "";
    if (!payrollStartDate || !monthFilter) return "";
    const monthStart = `${monthFilter}-01`;
    const monthEnd = new Date(`${monthFilter}-01T00:00:00.000Z`);
    monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1, 0);
    const monthEndKey = monthEnd.toISOString().slice(0, 10);
    if (payrollStartDate <= monthStart || payrollStartDate > monthEndKey) return "";
    return confirmedDate && payrollStartDate === confirmedDate
      ? `Confirmed from ${payrollStartDate}; run prorates salary only from this date.`
      : `Salary effective from ${payrollStartDate}; run prorates only from this date.`;
  };

  const employeeCustomizationCount = useMemo(
    () =>
      employeeProfiles.filter((profile) => {
        const salaryRules = profile?.latest_salary_metadata?.salaryRules || {};
        return salaryRules.basicPercentSource === "employee";
      }).length,
    [employeeProfiles]
  );

  const refreshAttendanceForPayGroup = async () => {
    if (!selectedPayGroupEmployeeIds.length) return;
    const res = await postApiWithToken("/payroll/attendance-snapshots/generate", {
      month: monthFilter,
      forceRebuild: true,
      employeeIds: selectedPayGroupEmployeeIds
    });
    if (!res?.success) {
      toast.error(res?.message || "Failed to refresh attendance snapshot");
      return;
    }
    toast.success("Attendance snapshot refreshed for selected pay group");
    await loadAttendanceSnapshots(monthFilter);
  };

  const openEmployeeSalarySetup = (employeeId: string) => {
    const query = new URLSearchParams({
      tab: "salary",
      ...(selectedPayGroupId ? { payGroupId: selectedPayGroupId } : {})
    });
    navigate(`/employees/edit/${employeeId}?${query.toString()}`);
  };

  return (
    <MainLayout
      title="Payroll Employees"
      breadcrumb={[{ label: "Home", href: "/" }, { label: "Payroll" }, { label: "Employees" }]}
    >
      <PayrollSectionNav />

      <div className="mb-6 rounded-2xl border bg-card p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-lg font-semibold">Employee Payroll Assignment</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Assign the pay group to employees, then customize salary at employee level where needed.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Select value={monthFilter} onValueChange={setMonthFilter}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Select month" />
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
            <Button
              variant="outline"
              onClick={refreshAttendanceForPayGroup}
              disabled={!canCreateRun || !selectedPayGroupEmployeeIds.length}
            >
              Refresh Attendance
            </Button>
          </div>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-2xl border bg-card p-5 shadow-sm">
          <p className="text-sm text-muted-foreground">Selected Pay Group</p>
          <p className="mt-2 text-xl font-semibold">
            {selectedPayGroup ? selectedPayGroup.name : "No pay group selected"}
          </p>
        </div>
        <div className="rounded-2xl border bg-card p-5 shadow-sm">
          <p className="text-sm text-muted-foreground">Assigned Employees</p>
          <p className="mt-2 text-xl font-semibold">{employeeProfiles.length}</p>
        </div>
        <div className="rounded-2xl border bg-card p-5 shadow-sm">
          <p className="text-sm text-muted-foreground">Employee Overrides</p>
          <p className="mt-2 text-xl font-semibold">{employeeCustomizationCount}</p>
        </div>
      </div>

      <div className="rounded-2xl border bg-card shadow-sm">
        <div className="border-b p-4">
          <p className="font-semibold">Employees In Selected Pay Group</p>
          <p className="text-sm text-muted-foreground">
            Attendance sync below is shown for {monthFilter}.{" "}
            {salaryProrationRule === "present_days_on_working_days"
              ? "Salary proration is using (Present + payroll payable Paid Leave) ÷ Working Days, so week offs and holidays are excluded from payroll calculation."
              : "Payroll payable days come from the attendance snapshot: Present + Paid Leave + Week Off + Holiday."}{" "}
            Use `Manage Salary` to customize Basic %, HRA %, variable pay, benefits, and payroll profile details.
          </p>
        </div>
        <div className="max-h-[560px] overflow-auto p-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Monthly Gross</TableHead>
                <TableHead className="text-right">Basic Rule</TableHead>
                <TableHead className="text-right">Variable Pay</TableHead>
                <TableHead className="text-right">Attendance Sync ({monthFilter})</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingEmployeeProfiles &&
                Array.from({ length: 4 }).map((_, idx) => (
                  <TableRow key={`profile-skeleton-${idx}`}>
                    <TableCell colSpan={7}>
                      <Skeleton className="h-10 w-full" />
                    </TableCell>
                  </TableRow>
                ))}

              {!loadingEmployeeProfiles &&
                employeeProfiles.map((profile) => {
                  const snapshot = selectedPayGroupSnapshots.find(
                    (row) => row.employee_external_id === profile.employee_external_id
                  );
                  const displayName =
                    sanitizeEmployeeDisplayName(profile.employee_display_name) ||
                    employeeNameMap[profile.employee_external_id] ||
                    sanitizeEmployeeDisplayName(profile.employee_name) ||
                    profile.employee_code ||
                    employeeCodeMap[profile.employee_external_id] ||
                    profile.employee_external_id ||
                    "Employee";
                  const displayCode =
                    profile.employee_code ||
                    employeeCodeMap[profile.employee_external_id] ||
                    profile.employee_external_id;
                  const profileImage =
                    profile.employee_profile_image ||
                    employeeProfileImageMap[profile.employee_external_id] ||
                    "";

                  return (
                    <TableRow key={profile.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-9 w-9">
                            <AvatarImage src={profileImage || undefined} alt={displayName} />
                            <AvatarFallback>{getInitials(displayName)}</AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium">{displayName}</p>
                            <p className="text-xs text-muted-foreground">{displayCode}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{getStatusBadge(profile.payroll_status || "active")}</TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(Number(profile.monthly_gross || 0))}
                      </TableCell>
                      <TableCell className="text-right">
                        {getEmployeeBasicRuleLabel(profile)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-col items-end gap-1">
                          {(() => {
                            const approvalStatus = String(profile.variable_pay_approval_status || "pending").toLowerCase();
                            const targetAmount = Number(profile.variable_pay_target || 0);
                            const approvedAmount = Number(
                              profile.variable_pay_approved_amount ?? profile.variable_pay ?? 0
                            );
                            const displayAmount =
                              approvalStatus === "approved" || approvalStatus === "partial"
                                ? approvedAmount
                                : targetAmount;
                            return <span>{formatCurrency(displayAmount)}</span>;
                          })()}
                          <span className="text-xs text-muted-foreground">
                            {(() => {
                              const approvalStatus = String(profile.variable_pay_approval_status || "pending").toLowerCase();
                              const targetAmount = Number(profile.variable_pay_target || 0);
                              const approvedAmount = Number(
                                profile.variable_pay_approved_amount ?? profile.variable_pay ?? 0
                              );
                              if (approvalStatus === "approved") {
                                return `Approved ${formatCurrency(approvedAmount)} · Target ${formatCurrency(targetAmount)}`;
                              }
                              if (approvalStatus === "partial") {
                                return `Approved ${formatCurrency(approvedAmount)} · Target ${formatCurrency(targetAmount)}`;
                              }
                              return `Target ${formatCurrency(targetAmount)}`;
                            })()}
                          </span>
                          {(() => {
                            const approvalStatus = String(profile.variable_pay_approval_status || "pending").toLowerCase();
                            if (approvalStatus === "approved") {
                              return null;
                            }
                            return (
                              <Badge variant="secondary" className="rounded-md">
                                {approvalStatus === "partial"
                                  ? "Partially approved"
                                  : approvalStatus === "rejected"
                                    ? "Rejected"
                                    : "Pending approval"}
                              </Badge>
                            );
                          })()}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {snapshot ? (
                          <div className="space-y-1">
                            <p className="text-sm font-medium text-green-600">
                              {getAttendanceSyncHeadline(snapshot)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {getAttendanceSyncBreakdown(snapshot) ||
                                "No payable attendance found in snapshot"}
                            </p>
                            {getSalaryEffectiveNote(profile) && (
                              <p className="text-xs text-amber-700">
                                {getSalaryEffectiveNote(profile)}
                              </p>
                            )}
                          </div>
                        ) : loadingAttendanceSnapshots ? (
                          <span className="text-sm text-muted-foreground">Checking...</span>
                        ) : (
                          <span className="text-sm text-muted-foreground">Waiting for attendance sync</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => openEmployeeSalarySetup(profile.employee_external_id)}>
                          Manage Salary
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}

              {!loadingEmployeeProfiles && !employeeProfiles.length && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    No employees are assigned to this pay group yet. Open an employee and use the salary tab
                    to assign this pay group and customize salary.
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

export default PayrollEmployees;
