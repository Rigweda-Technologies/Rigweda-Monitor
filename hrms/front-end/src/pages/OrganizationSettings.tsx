import { useEffect, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { getApiWithToken, postApiWithToken } from "@/services/apiWrapper";
import { toast } from "sonner";
import PermissionGate from "@/components/PermissionGate";
import { useAuth } from "@/context/useAuth";
import { setOrgTimeZone } from "@/utils/timezone";
import { Clock3, MapPin, Save, ShieldCheck, Sparkles } from "lucide-react";

const TIMEZONE_OPTIONS = [
  "Asia/Kolkata",
  "UTC",
  "Asia/Dubai",
  "Asia/Singapore",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Australia/Sydney"
];

const OrganizationSettings = () => {
  const { hasAnyPermission } = useAuth();
  const [leaveCreditFrequency, setLeaveCreditFrequency] = useState("monthly");
  const [leaveTypeCreditMode, setLeaveTypeCreditMode] = useState("current_month_onwards");
  const [sandwichRuleEnabled, setSandwichRuleEnabled] = useState(false);
  const [attendanceLockEnabled, setAttendanceLockEnabled] = useState(true);
  const [attendanceLockAfterDays, setAttendanceLockAfterDays] = useState(7);
  const [attendanceLockMode, setAttendanceLockMode] = useState("payroll_cutoff");
  const [attendanceLockDay, setAttendanceLockDay] = useState(25);
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [maxActiveLoginsPerUser, setMaxActiveLoginsPerUser] = useState(1);
  const [payrollCutoffDay, setPayrollCutoffDay] = useState(25);
  const [payrollSalaryPayDay, setPayrollSalaryPayDay] = useState(30);
  const [payrollEnabled, setPayrollEnabled] = useState(false);
  const [minWorkHoursPerDay, setMinWorkHoursPerDay] = useState(8);
  const [minHalfDayHours, setMinHalfDayHours] = useState(4);
  const [attendanceAllowedIp, setAttendanceAllowedIp] = useState("");
  const [attendanceIpEnabled, setAttendanceIpEnabled] = useState(false);
  const [attendanceSelfieRequired, setAttendanceSelfieRequired] = useState(false);
  const [attendanceMultiPunchEnabled, setAttendanceMultiPunchEnabled] = useState(false);
  const [attendanceGeoFenceEnabled, setAttendanceGeoFenceEnabled] = useState(false);
  const [attendanceGeoLatitude, setAttendanceGeoLatitude] = useState("");
  const [attendanceGeoLongitude, setAttendanceGeoLongitude] = useState("");
  const [attendanceGeoRadiusMeters, setAttendanceGeoRadiusMeters] = useState(200);
  const [attendanceDevBypassEnabled, setAttendanceDevBypassEnabled] = useState(false);
  const [probationPeriodDays, setProbationPeriodDays] = useState(90);
  const [noticePeriodDays, setNoticePeriodDays] = useState(30);
  const [employeeIdPrefix, setEmployeeIdPrefix] = useState("");
  const [logoPreviewUrl, setLogoPreviewUrl] = useState("");
  const [logoUpload, setLogoUpload] = useState<null | {
    fileName: string;
    mimeType: string;
    base64Data: string;
  }>(null);
  const [loading, setLoading] = useState(false);
  const canView = hasAnyPermission(["ORG_SETTINGS_VIEW"]);
  const canManage = hasAnyPermission(["ORG_SETTINGS_MANAGE"]);

  const fetchSettings = async () => {
    const res = await getApiWithToken("/org-settings", null, {
      requiredPermissions: ["ORG_SETTINGS_VIEW"]
    });
    if (res?.skipped) return;
    if (res?.success) {
      setLeaveCreditFrequency(res.data?.leaveCreditFrequency || "monthly");
      setLeaveTypeCreditMode(res.data?.leaveTypeCreditMode || "current_month_onwards");
      setSandwichRuleEnabled(Boolean(res.data?.sandwichRuleEnabled));
      setAttendanceLockEnabled(
        typeof res.data?.attendanceLockEnabled === "boolean" ? res.data.attendanceLockEnabled : true
      );
      setAttendanceLockAfterDays(
        typeof res.data?.attendanceLockAfterDays === "number" ? res.data.attendanceLockAfterDays : 7
      );
      setAttendanceLockMode(res.data?.attendanceLockMode || "payroll_cutoff");
      setAttendanceLockDay(
        typeof res.data?.attendanceLockDay === "number"
          ? res.data.attendanceLockDay
          : typeof res.data?.payrollCutoffDay === "number"
            ? res.data.payrollCutoffDay
            : 25
      );
      setTimezone(res.data?.timezone || "Asia/Kolkata");
      setMaxActiveLoginsPerUser(
        typeof res.data?.maxActiveLoginsPerUser === "number" ? res.data.maxActiveLoginsPerUser : 1
      );
      if (res.data?.timezone) {
        setOrgTimeZone(res.data.timezone);
      }
      setPayrollCutoffDay(
        typeof res.data?.payrollCutoffDay === "number" ? res.data.payrollCutoffDay : 25
      );
      setPayrollSalaryPayDay(
        typeof res.data?.payrollSalaryPayDay === "number" ? res.data.payrollSalaryPayDay : 30
      );
      setPayrollEnabled(Boolean(res.data?.payrollEnabled));
      setMinWorkHoursPerDay(
        typeof res.data?.minWorkHoursPerDay === "number" ? res.data.minWorkHoursPerDay : 8
      );
      setMinHalfDayHours(
        typeof res.data?.minHalfDayHours === "number" ? res.data.minHalfDayHours : 4
      );
      setAttendanceAllowedIp(String(res.data?.attendanceAllowedIp || ""));
      setAttendanceIpEnabled(Boolean(res.data?.attendanceIpEnabled));
      setAttendanceSelfieRequired(Boolean(res.data?.attendanceSelfieRequired));
      setAttendanceMultiPunchEnabled(Boolean(res.data?.attendanceMultiPunchEnabled));
      setAttendanceGeoFenceEnabled(Boolean(res.data?.attendanceGeoFenceEnabled));
      setAttendanceGeoLatitude(
        res.data?.attendanceGeoLatitude === null || res.data?.attendanceGeoLatitude === undefined
          ? ""
          : String(res.data.attendanceGeoLatitude)
      );
      setAttendanceGeoLongitude(
        res.data?.attendanceGeoLongitude === null || res.data?.attendanceGeoLongitude === undefined
          ? ""
          : String(res.data.attendanceGeoLongitude)
      );
      setAttendanceGeoRadiusMeters(
        typeof res.data?.attendanceGeoRadiusMeters === "number" ? res.data.attendanceGeoRadiusMeters : 200
      );
      setAttendanceDevBypassEnabled(Boolean(res.data?.attendanceDevBypassEnabled));
      setProbationPeriodDays(
        typeof res.data?.probationPeriodDays === "number" ? res.data.probationPeriodDays : 90
      );
      setNoticePeriodDays(
        typeof res.data?.noticePeriodDays === "number" ? res.data.noticePeriodDays : 30
      );
      setEmployeeIdPrefix(String(res.data?.employeeIdPrefix || ""));
      setLogoPreviewUrl(String(res.data?.logoUrl || ""));
      setLogoUpload(null);
    } else {
      toast.error(res?.message || "Failed to load settings");
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const saveSettings = async () => {
    try {
      setLoading(true);
      const res = await postApiWithToken("/org-settings", {
        leaveCreditFrequency,
        leaveTypeCreditMode,
        sandwichRuleEnabled,
        attendanceLockEnabled,
        attendanceLockAfterDays: Number(attendanceLockAfterDays),
        attendanceLockMode,
        attendanceLockDay: Number(attendanceLockDay),
        timezone,
        maxActiveLoginsPerUser: Number(maxActiveLoginsPerUser || 1),
        payrollCutoffDay: Number(payrollCutoffDay),
        payrollSalaryPayDay: Number(payrollSalaryPayDay),
        payrollEnabled,
        minWorkHoursPerDay: Number(minWorkHoursPerDay),
        minHalfDayHours: Number(minHalfDayHours),
        attendanceIpEnabled,
        attendanceAllowedIp,
        attendanceSelfieRequired,
        attendanceMultiPunchEnabled,
        attendanceGeoFenceEnabled,
        attendanceGeoLatitude: attendanceGeoLatitude === "" ? null : Number(attendanceGeoLatitude),
        attendanceGeoLongitude: attendanceGeoLongitude === "" ? null : Number(attendanceGeoLongitude),
        attendanceGeoRadiusMeters: Number(attendanceGeoRadiusMeters),
        attendanceDevBypassEnabled,
        probationPeriodDays: Number(probationPeriodDays),
        noticePeriodDays: Number(noticePeriodDays),
        employeeIdPrefix: employeeIdPrefix.trim().toUpperCase(),
        ...(logoUpload ? { logoUpload } : {})
      }, null, { requiredPermissions: ["ORG_SETTINGS_MANAGE"] });
      if (res?.skipped) return;
      if (res?.success) {
        if (timezone) {
          setOrgTimeZone(timezone);
        }
        if (res.data?.logoUrl) {
          setLogoPreviewUrl(String(res.data.logoUrl));
        }
        setLogoUpload(null);
        toast.success("Settings saved");
      } else {
        toast.error(res?.message || "Save failed");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <MainLayout
      title="Organization Settings"
      breadcrumb={[{ label: "Home", href: "/" }, { label: "Organization" }, { label: "Settings" }]}
    >
      {!canView && (
        <div className="bg-card rounded-xl card-shadow p-6 text-sm text-muted-foreground">
          You do not have permission to view organization settings.
        </div>
      )}
      {canView && (
      <div className="space-y-5 max-w-6xl">
        <div className="relative overflow-hidden rounded-2xl border border-indigo-200/70 bg-gradient-to-r from-indigo-50 via-sky-50 to-cyan-50 p-6 card-shadow">
          <div className="pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full bg-indigo-500/10 blur-3xl" />
          <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-white/80 px-3 py-1 text-xs font-medium text-indigo-700">
                <Sparkles className="h-3.5 w-3.5" />
                Organization Controls
              </p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">
                Settings Console
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Configure leave, attendance rules, payroll defaults, and check-in policies from one place.
              </p>
            </div>
            <div className="rounded-xl border border-white/70 bg-white/75 px-4 py-3 text-sm text-slate-700 backdrop-blur">
              <p className="font-medium">{canManage ? "Editable mode" : "Read-only mode"}</p>
              <p className="text-xs text-slate-500">
                {canManage
                  ? "You can update and save policy changes."
                  : "You can view settings but cannot update them."}
              </p>
            </div>
          </div>
          <div className="relative mt-5 flex flex-col gap-4 rounded-2xl border border-white/70 bg-white/80 p-4 backdrop-blur sm:flex-row sm:items-center">
            <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
              {logoPreviewUrl ? (
                <img src={logoPreviewUrl} alt="Organization logo preview" className="h-full w-full object-contain" />
              ) : (
                <span className="text-xs text-slate-400">No logo</span>
              )}
            </div>
            <div className="flex-1 space-y-2">
              <label className="text-sm font-medium">Organization Logo</label>
              <Input
                type="file"
                accept=".png,.jpg,.jpeg,.webp"
                disabled={!canManage}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => {
                    const result = String(reader.result || "");
                    const base64Data = result.includes(",") ? result.split(",")[1] : "";
                    setLogoPreviewUrl(result);
                    setLogoUpload({
                      fileName: file.name,
                      mimeType: file.type || "image/png",
                      base64Data
                    });
                  };
                  reader.readAsDataURL(file);
                }}
              />
              <p className="text-xs text-slate-500">
                Upload a PNG, JPG, or WEBP logo. It will appear on employee payslips and PDF downloads.
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <section className="rounded-2xl border border-slate-200 bg-card p-5 card-shadow transition-all duration-300 hover:shadow-lg">
            <div className="mb-4 flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-indigo-600" />
              <h3 className="text-base font-semibold text-slate-900">Leave Policy</h3>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Credit Frequency</label>
                <Select
                  value={leaveCreditFrequency}
                  onValueChange={setLeaveCreditFrequency}
                  disabled={!canManage}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select frequency" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="quarterly">Quarterly</SelectItem>
                    <SelectItem value="yearly">Yearly</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">New Leave Type Credit</label>
                <Select
                  value={leaveTypeCreditMode}
                  onValueChange={setLeaveTypeCreditMode}
                  disabled={!canManage}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select mode" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="current_month_onwards">Current month onwards</SelectItem>
                    <SelectItem value="full_year">Full leaves for cycle</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <Checkbox
                  checked={sandwichRuleEnabled}
                  onCheckedChange={(value) => setSandwichRuleEnabled(Boolean(value))}
                  disabled={!canManage}
                />
                <span>Enable sandwich rule (count week-offs/holidays between leave dates)</span>
              </label>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-card p-5 card-shadow transition-all duration-300 hover:shadow-lg">
            <div className="mb-4 flex items-center gap-2">
              <Clock3 className="h-5 w-5 text-cyan-600" />
              <h3 className="text-base font-semibold text-slate-900">Employment Defaults</h3>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Probation Period (Days)</label>
                  <Input
                    type="number"
                    min={0}
                    max={3650}
                    value={probationPeriodDays}
                    onChange={(e) => setProbationPeriodDays(Number(e.target.value))}
                    disabled={!canManage}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Notice Period (Days)</label>
                  <Input
                    type="number"
                    min={0}
                    max={3650}
                    value={noticePeriodDays}
                    onChange={(e) => setNoticePeriodDays(Number(e.target.value))}
                    disabled={!canManage}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Employee ID Prefix</label>
                <Input
                  type="text"
                  maxLength={10}
                  placeholder="Ex: LV"
                  value={employeeIdPrefix}
                  onChange={(e) => setEmployeeIdPrefix(e.target.value.toUpperCase())}
                  disabled={!canManage}
                />
                <p className="text-xs text-muted-foreground">
                  New employee codes use this prefix. If empty, system uses `.env` prefix.
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                Probation is auto-completed after the configured days. Notice period is used when moving an employee to notice.
              </p>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-card p-5 card-shadow transition-all duration-300 hover:shadow-lg">
            <div className="mb-4 flex items-center gap-2">
              <Clock3 className="h-5 w-5 text-sky-600" />
              <h3 className="text-base font-semibold text-slate-900">Attendance Rules</h3>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Minimum Working Hours Per Day</label>
                  <Input
                    type="number"
                    min={0}
                    max={24}
                    step={0.5}
                    value={minWorkHoursPerDay}
                    onChange={(e) => setMinWorkHoursPerDay(Number(e.target.value))}
                    disabled={!canManage}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Minimum Half Day Hours</label>
                  <Input
                    type="number"
                    min={0}
                    max={24}
                    step={0.5}
                    value={minHalfDayHours}
                    onChange={(e) => setMinHalfDayHours(Number(e.target.value))}
                    disabled={!canManage}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Hours below half-day threshold are treated as invalid on timesheet submission.
              </p>

              <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <Checkbox
                  checked={attendanceLockEnabled}
                  onCheckedChange={(value) => setAttendanceLockEnabled(Boolean(value))}
                  disabled={!canManage}
                />
                <span>Lock attendance edits for older days</span>
              </label>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <label className="text-sm font-medium">Lock Mode</label>
                  <Select
                    value={attendanceLockMode}
                    onValueChange={setAttendanceLockMode}
                    disabled={!canManage || !attendanceLockEnabled}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Lock mode" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="days_window">By days window</SelectItem>
                      <SelectItem value="payroll_cutoff">By attendance lock day</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Editable Window (Days)</label>
                  <Input
                    type="number"
                    min={0}
                    max={365}
                    value={attendanceLockAfterDays}
                    onChange={(e) => setAttendanceLockAfterDays(Number(e.target.value))}
                    disabled={!canManage || !attendanceLockEnabled || attendanceLockMode !== "days_window"}
                    placeholder="Ex: 7"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Attendance Lock Day</label>
                  <Input
                    type="number"
                    min={1}
                    max={31}
                    value={attendanceLockDay}
                    onChange={(e) => setAttendanceLockDay(Number(e.target.value))}
                    disabled={!canManage || !attendanceLockEnabled || attendanceLockMode !== "payroll_cutoff"}
                    placeholder="Ex: 9"
                  />
                  <p className="text-xs text-muted-foreground">
                    Attendance edits lock from this day of the month. This is separate from the payroll cutoff day.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-card p-5 card-shadow transition-all duration-300 hover:shadow-lg">
            <div className="mb-4 flex items-center gap-2">
              <Clock3 className="h-5 w-5 text-emerald-600" />
              <h3 className="text-base font-semibold text-slate-900">Payroll Settings</h3>
            </div>
            <div className="space-y-4">
              <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <Checkbox
                  checked={payrollEnabled}
                  onCheckedChange={(value) => setPayrollEnabled(Boolean(value))}
                  disabled={!canManage}
                />
                <span>
                  Enable payroll for this organization and auto-provision payroll setup.
                </span>
              </label>

              <div className="space-y-2">
                <label className="text-sm font-medium">Payroll Cutoff Day</label>
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={payrollCutoffDay}
                  onChange={(e) => setPayrollCutoffDay(Number(e.target.value))}
                  disabled={!canManage}
                  placeholder="Ex: 25"
                />
                <p className="text-xs text-muted-foreground">
                  This is used for payroll setup defaults and pay-group provisioning.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Salary Pay Day</label>
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={payrollSalaryPayDay}
                  onChange={(e) => setPayrollSalaryPayDay(Number(e.target.value))}
                  disabled={!canManage}
                  placeholder="Ex: 30"
                />
                <p className="text-xs text-muted-foreground">
                  Payroll uses this as the default salary release day when creating or provisioning pay groups.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Salary Proration</label>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-muted-foreground">
                  Salary proration is configured in <span className="font-medium text-slate-700">Payroll Setup</span> for each pay group.
                  Use that screen when you want to choose between payable-days based and present-days-on-working-days logic.
                </div>
                <p className="text-xs text-amber-600">
                  Existing payroll runs keep their current calculation until they are recomputed.
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-card p-5 card-shadow transition-all duration-300 hover:shadow-lg lg:col-span-2">
            <div className="mb-4 flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-violet-600" />
              <h3 className="text-base font-semibold text-slate-900">Organization Access and Timezone</h3>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Max Active Logins Per User</label>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={maxActiveLoginsPerUser}
                  onChange={(e) => setMaxActiveLoginsPerUser(Number(e.target.value))}
                  disabled={!canManage}
                />
                <p className="text-xs text-muted-foreground">
                  Limits how many devices a user can stay logged into at the same time for this organization.
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Organization Timezone</label>
                <Select
                  value={timezone}
                  onValueChange={setTimezone}
                  disabled={!canManage}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select timezone" />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEZONE_OPTIONS.map((tz) => (
                      <SelectItem key={tz} value={tz}>
                        {tz}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Attendance boundaries use this timezone. Timestamps remain stored in UTC.
                </p>
              </div>
            </div>
          </section>
        </div>

        <section className="rounded-2xl border border-slate-200 bg-card p-5 card-shadow transition-all duration-300 hover:shadow-lg">
          <div className="mb-4 flex items-center gap-2">
            <MapPin className="h-5 w-5 text-emerald-600" />
            <h3 className="text-base font-semibold text-slate-900">Check-In Restrictions</h3>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">Restriction Options</label>
              <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={attendanceIpEnabled}
                    onCheckedChange={(value) => setAttendanceIpEnabled(Boolean(value))}
                    disabled={!canManage}
                  />
                  <span>Office IP only</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={attendanceSelfieRequired}
                    onCheckedChange={(value) => setAttendanceSelfieRequired(Boolean(value))}
                    disabled={!canManage}
                  />
                  <span>Selfie required</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={attendanceMultiPunchEnabled}
                    onCheckedChange={(value) => setAttendanceMultiPunchEnabled(Boolean(value))}
                    disabled={!canManage}
                  />
                  <span>Multi check-in/out</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={attendanceGeoFenceEnabled}
                    onCheckedChange={(value) => setAttendanceGeoFenceEnabled(Boolean(value))}
                    disabled={!canManage}
                  />
                  <span>Office geofence only</span>
                </label>
                {!attendanceIpEnabled && !attendanceSelfieRequired && !attendanceMultiPunchEnabled && !attendanceGeoFenceEnabled && (
                  <p className="text-xs text-muted-foreground">No restriction enabled</p>
                )}
              </div>
            </div>

            <div className="space-y-2 lg:col-span-2">
              <label className="text-sm font-medium">Office IPs (comma/newline separated)</label>
              <Input
                type="text"
                placeholder="Ex: 103.12.11.20, 27.6.72.42"
                value={attendanceAllowedIp}
                onChange={(e) => setAttendanceAllowedIp(e.target.value)}
                disabled={!canManage || !attendanceIpEnabled}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Latitude</label>
              <Input
                type="number"
                step="0.000001"
                placeholder="Office latitude"
                value={attendanceGeoLatitude}
                onChange={(e) => setAttendanceGeoLatitude(e.target.value)}
                disabled={!canManage || !attendanceGeoFenceEnabled}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Longitude</label>
              <Input
                type="number"
                step="0.000001"
                placeholder="Office longitude"
                value={attendanceGeoLongitude}
                onChange={(e) => setAttendanceGeoLongitude(e.target.value)}
                disabled={!canManage || !attendanceGeoFenceEnabled}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Radius (Meters)</label>
              <Input
                type="number"
                min={10}
                max={100000}
                placeholder="Radius"
                value={attendanceGeoRadiusMeters}
                onChange={(e) => setAttendanceGeoRadiusMeters(Number(e.target.value || 200))}
                disabled={!canManage || !attendanceGeoFenceEnabled}
              />
            </div>
          </div>

          {/* <label className="mt-4 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
            <Checkbox
              checked={attendanceDevBypassEnabled}
              onCheckedChange={(value) => setAttendanceDevBypassEnabled(Boolean(value))}
              disabled={!canManage}
            />
            <span>
              Enable local development bypass (skip restriction checks when `NODE_ENV` is not `production`)
            </span>
          </label> */}
        </section>

        <PermissionGate permissions={["ORG_SETTINGS_MANAGE"]}>
          <div className="sticky bottom-4 z-10 flex justify-end">
            <Button onClick={saveSettings} disabled={loading} className="min-w-32 gap-2 rounded-xl shadow-lg">
              <Save className="h-4 w-4" />
              {loading ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </PermissionGate>
      </div>
      )}
    </MainLayout>
  );
};

export default OrganizationSettings;
