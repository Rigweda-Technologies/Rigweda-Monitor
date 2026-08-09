import { Badge } from "@/components/ui/badge";

export type PayrollRun = {
  id: string;
  run_code: string;
  run_name: string;
  pay_month: string;
  status: string;
  employee_count: number;
  processed_employee_count: number;
  warning_count: number;
  error_count: number;
  gross_total: number;
  net_pay_total: number;
  updated_at?: string;
};

export type PayrollRunEmployee = {
  id: string;
  employee_external_id: string;
  payroll_status: string;
  payable_days: number;
  lop_days: number;
  gross_earnings: number;
  total_deductions: number;
  reimbursement_amount: number;
  employer_contributions: number;
  net_pay: number;
  error_message?: string | null;
  warnings?: string[] | string;
};

export type PayslipData = {
  payslipJson?: any;
  pdfPayload?: any;
};

export type PayGroup = {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  pay_frequency: "monthly" | "semi_monthly" | "weekly";
  cutoff_day?: number | null;
  salary_pay_day: number;
  work_week_days?: number;
  is_active: boolean;
  metadata?: Record<string, any>;
};

export type PayGroupForm = {
  code: string;
  name: string;
  description: string;
  payFrequency: "monthly" | "semi_monthly" | "weekly";
  salaryPayDay: string;
  workWeekDays: string;
  basicPercent: string;
};

export type EmployeeOption = {
  _id: string;
  firstName?: string;
  lastName?: string;
  employeeCode?: string;
  profileImage?: string | null;
};

export type EmployeeListPayload = {
  items?: EmployeeOption[];
  pagination?: {
    page?: number;
    totalPages?: number;
  };
};

export type EmployeePayrollProfile = {
  id: string;
  employee_external_id: string;
  employee_name?: string | null;
  employee_display_name?: string | null;
  employee_code?: string | null;
  employee_profile_image?: string | null;
  pay_group_id?: string | null;
  payroll_status?: string;
  default_payment_mode?: string;
  tax_regime?: string;
  monthly_gross?: number | null;
  basic_pay?: number | null;
  variable_pay?: number | null;
  variable_pay_target?: number | null;
  variable_pay_approved_amount?: number | null;
  variable_pay_approval_status?: string | null;
  annual_ctc?: number | null;
  latest_salary_effective_from?: string | null;
  confirmed_date?: string | null;
  latest_salary_metadata?: Record<string, any> | null;
};

export type AttendanceSnapshotRow = {
  employee_external_id: string;
  payable_days: number;
  lop_days: number;
  present_days?: number;
  paid_leave_days?: number;
  unpaid_leave_days?: number;
  week_off_days?: number;
  holiday_days?: number;
  absent_days?: number;
  half_days?: number;
  generation_status?: string;
  generated_at?: string;
};

export const emptyPayGroupForm: PayGroupForm = {
  code: "",
  name: "",
  description: "",
  payFrequency: "monthly",
  salaryPayDay: "",
  workWeekDays: "6",
  basicPercent: "50"
};

export const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  }).format(Number.isFinite(amount) ? amount : 0);

export const toMonthValue = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
};

type BuildMonthOptionsParams = {
  payrollCutoffDay?: number | null;
  payrollSalaryPayDay?: number | null;
  months?: number;
  baseDate?: Date;
};

const normalizePayrollDay = (value: number | null | undefined, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const day = Math.floor(parsed);
  if (day < 1 || day > 31) return fallback;
  return day;
};

export const getPayrollCycleMonth = (params: BuildMonthOptionsParams = {}) => {
  const baseDate = params.baseDate ? new Date(params.baseDate) : new Date();
  const cutoffDay = normalizePayrollDay(params.payrollCutoffDay, 25);
  const salaryPayDay = normalizePayrollDay(params.payrollSalaryPayDay, 30);
  const isCrossMonthPayroll = salaryPayDay < cutoffDay;

  if (isCrossMonthPayroll && baseDate.getDate() <= salaryPayDay) {
    baseDate.setMonth(baseDate.getMonth() - 1);
  }

  return toMonthValue(baseDate);
};

export const buildMonthOptions = (params: BuildMonthOptionsParams = {}) => {
  const options: string[] = [];
  const monthCount = Math.max(1, Math.min(24, Math.floor(Number(params.months || 12))));
  const anchorMonth = getPayrollCycleMonth(params);
  const [year, month] = anchorMonth.split("-").map(Number);
  for (let i = 0; i < monthCount; i += 1) {
    const d = new Date(year, month - 1 - i, 1);
    options.push(toMonthValue(d));
  }
  return options;
};

export const getStatusBadge = (status: string) => {
  const normalized = String(status || "").toLowerCase();
  if (["paid", "locked", "approved", "ready_for_approval", "active"].includes(normalized)) {
    return <Badge className="bg-green-600 text-white">{status}</Badge>;
  }
  if (["validation_failed", "cancelled", "error", "inactive", "resigned", "exited"].includes(normalized)) {
    return <Badge className="bg-red-600 text-white">{status}</Badge>;
  }
  if (["draft", "validating", "pending", "processed", "on_leave", "on hold", "on_hold"].includes(normalized)) {
    return <Badge className="bg-amber-600 text-white">{status}</Badge>;
  }
  return <Badge variant="secondary">{status}</Badge>;
};

export const normalizeWarnings = (warnings: PayrollRunEmployee["warnings"]) => {
  if (!warnings) return [] as string[];
  if (Array.isArray(warnings)) return warnings;
  if (typeof warnings === "string") {
    try {
      const parsed = JSON.parse(warnings);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return warnings ? [warnings] : [];
    }
  }
  return [] as string[];
};

export const getEmployeeBasicRuleLabel = (profile: EmployeePayrollProfile) => {
  const salaryRules = profile?.latest_salary_metadata?.salaryRules || {};
  const source = salaryRules.basicPercentSource === "employee" ? "Employee" : "Pay Group";
  const percent =
    salaryRules.basicPercentSource === "employee"
      ? salaryRules.employeeBasicPercent ?? salaryRules.payGroupBasicPercent
      : salaryRules.payGroupBasicPercent;

  if (percent == null || percent === "") return `${source} default`;
  return `${source} ${Number(percent).toFixed(2)}%`;
};

export const getInitials = (name: string) =>
  String(name || "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "EM";

export const sanitizeEmployeeDisplayName = (value?: string | null) => {
  const name = String(value || "").trim();
  if (!name) return "";
  if (name.toLowerCase() === "employee") return "";
  return name;
};
