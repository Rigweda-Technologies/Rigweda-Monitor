import { type FocusEvent, type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { getApiWithToken, postApiWithToken } from "@/services/apiWrapper";
import { toast } from "sonner";

type ComponentDraft = {
  id?: string;
  scope: "earning" | "deduction" | "employer_contribution";
  code: string;
  name: string;
  effectiveFrom?: string;
  calculationMode: "fixed" | "percentage" | "formula" | "slab";
  taxable: boolean;
  amount: string;
  percentageOf: string;
  formulaTemplate: string;
  formulaExpression: string;
};

type PayrollTemplate = {
  id: string;
  title: string;
  description: string;
  components: ComponentDraft[];
  statutory: {
    enablePf: boolean;
    enableEsi: boolean;
    enablePt: boolean;
    enableLwf: boolean;
    pfWageThreshold: string;
    esiWageThreshold: string;
    stateCode: string;
  };
  attendanceRules: {
    attendanceLockMode: "payroll_cutoff" | "days_window";
    attendanceLockAfterDays: string;
    lopCalculationMethod: "calendar_days" | "working_days";
    salaryProrationRule: "payable_days" | "present_days_on_working_days";
    defaultWorkingDays: string;
    enableProration: boolean;
    enableAutoOvertime: boolean;
  };
};

type TelanganaRuleItem = {
  id: string;
  title: string;
  points: string[];
  status: "auto_default" | "manual_policy" | "legal_update_required";
};

type PayGroupOption = {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  pay_frequency: string;
  salary_pay_day: number;
  work_week_days?: number;
  is_active: boolean;
  metadata?: Record<string, any>;
};

type PayrollSettingsPayload = {
  default_pay_group_id?: string | null;
  defaultPayGroupId?: string | null;
  attendance_lock_mode?: "payroll_cutoff" | "days_window";
  attendance_lock_after_days?: number;
  lop_calculation_method?: "calendar_days" | "working_days";
  default_working_days?: number;
  enable_proration?: boolean;
  metadata?: Record<string, any>;
};

type SalaryComponentPayload = {
  id?: string;
  payGroupId?: string;
  pay_group_id?: string;
  scope: ComponentDraft["scope"];
  code?: string;
  name?: string;
  calculationMode?: ComponentDraft["calculationMode"];
  calculation_mode?: ComponentDraft["calculationMode"];
  taxable?: boolean;
  effectiveFrom?: string;
  effective_from?: string;
  metadata?: Record<string, any>;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSettings?: any;
  preferredPayGroupId?: string;
  payrollCutoffDay?: number;
  payrollSalaryPayDay?: number;
  onActivated?: () => void;
};

const TODAY = new Date().toISOString().slice(0, 10);
const getLocalDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const CURRENT_MONTH_START = getLocalDateKey(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
const toMonthInputValue = (value?: string) => {
  const rawValue = String(value || "").trim();
  if (!rawValue) return CURRENT_MONTH_START.slice(0, 7);
  if (/^\d{4}-\d{2}(-\d{2})?$/.test(rawValue)) return rawValue.slice(0, 7);
  const parsed = new Date(rawValue);
  if (Number.isNaN(parsed.getTime())) return CURRENT_MONTH_START.slice(0, 7);
  return getLocalDateKey(parsed).slice(0, 7);
};
const toMonthStartDate = (value?: string) => {
  const monthValue = toMonthInputValue(value);
  return monthValue ? `${monthValue}-01` : CURRENT_MONTH_START;
};
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEGACY_OTHER_ALLOWANCE_FORMULA =
  "round(max(MONTHLY_GROSS - (BASIC + HRA + VARIABLE + BONUS), 0))";
const OTHER_ALLOWANCE_FORMULA =
  "round(max(MONTHLY_GROSS - (BASIC + HRA + VARIABLE), 0))";

const steps = [
  "Salary Cycle",
  "Salary Components",
  "Compliance Defaults",
  "Attendance & LOP",
  "Review & Save"
];

const defaultComponent = (): ComponentDraft => ({
  id: undefined,
  scope: "earning",
  code: "",
  name: "",
  effectiveFrom: CURRENT_MONTH_START,
  calculationMode: "fixed",
  taxable: true,
  amount: "",
  percentageOf: "MONTHLY_GROSS",
  formulaTemplate: "custom",
  formulaExpression: ""
});

const FORMULA_PRESETS = [
  {
    id: "custom",
    label: "Custom Formula",
    expression: "",
    help: "You can write your own formula."
  },
  {
    id: "hra_50_basic",
    label: "HRA = 50% of Basic",
    expression: "BASIC * 0.5",
    help: "Common setup for many Indian payroll structures."
  },
  {
    id: "taxable_allowance_basic_minus_hra",
    label: "Other Allowance = Gross - Basic - HRA - Variable",
    expression: OTHER_ALLOWANCE_FORMULA,
    help: "Balances Monthly Gross after Basic, HRA, and Variable Pay. Bonus is not included."
  }
] as const;

const STARTER_FORMULA_BY_CODE: Record<string, string> = {
  BASIC: "BASIC_PAY",
  HRA: "round(BASIC_PAY * HRA_PERCENT_OF_BASIC / 100)",
  VARIABLE: "VARIABLE_PAY",
  OTHER_ALLOWANCE: OTHER_ALLOWANCE_FORMULA,
  EPF: "round(min(BASIC_PAY, 15000) * 0.12)",
  ESI: "round(ESI_EMPLOYEE_AMOUNT)",
  TDS: "round(TDS_AMOUNT)",
  EMPLOYER_EPF: "round(EMPLOYER_EPF)"
};

const PF_COMPONENT_CODES = new Set([
  "EPF",
  "EMPLOYEE_EPF",
  "EMPLOYEE_PROVIDENT_FUND",
  "PF_EMPLOYEE_SHARE",
  "EMPLOYER_EPF",
  "EMPLOYER_PF",
  "PF_EMPLOYER_SHARE"
]);

const ESI_COMPONENT_CODES = new Set([
  "ESI",
  "EMPLOYEE_ESI",
  "ESI_EMPLOYEE",
  "ESI_EMPLOYEE_AMOUNT",
  "EMPLOYER_ESI",
  "ESI_EMPLOYER",
  "ESI_EMPLOYER_AMOUNT"
]);

const isPfComponentCode = (code?: string) => PF_COMPONENT_CODES.has(String(code || "").trim().toUpperCase());
const isEsiComponentCode = (code?: string) => ESI_COMPONENT_CODES.has(String(code || "").trim().toUpperCase());

const TELANGANA_DEFAULT_TEMPLATE: PayrollTemplate = {
  id: "telangana_standard_monthly_v1",
  title: "Telangana Standard Payroll Pack",
  description:
    "Preloaded Indian payroll defaults for Telangana. HR can edit every component before saving.",
  components: [
    {
      scope: "earning",
      code: "BASIC",
      name: "Basic Pay",
      calculationMode: "percentage",
      taxable: true,
      amount: "50",
      percentageOf: "MONTHLY_GROSS",
      formulaTemplate: "custom",
      formulaExpression: ""
    },
    {
      scope: "earning",
      code: "HRA",
      name: "House Rent Allowance",
      calculationMode: "percentage",
      taxable: true,
      amount: "50",
      percentageOf: "BASIC",
      formulaTemplate: "hra_50_basic",
      formulaExpression: "BASIC * 0.5"
    },
    {
      scope: "earning",
      code: "FOOD_COUPONS",
      name: "Food Coupons",
      calculationMode: "fixed",
      taxable: false,
      amount: "2200",
      percentageOf: "MONTHLY_GROSS",
      formulaTemplate: "custom",
      formulaExpression: ""
    },
    {
      scope: "earning",
      code: "CHILDREN_EDU_ALLOW",
      name: "Children Education Allowance",
      calculationMode: "fixed",
      taxable: false,
      amount: "200",
      percentageOf: "MONTHLY_GROSS",
      formulaTemplate: "custom",
      formulaExpression: ""
    },
    {
      scope: "earning",
      code: "OTHER_ALLOWANCE",
      name: "Other Allowance",
      calculationMode: "formula",
      taxable: true,
      amount: "",
      percentageOf: "MONTHLY_GROSS",
      formulaTemplate: "taxable_allowance_basic_minus_hra",
      formulaExpression: OTHER_ALLOWANCE_FORMULA
    },
    {
      scope: "deduction",
      code: "EPF",
      name: "Employee Provident Fund",
      calculationMode: "formula",
      taxable: false,
      amount: "",
      percentageOf: "BASIC_PAY",
      formulaTemplate: "custom",
      formulaExpression: "round(min(BASIC_PAY, 15000) * 0.12)"
    },
    {
      scope: "deduction",
      code: "ESI",
      name: "Employee State Insurance",
      calculationMode: "formula",
      taxable: false,
      amount: "",
      percentageOf: "MONTHLY_GROSS",
      formulaTemplate: "custom",
      formulaExpression: "round(ESI_EMPLOYEE_AMOUNT)"
    },
    {
      scope: "deduction",
      code: "PT",
      name: "Professional Tax",
      calculationMode: "slab",
      taxable: false,
      amount: "200",
      percentageOf: "MONTHLY_GROSS",
      formulaTemplate: "custom",
      formulaExpression: ""
    },
    {
      scope: "deduction",
      code: "TDS",
      name: "Tax Deducted at Source",
      calculationMode: "formula",
      taxable: false,
      amount: "",
      percentageOf: "MONTHLY_GROSS",
      formulaTemplate: "custom",
      formulaExpression: "round(TDS_AMOUNT)"
    },
    {
      scope: "deduction",
      code: "PARENTS_MEDICAL_PREM",
      name: "Parents Medical Premium",
      calculationMode: "fixed",
      taxable: false,
      amount: "7859",
      percentageOf: "MONTHLY_GROSS",
      formulaTemplate: "custom",
      formulaExpression: ""
    },
    {
      scope: "employer_contribution",
      code: "EMPLOYER_EPF",
      name: "Employer Provident Fund",
      calculationMode: "formula",
      taxable: false,
      amount: "",
      percentageOf: "BASIC_PAY",
      formulaTemplate: "custom",
      formulaExpression: "round(EMPLOYER_EPF)"
    }
  ],
  statutory: {
    enablePf: true,
    enableEsi: true,
    enablePt: true,
    enableLwf: false,
    pfWageThreshold: "15000",
    esiWageThreshold: "21000",
    stateCode: "TS"
  },
  attendanceRules: {
    attendanceLockMode: "payroll_cutoff",
    attendanceLockAfterDays: "7",
    lopCalculationMethod: "working_days",
    salaryProrationRule: "payable_days",
    defaultWorkingDays: "30",
    enableProration: true,
    enableAutoOvertime: true
  }
};

type ComponentNamePreset = {
  labels: string[];
  template: ComponentDraft;
};

const STARTER_COMPONENT_NAME_PRESETS: ComponentNamePreset[] = [
  {
    labels: ["Basic Pay", "Basic", "Basic Salary"],
    template: TELANGANA_DEFAULT_TEMPLATE.components[0]
  },
  {
    labels: ["House Rent Allowance", "HRA"],
    template: TELANGANA_DEFAULT_TEMPLATE.components[1]
  },
  {
    labels: ["Food Coupons"],
    template: TELANGANA_DEFAULT_TEMPLATE.components[2]
  },
  {
    labels: ["Children Education Allowance", "Children Edu Allowance"],
    template: TELANGANA_DEFAULT_TEMPLATE.components[3]
  },
  {
    labels: ["Other Allowance"],
    template: TELANGANA_DEFAULT_TEMPLATE.components[4]
  },
  {
    labels: ["Employee Provident Fund", "Employee PF", "EPF"],
    template: TELANGANA_DEFAULT_TEMPLATE.components[5]
  },
  {
    labels: ["Employee State Insurance", "ESI"],
    template: TELANGANA_DEFAULT_TEMPLATE.components[6]
  },
  {
    labels: ["Professional Tax", "PT"],
    template: TELANGANA_DEFAULT_TEMPLATE.components[7]
  },
  {
    labels: ["Tax Deducted at Source", "TDS"],
    template: TELANGANA_DEFAULT_TEMPLATE.components[8]
  },
  {
    labels: ["Parents Medical Premium"],
    template: TELANGANA_DEFAULT_TEMPLATE.components[9]
  },
  {
    labels: ["Employer Provident Fund", "Employer PF", "Employer EPF"],
    template: TELANGANA_DEFAULT_TEMPLATE.components[10]
  }
];

const STARTER_COMPONENT_CODE_SET = new Set(
  STARTER_COMPONENT_NAME_PRESETS.map((preset) => preset.template.code.trim().toUpperCase())
);

const normalizeComponentNameKey = (value: string) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

const normalizeGeneratedComponentCode = (value: string) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const getPresetByComponentName = (value: string) => {
  const normalized = normalizeComponentNameKey(value);
  if (!normalized) return null;
  return (
    STARTER_COMPONENT_NAME_PRESETS.find((preset) =>
      preset.labels.some((label) => normalizeComponentNameKey(label) === normalized)
    ) || null
  );
};

const buildUniqueGeneratedComponentCode = (name: string, takenCodes: Set<string>) => {
  const baseCode = normalizeGeneratedComponentCode(name) || "CUSTOM_COMPONENT";
  let candidate = baseCode;
  let suffix = 2;
  while (takenCodes.has(candidate) || STARTER_COMPONENT_CODE_SET.has(candidate)) {
    candidate = `${baseCode}_${suffix}`;
    suffix += 1;
  }
  return candidate;
};

const ensureTemplateComponents = (components: ComponentDraft[], codes: string[]) => {
  const existingCodes = new Set(components.map((component) => component.code.trim().toUpperCase()));
  const missingComponents = codes
    .filter((code) => !existingCodes.has(code))
    .map((code) => TELANGANA_DEFAULT_TEMPLATE.components.find(
      (component) => component.code.trim().toUpperCase() === code
    ))
    .filter(Boolean)
    .map((component) => ({ ...(component as ComponentDraft) }));

  return missingComponents.length ? [...components, ...missingComponents] : components;
};

const TELANGANA_RULES: TelanganaRuleItem[] = [
  {
    id: "min_wage",
    title: "Minimum Wage Rule",
    points: [
      "Basic + DA must be >= Telangana notified minimum wage by skill/zone.",
      "Minimum wage values must be updated on every new Telangana notification."
    ],
    status: "legal_update_required"
  },
  {
    id: "salary_structure",
    title: "Salary Structure Rules",
    points: [
      "Basic typically 40%-50% of gross.",
      "HRA (Telangana non-metro) default 40% of Basic.",
      "Gross = sum of earnings. Net = Gross - deductions."
    ],
    status: "auto_default"
  },
  {
    id: "epf",
    title: "EPF Rules",
    points: [
      "PF eligibility based on Basic and policy (wage ceiling ₹15,000).",
      "Employee 12% and Employer 12% on PF wages.",
      "Employer split: EPS 8.33% (max ₹1250), remaining to EPF."
    ],
    status: "manual_policy"
  },
  {
    id: "esi",
    title: "ESI Rules",
    points: [
      "Eligible when Gross <= ₹21,000/month.",
      "Employee 0.75%, Employer 3.25%.",
      "Continue till contribution period closure if crossed mid-cycle."
    ],
    status: "manual_policy"
  },
  {
    id: "pt",
    title: "Professional Tax (Telangana)",
    points: [
      "Slabs: <=15000:0, 15001-20000:150, >20000:200 (monthly).",
      "Deduct monthly and remit by employer."
    ],
    status: "auto_default"
  },
  {
    id: "tds",
    title: "Income Tax (TDS)",
    points: [
      "Annual tax split over 12 months.",
      "Old/New regime selectable.",
      "Apply 4% cess and recalculate on mid-year revisions."
    ],
    status: "manual_policy"
  },
  {
    id: "bonus_gratuity",
    title: "Bonus and Gratuity",
    points: [
      "Bonus: eligibility <= ₹21,000 salary, 8.33%-20% annual Basic.",
      "Gratuity: payable after 5 years. Formula: (Last Basic * 15 * Service Years)/26."
    ],
    status: "manual_policy"
  },
  {
    id: "hours_leave_maternity_lwf",
    title: "Hours, Leave, Maternity, LWF",
    points: [
      "Working hours: 9/day, 48/week, overtime at 2x.",
      "Leave accrual and encashment as state/company policy.",
      "Maternity: 26 weeks (eligible employees).",
      "LWF as notified (annual/bi-annual), employer + employee contribution."
    ],
    status: "manual_policy"
  }
];

const FORMULA_FUNCTIONS = [
  { name: "round(x)", help: "Rounds to the nearest whole number." },
  { name: "min(a, b)", help: "Returns the smaller value." },
  { name: "max(a, b)", help: "Returns the larger value." },
  { name: "if(condition, a, b)", help: "Returns a or b based on a comparison." },
  { name: "ceil(x)", help: "Rounds up to the next whole number." },
  { name: "floor(x)", help: "Rounds down to the previous whole number." },
  { name: "abs(x)", help: "Returns the absolute value." },
  { name: "pow(a, b)", help: "Raises a number to a power." }
] as const;

const COMMON_FORMULA_VARIABLES = [
  "BASIC",
  "HRA",
  "VARIABLE",
  "MONTHLY_GROSS",
  "BASIC_PAY",
  "PAYABLE_DAYS",
  "LOP_DAYS",
  "PRORATION_FACTOR",
  "WORKING_DAYS",
  "CALENDAR_DAYS"
] as const;

const getRuleStatusLabel = (status: TelanganaRuleItem["status"]) => {
  if (status === "auto_default") return "Auto Default";
  if (status === "legal_update_required") return "Legal Update Needed";
  return "Manual Policy";
};

const getRuleStatusClass = (status: TelanganaRuleItem["status"]) => {
  if (status === "auto_default") return "bg-green-100 text-green-700";
  if (status === "legal_update_required") return "bg-amber-100 text-amber-700";
  return "bg-emerald-100 text-emerald-700";
};

const getScopeLabel = (scope: ComponentDraft["scope"]) => {
  if (scope === "earning") return "Earning";
  if (scope === "deduction") return "Deduction";
  return "Employer Contribution";
};

const getCalculationModeLabel = (mode: ComponentDraft["calculationMode"]) => {
  if (mode === "fixed") return "Fixed Amount";
  if (mode === "percentage") return "Percentage";
  if (mode === "formula") return "Formula";
  return "Slab";
};

const normalizeCalculationModeForScope = (
  scope: ComponentDraft["scope"],
  mode: ComponentDraft["calculationMode"]
): ComponentDraft["calculationMode"] => {
  if (scope === "earning" && mode === "slab") return "fixed";
  return mode;
};

const normalizeConditionalFormulaExpression = (expression: string) =>
  String(expression || "")
    .replace(/\bif\s*\(/gi, "__if(")
    .trim();

const tokenizeFormulaIdentifiers = (expression: string) => {
  const matches = String(expression || "").match(/[A-Za-z_][A-Za-z0-9_]*/g);
  return matches ? [...new Set(matches)] : [];
};

const evaluateFormulaPreview = (expression: string, context: Record<string, number> = {}) => {
  const expr = normalizeConditionalFormulaExpression(expression);
  if (!expr) return 0;

  if (/['"`;{}\[\]\\]/.test(expr)) {
    throw new Error("Unsupported token in formula expression");
  }

  const helpers = {
    min: Math.min,
    max: Math.max,
    round: Math.round,
    ceil: Math.ceil,
    floor: Math.floor,
    abs: Math.abs,
    pow: Math.pow,
    __if: (condition: unknown, trueValue: unknown, falseValue: unknown) =>
      condition ? trueValue : falseValue
  };

  const mergedContext: Record<string, unknown> = { ...helpers, ...context };
  const identifiers = tokenizeFormulaIdentifiers(expr);

  for (const token of identifiers) {
    if (!(token in mergedContext)) {
      if (/^[A-Z][A-Z0-9_]*$/.test(token)) {
        mergedContext[token] = 0;
        continue;
      }
      throw new Error(`Unknown variable in formula: ${token}`);
    }
  }

  const argNames = Object.keys(mergedContext);
  const argValues = argNames.map((key) => mergedContext[key]);
  const fn = new Function(...argNames, `"use strict"; return (${expr});`);
  const result = fn(...argValues);
  return Number(result || 0);
};

const getFormulaPreviewStatus = (expression: string, componentCodeOptions: string[]) => {
  const context: Record<string, number> = {};
  for (const key of [...COMMON_FORMULA_VARIABLES, ...componentCodeOptions]) {
    context[key] = 0;
  }

  try {
    evaluateFormulaPreview(expression, context);
    return { ok: true, message: "Formula syntax looks valid." };
  } catch (error) {
    return {
      ok: false,
      message: `Formula check failed: ${error instanceof Error ? error.message : "Invalid formula"}`
    };
  }
};

const scrollTextToEnd = (element: HTMLElement | null) => {
  if (!element) return;
  window.setTimeout(() => {
    element.scrollTo({ left: element.scrollWidth, behavior: "smooth" });
  }, 120);
};

const resetTextScroll = (element: HTMLElement | null) => {
  if (!element) return;
  element.scrollTo({ left: 0, behavior: "smooth" });
};

const scrollInputProps = (value: string) => ({
  title: value,
  onMouseEnter: (event: MouseEvent<HTMLInputElement>) => scrollTextToEnd(event.currentTarget),
  onMouseLeave: (event: MouseEvent<HTMLInputElement>) => resetTextScroll(event.currentTarget),
  onFocus: (event: FocusEvent<HTMLInputElement>) => scrollTextToEnd(event.currentTarget),
  onBlur: (event: FocusEvent<HTMLInputElement>) => resetTextScroll(event.currentTarget)
});

const scrollSelectTextProps = (value: string) => ({
  title: value,
  className:
    "[&>span]:block [&>span]:max-w-[calc(100%-1.5rem)] [&>span]:overflow-x-auto [&>span]:whitespace-nowrap [&>span]:line-clamp-none [&>span]:scrollbar-none",
  onMouseEnter: (event: MouseEvent<HTMLButtonElement>) =>
    scrollTextToEnd(event.currentTarget.querySelector("span")),
  onMouseLeave: (event: MouseEvent<HTMLButtonElement>) =>
    resetTextScroll(event.currentTarget.querySelector("span")),
  onFocus: (event: FocusEvent<HTMLButtonElement>) =>
    scrollTextToEnd(event.currentTarget.querySelector("span")),
  onBlur: (event: FocusEvent<HTMLButtonElement>) =>
    resetTextScroll(event.currentTarget.querySelector("span"))
});

const buildPayGroupState = (
  settings?: PayrollSettingsPayload,
  preferredPayGroupId?: string,
  payrollSalaryPayDay = 30,
  availablePayGroups: PayGroupOption[] = []
) => {
  const defaultPayGroupId = String(
    preferredPayGroupId ||
      settings?.default_pay_group_id ||
      settings?.defaultPayGroupId ||
      ""
  );
  const matchedPayGroup = availablePayGroups.find((group) => group.id === defaultPayGroupId);

  return {
    defaultPayGroupId,
    code: String(matchedPayGroup?.code || ""),
    name: String(matchedPayGroup?.name || ""),
    description: String(matchedPayGroup?.description || ""),
    payFrequency: String(matchedPayGroup?.pay_frequency || "monthly"),
    salaryPayDay: String(
      matchedPayGroup?.salary_pay_day ||
        payrollSalaryPayDay ||
        30
    ),
    workWeekDays: String(matchedPayGroup?.work_week_days || 6),
    basicPercent: String(
      matchedPayGroup?.metadata?.salaryRules?.basicPercent ??
        matchedPayGroup?.metadata?.basicPercent ??
        50
    )
  };
};

const buildStatutoryState = (settings?: PayrollSettingsPayload) => {
  const statutory = settings?.metadata?.statutory || {};
  return {
    enablePf: typeof statutory.enablePf === "boolean" ? statutory.enablePf : true,
    enableEsi: typeof statutory.enableEsi === "boolean" ? statutory.enableEsi : true,
    enablePt: typeof statutory.enablePt === "boolean" ? statutory.enablePt : true,
    enableLwf: typeof statutory.enableLwf === "boolean" ? statutory.enableLwf : false,
    pfWageThreshold: String(statutory.pfWageThreshold || "15000"),
    esiWageThreshold: String(statutory.esiWageThreshold || "21000"),
    stateCode: String(statutory.stateCode || "TS")
  };
};

const buildAttendanceRulesState = (settings?: PayrollSettingsPayload) => ({
  attendanceLockMode: (settings?.attendance_lock_mode || "payroll_cutoff") as
    | "payroll_cutoff"
    | "days_window",
  attendanceLockAfterDays: String(settings?.attendance_lock_after_days || 7),
  lopCalculationMethod: (settings?.lop_calculation_method || "calendar_days") as
    | "calendar_days"
    | "working_days",
  salaryProrationRule: (
    settings?.metadata?.attendance?.salaryProrationRule || "payable_days"
  ) as "payable_days" | "present_days_on_working_days",
  defaultWorkingDays: String(settings?.default_working_days || 30),
  enableProration:
    typeof settings?.enable_proration === "boolean" ? settings.enable_proration : true,
  enableAutoOvertime:
    typeof settings?.metadata?.attendance?.enableAutoOvertime === "boolean"
      ? settings.metadata.attendance.enableAutoOvertime
      : true
});

const buildSetupFingerprint = (payload: {
  payGroup: ReturnType<typeof buildPayGroupState>;
  components: ComponentDraft[];
  statutory: ReturnType<typeof buildStatutoryState>;
  attendanceRules: ReturnType<typeof buildAttendanceRulesState>;
}) =>
  JSON.stringify({
    payGroup: payload.payGroup,
    components: payload.components,
    statutory: payload.statutory,
    attendanceRules: payload.attendanceRules
  });

const getComponentPayGroupIds = (component?: SalaryComponentPayload) => {
  const metadata = component?.metadata || {};
  const normalizeValues = (value: unknown) => {
    if (Array.isArray(value)) return value;
    if (typeof value === "string" && value.trim()) return [value];
    return [];
  };
  const values = [
    ...normalizeValues(component?.payGroupId),
    ...normalizeValues(component?.pay_group_id),
    ...normalizeValues(metadata?.payGroupIds),
    ...normalizeValues(metadata?.payGroupId),
    ...normalizeValues(metadata?.pay_group_id),
    ...normalizeValues(metadata?.applicability?.payGroupIds),
    ...normalizeValues(metadata?.applicability?.payGroupId),
    ...normalizeValues(metadata?.applicability?.pay_group_id)
  ];

  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
};

const buildDatabaseBackedComponentsFromPayGroup = (payGroup?: PayGroupOption | null): ComponentDraft[] => {
  const basicPercent = String(
    payGroup?.metadata?.salaryRules?.basicPercent ??
      payGroup?.metadata?.basicPercent ??
      ""
  ).trim();
  if (!basicPercent) return [];

  const basicPercentValue = Number(basicPercent);
  if (!Number.isFinite(basicPercentValue)) return [];

  return [
    {
      id: undefined,
      scope: "earning",
      code: "BASIC",
      name: "Basic Pay",
      effectiveFrom: CURRENT_MONTH_START,
      calculationMode: "percentage",
      taxable: true,
      amount: basicPercent,
      percentageOf: "MONTHLY_GROSS",
      formulaTemplate: "custom",
      formulaExpression: `MONTHLY_GROSS * ${basicPercentValue / 100}`
    }
  ];
};

const dedupeLatestComponentRows = (rows: SalaryComponentPayload[]) => {
  const seen = new Set<string>();
  const deduped: SalaryComponentPayload[] = [];

  for (const row of rows) {
    const scopeKey = String(row?.scope || "").trim();
    const codeKey = String(row?.code || "").trim().toUpperCase();
    if (!scopeKey || !codeKey) continue;
    const compoundKey = `${scopeKey}:${codeKey}`;
    if (seen.has(compoundKey)) continue;
    seen.add(compoundKey);
    deduped.push(row);
  }

  return deduped;
};

const mapComponentToDraft = (component: SalaryComponentPayload): ComponentDraft => {
  const metadata = component?.metadata || {};
  const code = String(component?.code || "").toUpperCase();
  const calculationMode = normalizeCalculationModeForScope(
    component.scope,
    (component?.calculationMode || component?.calculation_mode || "fixed") as ComponentDraft["calculationMode"]
  );
  const storedFormulaExpression = String(
    metadata.expression || STARTER_FORMULA_BY_CODE[code] || ""
  );
  const formulaExpression =
    code === "OTHER_ALLOWANCE" && storedFormulaExpression === LEGACY_OTHER_ALLOWANCE_FORMULA
      ? OTHER_ALLOWANCE_FORMULA
      : storedFormulaExpression;
  return {
    id: component?.id,
    scope: component.scope,
    code,
    name: String(component?.name || ""),
    effectiveFrom:
      String(component?.effectiveFrom || component?.effective_from || "").slice(0, 10) ||
      CURRENT_MONTH_START,
    calculationMode,
    taxable: Boolean(component?.taxable),
    amount:
      calculationMode === "percentage"
        ? String(metadata.percentage ?? metadata.amount ?? metadata.monthlyAmount ?? "")
        : calculationMode === "formula"
          ? String(metadata.amount ?? metadata.monthlyAmount ?? metadata.defaultAmount ?? "")
          : String(metadata.monthlyAmount ?? metadata.amount ?? metadata.defaultAmount ?? ""),
    percentageOf: String(metadata.base || "MONTHLY_GROSS"),
    formulaTemplate:
      FORMULA_PRESETS.find((preset) => preset.expression === formulaExpression)?.id || "custom",
    formulaExpression
  };
};

export const PayrollSetupWizard = ({
  open,
  onOpenChange,
  initialSettings,
  preferredPayGroupId,
  payrollCutoffDay = 25,
  payrollSalaryPayDay = 30,
  onActivated
}: Props) => {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [loadingExistingSetup, setLoadingExistingSetup] = useState(false);
  const [loadedComponentIds, setLoadedComponentIds] = useState<string[]>([]);
  const [loadedComponentScopeMap, setLoadedComponentScopeMap] = useState<Record<string, ComponentDraft["scope"]>>({});

  const [payGroup, setPayGroup] = useState(
    buildPayGroupState(initialSettings, preferredPayGroupId, payrollSalaryPayDay)
  );

  const [components, setComponents] = useState<ComponentDraft[]>([]);
  const [showTemplatePreview, setShowTemplatePreview] = useState(false);
  const [startupDefaultsApplied, setStartupDefaultsApplied] = useState(false);
  const [showRulesPanel, setShowRulesPanel] = useState(false);
  const [showFormulaGuide, setShowFormulaGuide] = useState(false);
  const [availablePayGroups, setAvailablePayGroups] = useState<PayGroupOption[]>([]);
  const [loadingPayGroups, setLoadingPayGroups] = useState(false);
  const [savedSetupFingerprint, setSavedSetupFingerprint] = useState("");
  const loadRequestSeq = useRef(0);

  const [statutory, setStatutory] = useState(buildStatutoryState(initialSettings));

  const [attendanceRules, setAttendanceRules] = useState(buildAttendanceRulesState(initialSettings));
  const selectedPayGroupOption = useMemo(
    () =>
      availablePayGroups.find((group) => String(group.id) === String(payGroup.defaultPayGroupId || "").trim()) ||
      null,
    [availablePayGroups, payGroup.defaultPayGroupId]
  );
  const hasSavedComponentRows = loadedComponentIds.length > 0;

  const activeComponents = useMemo(
    () =>
      components.filter((component) => {
        if (!component.code.trim() || !component.name.trim()) return false;
        if (!statutory.enablePf && isPfComponentCode(component.code)) return false;
        if (!statutory.enableEsi && isEsiComponentCode(component.code)) return false;
        return true;
      }),
    [components, statutory.enableEsi, statutory.enablePf]
  );
  const activeComponentCount = useMemo(
    () => activeComponents.length,
    [activeComponents]
  );
  const earningCount = useMemo(
    () => activeComponents.filter((component) => component.scope === "earning").length,
    [activeComponents]
  );
  const deductionCount = useMemo(
    () => activeComponents.filter((component) => component.scope === "deduction").length,
    [activeComponents]
  );
  const employerContributionCount = useMemo(
    () => activeComponents.filter((component) => component.scope === "employer_contribution").length,
    [activeComponents]
  );
  const employeePfComponent = useMemo(
    () => activeComponents.find((component) => component.code.trim().toUpperCase() === "EPF") || null,
    [activeComponents]
  );
  const employerPfComponent = useMemo(
    () => activeComponents.find((component) => component.code.trim().toUpperCase() === "EMPLOYER_EPF") || null,
    [activeComponents]
  );
  const isPayGroupIdValid = UUID_REGEX.test(payGroup.defaultPayGroupId.trim());
  const currentSetupFingerprint = useMemo(
    () => buildSetupFingerprint({ payGroup, components, statutory, attendanceRules }),
    [attendanceRules, components, payGroup, statutory]
  );
  const hasUnsavedChanges = currentSetupFingerprint !== savedSetupFingerprint;
  const componentCodeOptions = useMemo(() => {
    const codes = components
      .map((c) => c.code.trim().toUpperCase())
      .filter(Boolean);
    return [...new Set(["MONTHLY_GROSS", ...codes])];
  }, [components]);
  const componentNameOptions = useMemo(() => {
    const names = [
      ...STARTER_COMPONENT_NAME_PRESETS.flatMap((preset) => preset.labels),
      ...components.map((component) => component.name).filter(Boolean)
    ];
    return [...new Set(names.map((name) => String(name || "").trim()).filter(Boolean))];
  }, [components]);

  const applyComponentNameSelection = (index: number, nextName: string) => {
    const normalizedName = String(nextName || "").trim();
    setComponents((prev) => {
      const existingCodes = new Set(
        prev
          .map((component, componentIndex) =>
            componentIndex === index ? "" : normalizeGeneratedComponentCode(component.code)
          )
          .filter(Boolean)
      );

      return prev.map((component, componentIndex) => {
        if (componentIndex !== index) return component;

        if (!normalizedName) {
          return { ...component, name: nextName, code: "" };
        }

        const preset = getPresetByComponentName(normalizedName);
        if (preset) {
          return {
            ...component,
            ...preset.template,
            id: component.id,
            name: preset.template.name,
            code: preset.template.code,
            effectiveFrom: component.effectiveFrom || preset.template.effectiveFrom
          };
        }

        if (component.id && component.code.trim()) {
          return { ...component, name: normalizedName };
        }

        return {
          ...component,
          name: normalizedName,
          code: buildUniqueGeneratedComponentCode(normalizedName, existingCodes)
        };
      });
    });
  };

  useEffect(() => {
    if (!open) return;
    setPayGroup((prev) => ({
      ...prev,
      defaultPayGroupId: String(
        preferredPayGroupId ||
          initialSettings?.default_pay_group_id ||
          initialSettings?.defaultPayGroupId ||
          prev.defaultPayGroupId ||
          ""
      )
    }));
  }, [open, preferredPayGroupId, initialSettings]);

  useEffect(() => {
    if (!open) return;
    const requestSeq = ++loadRequestSeq.current;

    const loadExistingSetup = async () => {
      setLoadingExistingSetup(true);
      setLoadingPayGroups(true);
      setComponents([]);
      setLoadedComponentIds([]);
      setLoadedComponentScopeMap({});
      try {
        const bootstrapRes = await getApiWithToken(
          `/payroll/setup/bootstrap${preferredPayGroupId ? `?payGroupId=${preferredPayGroupId}` : ""}`,
          null,
          {
            requiredPermissions: ["PAYROLL_CONFIG_MANAGE"]
          }
        );
        if (loadRequestSeq.current !== requestSeq) return;

        if (!bootstrapRes?.success) {
          if (!bootstrapRes?.skipped) {
            toast.error(bootstrapRes?.message || "Failed to load payroll setup");
          }
          return;
        }

        const bootstrap = bootstrapRes.data || {};
        const nextSettings = bootstrap.settings || initialSettings;
        const nextPayGroups = Array.isArray(bootstrap.payGroups) ? bootstrap.payGroups : [];
        const resolvedPayGroupId =
          String(bootstrap.selectedPayGroupId || "").trim() ||
          preferredPayGroupId ||
          nextSettings?.default_pay_group_id ||
          nextSettings?.defaultPayGroupId ||
          "";

        setAvailablePayGroups(nextPayGroups);

        const allComponents = Array.isArray(bootstrap.components) ? bootstrap.components : [];
        const exactPayGroupComponents = bootstrap.hasExplicitComponents
          ? dedupeLatestComponentRows(allComponents)
          : [];
        const selectedPayGroup =
          bootstrap.selectedPayGroup || nextPayGroups.find((group) => String(group.id) === resolvedPayGroupId) || null;
        const selectedPayGroupComponents = Array.isArray(bootstrap.selectedPayGroup?.components)
          ? dedupeLatestComponentRows(bootstrap.selectedPayGroup.components)
          : [];
        const componentsToUse =
          exactPayGroupComponents.length > 0
            ? exactPayGroupComponents
            : selectedPayGroupComponents.length > 0
              ? selectedPayGroupComponents
            : buildDatabaseBackedComponentsFromPayGroup(selectedPayGroup);

        const nextPayGroup = buildPayGroupState(
          nextSettings,
          resolvedPayGroupId,
          payrollSalaryPayDay,
          nextPayGroups
        );
        const nextStatutory = buildStatutoryState(nextSettings);
        const nextAttendanceRules = buildAttendanceRulesState(nextSettings);
        setPayGroup(nextPayGroup);

        if (loadRequestSeq.current !== requestSeq) return;

        if (componentsToUse.length) {
          const nextComponents = componentsToUse.map(mapComponentToDraft);
          setStatutory(nextStatutory);
          setAttendanceRules(nextAttendanceRules);
          setComponents(nextComponents);
          setLoadedComponentIds(
            componentsToUse
              .map((component) => String(component.id || ""))
              .filter(Boolean)
          );
          setLoadedComponentScopeMap(
            componentsToUse.reduce<Record<string, ComponentDraft["scope"]>>((acc, component) => {
              if (component.id) {
                acc[String(component.id)] = component.scope;
              }
              return acc;
            }, {})
          );
          setStartupDefaultsApplied(false);
          setSavedSetupFingerprint(
            buildSetupFingerprint({
              payGroup: nextPayGroup,
              components: nextComponents,
              statutory: nextStatutory,
              attendanceRules: nextAttendanceRules
            })
          );
        } else {
          setComponents([]);
          setStatutory(nextStatutory);
          setAttendanceRules(nextAttendanceRules);
          setLoadedComponentIds([]);
          setLoadedComponentScopeMap({});
          setStartupDefaultsApplied(false);
          setSavedSetupFingerprint("");
        }
      } finally {
        if (loadRequestSeq.current === requestSeq) {
          setLoadingExistingSetup(false);
          setLoadingPayGroups(false);
        }
      }
    };

    loadExistingSetup();
  }, [open, preferredPayGroupId, initialSettings, payrollSalaryPayDay]);

  const canNext = () => {
    if (step === 0) return Boolean(payGroup.defaultPayGroupId.trim()) && isPayGroupIdValid;
    if (step === 1) return activeComponentCount > 0;
    if (step === 2) return Boolean(statutory.stateCode.trim());
    if (step === 3) return Boolean(attendanceRules.defaultWorkingDays);
    return true;
  };

  const addComponent = () => setComponents((prev) => [...prev, defaultComponent()]);
  const removeComponent = (index: number) =>
    setComponents((prev) => prev.filter((_, i) => i !== index));

  const updateComponent = (index: number, patch: Partial<ComponentDraft>) =>
    setComponents((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...patch } : item))
    );
  const applyFormulaTemplate = (index: number, templateId: string) => {
    const preset = FORMULA_PRESETS.find((item) => item.id === templateId);
    updateComponent(index, {
      formulaTemplate: templateId,
      formulaExpression: preset?.expression || ""
    });
  };
  const loadTemplateForEdit = (template: PayrollTemplate) => {
    const existingComponentIdMap = new Map(
      components
        .filter((component) => component.code.trim() && component.name.trim())
        .map((component) => [
          `${component.scope}:${component.code.trim().toUpperCase()}`,
          component.id
        ] as const)
        .filter(([, componentId]) => Boolean(componentId))
    );
    setComponents(
      template.components.map((component) => {
        const lookupKey = `${component.scope}:${component.code.trim().toUpperCase()}`;
        return {
          ...component,
          id: existingComponentIdMap.get(lookupKey) || component.id
        };
      })
    );
    setStatutory(template.statutory);
    setAttendanceRules(template.attendanceRules);
    setStartupDefaultsApplied(true);
    toast.success("Startup defaults loaded. Review and edit before saving.");
  };

  const activateSetup = async () => {
    setSaving(true);
    try {
      const payGroupId = payGroup.defaultPayGroupId.trim();
      const basicComponentDraft = activeComponents.find(
        (component) => component.scope === "earning" && component.code.trim().toUpperCase() === "BASIC"
      );
      const payGroupBasicPercent = Number(
        String(basicComponentDraft?.amount || payGroup.basicPercent || 50).trim()
      );
      // The Basic row shown for a pay group without saved revisions is an
      // editable first component, not a preview-only row. Include it in the
      // initial save so its effective month and calculation are persisted.
      const componentRows = activeComponents;
      const activeComponentIds = componentRows
        .map((component) => String(component.id || ""))
        .filter(Boolean);
      const removedComponentIds = loadedComponentIds.filter(
        (componentId) => !activeComponentIds.includes(componentId)
      );
      const componentPayloads = componentRows.map((component) => {
        const calculationMode = normalizeCalculationModeForScope(component.scope, component.calculationMode);
        const normalizedComponentCode = component.code.trim().toUpperCase();
        const isBasicEarning =
          component.scope === "earning" &&
          (normalizedComponentCode === "BASIC" ||
            /^BASIC_\d+$/.test(normalizedComponentCode) ||
            component.name.trim().toLowerCase() === "basic pay");
        const percentageValue = Number(
          String(
            component.amount ||
              (isBasicEarning && Number.isFinite(payGroupBasicPercent)
                ? payGroupBasicPercent
                : 0)
          ).trim()
        );
        const componentMetadata =
          calculationMode === "percentage"
            ? {
                wizardVersion: "v1",
                base: component.percentageOf || "MONTHLY_GROSS",
                percentage: percentageValue,
                payGroupIds: [payGroupId],
                payGroupId,
                pay_group_id: payGroupId,
                applicability: { payGroupIds: [payGroupId] }
              }
            : calculationMode === "formula"
              ? {
                  wizardVersion: "v1",
                  expression: component.formulaExpression || "0",
                  payGroupIds: [payGroupId],
                  payGroupId,
                  pay_group_id: payGroupId,
                  applicability: { payGroupIds: [payGroupId] }
                }
              : {
                  wizardVersion: "v1",
                  monthlyAmount: Number(component.amount || 0),
                  payGroupIds: [payGroupId],
                  payGroupId,
                  pay_group_id: payGroupId,
                  applicability: { payGroupIds: [payGroupId] }
                };

        return {
          id: component.id,
          scope: component.scope,
          code: component.code.trim().toUpperCase(),
          name: component.name.trim(),
          displayName: component.name.trim(),
          description: null,
          calculationMode,
          taxable: component.taxable,
          effectiveFrom: component.effectiveFrom || CURRENT_MONTH_START,
          metadata: componentMetadata
        };
      });

      const invalidPercentageComponent = componentPayloads.find(
        (component) =>
          component.calculationMode === "percentage" &&
          (!Number.isFinite(
            Number((component.metadata as Record<string, unknown>).percentage)
          ) ||
            Number((component.metadata as Record<string, unknown>).percentage) <= 0)
      );
      if (invalidPercentageComponent) {
        toast.error(
          `Enter a percentage greater than 0 for ${invalidPercentageComponent.name}.`
        );
        return;
      }

      const bulkPayload = {
        payGroupId,
          payGroup: {
            code: String(payGroup.code || "").trim().toUpperCase(),
            name: String(payGroup.name || "").trim(),
            description: String(payGroup.description || "").trim() || null,
            payFrequency: payGroup.payFrequency,
            salaryPayDay: Number(payGroup.salaryPayDay || 30),
            workWeekDays: Number(payGroup.workWeekDays || 6),
            isActive: true,
            metadata: {
              salaryRules: {
                basicPercent: Number.isFinite(payGroupBasicPercent) ? payGroupBasicPercent : 50
              }
            }
          },
        settings: {
          countryCode: "IN",
          stateCode: String(statutory.stateCode || "").trim().toUpperCase(),
          attendanceLockMode: attendanceRules.attendanceLockMode,
          attendanceLockAfterDays: Number(attendanceRules.attendanceLockAfterDays || 7),
          lopCalculationMethod: attendanceRules.lopCalculationMethod,
          defaultWorkingDays: Number(attendanceRules.defaultWorkingDays || 30),
          enableProration: attendanceRules.enableProration,
          metadata: {
            wizardVersion: "v1",
            statutory,
            attendance: {
              enableAutoOvertime: attendanceRules.enableAutoOvertime,
              salaryProrationRule: attendanceRules.salaryProrationRule
            }
          }
        },
        components: componentPayloads,
        removedComponents: removedComponentIds
          .map((componentId) => ({
            id: componentId,
            scope: loadedComponentScopeMap[componentId]
          }))
          .filter((item) => item.scope)
      };

      const saveRes = await postApiWithToken("/payroll/setup/save", bulkPayload, null, {
        requiredPermissions: ["PAYROLL_CONFIG_MANAGE"]
      });
      if (!saveRes?.success) {
        toast.error(saveRes?.message || "Failed to save payroll setup");
        return;
      }

      const createdCount = Number(saveRes?.data?.summary?.createdCount || 0);
      const updatedCount = Number(saveRes?.data?.summary?.updatedCount || 0);
      const removedCount = Number(saveRes?.data?.summary?.removedCount || 0);
      toast.success(`Payroll setup saved. ${createdCount} created, ${updatedCount} updated, ${removedCount} removed.`);

      setSavedSetupFingerprint(
        buildSetupFingerprint({
          payGroup,
          components: components.filter((c) => c.code.trim() && c.name.trim()),
          statutory,
          attendanceRules
        })
      );
      const refreshDetail = {
        payGroupId,
        payGroupCode: payGroup?.code || null,
        payGroupName: payGroup?.name || null,
        updatedAt: Date.now()
      };

      window.dispatchEvent(new CustomEvent("payroll:setup-updated", { detail: refreshDetail }));
      try {
        localStorage.setItem("payroll:setup-updated", JSON.stringify(refreshDetail));
      } catch {
        // Ignore storage write failures; the in-tab event still handles refresh.
      }
      onActivated?.();
      onOpenChange(false);
      setStep(0);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && hasUnsavedChanges) {
          const discard = window.confirm(
            "You have unsaved payroll setup changes. Close without saving?"
          );
          if (!discard) return;
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Payroll Setup Wizard</DialogTitle>
        </DialogHeader>

        <div className="rounded-xl border bg-muted/30 p-4 mb-4">
          <p className="font-medium">Set up payroll in plain English</p>
          <p className="text-sm text-muted-foreground mt-1">
            This flow helps you choose a salary cycle, review earnings and deductions, keep common
            Telangana compliance defaults, and save a payroll structure your team can understand.
          </p>
        </div>

        {hasUnsavedChanges && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            You have unsaved payroll setup changes. Save before closing if you want to keep them.
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-5 gap-2 mb-4">
          {steps.map((label, index) => (
            <div
              key={label}
              className={`rounded-md border px-3 py-2 text-sm ${
                index === step ? "bg-primary text-primary-foreground" : "bg-background"
              }`}
            >
              <span className="font-medium">{index + 1}.</span> {label}
            </div>
          ))}
        </div>

        {step === 0 && (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/20 p-3">
              <p className="font-medium text-sm">What this step means</p>
              <p className="text-sm text-muted-foreground mt-1">
                A pay group is your salary cycle. It decides which employees follow this payroll
                calendar, when attendance closes, and which day salary is processed.
              </p>
            </div>

            <div>
              <label className="text-sm font-medium">Choose Salary Cycle</label>
              <Select
                value={payGroup.defaultPayGroupId || undefined}
                onValueChange={(value) =>
                  setPayGroup((prev) => ({ ...prev, defaultPayGroupId: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      loadingPayGroups
                        ? "Loading pay groups..."
                        : availablePayGroups.length > 0
                          ? "Select pay group"
                          : "No pay groups found"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {availablePayGroups.map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      {group.name} ({group.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Pick the main salary cycle your company will use. Most startups keep one monthly
                cycle for everyone.
              </p>
            </div>

            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                Advanced: paste pay group UUID manually
              </summary>
              <div className="mt-3">
                <Input
                  value={payGroup.defaultPayGroupId}
                  onChange={(e) =>
                    setPayGroup((prev) => ({ ...prev, defaultPayGroupId: e.target.value }))
                  }
                  placeholder="Paste pay group UUID"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Use this only if you already have the exact pay group id from the system.
                </p>
                {!!payGroup.defaultPayGroupId.trim() && !isPayGroupIdValid && (
                  <p className="text-xs text-red-600 mt-1">
                    Use Pay Group UUID only. Example: `8f2c3a2e-11ab-4c89-9d00-1a2b3c4d5e6f`.
                  </p>
                )}
              </div>
            </details>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-sm font-medium">Salary Frequency</label>
                <Select
                  value={payGroup.payFrequency}
                  onValueChange={(value) =>
                    setPayGroup((prev) => ({ ...prev, payFrequency: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="semi_monthly">Twice a month</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Monthly is the simplest and most common choice for startups.
                </p>
              </div>
              <div>
                <label className="text-sm font-medium">Salary Pay Day</label>
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={payGroup.salaryPayDay}
                  onChange={(e) =>
                    setPayGroup((prev) => ({ ...prev, salaryPayDay: e.target.value }))
                  }
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Example: `30` means salary is usually released on the 30th.
                </p>
              </div>
              <div>
                <label className="text-sm font-medium">Attendance Cutoff Day</label>
                <Input type="number" value={payrollCutoffDay} disabled readOnly />
                <p className="text-xs text-muted-foreground mt-1">
                  This comes from Organization Settings and closes attendance for payroll.
                </p>
              </div>
            </div>

            <div className="rounded-lg border p-3">
              <p className="font-medium text-sm">Quick Example</p>
              <p className="text-sm text-muted-foreground mt-1">
                If your company pays salary every month on the 30th and closes attendance on the
                25th, this pay group becomes the default cycle for payroll runs.
              </p>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            {loadingExistingSetup && (
              <p className="text-sm text-muted-foreground">Loading existing payroll setup...</p>
            )}
            <div className="rounded-lg border bg-muted/20 p-3">
              <p className="font-medium text-sm">What this step means</p>
              <p className="text-sm text-muted-foreground mt-1">
                Salary components are the lines you see in a payslip. Common examples are Basic,
                HRA, Variable Pay, PF, PT, and Employer PF.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-lg border p-3">
                <p className="font-medium text-sm">Earnings</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Paid to the employee. Example: Basic, HRA, Special Allowance, Variable Pay.
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="font-medium text-sm">Deductions</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Reduced from salary. Example: PF, PT, ESI, TDS, loan recovery.
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="font-medium text-sm">Employer Contributions</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Paid by company, not reduced from net pay. Example: Employer PF or NPS.
                </p>
              </div>
            </div>
            <div className="border rounded-lg p-3 space-y-2">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">Telangana Payroll Checklist</p>
                  <p className="text-xs text-muted-foreground">
                    Review which parts are legal defaults and which parts depend on your company
                    policy.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowRulesPanel((prev) => !prev)}
                >
                  {showRulesPanel ? "Hide Rules" : "View Rules"}
                </Button>
              </div>
              {showRulesPanel && (
                <div className="space-y-2">
                  {TELANGANA_RULES.map((rule) => (
                    <div key={rule.id} className="border rounded-md p-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-medium">{rule.title}</p>
                        <span
                          className={`text-[10px] px-2 py-1 rounded ${getRuleStatusClass(rule.status)}`}
                        >
                          {getRuleStatusLabel(rule.status)}
                        </span>
                      </div>
                      <div className="mt-1 space-y-1">
                        {rule.points.map((point) => (
                          <p key={point} className="text-xs text-muted-foreground">
                            • {point}
                          </p>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="border rounded-lg p-3 space-y-3 bg-muted/20">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">Startup-Friendly Default Pack</p>
                  <p className="text-xs text-muted-foreground">
                    Real startups usually start with a standard structure first and fine-tune after
                    their first payroll cycles.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setShowTemplatePreview(true);
                      loadTemplateForEdit(TELANGANA_DEFAULT_TEMPLATE);
                    }}
                  >
                    View Defaults
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => loadTemplateForEdit(TELANGANA_DEFAULT_TEMPLATE)}
                  >
                    {startupDefaultsApplied ? "Reload Startup Defaults" : "Use Startup Defaults"}
                  </Button>
                </div>
              </div>
              <div className="rounded-md border bg-background px-3 py-2">
                <p className="text-xs font-medium">
                  {startupDefaultsApplied
                    ? "Startup defaults are currently loaded in this wizard."
                    : "You can load startup defaults at any time."}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Default pack includes common starter items like Basic, HRA, Other Allowance,
                  PF, and Professional Tax so a new company does not need to build payroll from
                  scratch.
                </p>
              </div>
              {showTemplatePreview && (
                <div className="space-y-2 border rounded p-3 bg-background">
                  <p className="text-xs font-medium">Default Components (Preview)</p>
                  {TELANGANA_DEFAULT_TEMPLATE.components.map((component) => (
                    <div
                      key={`${component.scope}-${component.code}`}
                      className="text-xs border rounded px-2 py-1"
                    >
                      <span className="font-medium">{component.code}</span> - {component.name} |{" "}
                      {component.calculationMode === "percentage"
                        ? `${component.amount}% of ${component.percentageOf}`
                        : component.calculationMode === "formula"
                          ? component.formulaExpression
                          : `Amount ${component.amount}`}
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">
                    These are starter defaults only. Every company can change components, percentages,
                    or formulas later.
                  </p>
                </div>
              )}
            </div>
            <div className="rounded-lg border p-3">
              <p className="font-medium text-sm">Current Structure Summary</p>
              <p className="text-sm text-muted-foreground mt-1">
                {activeComponentCount} active components loaded: {earningCount} earnings,{" "}
                {deductionCount} deductions, {employerContributionCount} employer contributions.
              </p>
              {!hasSavedComponentRows && selectedPayGroupOption && (
                <p className="text-xs text-amber-700 mt-2">
                  No saved component revisions found for {selectedPayGroupOption.name}. Showing only
                  pay group settings until components are saved.
                </p>
              )}
            </div>
            <datalist id="component-name-presets">
              {componentNameOptions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            {components.map((component, index) => (
              <div
                key={`${index}-${component.scope}`}
                className="border rounded-lg p-3 space-y-3 transition-colors hover:border-primary/60 hover:bg-primary/5"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-sm">
                      {component.name.trim() || component.code.trim() || `Component ${index + 1}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {getScopeLabel(component.scope)} • {getCalculationModeLabel(component.calculationMode)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Effective from {toMonthInputValue(component.effectiveFrom)}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                  <Select
                    value={component.scope}
                    onValueChange={(value) => {
                      const nextScope = value as ComponentDraft["scope"];
                      updateComponent(index, {
                        scope: nextScope,
                        calculationMode: normalizeCalculationModeForScope(nextScope, component.calculationMode)
                      });
                    }}
                  >
                    <SelectTrigger {...scrollSelectTextProps(getScopeLabel(component.scope))}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="earning">Earning</SelectItem>
                      <SelectItem value="deduction">Deduction</SelectItem>
                      <SelectItem value="employer_contribution">Employer Contribution</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="Component name"
                    list="component-name-presets"
                    value={component.name}
                    {...scrollInputProps(component.name || "Component name")}
                    onChange={(e) => applyComponentNameSelection(index, e.target.value)}
                  />
                  <Input
                    placeholder="Auto-generated code"
                    value={component.code || "Auto-generated"}
                    readOnly
                    {...scrollInputProps(component.code || "Auto-generated code")}
                  />
                  <p className="text-xs text-muted-foreground md:col-span-1 md:mt-1">
                    Known names use fixed system codes. Custom names get a unique generated code.
                  </p>
                  <Select
                    value={component.calculationMode}
                    onValueChange={(value) =>
                      updateComponent(index, {
                        calculationMode: value as ComponentDraft["calculationMode"]
                      })
                    }
                  >
                    <SelectTrigger {...scrollSelectTextProps(getCalculationModeLabel(component.calculationMode))}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fixed">Fixed Amount</SelectItem>
                      <SelectItem value="percentage">Percentage</SelectItem>
                      <SelectItem value="formula">Formula</SelectItem>
                      {component.scope !== "earning" && <SelectItem value="slab">Slab</SelectItem>}
                    </SelectContent>
                  </Select>
                  {component.calculationMode === "formula" ? (
                    <Input
                      value="Use formula setup below"
                      readOnly
                      {...scrollInputProps("Use formula setup below")}
                    />
                  ) : (
                    <Input
                      type="number"
                      placeholder={
                        component.calculationMode === "percentage"
                          ? "Percentage (e.g. 50)"
                          : "Monthly amount"
                      }
                      value={component.amount}
                      {...scrollInputProps(
                        component.amount ||
                          (component.calculationMode === "percentage"
                            ? "Percentage (e.g. 50)"
                            : "Monthly amount")
                      )}
                      onChange={(e) => updateComponent(index, { amount: e.target.value })}
                      />
                    )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-medium">Effective From</label>
                    <Input
                      type="month"
                      value={toMonthInputValue(component.effectiveFrom)}
                      onChange={(e) =>
                        updateComponent(index, { effectiveFrom: toMonthStartDate(e.target.value) })
                      }
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      The component will apply from this month onward in payroll runs.
                    </p>
                  </div>
                </div>
                {component.calculationMode === "percentage" && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs font-medium">Based On Component</label>
                      <Select
                        value={component.percentageOf}
                        onValueChange={(value) => updateComponent(index, { percentageOf: value })}
                      >
                        <SelectTrigger {...scrollSelectTextProps(component.percentageOf)}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {componentCodeOptions.map((code) => (
                            <SelectItem key={code} value={code}>
                              {code}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground mt-1">
                        Example: HRA as 50% of BASIC.
                      </p>
                    </div>
                  </div>
                )}
                {component.calculationMode === "formula" && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/20 px-3 py-2">
                      <div>
                        <p className="text-sm font-medium">Formula Help</p>
                        <p className="text-xs text-muted-foreground">
                          Supported functions and variables used by the payroll formula engine.
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setShowFormulaGuide((prev) => !prev)}
                      >
                        {showFormulaGuide ? "Hide Formula Guide" : "View Formula Guide"}
                      </Button>
                    </div>
                    {showFormulaGuide && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 rounded-md border bg-background p-3">
                        <div>
                          <p className="text-xs font-medium mb-2">Supported Functions</p>
                          <div className="space-y-1">
                            {FORMULA_FUNCTIONS.map((item) => (
                              <div key={item.name} className="text-xs text-muted-foreground">
                                <span className="font-mono text-foreground">{item.name}</span> - {item.help}
                              </div>
                            ))}
                          </div>
                        </div>
                        <div>
                          <p className="text-xs font-medium mb-2">Common Variables</p>
                          <div className="flex flex-wrap gap-2">
                            {COMMON_FORMULA_VARIABLES.map((variable) => (
                              <span
                                key={variable}
                                className="rounded-full border px-2 py-1 text-xs font-mono"
                              >
                                {variable}
                              </span>
                            ))}
                          </div>
                          <p className="text-xs text-muted-foreground mt-2">
                            Example:{" "}
                            <span className="font-mono text-foreground">
                              round(min(BASIC_PAY, 15000) * 0.12)
                            </span>
                          </p>
                        </div>
                      </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs font-medium">Formula Preset</label>
                      <Select
                        value={component.formulaTemplate}
                        onValueChange={(value) => applyFormulaTemplate(index, value)}
                      >
                        <SelectTrigger
                          {...scrollSelectTextProps(
                            FORMULA_PRESETS.find((preset) => preset.id === component.formulaTemplate)
                              ?.label || "Custom Formula"
                          )}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FORMULA_PRESETS.map((preset) => (
                            <SelectItem key={preset.id} value={preset.id}>
                              {preset.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground mt-1">
                        {
                          FORMULA_PRESETS.find((preset) => preset.id === component.formulaTemplate)
                            ?.help
                        }
                      </p>
                    </div>
                    <div>
                      <label className="text-xs font-medium">Formula Expression</label>
                      <Textarea
                        placeholder="round(max(MONTHLY_GROSS - (BASIC + HRA + VARIABLE), 0))"
                        value={component.formulaExpression}
                        className="min-h-[72px] font-mono text-xs"
                        onChange={(e) =>
                          updateComponent(index, {
                            formulaTemplate: "custom",
                            formulaExpression: e.target.value
                          })
                        }
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Use variables like `BASIC`, `HRA`, `MONTHLY_GROSS`, or `BASIC_PAY`. `VARIABLE`
                        means the employee's Variable Pay target.
                      </p>
                      {(() => {
                        const formulaCheck = getFormulaPreviewStatus(
                          component.formulaExpression,
                          componentCodeOptions
                        );
                        return (
                          <p
                            className={`text-xs mt-1 ${
                              formulaCheck.ok ? "text-green-700" : "text-red-600"
                            }`}
                          >
                            {formulaCheck.message}
                          </p>
                        );
                      })()}
                    </div>
                  </div>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={component.taxable}
                      onCheckedChange={(checked) => updateComponent(index, { taxable: checked })}
                    />
                    <p className="text-sm">Taxable component</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => removeComponent(index)}
                    disabled={components.length === 1}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
            <Button variant="outline" onClick={addComponent}>
              Add Another Component
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/20 p-3">
              <p className="font-medium text-sm">What this step means</p>
              <p className="text-sm text-muted-foreground mt-1">
                These are the common compliance defaults your company will usually review with your
                accountant or payroll consultant. You can keep the simple defaults and adjust later.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="flex items-center justify-between border rounded p-3">
                <div>
                  <p className="font-medium text-sm">Provident Fund (PF)</p>
                  <p className="text-xs text-muted-foreground">Employee PF deduction and company PF contribution</p>
                </div>
                <Switch
                  checked={statutory.enablePf}
                  onCheckedChange={(checked) => {
                    setStatutory((prev) => ({ ...prev, enablePf: checked }));
                    if (checked) {
                      setComponents((prev) => ensureTemplateComponents(prev, ["EPF", "EMPLOYER_EPF"]));
                    }
                  }}
                />
              </div>
              <div className="flex items-center justify-between border rounded p-3">
                <div>
                  <p className="font-medium text-sm">Employee State Insurance (ESI)</p>
                  <p className="text-xs text-muted-foreground">Use for employees who fall under ESI coverage</p>
                </div>
                <Switch
                  checked={statutory.enableEsi}
                  onCheckedChange={(checked) => {
                    setStatutory((prev) => ({ ...prev, enableEsi: checked }));
                    if (checked) {
                      setComponents((prev) => ensureTemplateComponents(prev, ["ESI"]));
                    }
                  }}
                />
              </div>
              <div className="flex items-center justify-between border rounded p-3">
                <div>
                  <p className="font-medium text-sm">Professional Tax (PT)</p>
                  <p className="text-xs text-muted-foreground">Telangana monthly PT deduction</p>
                </div>
                <Switch
                  checked={statutory.enablePt}
                  onCheckedChange={(checked) => setStatutory((prev) => ({ ...prev, enablePt: checked }))}
                />
              </div>
              <div className="flex items-center justify-between border rounded p-3">
                <div>
                  <p className="font-medium text-sm">Labour Welfare Fund (LWF)</p>
                  <p className="text-xs text-muted-foreground">Optional for companies where LWF applies</p>
                </div>
                <Switch
                  checked={statutory.enableLwf}
                  onCheckedChange={(checked) =>
                    setStatutory((prev) => ({ ...prev, enableLwf: checked }))
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-sm font-medium">PF Wage Threshold</label>
                <Input
                  type="number"
                  value={statutory.pfWageThreshold}
                  onChange={(e) =>
                    setStatutory((prev) => ({ ...prev, pfWageThreshold: e.target.value }))
                  }
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Starter reference for PF eligibility/policy checks.
                </p>
              </div>
              <div>
                <label className="text-sm font-medium">ESI Wage Threshold</label>
                <Input
                  type="number"
                  value={statutory.esiWageThreshold}
                  onChange={(e) =>
                    setStatutory((prev) => ({ ...prev, esiWageThreshold: e.target.value }))
                  }
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Starter reference for ESI coverage checks.
                </p>
              </div>
              <div>
                <label className="text-sm font-medium">State Code</label>
                <Input
                  value={statutory.stateCode}
                  onChange={(e) => setStatutory((prev) => ({ ...prev, stateCode: e.target.value }))}
                  placeholder="TS"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Telangana: use TS
                </p>
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/20 p-3">
              <p className="font-medium text-sm">What this step means</p>
              <p className="text-sm text-muted-foreground mt-1">
                This controls when attendance becomes final for payroll, how loss of pay is
                calculated, and how monthly salary is prorated. If you are unsure, use payroll
                cutoff + working days + payable days based proration.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">When to Lock Attendance</label>
                <Select
                  value={attendanceRules.attendanceLockMode}
                  onValueChange={(value) =>
                    setAttendanceRules((prev) => ({
                      ...prev,
                      attendanceLockMode: value as "payroll_cutoff" | "days_window"
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="payroll_cutoff">Lock by Payroll Cutoff</SelectItem>
                    <SelectItem value="days_window">Lock by Days Window</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Cutoff mode is easier for most HR and finance teams to manage.
                </p>
              </div>
              <div>
                <label className="text-sm font-medium">Lock After This Many Days</label>
                <Input
                  type="number"
                  min={0}
                  max={60}
                  value={attendanceRules.attendanceLockAfterDays}
                  onChange={(e) =>
                    setAttendanceRules((prev) => ({
                      ...prev,
                      attendanceLockAfterDays: e.target.value
                    }))
                  }
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Example: `7` means old attendance edits stop after 7 days.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium">Loss of Pay (LOP) Calculation</label>
                <Select
                  value={attendanceRules.lopCalculationMethod}
                  onValueChange={(value) =>
                    setAttendanceRules((prev) => ({
                      ...prev,
                      lopCalculationMethod: value as "calendar_days" | "working_days"
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="calendar_days">Calendar Days</SelectItem>
                    <SelectItem value="working_days">Working Days</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  This only changes the LOP denominator. It does not automatically mean salary is
                  paid only on present days.
                </p>
              </div>
              <div>
                <label className="text-sm font-medium">Default Working Days in Month</label>
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={attendanceRules.defaultWorkingDays}
                  onChange={(e) =>
                    setAttendanceRules((prev) => ({
                      ...prev,
                      defaultWorkingDays: e.target.value
                    }))
                  }
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Most teams keep `30` as a simple default.
                </p>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">Salary Proration Basis</label>
              <Select
                value={attendanceRules.salaryProrationRule}
                onValueChange={(value) =>
                  setAttendanceRules((prev) => ({
                    ...prev,
                    salaryProrationRule: value as "payable_days" | "present_days_on_working_days"
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="payable_days">Pay on payable days</SelectItem>
                  <SelectItem value="present_days_on_working_days">Pay on present days / working days</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Example: if your organization pays salary only for worked days excluding week offs
                and holidays, choose present days / working days. Formula: salary ÷ working days ×
                present days.
              </p>
              <p className="text-xs text-amber-600 mt-1">
                Changes apply only to future payroll runs or runs that are recomputed. Already
                processed payroll will not change automatically.
              </p>
            </div>

            <div className="flex items-center justify-between border rounded p-3">
              <div>
                <p className="font-medium text-sm">Enable Salary Proration</p>
                <p className="text-xs text-muted-foreground">
                  Automatically adjusts salary when payable days are lower than full month.
                </p>
              </div>
              <Switch
                checked={attendanceRules.enableProration}
                onCheckedChange={(checked) =>
                  setAttendanceRules((prev) => ({ ...prev, enableProration: checked }))
                }
              />
            </div>

            <div className="flex items-center justify-between border rounded p-3">
              <div>
                <p className="font-medium text-sm">Enable Auto OT Component</p>
                <p className="text-xs text-muted-foreground">
                  Adds `OT_AUTO` from attendance overtime minutes during payroll compute.
                </p>
              </div>
              <Switch
                checked={attendanceRules.enableAutoOvertime}
                onCheckedChange={(checked) =>
                  setAttendanceRules((prev) => ({ ...prev, enableAutoOvertime: checked }))
                }
              />
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/20 p-3">
              <p className="font-medium text-sm">Final review</p>
              <p className="text-sm text-muted-foreground mt-1">
                Check the main payroll settings below. You can still edit components and policies
                later after saving this setup.
              </p>
            </div>
            <div className="rounded border p-3">
              <p className="font-medium mb-2">Salary Cycle</p>
              <p className="text-sm text-muted-foreground">
                Pay Group ID: <span className="font-mono text-foreground">{payGroup.defaultPayGroupId}</span>
              </p>
              <p className="text-sm text-muted-foreground">
                Cycle: {payGroup.payFrequency}, Salary Day: {payGroup.salaryPayDay}, Cutoff Day:{" "}
                {payrollCutoffDay}
              </p>
            </div>
            <div className="rounded border p-3">
              <p className="font-medium mb-2">Salary Components</p>
              <p className="text-sm text-muted-foreground">
                {activeComponentCount} components are included in this setup.
              </p>
              <div className="mt-2 space-y-1">
                {activeComponents.map((c, i) => (
                    <p key={`${c.code}-${i}`} className="text-xs text-muted-foreground">
                      {c.code.toUpperCase()} ({getScopeLabel(c.scope)}) - {c.calculationMode === "percentage"
                        ? `${c.amount || 0}% of ${c.percentageOf || "MONTHLY_GROSS"}`
                        : c.calculationMode === "formula"
                          ? c.formulaExpression || "Formula not set"
                          : `Amount ${c.amount || 0}`}
                    </p>
                  ))}
              </div>
            </div>
            <div className="rounded border p-3">
              <p className="font-medium mb-2">Compliance Defaults</p>
              <p className="text-sm text-muted-foreground">
                PF: {statutory.enablePf ? "On" : "Off"}, ESI: {statutory.enableEsi ? "On" : "Off"},
                PT: {statutory.enablePt ? "On" : "Off"}, State: {statutory.stateCode}
              </p>
              {statutory.enablePf && (
                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                  <p>
                    Employee PF:{" "}
                    {employeePfComponent
                      ? `${employeePfComponent.code.toUpperCase()} - ${getCalculationModeLabel(employeePfComponent.calculationMode)}`
                      : "Not added as a salary component"}
                  </p>
                  <p>
                    Employer PF:{" "}
                    {employerPfComponent
                      ? `${employerPfComponent.code.toUpperCase()} - ${getCalculationModeLabel(employerPfComponent.calculationMode)}`
                      : "Not added as an employer contribution"}
                  </p>
                </div>
              )}
            </div>
            <div className="rounded border p-3">
              <p className="font-medium mb-2">Attendance & LOP</p>
              <p className="text-sm text-muted-foreground">
                Lock Mode: {attendanceRules.attendanceLockMode}, LOP:{" "}
                {attendanceRules.lopCalculationMethod}, Working Days:{" "}
                {attendanceRules.defaultWorkingDays}
              </p>
              <p className="text-sm text-muted-foreground">
                Proration Basis:{" "}
                {attendanceRules.salaryProrationRule === "present_days_on_working_days"
                  ? "Salary ÷ working days × present days"
                  : "Payable days based"}
              </p>
            </div>
          </div>
        )}

        <div className="flex justify-between pt-4">
          <Button
            variant="outline"
            onClick={() => setStep((prev) => Math.max(0, prev - 1))}
            disabled={step === 0 || saving}
          >
            Back
          </Button>
          {step < steps.length - 1 ? (
            <Button onClick={() => canNext() && setStep((prev) => Math.min(steps.length - 1, prev + 1))} disabled={!canNext()}>
              Next
            </Button>
          ) : (
            <Button onClick={activateSetup} disabled={saving}>
              {saving ? "Saving..." : "Save Payroll Setup"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PayrollSetupWizard;
