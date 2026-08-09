import { useEffect, useMemo, useRef, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Select,
  SelectGroup,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, Calculator, ChevronDown, History, Info, Landmark, ListChecks, Pencil } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  getApiWithToken,
  postApiWithToken,
  putApiWithToken,
} from "@/services/apiWrapper";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { hasAnyPermission } from "@/utils/auth";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { EmployeeIdCard } from "@/components/employees/EmployeeIdCard";
import { toDateKeyInOrgCalendar } from "@/utils/timezone";

const PROFILE_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const PROFILE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const BLOOD_GROUP_OPTIONS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const VARIABLE_PAY_RELEASE_OPTIONS = [
  { label: "Every 3 months", value: "3" },
  { label: "Every 6 months", value: "6" },
  { label: "Every 12 months", value: "12" },
  { label: "Custom", value: "custom" }
];
const VARIABLE_PAY_MODE_OPTIONS = [
  { label: "Fixed amount", value: "fixed" },
  { label: "% of Gross", value: "percentage" },
  { label: "% of CTC", value: "ctc_percentage" }
];
const RELATION_OPTIONS = [
  { label: "Father", value: "father" },
  { label: "Mother", value: "mother" },
  { label: "Spouse", value: "spouse" },
  { label: "Brother", value: "brother" },
  { label: "Sister", value: "sister" },
  { label: "Son", value: "son" },
  { label: "Daughter", value: "daughter" },
  { label: "Guardian", value: "guardian" },
  { label: "Friend", value: "friend" },
  { label: "Other", value: "other" }
];
const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;
const PLACE_NAME_REGEX = /^[A-Za-z]+(?:[A-Za-z .'-]*[A-Za-z])?$/;
const formatInr = (value: number | string | null | undefined) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(Number(value || 0));

const normalizePayrollDate = (value?: string | null) => {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return toDateKeyInOrgCalendar(text);
};

const formatDateDisplay = (value?: string | null) => {
  const dateKey = normalizePayrollDate(value);
  if (!dateKey) return "-";

  const [year, month, day] = dateKey.split("-").map((part) => Number(part));
  if (!year || !month || !day) return dateKey;

  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
};

const toDateInputValue = (date: Date) => date.toISOString().slice(0, 10);

const addDaysToDateValue = (dateValue: string, days: number) => {
  const date = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(date.getTime())) return toDateInputValue(new Date());
  date.setDate(date.getDate() + days);
  return toDateInputValue(date);
};

const isRevisionEditableToday = (effectiveTo?: string | null) => {
  const normalizedEffectiveTo = normalizePayrollDate(effectiveTo);
  if (!normalizedEffectiveTo) return true;
  return toDateInputValue(new Date()) <= normalizedEffectiveTo;
};

const isRevisionActiveToday = (revision?: SalaryStructureRow | null) => {
  if (!revision?.effective_from) return false;
  const today = toDateInputValue(new Date());
  const effectiveFrom = normalizePayrollDate(revision.effective_from);
  const effectiveTo = normalizePayrollDate(revision.effective_to);
  return effectiveFrom <= today && (!effectiveTo || today <= effectiveTo);
};

const isRevisionScheduledForFuture = (revision?: SalaryStructureRow | null) => {
  if (!revision?.effective_from) return false;
  return normalizePayrollDate(revision.effective_from) > toDateInputValue(new Date());
};

const getDefaultSalaryRevisionDate = (salaryStructures: SalaryStructureRow[]) => {
  const today = toDateInputValue(new Date());
  const latestEffectiveFrom = salaryStructures
    .map((row) => normalizePayrollDate(row.effective_from))
    .filter(Boolean)
    .sort()
    .at(-1);

  if (!latestEffectiveFrom) return today;
  return today > latestEffectiveFrom ? today : addDaysToDateValue(latestEffectiveFrom, 1);
};

const getOpenSalaryRevision = (salaryStructures: SalaryStructureRow[]) =>
  [...salaryStructures]
    .filter((row) => isRevisionActiveToday(row))
    .sort((a, b) =>
      String(b.effective_from || "").localeCompare(String(a.effective_from || ""))
    )[0] ||
  [...salaryStructures]
    .filter((row) => isRevisionScheduledForFuture(row))
    .sort((a, b) =>
      String(a.effective_from || "").localeCompare(String(b.effective_from || ""))
    )[0] ||
  [...salaryStructures].sort((a, b) =>
    String(b.effective_from || "").localeCompare(String(a.effective_from || ""))
  )[0] ||
  null;

const roundPayrollAmount = (value: number) => Number(value.toFixed(2));

const tokenizeFormulaIdentifiers = (expression: string) => {
  const matches = String(expression || "").match(/[A-Za-z_][A-Za-z0-9_]*/g);
  return matches ? [...new Set(matches)] : [];
};

const normalizeConditionalFormulaExpression = (expression: string) =>
  String(expression || "")
    .replace(/\bif\s*\(/gi, "__if(")
    .trim();

const evaluatePreviewFormula = (expression: string, context: Record<string, number> = {}) => {
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

  // Only pass identifiers referenced by this expression. Passing every loaded
  // component code into `new Function` makes an unrelated code containing a
  // space, hyphen, or other non-JavaScript character invalidate all formulas.
  const argNames = identifiers;
  const argValues = argNames.map((key) => mergedContext[key]);
  const fn = new Function(...argNames, `"use strict"; return (${expr});`);
  const result = fn(...argValues);
  return roundPayrollAmount(Number(result || 0));
};

const evaluatePreviewSlabs = (
  value: number,
  slabs: Array<{ upto?: number | null; amount?: number | null }> = []
) => {
  const normalizedValue = Number(value || 0);
  const matchingSlab = slabs.find(
    (slab) => slab?.upto === null || slab?.upto === undefined || normalizedValue <= Number(slab.upto)
  );
  return roundPayrollAmount(Number(matchingSlab?.amount || 0));
};

const computeEmployerEpfAmount = ({
  basicPay,
  epfMode,
  epfFixedAmount,
  epfPercentOfBasic,
  restrictPfWage,
  pfWageCeiling
}: {
  basicPay: number;
  epfMode: string;
  epfFixedAmount: number;
  epfPercentOfBasic: number;
  restrictPfWage: boolean;
  pfWageCeiling: number;
}) => {
  const epfBase = restrictPfWage ? Math.min(basicPay, pfWageCeiling) : basicPay;
  return epfMode === "fixed"
    ? epfFixedAmount
    : roundPayrollAmount(epfBase * (epfPercentOfBasic / 100));
};

const computeEmployerEsiAmount = ({
  monthlyGross,
  includeEsi,
  esiEligibilityThreshold = 21000,
  esiEmployerRate = 3.25
}: {
  monthlyGross: number;
  includeEsi: boolean;
  esiEligibilityThreshold?: number;
  esiEmployerRate?: number;
}) =>
  includeEsi && monthlyGross > 0 && monthlyGross <= esiEligibilityThreshold
    ? roundPayrollAmount(monthlyGross * (esiEmployerRate / 100))
    : 0;

const computeProfessionalTaxAmount = ({
  monthlyGross,
  professionalTaxApplicable
}: {
  monthlyGross: number;
  professionalTaxApplicable: boolean;
}) => {
  if (!professionalTaxApplicable || monthlyGross <= 0) {
    return 0;
  }

  if (monthlyGross <= 15000) {
    return 0;
  }

  if (monthlyGross <= 20000) {
    return 150;
  }

  return 200;
};

const computeVariablePayFromAmount = ({
  baseAmount,
  percentage
}: {
  baseAmount: number;
  percentage: number;
}) => {
  if (baseAmount <= 0 || percentage <= 0) {
    return 0;
  }

  return roundPayrollAmount(baseAmount * (percentage / 100));
};

const deriveGrossFromMonthlyCtc = ({
  monthlyCtc,
  basicPercent,
  epfMode,
  epfFixedAmount,
  epfPercentOfBasic,
  restrictPfWage,
  pfWageCeiling,
  includeEsi,
  fixedBasicPay,
  hraPercentOfBasic,
  variablePayEnabled,
  variablePayMode,
  variablePayPercentOfCtc,
  variablePayBaseCode,
  variablePayAmount,
  variablePayOverrideAmount,
  variablePayRecognizedAmount
}: {
  monthlyCtc: number;
  basicPercent: number;
  epfMode: string;
  epfFixedAmount: number;
  epfPercentOfBasic: number;
  restrictPfWage: boolean;
  pfWageCeiling: number;
  includeEsi: boolean;
  fixedBasicPay?: number;
  hraPercentOfBasic?: number;
  variablePayEnabled?: boolean;
  variablePayMode?: string;
  variablePayPercentOfCtc?: number;
  variablePayBaseCode?: string;
  variablePayAmount?: number;
  variablePayOverrideAmount?: number;
  variablePayRecognizedAmount?: number;
}) => {
  const resolveVariableBaseAmount = ({
    fixedGross,
    basicPay,
    hraAmount
  }: {
    fixedGross: number;
    basicPay: number;
    hraAmount: number;
  }) => {
    const fixedAllowance = Math.max(0, fixedGross - basicPay - hraAmount);
    switch (String(variablePayBaseCode || "MONTHLY_GROSS").toUpperCase()) {
      case "MONTHLY_CTC":
        return monthlyCtc;
      case "BASIC":
      case "BASIC_PAY":
      case "BASIC_SALARY":
      case "EARNED_BASIC":
        return basicPay;
      case "HRA":
      case "HOUSE_RENT_ALLOWANCE":
        return hraAmount;
      case "OTHER_ALLOWANCE":
      case "FIXED_ALLOWANCE":
      case "SPECIAL_ALLOWANCE":
      case "CONVEYANCE":
        return fixedAllowance;
      default:
        return fixedGross;
    }
  };

  let fixedGross = Math.max(0, monthlyCtc);
  let variablePayTarget = 0;

  for (let index = 0; index < 25; index += 1) {
    const basicPay = fixedBasicPay && fixedBasicPay > 0
      ? fixedBasicPay
      : roundPayrollAmount(fixedGross * (basicPercent / 100));
    const hraAmount = roundPayrollAmount(basicPay * ((hraPercentOfBasic || 0) / 100));
    const employerEpf = computeEmployerEpfAmount({
      basicPay,
      epfMode,
      epfFixedAmount,
      epfPercentOfBasic,
      restrictPfWage,
      pfWageCeiling
    });
    const employerEsi = computeEmployerEsiAmount({
      monthlyGross: fixedGross,
      includeEsi
    });
    const nextVariablePayTarget = variablePayEnabled
      ? variablePayOverrideAmount !== undefined && variablePayOverrideAmount !== null
        ? roundPayrollAmount(Number(variablePayOverrideAmount || 0))
        : variablePayMode === "fixed"
          ? roundPayrollAmount(Number(variablePayAmount || 0))
          : computeVariablePayFromAmount({
              baseAmount:
                variablePayMode === "ctc_percentage"
                  ? monthlyCtc
                  : resolveVariableBaseAmount({
                      fixedGross,
                      basicPay,
                      hraAmount
                    }),
              percentage: Number(variablePayPercentOfCtc || 0)
            })
      : 0;
    const nextFixedGross = roundPayrollAmount(
      Math.max(
        0,
        monthlyCtc -
          employerEpf -
          employerEsi -
          nextVariablePayTarget
      )
    );

    if (
      Math.abs(nextFixedGross - fixedGross) < 0.01 &&
      Math.abs(nextVariablePayTarget - variablePayTarget) < 0.01
    ) {
      fixedGross = nextFixedGross;
      variablePayTarget = nextVariablePayTarget;
      break;
    }

    fixedGross = nextFixedGross;
    variablePayTarget = nextVariablePayTarget;
  }

  const basicPay = fixedBasicPay && fixedBasicPay > 0
    ? fixedBasicPay
    : roundPayrollAmount(fixedGross * (basicPercent / 100));
  const hraAmount = roundPayrollAmount(basicPay * ((hraPercentOfBasic || 0) / 100));
  const employerEpf = computeEmployerEpfAmount({
    basicPay,
    epfMode,
    epfFixedAmount,
    epfPercentOfBasic,
    restrictPfWage,
    pfWageCeiling
  });
  const employerEsiAmount = computeEmployerEsiAmount({
    monthlyGross: fixedGross,
    includeEsi
  });
  const totalMonthlyGross = roundPayrollAmount(fixedGross + variablePayTarget);

  return {
    monthlyGross: totalMonthlyGross,
    fixedGross,
    basicPay,
    employerEpf,
    employerEsiAmount,
    variablePayTarget: roundPayrollAmount(variablePayTarget),
    hraAmount
  };
};

/* ================= TYPES ================= */

interface Option {
  _id: string;
  name: string;
}

type PayGroup = {
  id: string;
  code: string;
  name: string;
  pay_frequency: string;
  is_active: boolean;
  metadata?: Record<string, any>;
};

type PayrollSettings = {
  metadata?: Record<string, any>;
};

type PayrollProfile = {
  id: string;
  employee_external_id: string;
  pay_group_id?: string | null;
  payroll_status?: string;
  default_payment_mode?: string;
  tax_regime?: string;
  date_of_joining?: string | null;
};

type PayrollComponent = {
  id: string;
  scope: "earning" | "deduction" | "employer_contribution";
  code: string;
  name: string;
  calculation_mode: "fixed" | "percentage" | "formula" | "slab";
  priority?: number;
  taxable?: boolean;
  metadata?: Record<string, any>;
};

type SalaryStructureRow = {
  id: string;
  annual_ctc?: number | string | null;
  monthly_gross?: number | string | null;
  basic_pay?: number | string | null;
  variable_pay?: number | string | null;
  effective_from?: string | null;
  effective_to?: string | null;
  is_current?: boolean;
  revision_reason?: string | null;
  metadata?: Record<string, any>;
};

type BankDetailRow = {
  id: string;
  account_holder_name?: string | null;
  bank_name?: string | null;
  branch_name?: string | null;
  account_number?: string | null;
  ifsc_code?: string | null;
  account_type?: string | null;
  payment_mode?: string | null;
  upi_id?: string | null;
  is_primary?: boolean;
  is_verified?: boolean;
  effective_from?: string | null;
  effective_to?: string | null;
  version_no?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type EmployeeComponentOverride = {
  scope: PayrollComponent["scope"];
  code: string;
  name: string;
  enabled: boolean;
  calculationMode: PayrollComponent["calculation_mode"];
  taxable: boolean;
  amount: string;
  base: string;
  formulaTemplate: string;
  formulaExpression: string;
  bonusCreditTiming: "immediate" | "after_probation" | "manual_date";
  bonusEligibilityDate: string;
  bonusPayoutMonths: string;
  metadata?: Record<string, any>;
};

type SalarySetupFingerprint = {
  salaryForm: Record<string, string | boolean>;
  componentOverrides: Record<string, Partial<EmployeeComponentOverride>>;
};

type EmployeeOverridePreset = {
  code: string;
  name: string;
  description: string;
  scope: PayrollComponent["scope"];
  calculationMode: PayrollComponent["calculation_mode"];
  taxable: boolean;
  amount?: string;
  base?: string;
  metadata?: Record<string, any>;
};

const FORMULA_PRESETS = [
  {
    value: "custom",
    label: "Custom Formula",
    expression: ""
  },
  {
    value: "basic_percent_4_81",
    label: "4.81% of Basic Pay",
    expression: "round(BASIC_PAY * 0.0481)"
  },
  {
    value: "basic_percent_12",
    label: "12% of Basic Pay",
    expression: "round(BASIC_PAY * 0.12)"
  },
  {
    value: "gross_percent_10",
    label: "10% of Monthly Gross",
    expression: "round(MONTHLY_GROSS * 0.10)"
  },
  {
    value: "fixed_zero",
    label: "Zero Amount",
    expression: "0"
  }
];

const ADVANCED_COMPONENT_EXCLUDE = new Set([
  "BASIC",
  "HRA",
  "VARIABLE"
]);

const PREVIEW_EXCLUDED_EARNING_CODES = new Set([
  "BASIC",
  "HRA",
  "VARIABLE",
  "OTHER_ALLOWANCE"
]);

const HRA_COMPONENT_CODES = new Set([
  "HRA",
  "HOUSE_RENT_ALLOWANCE"
]);

const PF_COMPONENT_CODES = new Set([
  "EPF",
  "EMPLOYEEPF",
  "EMPLOYEE_EPF",
  "EMPLOYEE_PROVIDENT_FUND",
  "PF_EMPLOYEE_SHARE",
  "EMPLOYERPF",
  "EMPLOYER_EPF",
  "EMPLOYER_PF",
  "PF_EMPLOYER_SHARE"
]);

const EMPLOYER_PF_COMPONENT_CODES = new Set([
  "EMPLOYERPF",
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
const isEmployerPfComponentCode = (code?: string) =>
  EMPLOYER_PF_COMPONENT_CODES.has(String(code || "").trim().toUpperCase());
const isEsiComponentCode = (code?: string) => ESI_COMPONENT_CODES.has(String(code || "").trim().toUpperCase());
const isHraComponentCode = (code?: string) => HRA_COMPONENT_CODES.has(String(code || "").trim().toUpperCase());

const EMPLOYEE_OVERRIDE_PRESETS: EmployeeOverridePreset[] = [
  {
    code: "BONUS",
    name: "Annual Bonus",
    description: "Set a specific annual or milestone bonus for this employee.",
    scope: "earning",
    calculationMode: "fixed",
    taxable: true,
    amount: "",
    metadata: {
      unitLabel: "currency"
    }
  },
  {
    code: "JOINING_BONUS",
    name: "Joining Bonus",
    description: "Use when the employee receives a one-time joining payout.",
    scope: "earning",
    calculationMode: "fixed",
    taxable: true,
    amount: "",
    metadata: {
      unitLabel: "currency"
    }
  },
  {
    code: "RETENTION_BONUS",
    name: "Retention Bonus",
    description: "Use for retention-based payouts linked to tenure or milestones.",
    scope: "earning",
    calculationMode: "fixed",
    taxable: true,
    amount: "",
    metadata: {
      unitLabel: "currency"
    }
  },
  {
    code: "STOCK_GRANT",
    name: "Stock / Share Grant",
    description: "Some companies allocate ESOP, RSU, or share units to selected employees.",
    scope: "employer_contribution",
    calculationMode: "fixed",
    taxable: false,
    amount: "",
    metadata: {
      unitLabel: "shares",
      placeholder: "e.g. 0.2 or 0.3 shares"
    }
  }
];

const emptyForm = {
  email: "",
  firstName: "",
  lastName: "",
  employeeCode: "",
  departmentId: "",
  designationId: "",
  managerId: "",
  leaveApprovalFlowId: "",
  attendanceApprovalFlowId: "",
  shiftId: "",
  roleIds: [] as string[],
  employmentType: "",
  dateOfJoining: "",
  confirmedDate: "",
  employmentLifecycleStatus: "confirmed",
  lastWorkingDay: "",
  phone: "",
  dob: "",
  gender: "",
  bloodGroup: "",
  aadhaarNumber: "",
  panNumber: "",
  address: {
    line1: "",
    line2: "",
    city: "",
    state: "",
    country: "",
    zip: ""
  },
  emergencyContacts: [
    { name: "", relation: "", phone: "" }
  ]
};

const buildComponentOverrideState = (
  component: PayrollComponent,
  existingOverride?: Partial<EmployeeComponentOverride> | null
): EmployeeComponentOverride => {
  const metadata = component.metadata || {};
  return {
    scope: component.scope,
    code: component.code,
    name: existingOverride?.name || component.name,
    enabled:
      typeof existingOverride?.enabled === "boolean"
        ? existingOverride.enabled
        : metadata.defaultEnabled !== false,
    calculationMode:
      (existingOverride?.calculationMode as PayrollComponent["calculation_mode"]) ||
      component.calculation_mode,
    taxable:
      typeof existingOverride?.taxable === "boolean"
        ? existingOverride.taxable
        : Boolean(component.taxable),
    amount: String(existingOverride?.amount ?? metadata.monthlyAmount ?? metadata.percentage ?? ""),
    base: String(existingOverride?.base ?? metadata.base ?? "MONTHLY_GROSS"),
    formulaTemplate: String(existingOverride?.formulaTemplate ?? metadata.formulaTemplate ?? "custom"),
    formulaExpression: String(existingOverride?.formulaExpression ?? metadata.expression ?? ""),
    bonusCreditTiming: (
      existingOverride?.bonusCreditTiming ||
      existingOverride?.metadata?.bonusRule?.creditTiming ||
      metadata.bonusRule?.creditTiming ||
      "after_probation"
    ) as EmployeeComponentOverride["bonusCreditTiming"],
    bonusEligibilityDate: String(
      existingOverride?.bonusEligibilityDate ||
      existingOverride?.metadata?.bonusRule?.eligibilityDate ||
      metadata.bonusRule?.eligibilityDate ||
      ""
    ),
    bonusPayoutMonths: String(
      existingOverride?.bonusPayoutMonths ||
      existingOverride?.metadata?.bonusRule?.payoutMonths ||
      metadata.bonusRule?.payoutMonths ||
      "2"
    ),
    metadata: {
      ...metadata,
      ...(existingOverride?.metadata || {})
    }
  };
};

const buildPresetOverrideState = (
  preset: EmployeeOverridePreset,
  existingOverride?: Partial<EmployeeComponentOverride> | null
): EmployeeComponentOverride =>
  buildComponentOverrideState(
    {
      id: preset.code,
      scope: preset.scope,
      code: preset.code,
      name: preset.name,
      calculation_mode: preset.calculationMode,
      taxable: preset.taxable,
      metadata: {
        defaultEnabled: false,
        monthlyAmount: preset.amount || "",
        base: preset.base || "MONTHLY_GROSS",
        ...(preset.metadata || {})
      }
    },
    existingOverride
  );

const formatOverrideValue = (override: EmployeeComponentOverride) => {
  if (override.calculationMode === "percentage") {
    return `${override.amount || 0}%`;
  }
  if (override.metadata?.unitLabel === "shares") {
    return `${override.amount || 0} shares`;
  }
  if (override.amount) {
    return formatInr(override.amount);
  }
  return override.calculationMode;
};

const getComponentOverrideErrorKey = (code: string, field: string) =>
  `componentOverride.${String(code || "").toUpperCase()}.${field}`;

const isBlankValue = (value: unknown) => String(value ?? "").trim() === "";

const buildSalarySetupFingerprint = (payload: SalarySetupFingerprint) =>
  JSON.stringify({
    salaryForm: payload.salaryForm,
    componentOverrides: payload.componentOverrides
  });

const replaceText = (value: string, search: string, replacement: string) =>
  String(value || "").split(search).join(replacement);

/* ================= COMPONENT ================= */

const AddEmployee = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const isEdit = Boolean(id);
  const requestedTab = searchParams.get("tab");
  const requestedEditMode = searchParams.get("edit") === "true";
  const requestedPayGroupId = searchParams.get("payGroupId") || "";

  const [form, setForm] = useState(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [departments, setDepartments] = useState<Option[]>([]);
  const [designations, setDesignations] = useState<Option[]>([]);
  const [roles, setRoles] = useState<Option[]>([]);
  const [managers, setManagers] = useState<Option[]>([]);
  const [leaveApprovalFlows, setLeaveApprovalFlows] = useState<Option[]>([]);
  const [attendanceApprovalFlows, setAttendanceApprovalFlows] = useState<Option[]>([]);
  const [shifts, setShifts] = useState<Option[]>([]);
  const [orgProbationDays, setOrgProbationDays] = useState(90);
  const [orgNoticeDays, setOrgNoticeDays] = useState(30);
  const [orgEmployeeCodePrefix, setOrgEmployeeCodePrefix] = useState(
    ((import.meta as any).env?.VITE_EMPLOYEE_ID_PREFIX
      || (import.meta as any).env?.VITE_EMPLOYEE_CODE_PREFIX
      || "LV")
  );
  const [profileImageUrl, setProfileImageUrl] = useState("");
  const [profileImageUpload, setProfileImageUpload] = useState<null | {
    fileName: string;
    mimeType: string;
    base64Data: string;
  }>(null);
  const [originalLifecycleStatus, setOriginalLifecycleStatus] = useState("confirmed");
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState(
    ["salary", "bank", "statutory", "idcard"].includes(String(requestedTab)) && isEdit
      ? String(requestedTab)
      : "employee"
  );
  const payrollProfileLoadedRef = useRef(false);
  const payGroupsLoadedRef = useRef(false);
  const payrollSettingsLoadedRef = useRef(false);
  const [editableSections, setEditableSections] = useState<Record<string, boolean>>({});
  const [payGroups, setPayGroups] = useState<PayGroup[]>([]);
  const [payrollSettings, setPayrollSettings] = useState<PayrollSettings | null>(null);
  const [payrollComponents, setPayrollComponents] = useState<PayrollComponent[]>([]);
  const [payrollComponentCodes, setPayrollComponentCodes] = useState<string[]>([]);
  const [payrollProfileId, setPayrollProfileId] = useState<string>("");
  const [savingSalary, setSavingSalary] = useState(false);
  const [salarySaveNotice, setSalarySaveNotice] = useState("");
  const [savingBank, setSavingBank] = useState(false);
  const [hasSavedBankDetails, setHasSavedBankDetails] = useState(false);
  const [currentBankEffectiveFrom, setCurrentBankEffectiveFrom] = useState("");
  const [hasSavedStatutoryDetails, setHasSavedStatutoryDetails] = useState(false);
  const [lookingUpIfsc, setLookingUpIfsc] = useState(false);
  const [lookingUpAccount, setLookingUpAccount] = useState(false);
  const [savedSalarySetupFingerprint, setSavedSalarySetupFingerprint] = useState("");
  const [salaryStructures, setSalaryStructures] = useState<SalaryStructureRow[]>([]);
  const [bankDetails, setBankDetails] = useState<BankDetailRow[]>([]);
  const [selectedSalaryStructureId, setSelectedSalaryStructureId] = useState("");
  const [salaryEditMode, setSalaryEditMode] = useState<"update" | "revision">("update");
  const [salaryAutoCalc, setSalaryAutoCalc] = useState(true);
  const [salaryForm, setSalaryForm] = useState({
    payGroupId: "",
    payrollStatus: "active",
    defaultPaymentMode: "bank_transfer",
    taxRegime: "new",
    basicPercentSource: "pay_group",
    employeeBasicPercent: "",
    hraPercentOfBasic: "50",
    epfMode: "percentage",
    epfPercentOfBasic: "12",
    epfFixedAmount: "",
    restrictPfWage: true,
    pfWageCeiling: "15000",
    includeEsi: true,
    variablePayEnabled: false,
    variablePayMode: "fixed",
    variablePayPercentOfCtc: "",
    variablePayBaseCode: "MONTHLY_GROSS",
    variablePayReleaseOption: "12",
    variablePayReleaseMonths: "12",
    variablePayApprovalStatus: "pending",
    variablePayApprovedAmount: "",
    annualCtc: "",
    monthlyGross: "",
    basicPay: "",
    variablePay: "",
    effectiveFrom: new Date().toISOString().slice(0, 10),
    revisionReason: "Initial salary setup"
  });
  const [bankForm, setBankForm] = useState({
    accountHolderName: "",
    bankName: "",
    branchName: "",
    accountNumber: "",
    ifscCode: "",
    accountType: "salary",
    paymentMode: "bank_transfer",
    upiId: "",
    isPrimary: true,
    isVerified: false,
    effectiveFrom: new Date().toISOString().slice(0, 10)
  });
  const [statutoryForm, setStatutoryForm] = useState({
    pan: "",
    aadhaar: "",
    uan: "",
    esicNumber: "",
    pfMember: true,
    epsEligible: true,
    esiEligible: false,
    professionalTaxApplicable: true,
    lwfApplicable: false,
    declarationSubmitted: false,
    effectiveFrom: new Date().toISOString().slice(0, 10),
    previousEmployerIncomeAnnual: "",
    previousEmployerTdsAnnual: "",
    otherIncomeAnnual: "",
    housingLoanInterestAnnual: "",
    hraExemptionAnnual: "",
    deduction80cAnnual: "",
    deduction80ccd1bAnnual: "",
    deduction80dAnnual: "",
    deduction80OtherAnnual: ""
  });
  const [savingStatutory, setSavingStatutory] = useState(false);
  const [componentOverrides, setComponentOverrides] = useState<Record<string, EmployeeComponentOverride>>({});
  const canEditEmployeeDetails = hasAnyPermission(["EMP_UPDATE"]);
  const canManagePayroll = hasAnyPermission(["PAYROLL_CONFIG_MANAGE"]);
  const sectionLabels: Record<string, string> = {
    employee: "Personal & Employee Details",
    salary: "Salary Details",
    bank: "Bank Details",
    statutory: "Tax & Statutory",
    idcard: "ID Card"
  };
  const activeSectionLabel = sectionLabels[activeTab] || "Details";
  const canEditActiveSection =
    activeTab === "employee" ? canEditEmployeeDetails : activeTab === "idcard" ? false : canManagePayroll;
  const isSectionReadOnly = (section: string) => isEdit && !editableSections[section];
  const activeSectionReadOnly = isSectionReadOnly(activeTab);
  const enableActiveSectionEdit = () => {
    setEditableSections((prev) => ({ ...prev, [activeTab]: true }));
  };
  const cancelActiveSectionEdit = () => {
    setEditableSections((prev) => ({ ...prev, [activeTab]: false }));
    if (activeTab === "employee") {
      fetchEmployee();
      return;
    }
    if (activeTab === "salary" || activeTab === "bank" || activeTab === "statutory") {
      fetchPayrollData();
    }
  };
  const selectedPayGroup = useMemo(
    () => payGroups.find((row) => row.id === salaryForm.payGroupId) || null,
    [payGroups, salaryForm.payGroupId]
  );
  const payrollStatutorySettings = payrollSettings?.metadata?.statutory || {};
  const hasPayGroupComponentSetup = payrollComponentCodes.length > 0;
  const payGroupHasPfComponent = payrollComponentCodes.some(isPfComponentCode);
  const payGroupHasEsiComponent = payrollComponentCodes.some(isEsiComponentCode);
  const setupPfEnabled = hasPayGroupComponentSetup
    ? payGroupHasPfComponent
    : typeof payrollStatutorySettings.enablePf === "boolean"
    ? payrollStatutorySettings.enablePf
    : true;
  const setupEsiEnabled = hasPayGroupComponentSetup
    ? payGroupHasEsiComponent
    : typeof payrollStatutorySettings.enableEsi === "boolean"
    ? payrollStatutorySettings.enableEsi
    : true;
  const effectivePfEnabled = setupPfEnabled && statutoryForm.pfMember;
  const effectiveEsiEnabled = setupEsiEnabled && salaryForm.includeEsi;
  const effectiveHraEnabled = payrollComponentCodes.some(isHraComponentCode);
  const openSalaryRevision = useMemo(
    () => getOpenSalaryRevision(salaryStructures),
    [salaryStructures]
  );
  const selectedSalaryRevision = useMemo(
    () => salaryStructures.find((row) => row.id === selectedSalaryStructureId) || null,
    [salaryStructures, selectedSalaryStructureId]
  );
  const selectedSalaryRevisionIsClosed =
    salaryEditMode === "update" &&
    !isRevisionEditableToday(selectedSalaryRevision?.effective_to);
  const bankIsCurrentRevision =
    Boolean(hasSavedBankDetails) &&
    Boolean(currentBankEffectiveFrom) &&
    String(bankForm.effectiveFrom || "") === currentBankEffectiveFrom;
  const salarySaveButtonLabel = selectedSalaryRevisionIsClosed
    ? "View Only - Cannot Update"
    : savingSalary
      ? salaryEditMode === "revision"
        ? "Creating Salary Revision..."
        : "Updating Current Salary..."
      : salaryEditMode === "revision"
        ? "Create Salary Revision"
        : "Update Current Salary";
  const bankSaveButtonLabel = savingBank
    ? "Saving Bank Details..."
    : hasSavedBankDetails
      ? bankIsCurrentRevision
        ? "Update Current Bank Details"
        : "Create Bank Revision"
      : "Save Bank Details";
  const statutorySaveButtonLabel = savingStatutory
    ? "Saving..."
    : hasSavedStatutoryDetails
      ? "Create Statutory Revision"
      : "Save Tax & Statutory";
  const salaryModeBadgeLabel = !salaryStructures.length
    ? "New"
    : selectedSalaryRevision && isRevisionScheduledForFuture(selectedSalaryRevision)
      ? "Scheduled"
      : selectedSalaryRevision && !isRevisionActiveToday(selectedSalaryRevision)
        ? "Historical"
        : salaryEditMode === "revision"
          ? "Revision"
          : "Current";
  const bankModeBadgeLabel = !hasSavedBankDetails
    ? "New"
    : bankIsCurrentRevision
      ? "Current"
      : "Revision";
  const statutoryModeBadgeLabel = !hasSavedStatutoryDetails ? "New" : "Revision";
  const employeeIdCardData = useMemo(
    () => ({
      firstName: form.firstName,
      lastName: form.lastName,
      employeeCode: form.employeeCode,
      phone: form.phone,
      bloodGroup: form.bloodGroup,
      profileImage: profileImageUrl,
      designationId: {
        name: designations.find((designation) => designation._id === form.designationId)?.name || ""
      },
      emergencyContacts: form.emergencyContacts
    }),
    [
      designations,
      form.bloodGroup,
      form.designationId,
      form.employeeCode,
      form.emergencyContacts,
      form.firstName,
      form.lastName,
      form.phone,
      profileImageUrl
    ]
  );

  const payGroupBasicPercent = Number(
    selectedPayGroup?.metadata?.salaryRules?.basicPercent ??
      selectedPayGroup?.metadata?.basicPercent ??
      50
  );
  const effectiveBasicPercent = Number(
    salaryForm.basicPercentSource === "employee"
      ? salaryForm.employeeBasicPercent || payGroupBasicPercent
      : payGroupBasicPercent
  );

  const applySalaryRevisionToForm = (salary: SalaryStructureRow) => {
    const salaryRules = salary?.metadata?.salaryRules || {};
    setSelectedSalaryStructureId(salary.id || "");
    setSalaryEditMode("update");
    setComponentOverrides(salaryRules.componentOverrides || {});
    setSalaryForm((prev) => ({
      ...prev,
      basicPercentSource: salaryRules.basicPercentSource || "pay_group",
      employeeBasicPercent:
        salaryRules.employeeBasicPercent !== undefined && salaryRules.employeeBasicPercent !== null
          ? String(salaryRules.employeeBasicPercent)
          : "",
      hraPercentOfBasic:
        salaryRules.hraPercentOfBasic !== undefined && salaryRules.hraPercentOfBasic !== null
          ? String(salaryRules.hraPercentOfBasic)
          : prev.hraPercentOfBasic,
      epfMode: salaryRules.epfMode || prev.epfMode,
      epfPercentOfBasic:
        salaryRules.epfPercentOfBasic !== undefined && salaryRules.epfPercentOfBasic !== null
          ? String(salaryRules.epfPercentOfBasic)
          : prev.epfPercentOfBasic,
      epfFixedAmount:
        salaryRules.epfFixedAmount !== undefined && salaryRules.epfFixedAmount !== null
          ? String(salaryRules.epfFixedAmount)
          : prev.epfFixedAmount,
      restrictPfWage:
        typeof salaryRules.restrictPfWage === "boolean"
          ? salaryRules.restrictPfWage
          : prev.restrictPfWage,
      pfWageCeiling:
        salaryRules.pfWageCeiling !== undefined && salaryRules.pfWageCeiling !== null
          ? String(salaryRules.pfWageCeiling)
          : prev.pfWageCeiling,
      includeEsi:
        typeof salaryRules.includeEsi === "boolean" ? salaryRules.includeEsi : prev.includeEsi,
      variablePayEnabled:
        typeof salaryRules.variablePayEnabled === "boolean"
          ? salaryRules.variablePayEnabled
          : Number(
              salaryRules.variablePayTargetMonthly ??
                salaryRules.variablePayApprovedAmount ??
                salary?.variable_pay_target ??
                salary?.variable_pay ??
                0
            ) > 0,
      variablePayMode: salaryRules.variablePayMode || prev.variablePayMode,
      variablePayPercentOfCtc:
        salaryRules.variablePayPercentOfCtc !== undefined && salaryRules.variablePayPercentOfCtc !== null
          ? String(salaryRules.variablePayPercentOfCtc)
          : prev.variablePayPercentOfCtc,
      variablePayBaseCode: salaryRules.variablePayBaseCode || prev.variablePayBaseCode || "MONTHLY_GROSS",
      variablePayReleaseOption: ["3", "6", "12"].includes(String(salaryRules.variablePayReleaseMonths || ""))
        ? String(salaryRules.variablePayReleaseMonths)
        : salaryRules.variablePayReleaseMonths
          ? "custom"
          : prev.variablePayReleaseOption,
      variablePayReleaseMonths:
        salaryRules.variablePayReleaseMonths !== undefined && salaryRules.variablePayReleaseMonths !== null
          ? String(salaryRules.variablePayReleaseMonths)
          : prev.variablePayReleaseMonths,
      variablePayApprovalStatus: ["pending", "partial", "approved", "rejected"].includes(String(salaryRules.variablePayApprovalStatus || ""))
        ? String(salaryRules.variablePayApprovalStatus)
        : prev.variablePayApprovalStatus,
      variablePayApprovedAmount:
        salaryRules.variablePayApprovedAmount !== undefined && salaryRules.variablePayApprovedAmount !== null
          ? String(salaryRules.variablePayApprovedAmount)
          : salary?.variable_pay_approved_amount !== undefined && salary?.variable_pay_approved_amount !== null
            ? String(salary.variable_pay_approved_amount)
            : Number(salary?.variable_pay || 0) > 0
              ? String(salary.variable_pay)
              : prev.variablePayApprovedAmount,
      annualCtc: salary?.annual_ctc ? String(salary.annual_ctc) : "",
      monthlyGross: salary?.monthly_gross ? String(salary.monthly_gross) : "",
      basicPay: salary?.basic_pay ? String(salary.basic_pay) : "",
      variablePay:
        salaryRules.variablePayTargetMonthly !== undefined && salaryRules.variablePayTargetMonthly !== null
          ? String(salaryRules.variablePayTargetMonthly)
          : salary?.variable_pay_target !== undefined && salary?.variable_pay_target !== null
            ? String(salary.variable_pay_target)
            : salary?.variable_pay !== undefined && salary?.variable_pay !== null && Number(salary.variable_pay) > 0
              ? String(salary.variable_pay)
              : "",
      effectiveFrom: normalizePayrollDate(salary?.effective_from) || prev.effectiveFrom,
      revisionReason: salary?.revision_reason || prev.revisionReason
    }));
  };

  const startNewSalaryRevision = () => {
    const nextEffectiveFrom = getDefaultSalaryRevisionDate(salaryStructures);
    setSelectedSalaryStructureId("");
    setSalaryEditMode("revision");
    setSalaryForm((prev) => ({
      ...prev,
      effectiveFrom: nextEffectiveFrom,
      revisionReason: "Salary revision / hike"
    }));
  };

  const salaryBreakdown = useMemo(() => {
    const annualCtc = Number(salaryForm.annualCtc || 0);
    const monthlyCtc = Number((annualCtc / 12).toFixed(2));
    const variablePayApprovalStatus = String(salaryForm.variablePayApprovalStatus || "pending");
    const configuredVariablePayTarget = salaryForm.variablePayEnabled
      ? Number(salaryForm.variablePay || 0)
      : 0;
    const variablePayRecognizedAmount =
      salaryForm.variablePayEnabled && ["partial", "approved"].includes(variablePayApprovalStatus)
        ? Number(salaryForm.variablePayApprovedAmount || configuredVariablePayTarget || 0)
        : 0;
    const configuredSalary = salaryAutoCalc && annualCtc > 0 && salaryForm.payGroupId
      ? deriveGrossFromMonthlyCtc({
          monthlyCtc,
          basicPercent: Math.max(1, Math.min(100, Number(effectiveBasicPercent || 50))),
          epfMode: salaryForm.epfMode,
          epfFixedAmount: effectivePfEnabled ? Number(salaryForm.epfFixedAmount || 0) : 0,
          epfPercentOfBasic: effectivePfEnabled ? Number(salaryForm.epfPercentOfBasic || 12) : 0,
          restrictPfWage: salaryForm.restrictPfWage,
          pfWageCeiling: Number(salaryForm.pfWageCeiling || 15000),
          includeEsi: effectiveEsiEnabled,
          hraPercentOfBasic: effectiveHraEnabled ? Number(salaryForm.hraPercentOfBasic || 0) : 0,
          variablePayEnabled: salaryForm.variablePayEnabled,
          variablePayMode: salaryForm.variablePayMode,
          variablePayPercentOfCtc: Number(salaryForm.variablePayPercentOfCtc || 0),
          variablePayBaseCode: salaryForm.variablePayBaseCode,
          variablePayAmount: configuredVariablePayTarget,
          variablePayRecognizedAmount
        })
      : null;
    const grossBeforeVariablePay = configuredSalary
      ? configuredSalary.fixedGross
      : Number(salaryForm.monthlyGross || 0);
    const basicPay = configuredSalary
      ? configuredSalary.basicPay
      : Number(salaryForm.basicPay || 0);
    const variablePayTarget = configuredSalary
      ? configuredSalary.variablePayTarget
      : configuredVariablePayTarget;
    const payrollMonthlyGross = Number(
      (grossBeforeVariablePay + variablePayRecognizedAmount).toFixed(2)
    );
    const ctcMonthlyGross = configuredSalary
      ? configuredSalary.monthlyGross
      : Number((grossBeforeVariablePay + variablePayTarget).toFixed(2));
    const hraPercent = effectiveHraEnabled ? Math.max(0, Number(salaryForm.hraPercentOfBasic || 0)) : 0;
    const hraAmount = Number((basicPay * (hraPercent / 100)).toFixed(2));
    const fixedAllowance = Number(
      Math.max(0, payrollMonthlyGross - basicPay - hraAmount - variablePayRecognizedAmount).toFixed(2)
    );
    const employerEpf = !effectivePfEnabled
      ? 0
      : configuredSalary
        ? configuredSalary.employerEpf
        : computeEmployerEpfAmount({
          basicPay,
          epfMode: salaryForm.epfMode,
          epfFixedAmount: Number(salaryForm.epfFixedAmount || 0),
          epfPercentOfBasic: Number(salaryForm.epfPercentOfBasic || 12),
          restrictPfWage: salaryForm.restrictPfWage,
          pfWageCeiling: Number(salaryForm.pfWageCeiling || 15000)
        });
    const employeeEpf = employerEpf;
    const esiWages = payrollMonthlyGross > 0 ? payrollMonthlyGross : basicPay;
    const esiEmployeeAmount = effectiveEsiEnabled && esiWages <= 21000
      ? Number((esiWages * 0.0075).toFixed(2))
      : 0;
    const esiEmployerAmount = configuredSalary
      ? configuredSalary.employerEsiAmount
      : computeEmployerEsiAmount({
          monthlyGross: esiWages,
          includeEsi: effectiveEsiEnabled
    });
    const professionalTaxAmount = computeProfessionalTaxAmount({
      monthlyGross: payrollMonthlyGross,
      ctcMonthlyGross,
      professionalTaxApplicable: statutoryForm.professionalTaxApplicable
    });
    const totalDeductions = Number(
      (
        employeeEpf +
        esiEmployeeAmount +
        professionalTaxAmount
      ).toFixed(2)
    );
    const netSalary = Number((payrollMonthlyGross - totalDeductions).toFixed(2));
    const annualNetSalary = Number((netSalary * 12).toFixed(2));

    return {
      annualCtc,
      monthlyCtc,
      monthlyGross: payrollMonthlyGross,
      grossBeforeVariablePay: Number(grossBeforeVariablePay.toFixed(2)),
      basicPay,
      variablePay: variablePayTarget,
      variablePayRecognizedAmount,
      variablePayApprovedAmount: variablePayRecognizedAmount,
      variablePayApprovalStatus,
      hraAmount,
      fixedAllowance,
      employerEpf,
      employeeEpf,
      esiEmployeeAmount,
      esiEmployerAmount,
      professionalTaxAmount,
      totalDeductions,
      netSalary,
      annualNetSalary
    };
  }, [
    salaryForm.annualCtc,
    salaryForm.monthlyGross,
    salaryForm.basicPay,
    salaryForm.variablePay,
    salaryForm.variablePayEnabled,
    salaryForm.variablePayMode,
    salaryForm.variablePayPercentOfCtc,
    salaryForm.variablePayBaseCode,
    salaryForm.variablePayApprovedAmount,
    salaryForm.hraPercentOfBasic,
    effectiveHraEnabled,
    salaryForm.epfMode,
    salaryForm.epfPercentOfBasic,
    salaryForm.epfFixedAmount,
    salaryForm.restrictPfWage,
    salaryForm.pfWageCeiling,
    effectiveEsiEnabled,
    effectivePfEnabled,
    salaryAutoCalc,
    salaryForm.payGroupId,
    effectiveBasicPercent,
    statutoryForm.professionalTaxApplicable,
    salaryForm.variablePayApprovalStatus
  ]);

  const currentSalarySetupFingerprint = useMemo(
    () =>
      buildSalarySetupFingerprint({
        salaryForm: {
          payGroupId: salaryForm.payGroupId,
          payrollStatus: salaryForm.payrollStatus,
          defaultPaymentMode: salaryForm.defaultPaymentMode,
          taxRegime: salaryForm.taxRegime,
          basicPercentSource: salaryForm.basicPercentSource,
          employeeBasicPercent: salaryForm.employeeBasicPercent,
          hraPercentOfBasic: salaryForm.hraPercentOfBasic,
          epfMode: salaryForm.epfMode,
          epfPercentOfBasic: salaryForm.epfPercentOfBasic,
          epfFixedAmount: salaryForm.epfFixedAmount,
          restrictPfWage: salaryForm.restrictPfWage,
          pfWageCeiling: salaryForm.pfWageCeiling,
          includeEsi: salaryForm.includeEsi,
          variablePayEnabled: salaryForm.variablePayEnabled,
          variablePayMode: salaryForm.variablePayMode,
          variablePayPercentOfCtc: salaryForm.variablePayPercentOfCtc,
          variablePayBaseCode: salaryForm.variablePayBaseCode,
          variablePayReleaseOption: salaryForm.variablePayReleaseOption,
          variablePayReleaseMonths: salaryForm.variablePayReleaseMonths,
          variablePayApprovalStatus: salaryForm.variablePayApprovalStatus,
          variablePayApprovedAmount: salaryForm.variablePayApprovedAmount,
          annualCtc: salaryForm.annualCtc,
          monthlyGross: salaryBreakdown.grossBeforeVariablePay,
          basicPay: salaryForm.basicPay,
          variablePay: salaryForm.variablePay,
          effectiveFrom: salaryForm.effectiveFrom,
          revisionReason: salaryForm.revisionReason
        },
        componentOverrides
      }),
    [componentOverrides, salaryBreakdown.grossBeforeVariablePay, salaryForm]
  );
  const salaryHasUnsavedChanges = currentSalarySetupFingerprint !== savedSalarySetupFingerprint;

  const salaryPreviewBaseAmounts = useMemo(
    () =>
      ({
        BASIC: salaryBreakdown.basicPay,
        BASIC_PAY: salaryBreakdown.basicPay,
        BASIC_SALARY: salaryBreakdown.basicPay,
        EARNED_BASIC: salaryBreakdown.basicPay,
        HRA: salaryBreakdown.hraAmount,
        HOUSE_RENT_ALLOWANCE: salaryBreakdown.hraAmount,
        OTHER_ALLOWANCE: salaryBreakdown.fixedAllowance,
        FIXED_ALLOWANCE: salaryBreakdown.fixedAllowance,
        SPECIAL_ALLOWANCE: salaryBreakdown.fixedAllowance,
        CONVEYANCE: salaryBreakdown.fixedAllowance,
        VARIABLE: salaryBreakdown.variablePay,
        VARIABLE_PAY: salaryBreakdown.variablePay,
        VARIABLE_PAY_TARGET: salaryBreakdown.variablePay,
        MONTHLY_GROSS: salaryBreakdown.grossBeforeVariablePay,
        GROSS: salaryBreakdown.grossBeforeVariablePay,
        CTC_EARNINGS_POOL: salaryBreakdown.ctcMonthlyGross,
        FIXED_PAY: salaryBreakdown.grossBeforeVariablePay,
        MONTHLY_CTC: salaryBreakdown.monthlyCtc,
        EMPLOYER_EPF: salaryBreakdown.employerEpf,
        EMPLOYER_PF: salaryBreakdown.employerEpf,
        PF_EMPLOYER_SHARE: salaryBreakdown.employerEpf,
        EPF: salaryBreakdown.employeeEpf,
        EMPLOYEE_EPF: salaryBreakdown.employeeEpf,
        EMPLOYEE_PROVIDENT_FUND: salaryBreakdown.employeeEpf,
        PF_EMPLOYEE_SHARE: salaryBreakdown.employeeEpf,
        EMPLOYER_ESI: salaryBreakdown.esiEmployerAmount,
        ESI_EMPLOYER_AMOUNT: salaryBreakdown.esiEmployerAmount,
        ESI_EMPLOYEE_AMOUNT: salaryBreakdown.esiEmployeeAmount,
        ESI_AMOUNT: salaryBreakdown.esiEmployeeAmount,
        PROFESSIONAL_TAX: salaryBreakdown.professionalTaxAmount,
        PT: salaryBreakdown.professionalTaxAmount,
        P_TAX: salaryBreakdown.professionalTaxAmount
      } as Record<string, number>),
    [salaryBreakdown]
  );

  const salaryComponentPreviewRows = useMemo(
    () => {
      const previewValues: Record<string, number> = {
        ...salaryPreviewBaseAmounts,
        EPF: 0,
        EMPLOYEE_EPF: 0,
        EMPLOYEE_PROVIDENT_FUND: 0,
        PF_EMPLOYEE_SHARE: 0
      };
      const previewRows: Array<{
        code: string;
        label: string;
        scope: PayrollComponent["scope"];
        mode: PayrollComponent["calculation_mode"];
        detail: string;
        monthlyAmount: number | null;
      }> = [];

      const setEmployeePfAliases = (amount: number) => {
        previewValues.EPF = amount;
        previewValues.EMPLOYEE_EPF = amount;
        previewValues.EMPLOYEE_PROVIDENT_FUND = amount;
        previewValues.PF_EMPLOYEE_SHARE = amount;
      };

      for (const component of [...payrollComponents].sort((a, b) =>
        Number(a.priority ?? 100) - Number(b.priority ?? 100) ||
        String(a.code || "").localeCompare(String(b.code || ""))
      )) {
        const key = String(component.code || "").toUpperCase();
        if (!effectivePfEnabled && isPfComponentCode(key)) continue;
        if (!effectiveEsiEnabled && isEsiComponentCode(key)) continue;
        const override = componentOverrides[key] || buildComponentOverrideState(component);
        if (!override.enabled) continue;

        const baseKey = String(override.base || "MONTHLY_GROSS").toUpperCase();
        const baseAmount = previewValues[baseKey] ?? salaryPreviewBaseAmounts[baseKey] ?? salaryBreakdown.monthlyGross;
        let monthlyAmount: number | null = null;

        try {
          monthlyAmount =
            override.calculationMode === "fixed" && !isBlankValue(override.amount)
              ? Number(override.amount)
              : override.calculationMode === "percentage" && !isBlankValue(override.amount)
                ? Number((baseAmount * Number(override.amount)) / 100)
                : override.calculationMode === "formula"
                  ? evaluatePreviewFormula(override.formulaExpression || "0", previewValues)
                  : override.calculationMode === "slab"
                    ? evaluatePreviewSlabs(
                        baseAmount,
                        Array.isArray(override.metadata?.slabs) ? override.metadata.slabs : []
                      )
                    : null;
        } catch (_) {
          monthlyAmount = null;
        }

        if (key === "PT" || key === "PROFESSIONAL_TAX" || key === "P_TAX") {
          const payableGrossContext = {
            ...previewValues,
            MONTHLY_GROSS: salaryBreakdown.monthlyGross,
            GROSS: salaryBreakdown.monthlyGross
          };
          try {
            monthlyAmount =
              override.calculationMode === "slab"
                ? evaluatePreviewSlabs(
                    salaryBreakdown.monthlyGross,
                    Array.isArray(override.metadata?.slabs) ? override.metadata.slabs : []
                  )
                : override.calculationMode === "formula"
                  ? evaluatePreviewFormula(override.formulaExpression || "0", payableGrossContext)
                  : monthlyAmount;
          } catch (_) {
            monthlyAmount = salaryBreakdown.professionalTaxAmount;
          }
        }

        // These are the standard split components for the fixed earnings
        // balance. Keep their preview deterministic even when an older saved
        // formula revision cannot be evaluated by the browser.
        if (
          override.calculationMode === "formula" &&
          Number(monthlyAmount || 0) === 0 &&
          salaryBreakdown.fixedAllowance > 0 &&
          (key === "ALLOWANCE" || key === "SPECIAL_ALLOWANCE" || key === "CONVEYANCE")
        ) {
          const allocationRatio =
            key === "CONVEYANCE"
              ? 0.2
              : 0.8;
          monthlyAmount = roundPayrollAmount(
            salaryBreakdown.fixedAllowance * allocationRatio
          );
        }

        const resolvedAmount =
          key === "VARIABLE" || key === "VARIABLE_PAY"
            ? Number(salaryBreakdown.variablePayApprovedAmount.toFixed(2))
            : monthlyAmount != null && Number.isFinite(monthlyAmount)
              ? Number(monthlyAmount.toFixed(2))
              : null;

        if (resolvedAmount != null && key !== "VARIABLE" && key !== "VARIABLE_PAY") {
          previewValues[key] = resolvedAmount;
          if (key === "EPF") {
            setEmployeePfAliases(resolvedAmount);
          }
        }

        const detail =
          key === "VARIABLE" || key === "VARIABLE_PAY"
            ? ["partial", "approved"].includes(salaryBreakdown.variablePayApprovalStatus)
              ? formatInr(resolvedAmount ?? 0)
              : "Pending approval"
            : override.calculationMode === "percentage"
            ? `${override.amount || 0}% of ${override.base || "MONTHLY_GROSS"}`
            : override.calculationMode === "formula"
              ? override.formulaExpression || "Formula not set"
              : override.calculationMode === "slab"
                ? "Slab-based amount"
                : resolvedAmount != null
                  ? formatInr(resolvedAmount)
                  : "Amount not set";

        previewRows.push({
          code: key,
          label: override.name || component.name,
          scope: isEmployerPfComponentCode(key)
            ? "employer_contribution"
            : component.scope,
          mode: override.calculationMode,
          detail,
          monthlyAmount: resolvedAmount
        });
      }

      return previewRows;
    },
    [
      componentOverrides,
      effectiveEsiEnabled,
      effectivePfEnabled,
      payrollComponents,
      salaryBreakdown.monthlyGross,
      salaryBreakdown.variablePayApprovedAmount,
      salaryBreakdown.variablePayApprovalStatus,
      salaryPreviewBaseAmounts
    ]
  );
  const earningSalaryComponentRows = useMemo(
    () => salaryComponentPreviewRows.filter((row) => row.scope === "earning"),
    [salaryComponentPreviewRows]
  );
  const earningComponentBaseOptions = useMemo(() => {
    const optionMap = new Map<string, { value: string; label: string }>();
    const addOption = (value: string, label: string) => {
      const normalizedValue = String(value || "").trim().toUpperCase();
      if (!normalizedValue || optionMap.has(normalizedValue)) return;
      optionMap.set(normalizedValue, { value: normalizedValue, label });
    };

    for (const component of earningSalaryComponentRows) {
      addOption(component.code, `${component.label} (${component.code})`);
    }

    addOption("FIXED_PAY", "Fixed Pay (FIXED_PAY)");
    addOption("BASIC_SALARY", "Basic Salary (BASIC_SALARY)");
    addOption("MONTHLY_GROSS", "Monthly Gross (MONTHLY_GROSS)");
    addOption("GROSS", "Monthly Gross (GROSS)");
    addOption("MONTHLY_CTC", "Monthly CTC (MONTHLY_CTC)");

    return Array.from(optionMap.values());
  }, [earningSalaryComponentRows]);
  const dynamicSalaryComponentRows = useMemo(
    () => salaryComponentPreviewRows.filter((row) => row.mode !== "fixed"),
    [salaryComponentPreviewRows]
  );
    const selectedVariableBaseLabel =
    earningComponentBaseOptions.find(
      (option) => option.value === String(salaryForm.variablePayBaseCode || "MONTHLY_GROSS").toUpperCase()
    )?.label ||
    String(salaryForm.variablePayBaseCode || "Monthly Gross")
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/\b\w/g, (char) => char.toUpperCase());
  const selectedVariableBaseDisplayLabel = selectedVariableBaseLabel.replace(/\s*\([^)]+\)$/, "");
  const selectedVariableTargetTypeValue =
    salaryForm.variablePayMode === "fixed"
      ? "fixed"
      : salaryForm.variablePayMode === "ctc_percentage"
        ? "ctc_percentage"
        : `base:${String(salaryForm.variablePayBaseCode || "MONTHLY_GROSS").toUpperCase()}`;

  const customEarningPreviewRows = useMemo(
    () =>
      salaryComponentPreviewRows.filter(
        (row) => row.scope === "earning" && !PREVIEW_EXCLUDED_EARNING_CODES.has(row.code)
      ),
    [salaryComponentPreviewRows]
  );
  const customEarningPreviewTotal = useMemo(
    () =>
      customEarningPreviewRows.reduce(
        (total, row) => total + Number(row.monthlyAmount || 0),
        0
      ),
    [customEarningPreviewRows]
  );
  const specialAllowancePreviewAmount = Number(
    Math.max(0, salaryBreakdown.fixedAllowance - customEarningPreviewTotal).toFixed(2)
  );
  const employerContributionPreviewRows = useMemo(
    () => salaryComponentPreviewRows.filter((row) => row.scope === "employer_contribution"),
    [salaryComponentPreviewRows]
  );
  const deductionPreviewRows = useMemo(
    () => salaryComponentPreviewRows.filter((row) => row.scope === "deduction"),
    [salaryComponentPreviewRows]
  );
  const earningsSummaryRows = useMemo(() => {
    const fixedPayTotal = salaryBreakdown.grossBeforeVariablePay;
    const rows: Array<{
      label: string;
      amount: number;
      description?: string;
      highlight?: boolean;
    }> = [
      { label: "Basic Salary", amount: salaryBreakdown.basicPay }
    ];

    if (effectiveHraEnabled) {
      rows.push({ label: "House Rent Allowance", amount: salaryBreakdown.hraAmount });
    }

    rows.push(
      ...customEarningPreviewRows.map((component) => ({
        label: component.label,
        amount: Number(component.monthlyAmount || 0),
        description: component.detail
      }))
    );

    if (specialAllowancePreviewAmount > 0) {
      rows.push({
        label: "Residual Allowance",
        amount: specialAllowancePreviewAmount,
        description: "Residual earnings after configured components"
      });
    }

    rows.push({
      label: "Fixed Pay",
      amount: fixedPayTotal,
      description: effectiveHraEnabled
        ? "Basic + HRA + custom earnings + Residual Allowance"
        : "Basic + custom earnings + Residual Allowance",
      highlight: true
    });

    if (salaryForm.variablePayEnabled) {
      rows.push({
        label: "Approved Variable Pay",
        amount: salaryBreakdown.variablePayRecognizedAmount,
        description:
          ["partial", "approved"].includes(salaryBreakdown.variablePayApprovalStatus)
            ? "Approved amount that will be credited in its approval month"
            : "Nothing is approved; ₹0 is included in Gross and Net Pay"
      });
    }

    return rows;
  }, [
    customEarningPreviewRows,
    customEarningPreviewTotal,
    salaryBreakdown.basicPay,
    salaryBreakdown.hraAmount,
    salaryBreakdown.variablePayRecognizedAmount,
    salaryBreakdown.variablePayApprovedAmount,
    salaryBreakdown.variablePayApprovalStatus,
    effectiveHraEnabled,
    salaryForm.variablePayEnabled,
    specialAllowancePreviewAmount
  ]);
  const earningsPreviewTotal = useMemo(
    () => {
      const fixedPayTotal = earningsSummaryRows.find((row) => row.label === "Fixed Pay")?.amount || 0;
      return fixedPayTotal + (salaryForm.variablePayEnabled && ["partial", "approved"].includes(salaryBreakdown.variablePayApprovalStatus)
        ? salaryBreakdown.variablePayRecognizedAmount
        : 0);
    },
    [
      earningsSummaryRows,
      salaryBreakdown.variablePayRecognizedAmount,
      salaryBreakdown.variablePayApprovalStatus,
      salaryForm.variablePayEnabled
    ]
  );

  const payrollSummaryTotals = useMemo(() => {
    const configuredEmployerContributionTotal = employerContributionPreviewRows
      .reduce((total, row) => total + Number(row.monthlyAmount || 0), 0);
    const derivedEmployerContributionTotal = Number(
      (salaryBreakdown.employerEpf + salaryBreakdown.esiEmployerAmount).toFixed(2)
    );
    const employerContributionTotal = Number(
      (
        employerContributionPreviewRows.length > 0
          ? configuredEmployerContributionTotal
          : derivedEmployerContributionTotal
      ).toFixed(2)
    );
    const deductionTotal = deductionPreviewRows
      .reduce((total, row) => total + Number(row.monthlyAmount || 0), 0);

    return {
      variablePay: salaryForm.variablePayEnabled ? Number(salaryBreakdown.variablePayRecognizedAmount || 0) : 0,
      gross: Number(salaryBreakdown.monthlyGross.toFixed(2)),
      employerContributionTotal,
      ctc: Number(salaryBreakdown.monthlyCtc.toFixed(2)),
      deductionTotal,
      netSalary: Number((salaryBreakdown.monthlyGross - deductionTotal).toFixed(2))
    };
  }, [
    salaryBreakdown.employerEpf,
    salaryBreakdown.esiEmployerAmount,
    salaryBreakdown.monthlyCtc,
    salaryBreakdown.monthlyGross,
    salaryBreakdown.variablePayApprovedAmount,
    employerContributionPreviewRows,
    deductionPreviewRows,
    salaryForm.variablePayEnabled
  ]);

  const enabledEmployeeComponents = useMemo(
    () => {
      const componentCodes = new Set<string>();
      const componentEntries = payrollComponents
        .map((component) => {
          const key = String(component.code || "").toUpperCase();
          componentCodes.add(key);
          if (!effectivePfEnabled && isPfComponentCode(key)) return null;
          if (!effectiveEsiEnabled && isEsiComponentCode(key)) return null;
          return componentOverrides[key] || buildComponentOverrideState(component);
        })
        .filter(Boolean) as EmployeeComponentOverride[];

      const presetEntries = EMPLOYEE_OVERRIDE_PRESETS
        .filter((preset) => !componentCodes.has(preset.code))
        .map((preset) => componentOverrides[preset.code] || buildPresetOverrideState(preset));

      const storedEntries = Object.entries(componentOverrides)
        .filter(([code, override]) => !componentCodes.has(code) && !EMPLOYEE_OVERRIDE_PRESETS.some((preset) => preset.code === code) && Boolean(override?.code))
        .map(([, override]) => override);

      return [...componentEntries, ...presetEntries, ...storedEntries].filter((override) => override?.enabled);
    },
    [componentOverrides, effectiveEsiEnabled, effectivePfEnabled, payrollComponents]
  );
  const employeeOverrideSettings = useMemo(
    () =>
      EMPLOYEE_OVERRIDE_PRESETS.map((preset) => {
        const matchingComponent = payrollComponents.find(
          (component) => String(component.code || "").toUpperCase() === preset.code
        );
        if (matchingComponent) {
          const key = preset.code;
          return {
            preset,
            override:
              componentOverrides[key] || buildComponentOverrideState(matchingComponent)
          };
        }
        return {
          preset,
          override: componentOverrides[preset.code] || buildPresetOverrideState(preset)
        };
      }),
    [componentOverrides, payrollComponents]
  );

  const getEffectiveComponentOverrideEntries = () => {
    const componentCodes = new Set<string>();
    const componentEntries = payrollComponents
      .map((component) => {
        const key = String(component.code || "").toUpperCase();
        if (!key) return null;
        componentCodes.add(key);
        if (!effectivePfEnabled && isPfComponentCode(key)) return null;
        if (!effectiveEsiEnabled && isEsiComponentCode(key)) return null;
        return [
          key,
          componentOverrides[key] || buildComponentOverrideState(component)
        ] as const;
      })
      .filter(Boolean) as Array<readonly [string, EmployeeComponentOverride]>;

    const storedEntries = Object.entries(componentOverrides).filter(
      ([code, override]) =>
        !componentCodes.has(code)
        && Boolean(override?.code)
        && (effectivePfEnabled || !isPfComponentCode(code))
        && (effectiveEsiEnabled || !isEsiComponentCode(code))
    );

    return [...componentEntries, ...storedEntries];
  };

  const validateEnabledComponentOverrides = () => {
    const nextErrors: Record<string, string> = {};

    getEffectiveComponentOverrideEntries().forEach(([code, override]) => {
      if (!override?.enabled) return;

      if (isBlankValue(override.name)) {
        nextErrors[getComponentOverrideErrorKey(code, "name")] = "Display name is required";
      }

      if (override.calculationMode === "percentage") {
        if (isBlankValue(override.amount)) {
          nextErrors[getComponentOverrideErrorKey(code, "amount")] = "Percentage is required";
        } else if (!Number.isFinite(Number(override.amount))) {
          nextErrors[getComponentOverrideErrorKey(code, "amount")] = "Enter a valid percentage";
        }

        if (isBlankValue(override.base)) {
          nextErrors[getComponentOverrideErrorKey(code, "base")] = "Base variable is required";
        }
      } else if (override.calculationMode === "formula") {
        if (isBlankValue(override.formulaExpression)) {
          nextErrors[getComponentOverrideErrorKey(code, "formulaExpression")] = "Custom formula is required";
        }
      } else if (isBlankValue(override.amount)) {
        nextErrors[getComponentOverrideErrorKey(code, "amount")] =
          override.calculationMode === "slab" ? "Manual amount is required" : "Monthly amount is required";
      } else if (!Number.isFinite(Number(override.amount))) {
        nextErrors[getComponentOverrideErrorKey(code, "amount")] = "Enter a valid amount";
      }

      if (
        code === "BONUS" &&
        override.bonusCreditTiming === "manual_date" &&
        isBlankValue(override.bonusEligibilityDate)
      ) {
        nextErrors[getComponentOverrideErrorKey(code, "bonusEligibilityDate")] =
          "Eligibility date is required";
      }

      if (
        code === "BONUS" &&
        !isBlankValue(override.bonusPayoutMonths) &&
        !Number.isFinite(Number(override.bonusPayoutMonths))
      ) {
        nextErrors[getComponentOverrideErrorKey(code, "bonusPayoutMonths")] =
          "Enter valid payout months";
      }
    });

    return nextErrors;
  };

  /* ================= FETCH MASTER DATA ================= */

  useEffect(() => {
    fetchDepartments();
    fetchDesignations();
    fetchRoles();
    fetchManagers();
    fetchApprovalFlows();
    fetchShifts();
    fetchOrgSettings();
    if (!isEdit) {
      fetchNextEmployeeCode();
    }
  }, []);

  useEffect(() => {
    if (isEdit) {
      fetchEmployee();
    }
  }, [id, isEdit]);

  useEffect(() => {
    if (requestedTab === "salary" && isEdit) {
      setActiveTab("salary");
    }
  }, [isEdit, requestedTab]);

  useEffect(() => {
    if (!isEdit) return;
    const initialTab = ["salary", "bank", "statutory", "idcard"].includes(String(requestedTab))
      ? String(requestedTab)
      : "employee";
    payrollProfileLoadedRef.current = false;
    setPayrollProfileId("");
    setBankDetails([]);
    setHasSavedBankDetails(false);
    setCurrentBankEffectiveFrom("");
    setEditableSections(requestedEditMode ? { [initialTab]: true } : {});
  }, [id, isEdit, requestedEditMode, requestedTab]);

  useEffect(() => {
    if (activeTab !== "salary" || !canManagePayroll || !salaryForm.payGroupId) return;
    fetchPayrollComponents(salaryForm.payGroupId);
  }, [activeTab, canManagePayroll, salaryForm.payGroupId]);

  useEffect(() => {
    if (!canManagePayroll) return;

    const isPayrollDetailsTab = ["salary", "bank", "statutory"].includes(activeTab);
    if (!isPayrollDetailsTab) return;

    if (isEdit && !payrollProfileLoadedRef.current) {
      payrollProfileLoadedRef.current = true;
      fetchPayrollData();
    }

    if (activeTab === "salary") {
      if (!payGroupsLoadedRef.current) {
        payGroupsLoadedRef.current = true;
        fetchPayGroups();
      }
      if (!payrollSettingsLoadedRef.current) {
        payrollSettingsLoadedRef.current = true;
        fetchPayrollSettings();
      }
    }
  }, [activeTab, canManagePayroll, id, isEdit]);

  useEffect(() => {
    const handlePayrollSetupUpdated = (event: Event) => {
      if (activeTab !== "salary") return;
      const customEvent = event as CustomEvent<{ payGroupId?: string; updatedAt?: number }>;
      const updatedPayGroupId = String(customEvent.detail?.payGroupId || "").trim();
      if (!updatedPayGroupId || updatedPayGroupId !== String(salaryForm.payGroupId || "").trim()) {
        return;
      }
      fetchPayrollComponents(updatedPayGroupId, customEvent.detail?.updatedAt || Date.now());
    };

    const handlePayrollSetupStorage = (event: StorageEvent) => {
      if (activeTab !== "salary") return;
      if (event.key !== "payroll:setup-updated" || !event.newValue) return;
      try {
        const storedDetail = JSON.parse(event.newValue) as { payGroupId?: string; updatedAt?: number };
        const updatedPayGroupId = String(storedDetail?.payGroupId || "").trim();
        if (!updatedPayGroupId || updatedPayGroupId !== String(salaryForm.payGroupId || "").trim()) {
          return;
        }
        fetchPayrollComponents(updatedPayGroupId, storedDetail?.updatedAt || Date.now());
      } catch {
        // Ignore malformed storage payloads.
      }
    };

    window.addEventListener("payroll:setup-updated", handlePayrollSetupUpdated as EventListener);
    window.addEventListener("storage", handlePayrollSetupStorage);

    return () => {
      window.removeEventListener("payroll:setup-updated", handlePayrollSetupUpdated as EventListener);
      window.removeEventListener("storage", handlePayrollSetupStorage);
    };
  }, [activeTab, canManagePayroll, salaryForm.payGroupId]);

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || "");
        const base64 = result.includes(",") ? result.split(",")[1] : result;
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const validateProfileImage = (file: File) => {
    if (!PROFILE_IMAGE_TYPES.includes(file.type)) {
      toast.error("Invalid profile image format");
      return false;
    }
    if (file.size > PROFILE_IMAGE_MAX_BYTES) {
      toast.error("Profile image size should be under 2MB");
      return false;
    }
    return true;
  };

  const fetchEmployee = async () => {
    if (!id) return;
    const res = await getApiWithToken(`/employees/${id}`);
    if (res?.success && res?.data) {
      const employee = res.data;
      setForm({
        email: employee.userId?.email || "",
        firstName: employee.firstName || "",
        lastName: employee.lastName || "",
        employeeCode: employee.employeeCode || "",
        departmentId: employee.departmentId?._id || "",
        designationId: employee.designationId?._id || "",
        managerId: employee.managerId?._id || "",
        leaveApprovalFlowId: employee.leaveApprovalFlowId?._id || "",
        attendanceApprovalFlowId: employee.attendanceApprovalFlowId?._id || "",
        shiftId: employee.shiftId?._id || "",
        roleIds: (employee.roleIds || []).map((r: any) => r?._id).filter(Boolean),
        employmentType: employee.employmentType || "",
        dateOfJoining: employee.dateOfJoining
          ? new Date(employee.dateOfJoining).toISOString().slice(0, 10)
          : "",
        confirmedDate: employee.confirmedDate
          ? new Date(employee.confirmedDate).toISOString().slice(0, 10)
          : employee.probationCompletedAt
            ? new Date(employee.probationCompletedAt).toISOString().slice(0, 10)
            : "",
        employmentLifecycleStatus:
          employee.employmentLifecycleStatus ||
          (employee.status === "resigned" ? "notice" : "confirmed"),
        lastWorkingDay: employee.lastWorkingDay
          ? new Date(employee.lastWorkingDay).toISOString().slice(0, 10)
          : employee.noticeEndDate
            ? new Date(employee.noticeEndDate).toISOString().slice(0, 10)
            : "",
        phone: employee.phone || "",
        dob: employee.dob ? new Date(employee.dob).toISOString().slice(0, 10) : "",
        gender: employee.gender || "",
        bloodGroup: employee.bloodGroup || "",
        aadhaarNumber: employee.aadhaarNumber || "",
        panNumber: employee.panNumber || "",
        address: employee.address || emptyForm.address,
        emergencyContacts: employee.emergencyContacts?.length
          ? employee.emergencyContacts
          : emptyForm.emergencyContacts
      });
      setOriginalLifecycleStatus(
        employee.employmentLifecycleStatus ||
        (employee.status === "resigned" ? "notice" : "confirmed")
      );
      setProfileImageUrl(employee.profileImage || "");
      setProfileImageUpload(null);
    } else {
      toast.error(res?.message || "Failed to load employee");
    }
  };

  const fetchDepartments = async () => {
    const res = await getApiWithToken("/departments", null, {
      requiredPermissions: ["DEPT_VIEW"],
      suppressPermissionError: true
    });
    if (res?.code == 200) setDepartments(res.data || []);
  };

  const fetchDesignations = async () => {
    const res = await getApiWithToken("/designations", null, {
      requiredPermissions: ["DESIG_VIEW"],
      suppressPermissionError: true
    });
    if (res?.code == 200) setDesignations(res.data || []);
  };

  const fetchRoles = async () => {
    const res = await getApiWithToken("/roles", null, {
      requiredPermissions: ["ROLE_VIEW"],
      suppressPermissionError: true
    });
    if (res?.code == 200) setRoles(res.data || []);
  };

  const fetchManagers = async () => {
    const res = await getApiWithToken("/employees?employeeState=active", null, {
      requiredPermissions: ["EMP_VIEW"],
      suppressPermissionError: true
    });
    if (res?.success) {
      const list = res.data?.items || [];
      setManagers(
        list.map((e: any) => ({
          _id: e._id,
          name: `${e.firstName || ""} ${e.lastName || ""}`.trim()
        }))
      );
    }
  };

  const fetchApprovalFlows = async () => {
    const [leaveRes, attendanceRes] = await Promise.all([
      getApiWithToken("/approval-flows?moduleKey=leave", null, {
        requiredPermissions: ["APPROVAL_FLOW_VIEW"],
        suppressPermissionError: true
      }),
      getApiWithToken("/approval-flows?moduleKey=attendance_request", null, {
        requiredPermissions: ["APPROVAL_FLOW_VIEW"],
        suppressPermissionError: true
      })
    ]);

    setLeaveApprovalFlows(
      Array.isArray(leaveRes?.data)
        ? leaveRes.data.map((flow: any) => ({ _id: flow._id, name: flow.name }))
        : []
    );
    setAttendanceApprovalFlows(
      Array.isArray(attendanceRes?.data)
        ? attendanceRes.data.map((flow: any) => ({ _id: flow._id, name: flow.name }))
        : []
    );
  };

  const fetchShifts = async () => {
    const res = await getApiWithToken("/shifts", null, {
      requiredPermissions: ["SHIFT_VIEW"],
      suppressPermissionError: true
    });
    if (res?.success) {
      setShifts((res.data || []).map((s: any) => ({ _id: s._id, name: `${s.name} (${s.startTime}-${s.endTime})` })));
    } else {
      setShifts([]);
    }
  };

  const fetchNextEmployeeCode = async () => {
    const res = await getApiWithToken("/employees/next-code", null, {
      requiredPermissions: ["EMP_CREATE"]
    });
    if (res?.success && res?.data?.employeeCode) {
      setForm((prev) => {
        if (prev.employeeCode?.trim()) return prev;
        return { ...prev, employeeCode: String(res.data.employeeCode).toUpperCase() };
      });
    }
  };

  const fetchOrgSettings = async () => {
    const res = await getApiWithToken("/org-settings");
    if (res?.success && res?.data) {
      setOrgProbationDays(
        typeof res.data.probationPeriodDays === "number" ? res.data.probationPeriodDays : 90
      );
      setOrgNoticeDays(
        typeof res.data.noticePeriodDays === "number" ? res.data.noticePeriodDays : 30
      );
      const settingsPrefix = String(res.data.employeeIdPrefix || "").trim().toUpperCase();
      if (settingsPrefix) {
        setOrgEmployeeCodePrefix(settingsPrefix);
      }
    }
  };

  const fetchPayGroups = async () => {
    const res = await getApiWithToken("/payroll/pay-groups", null, {
      requiredPermissions: ["PAYROLL_CONFIG_MANAGE"]
    });
    if (res?.success) {
      const rows = Array.isArray(res.data) ? res.data : [];
      setPayGroups(rows);
      setSalaryForm((prev) => {
        if (prev.payGroupId) return prev;
        const requestedPayGroup = rows.find((row) => row.id === requestedPayGroupId);
        return { ...prev, payGroupId: requestedPayGroup?.id || rows[0]?.id || "" };
      });
    }
  };

  const fetchPayrollSettings = async () => {
    if (!canManagePayroll) return;
    const res = await getApiWithToken("/payroll/settings", null, {
      requiredPermissions: ["PAYROLL_CONFIG_MANAGE"]
    });
    if (res?.success) {
      setPayrollSettings(res.data || null);
    }
  };

  const fetchPayrollData = async () => {
    if (!id || !canManagePayroll) return;
    const profileListRes = await getApiWithToken(
      `/payroll/employee-profiles?employeeExternalId=${id}`,
      null,
      { requiredPermissions: ["PAYROLL_CONFIG_MANAGE"], forceRefresh: true }
    );
    if (!profileListRes?.success || !Array.isArray(profileListRes.data) || !profileListRes.data[0]) {
      return;
    }

    const profile = profileListRes.data[0] as PayrollProfile;
    setPayrollProfileId(profile.id);

    const detailRes = await getApiWithToken(`/payroll/employee-profiles/${profile.id}`, null, {
      requiredPermissions: ["PAYROLL_CONFIG_MANAGE"],
      forceRefresh: true
    });

    if (!detailRes?.success || !detailRes?.data) return;
    const detail = detailRes.data;
    const salaryStructures = Array.isArray(detail.salaryStructures) ? detail.salaryStructures : [];
    const bankDetails = Array.isArray(detail.bankDetails) ? detail.bankDetails : [];
    const statutoryDetails = Array.isArray(detail.statutoryDetails) ? detail.statutoryDetails : [];
    const currentSalary = getOpenSalaryRevision(salaryStructures);
    const currentBank = bankDetails[0] || null;
    const currentStatutory = statutoryDetails[0] || null;
    setSalaryStructures(salaryStructures);
    setBankDetails(bankDetails);
    setSelectedSalaryStructureId(currentSalary?.id || "");
    setSalaryEditMode("update");
    const salaryRules = currentSalary?.metadata?.salaryRules || {};
    const taxDeclaration = currentStatutory?.metadata?.taxDeclaration || {};
    setComponentOverrides(salaryRules.componentOverrides || {});

    const nextSalaryForm = (prev: typeof salaryForm) => ({
      ...prev,
      payGroupId: detail.pay_group_id || prev.payGroupId || "",
      payrollStatus: detail.payroll_status || "active",
      defaultPaymentMode: detail.default_payment_mode || "bank_transfer",
      taxRegime: detail.tax_regime || "new",
      basicPercentSource: salaryRules.basicPercentSource || "pay_group",
      employeeBasicPercent:
        salaryRules.employeeBasicPercent !== undefined && salaryRules.employeeBasicPercent !== null
          ? String(salaryRules.employeeBasicPercent)
          : "",
      hraPercentOfBasic:
        salaryRules.hraPercentOfBasic !== undefined && salaryRules.hraPercentOfBasic !== null
          ? String(salaryRules.hraPercentOfBasic)
          : prev.hraPercentOfBasic,
      epfMode: salaryRules.epfMode || prev.epfMode,
      epfPercentOfBasic:
        salaryRules.epfPercentOfBasic !== undefined && salaryRules.epfPercentOfBasic !== null
          ? String(salaryRules.epfPercentOfBasic)
          : prev.epfPercentOfBasic,
      epfFixedAmount:
        salaryRules.epfFixedAmount !== undefined && salaryRules.epfFixedAmount !== null
          ? String(salaryRules.epfFixedAmount)
          : prev.epfFixedAmount,
      restrictPfWage:
        typeof salaryRules.restrictPfWage === "boolean"
          ? salaryRules.restrictPfWage
          : prev.restrictPfWage,
      pfWageCeiling:
        salaryRules.pfWageCeiling !== undefined && salaryRules.pfWageCeiling !== null
          ? String(salaryRules.pfWageCeiling)
          : prev.pfWageCeiling,
      includeEsi:
        typeof salaryRules.includeEsi === "boolean" ? salaryRules.includeEsi : prev.includeEsi,
      variablePayEnabled:
        typeof salaryRules.variablePayEnabled === "boolean"
          ? salaryRules.variablePayEnabled
          : Number(
              salaryRules.variablePayTargetMonthly ??
                salaryRules.variablePayApprovedAmount ??
                currentSalary?.variable_pay_target ??
                currentSalary?.variable_pay ??
                0
            ) > 0,
      variablePayMode: salaryRules.variablePayMode || prev.variablePayMode,
      variablePayPercentOfCtc:
        salaryRules.variablePayPercentOfCtc !== undefined && salaryRules.variablePayPercentOfCtc !== null
          ? String(salaryRules.variablePayPercentOfCtc)
          : prev.variablePayPercentOfCtc,
      variablePayReleaseOption: ["3", "6", "12"].includes(String(salaryRules.variablePayReleaseMonths || ""))
        ? String(salaryRules.variablePayReleaseMonths)
        : salaryRules.variablePayReleaseMonths
          ? "custom"
          : prev.variablePayReleaseOption,
      variablePayReleaseMonths:
        salaryRules.variablePayReleaseMonths !== undefined && salaryRules.variablePayReleaseMonths !== null
          ? String(salaryRules.variablePayReleaseMonths)
          : prev.variablePayReleaseMonths,
      variablePayApprovalStatus: ["pending", "partial", "approved", "rejected"].includes(String(salaryRules.variablePayApprovalStatus || ""))
        ? String(salaryRules.variablePayApprovalStatus)
        : prev.variablePayApprovalStatus,
      variablePayApprovedAmount:
        salaryRules.variablePayApprovedAmount !== undefined && salaryRules.variablePayApprovedAmount !== null
          ? String(salaryRules.variablePayApprovedAmount)
          : currentSalary?.variable_pay_approved_amount !== undefined && currentSalary?.variable_pay_approved_amount !== null
            ? String(currentSalary.variable_pay_approved_amount)
            : Number(currentSalary?.variable_pay || 0) > 0
              ? String(currentSalary.variable_pay)
              : prev.variablePayApprovedAmount,
      annualCtc: currentSalary?.annual_ctc ? String(currentSalary.annual_ctc) : "",
      monthlyGross: currentSalary?.monthly_gross ? String(currentSalary.monthly_gross) : "",
      basicPay: currentSalary?.basic_pay ? String(currentSalary.basic_pay) : "",
      variablePay:
        salaryRules.variablePayTargetMonthly !== undefined && salaryRules.variablePayTargetMonthly !== null
          ? String(salaryRules.variablePayTargetMonthly)
          : currentSalary?.variable_pay_target !== undefined && currentSalary?.variable_pay_target !== null
            ? String(currentSalary.variable_pay_target)
            : currentSalary?.variable_pay !== undefined && currentSalary?.variable_pay !== null
              ? String(currentSalary.variable_pay)
              : "",
      effectiveFrom:
        normalizePayrollDate(currentSalary?.effective_from) ||
        detail?.date_of_joining?.slice(0, 10) ||
        prev.effectiveFrom
    });

    setSalaryForm(nextSalaryForm);
    setSavedSalarySetupFingerprint(
      buildSalarySetupFingerprint({
        salaryForm: {
          payGroupId: detail.pay_group_id || "",
          payrollStatus: detail.payroll_status || "active",
          defaultPaymentMode: detail.default_payment_mode || "bank_transfer",
          taxRegime: detail.tax_regime || "new",
          basicPercentSource: salaryRules.basicPercentSource || "pay_group",
          employeeBasicPercent:
            salaryRules.employeeBasicPercent !== undefined && salaryRules.employeeBasicPercent !== null
              ? String(salaryRules.employeeBasicPercent)
              : "",
          hraPercentOfBasic:
            salaryRules.hraPercentOfBasic !== undefined && salaryRules.hraPercentOfBasic !== null
              ? String(salaryRules.hraPercentOfBasic)
              : "50",
          epfMode: salaryRules.epfMode || "percentage",
          epfPercentOfBasic:
            salaryRules.epfPercentOfBasic !== undefined && salaryRules.epfPercentOfBasic !== null
              ? String(salaryRules.epfPercentOfBasic)
              : "12",
          epfFixedAmount:
            salaryRules.epfFixedAmount !== undefined && salaryRules.epfFixedAmount !== null
              ? String(salaryRules.epfFixedAmount)
              : "",
          restrictPfWage:
            typeof salaryRules.restrictPfWage === "boolean" ? salaryRules.restrictPfWage : true,
          pfWageCeiling:
            salaryRules.pfWageCeiling !== undefined && salaryRules.pfWageCeiling !== null
              ? String(salaryRules.pfWageCeiling)
              : "15000",
          includeEsi: typeof salaryRules.includeEsi === "boolean" ? salaryRules.includeEsi : true,
          variablePayEnabled:
            typeof salaryRules.variablePayEnabled === "boolean"
              ? salaryRules.variablePayEnabled
              : Number(
                  salaryRules.variablePayTargetMonthly ??
                    salaryRules.variablePayApprovedAmount ??
                    currentSalary?.variable_pay_target ??
                    currentSalary?.variable_pay ??
                    0
                ) > 0,
          variablePayMode: salaryRules.variablePayMode || "fixed",
          variablePayPercentOfCtc:
            salaryRules.variablePayPercentOfCtc !== undefined && salaryRules.variablePayPercentOfCtc !== null
              ? String(salaryRules.variablePayPercentOfCtc)
              : "",
          variablePayBaseCode: salaryRules.variablePayBaseCode || "MONTHLY_GROSS",
          variablePayReleaseOption: ["3", "6", "12"].includes(String(salaryRules.variablePayReleaseMonths || ""))
            ? String(salaryRules.variablePayReleaseMonths)
            : salaryRules.variablePayReleaseMonths
              ? "custom"
              : "12",
          variablePayReleaseMonths:
            salaryRules.variablePayReleaseMonths !== undefined && salaryRules.variablePayReleaseMonths !== null
              ? String(salaryRules.variablePayReleaseMonths)
              : "12",
          variablePayApprovalStatus: ["pending", "partial", "approved", "rejected"].includes(String(salaryRules.variablePayApprovalStatus || ""))
            ? String(salaryRules.variablePayApprovalStatus)
            : "pending",
          variablePayApprovedAmount:
            salaryRules.variablePayApprovedAmount !== undefined && salaryRules.variablePayApprovedAmount !== null
              ? String(salaryRules.variablePayApprovedAmount)
              : Number(currentSalary?.variable_pay || 0) > 0
                ? String(currentSalary.variable_pay)
                : "",
          annualCtc: currentSalary?.annual_ctc ? String(currentSalary.annual_ctc) : "",
          monthlyGross: currentSalary?.monthly_gross ? String(currentSalary.monthly_gross) : "",
          basicPay: currentSalary?.basic_pay ? String(currentSalary.basic_pay) : "",
          variablePay:
            currentSalary?.variable_pay !== undefined && currentSalary?.variable_pay !== null
              ? String(currentSalary.variable_pay)
              : "",
          effectiveFrom:
            normalizePayrollDate(currentSalary?.effective_from) ||
            detail?.date_of_joining?.slice(0, 10) ||
            new Date().toISOString().slice(0, 10),
          revisionReason: currentSalary?.revision_reason || "Initial salary setup"
        },
        componentOverrides: salaryRules.componentOverrides || {}
      })
    );

    setBankForm((prev) => ({
      ...prev,
      accountHolderName: currentBank?.account_holder_name || "",
      bankName: currentBank?.bank_name || "",
      branchName: currentBank?.branch_name || "",
      accountNumber: currentBank?.account_number || "",
      ifscCode: currentBank?.ifsc_code || "",
      accountType: currentBank?.account_type || prev.accountType,
      paymentMode: currentBank?.payment_mode || detail.default_payment_mode || prev.paymentMode,
      upiId: currentBank?.upi_id || "",
      isPrimary: typeof currentBank?.is_primary === "boolean" ? currentBank.is_primary : true,
      isVerified: typeof currentBank?.is_verified === "boolean" ? currentBank.is_verified : false,
      effectiveFrom:
        normalizePayrollDate(currentBank?.effective_from) ||
        detail?.date_of_joining?.slice(0, 10) ||
        prev.effectiveFrom
    }));
    setHasSavedBankDetails(Boolean(currentBank));
    setCurrentBankEffectiveFrom(normalizePayrollDate(currentBank?.effective_from));

    setStatutoryForm((prev) => ({
      ...prev,
      pan: currentStatutory?.pan || "",
      aadhaar: currentStatutory?.aadhaar || "",
      uan: currentStatutory?.uan || "",
      esicNumber: currentStatutory?.esic_number || "",
      pfMember: typeof currentStatutory?.pf_member === "boolean" ? currentStatutory.pf_member : true,
      epsEligible:
        typeof currentStatutory?.eps_eligible === "boolean" ? currentStatutory.eps_eligible : true,
      esiEligible:
        typeof currentStatutory?.esi_eligible === "boolean" ? currentStatutory.esi_eligible : false,
      professionalTaxApplicable:
        typeof currentStatutory?.professional_tax_applicable === "boolean"
          ? currentStatutory.professional_tax_applicable
          : true,
      lwfApplicable:
        typeof currentStatutory?.lwf_applicable === "boolean" ? currentStatutory.lwf_applicable : false,
      declarationSubmitted:
        typeof currentStatutory?.declaration_submitted === "boolean"
          ? currentStatutory.declaration_submitted
          : false,
      effectiveFrom:
        normalizePayrollDate(currentStatutory?.effective_from) ||
        detail?.date_of_joining?.slice(0, 10) ||
        prev.effectiveFrom,
      previousEmployerIncomeAnnual: String(taxDeclaration.previousEmployerIncomeAnnual ?? ""),
      previousEmployerTdsAnnual: String(taxDeclaration.previousEmployerTdsAnnual ?? ""),
      otherIncomeAnnual: String(taxDeclaration.otherIncomeAnnual ?? ""),
      housingLoanInterestAnnual: String(taxDeclaration.housingLoanInterestAnnual ?? ""),
      hraExemptionAnnual: String(taxDeclaration.hraExemptionAnnual ?? ""),
      deduction80cAnnual: String(taxDeclaration.deduction80cAnnual ?? ""),
      deduction80ccd1bAnnual: String(taxDeclaration.deduction80ccd1bAnnual ?? ""),
      deduction80dAnnual: String(taxDeclaration.deduction80dAnnual ?? ""),
      deduction80OtherAnnual: String(taxDeclaration.deduction80OtherAnnual ?? "")
    }));
    setHasSavedStatutoryDetails(Boolean(currentStatutory));
  };

  const fetchPayrollComponents = async (payGroupId: string, _refreshKey = 0) => {
    if (!payGroupId || !canManagePayroll) {
      setPayrollComponents([]);
      setPayrollComponentCodes([]);
      return;
    }

    const componentsRes = await getApiWithToken(
      `/payroll/salary-components?payGroupId=${payGroupId}`,
      null,
      {
        requiredPermissions: ["PAYROLL_CONFIG_MANAGE"],
        forceRefresh: Boolean(_refreshKey)
      }
    );

    const allRows: PayrollComponent[] = Array.isArray(componentsRes?.data)
      ? componentsRes.data
      : [];
    setPayrollComponentCodes(
      allRows.map((row) => String(row.code || "").trim().toUpperCase()).filter(Boolean)
    );

    const rows = allRows
      .filter((row) => !ADVANCED_COMPONENT_EXCLUDE.has(String(row.code || "").toUpperCase()))
      .sort((a, b) => String(a.code || "").localeCompare(String(b.code || "")));

    setPayrollComponents(rows);
    setComponentOverrides((prev) => {
      const next = { ...prev };
      for (const component of rows) {
        const key = String(component.code || "").toUpperCase();
        const sourceOverride = buildComponentOverrideState(component);
        const existingOverride = prev[key];
        if (!existingOverride) {
          next[key] = sourceOverride;
          continue;
        }

        next[key] = {
          ...sourceOverride,
          enabled:
            typeof existingOverride.enabled === "boolean" ? existingOverride.enabled : sourceOverride.enabled,
          taxable:
            typeof existingOverride.taxable === "boolean" ? existingOverride.taxable : sourceOverride.taxable,
          name: existingOverride.name || sourceOverride.name,
          metadata: {
            ...sourceOverride.metadata,
            ...(existingOverride.metadata || {})
          }
        };
      }
      return next;
    });
  };

  useEffect(() => {
    if (!salaryAutoCalc) return;
    const annualCtc = Number(salaryForm.annualCtc || 0);
    if (!annualCtc || annualCtc <= 0) return;
    if (!salaryForm.payGroupId) return;
    const basicPercent = Math.max(1, Math.min(100, Number(effectiveBasicPercent || 50)));
    const monthlyCtc = Number((annualCtc / 12).toFixed(2));
    const derivedSalary = deriveGrossFromMonthlyCtc({
      monthlyCtc,
      basicPercent,
      epfMode: salaryForm.epfMode,
      epfFixedAmount: effectivePfEnabled ? Number(salaryForm.epfFixedAmount || 0) : 0,
      epfPercentOfBasic: effectivePfEnabled ? Number(salaryForm.epfPercentOfBasic || 12) : 0,
      restrictPfWage: salaryForm.restrictPfWage,
      pfWageCeiling: Number(salaryForm.pfWageCeiling || 15000),
      includeEsi: effectiveEsiEnabled,
      hraPercentOfBasic: effectiveHraEnabled ? Number(salaryForm.hraPercentOfBasic || 0) : 0,
      variablePayEnabled: salaryForm.variablePayEnabled,
      variablePayMode: salaryForm.variablePayMode,
      variablePayPercentOfCtc: Number(salaryForm.variablePayPercentOfCtc || 0),
      variablePayBaseCode: salaryForm.variablePayBaseCode,
      variablePayAmount: Number(salaryForm.variablePay || 0),
      variablePayRecognizedAmount:
        salaryForm.variablePayEnabled &&
        ["partial", "approved"].includes(String(salaryForm.variablePayApprovalStatus || "pending"))
          ? Number(salaryForm.variablePayApprovedAmount || 0)
          : 0
    });

    setSalaryForm((prev) => {
      const variablePayApprovalStatus = String(prev.variablePayApprovalStatus || "pending");
      const next = {
        ...prev,
        monthlyGross: String(derivedSalary.fixedGross ?? derivedSalary.monthlyGross),
        basicPay: String(derivedSalary.basicPay),
        variablePay: salaryForm.variablePayEnabled ? String(derivedSalary.variablePayTarget) : prev.variablePay,
        variablePayApprovedAmount:
          salaryForm.variablePayEnabled && ["partial", "approved"].includes(variablePayApprovalStatus)
            ? prev.variablePayApprovedAmount || String(derivedSalary.variablePayTarget)
            : prev.variablePayApprovedAmount
      };

      if (
        prev.monthlyGross === next.monthlyGross &&
        prev.basicPay === next.basicPay &&
        prev.variablePay === next.variablePay &&
        prev.variablePayApprovedAmount === next.variablePayApprovedAmount
      ) {
        return prev;
      }
      return next;
    });
  }, [
    salaryAutoCalc,
    salaryForm.annualCtc,
    salaryForm.payGroupId,
    salaryForm.hraPercentOfBasic,
    salaryForm.epfMode,
    salaryForm.epfPercentOfBasic,
    salaryForm.epfFixedAmount,
    salaryForm.restrictPfWage,
    salaryForm.pfWageCeiling,
    effectiveEsiEnabled,
    effectivePfEnabled,
    salaryForm.variablePayEnabled,
    salaryForm.variablePayMode,
    salaryForm.variablePayPercentOfCtc,
    salaryForm.variablePayBaseCode,
    salaryForm.variablePay,
    salaryForm.variablePayApprovedAmount,
    salaryForm.variablePayApprovalStatus,
    effectiveBasicPercent,
    effectiveHraEnabled
  ]);

  const variablePayReleaseMonthsInput = Number(
    salaryForm.variablePayReleaseMonths || salaryForm.variablePayReleaseOption || 12
  );
  const variablePayReleaseMonths = Number.isFinite(variablePayReleaseMonthsInput)
    ? Math.max(1, variablePayReleaseMonthsInput)
    : 12;
  const variablePayTargetAmount = Number(salaryBreakdown.variablePay || 0);
  const variablePayApprovedAmountValue = Number(salaryForm.variablePayApprovedAmount || 0);
  const approvedVariablePayFieldError =
    salaryForm.variablePayEnabled &&
    ["partial", "approved"].includes(String(salaryForm.variablePayApprovalStatus || "pending").toLowerCase()) &&
    Number.isFinite(variablePayApprovedAmountValue) &&
    variablePayApprovedAmountValue - variablePayTargetAmount > 0.01
      ? `Approved variable pay cannot exceed ${formatInr(variablePayTargetAmount)}`
      : "";
  const variablePayReleaseAmount = Number(
    (Number(salaryBreakdown.variablePayApprovedAmount || 0) * variablePayReleaseMonths).toFixed(2)
  );
  const isVariablePayPercentageMode =
    salaryForm.variablePayMode === "percentage" || salaryForm.variablePayMode === "ctc_percentage";

  const shouldShowLastWorkingDay =
    isEdit &&
    (form.employmentLifecycleStatus === "notice" ||
      form.employmentLifecycleStatus === "terminated");
  const isConfirmedLifecycle = isEdit && form.employmentLifecycleStatus === "confirmed";

  /* ================= SUBMIT ================= */

  const getLifecycleAction = (status: string) => {
    if (status === "confirmed") return "confirm";
    if (status === "notice") return "terminate_with_notice";
    if (status === "terminated") return "terminate_without_notice";
    return "";
  };

  const clearFieldError = (field: string) => {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const getFieldError = (field: string) => fieldErrors[field] || "";

  const showValidationToast = (errors: Record<string, string>) => {
    const count = Object.keys(errors).length;
    toast.error(
      count === 1
        ? "Please fix the highlighted field"
        : `Please fix the ${count} highlighted fields`
    );
  };

  const mapSaveResponseToFieldErrors = (message: string) => {
    const normalizedMessage = message.toLowerCase();
    const responseFieldErrors: Record<string, string> = {};

    if (normalizedMessage.includes("employee code already exists")) {
      responseFieldErrors.employeeCode = "This employee code already exists";
    }
    if (
      normalizedMessage.includes("user already exists") ||
      normalizedMessage.includes("email already exists") ||
      normalizedMessage.includes("email must be a valid email")
    ) {
      responseFieldErrors.email = normalizedMessage.includes("valid email")
        ? "Enter a valid email address"
        : "This email is already registered";
    }
    if (normalizedMessage.includes("first name")) {
      responseFieldErrors.firstName = message;
    }
    if (normalizedMessage.includes("last name")) {
      responseFieldErrors.lastName = message;
    }
    if (normalizedMessage.includes("department")) {
      responseFieldErrors.departmentId = message;
    }
    if (normalizedMessage.includes("designation")) {
      responseFieldErrors.designationId = message;
    }
    if (normalizedMessage.includes("dateofjoining") || normalizedMessage.includes("date of joining")) {
      responseFieldErrors.dateOfJoining = message;
    }
    if (normalizedMessage.includes("employmenttype") || normalizedMessage.includes("employment type")) {
      responseFieldErrors.employmentType = message;
    }
    if (normalizedMessage.includes("roleids") || normalizedMessage.includes("role ids")) {
      responseFieldErrors.roleIds = message;
    }
    if (normalizedMessage.includes("phone")) {
      if (normalizedMessage.includes("emergency")) {
        responseFieldErrors.emergencyPhone = message;
      } else {
        responseFieldErrors.phone = message;
      }
    }
    if (normalizedMessage.includes("aadhaar")) {
      responseFieldErrors.aadhaarNumber = message;
    }
    if (normalizedMessage.includes("pan")) {
      responseFieldErrors.panNumber = message;
    }
    if (normalizedMessage.includes("zip")) {
      responseFieldErrors.addressZip = message;
    }
    if (normalizedMessage.includes("city")) {
      responseFieldErrors.addressCity = message;
    }
    if (normalizedMessage.includes("state")) {
      responseFieldErrors.addressState = message;
    }
    if (normalizedMessage.includes("country")) {
      responseFieldErrors.addressCountry = message;
    }
    if (normalizedMessage.includes("lastworkingday") || normalizedMessage.includes("last working day")) {
      responseFieldErrors.lastWorkingDay = message;
    }
    if (
      normalizedMessage.includes("approved variable pay cannot exceed") ||
      normalizedMessage.includes("approved variable pay amount must be a valid number")
    ) {
      responseFieldErrors.variablePayApprovedAmount = message;
    }
    if (normalizedMessage.includes("emergency contact")) {
      if (normalizedMessage.includes("name")) responseFieldErrors.emergencyName = message;
      if (normalizedMessage.includes("relation")) responseFieldErrors.emergencyRelation = message;
      if (normalizedMessage.includes("phone")) responseFieldErrors.emergencyPhone = message;
    }

    return responseFieldErrors;
  };

  const handleSubmit = async () => {
    const nextFieldErrors: Record<string, string> = {};

    if (
      !form.email.trim() ||
      !form.firstName.trim() ||
      !form.lastName.trim() ||
      !form.departmentId ||
      !form.designationId ||
      !form.roleIds?.length ||
      !form.employmentType ||
      !form.dateOfJoining
    ) {
      if (!form.email.trim()) nextFieldErrors.email = "Email is required";
      if (!form.firstName.trim()) nextFieldErrors.firstName = "First name is required";
      if (!form.lastName.trim()) nextFieldErrors.lastName = "Last name is required";
      if (!form.departmentId) nextFieldErrors.departmentId = "Department is required";
      if (!form.designationId) nextFieldErrors.designationId = "Designation is required";
      if (!form.roleIds?.length) nextFieldErrors.roleIds = "Select at least one role";
      if (!form.employmentType) nextFieldErrors.employmentType = "Employment type is required";
      if (!form.dateOfJoining) nextFieldErrors.dateOfJoining = "Date of joining is required";
    }

    if (isEdit && form.phone.trim() && !INDIAN_MOBILE_REGEX.test(form.phone.trim())) {
      nextFieldErrors.phone = "Enter a valid 10-digit Indian mobile number";
    }
    if (isEdit && form.aadhaarNumber.trim() && !/^\d{12}$/.test(form.aadhaarNumber.trim())) {
      nextFieldErrors.aadhaarNumber = "Aadhaar number must be 12 digits";
    }
    if (isEdit && form.panNumber.trim() && !/^[A-Za-z]{5}[0-9]{4}[A-Za-z]{1}$/.test(form.panNumber.trim())) {
      nextFieldErrors.panNumber = "PAN number format is invalid";
    }
    if (isEdit && form.address.zip.trim() && !/^\d+$/.test(form.address.zip.trim())) {
      nextFieldErrors.addressZip = "PIN/Zip code must contain only numbers";
    }
    if (isEdit && form.address.city.trim() && !PLACE_NAME_REGEX.test(form.address.city.trim())) {
      nextFieldErrors.addressCity = "City must contain only letters";
    }
    if (isEdit && form.address.state.trim() && !PLACE_NAME_REGEX.test(form.address.state.trim())) {
      nextFieldErrors.addressState = "State must contain only letters";
    }
    if (isEdit && form.address.country.trim() && !PLACE_NAME_REGEX.test(form.address.country.trim())) {
      nextFieldErrors.addressCountry = "Country must contain only letters";
    }
    if (isEdit && shouldShowLastWorkingDay && !form.lastWorkingDay) {
      nextFieldErrors.lastWorkingDay = "Last working day is required";
    }
    if (isEdit) {
      const emergency = form.emergencyContacts[0];
      const hasEmergencyValue = Boolean(emergency?.name || emergency?.relation || emergency?.phone);
      if (hasEmergencyValue) {
        if (!emergency?.name) {
          nextFieldErrors.emergencyName = "Emergency contact name is required";
        } else if (!/^[A-Za-z ]{2,50}$/.test(emergency.name.trim())) {
          nextFieldErrors.emergencyName = "Use only letters, 2-50 characters";
        }
        if (!emergency?.relation) {
          nextFieldErrors.emergencyRelation = "Emergency relation is required";
        }
        if (!emergency?.phone) {
          nextFieldErrors.emergencyPhone = "Emergency mobile number is required";
        } else if (!INDIAN_MOBILE_REGEX.test(emergency.phone.trim())) {
          nextFieldErrors.emergencyPhone = "Enter a valid 10-digit Indian mobile number";
        }
      }
    }

    setFieldErrors(nextFieldErrors);
    if (Object.keys(nextFieldErrors).length > 0) {
      showValidationToast(nextFieldErrors);
      return;
    }

    const payload = {
      email: form.email,
      roleIds: form.roleIds,
      firstName: form.firstName,
      lastName: form.lastName,
      employeeCode: form.employeeCode?.trim() ? form.employeeCode.trim().toUpperCase() : undefined,
      departmentId: form.departmentId,
      designationId: form.designationId,
      managerId: form.managerId || undefined,
      leaveApprovalFlowId: form.leaveApprovalFlowId || null,
      attendanceApprovalFlowId: form.attendanceApprovalFlowId || null,
      shiftId: form.shiftId || undefined,
      employmentType: form.employmentType,
      dateOfJoining: form.dateOfJoining,
      ...(profileImageUpload ? { profileImageUpload } : {}),
      ...(isEdit
        ? {
            phone: form.phone.trim(),
            confirmedDate: form.confirmedDate || null,
            lastWorkingDay: shouldShowLastWorkingDay ? form.lastWorkingDay : null,
            dob: form.dob || undefined,
            gender: form.gender || undefined,
            bloodGroup: form.bloodGroup || undefined,
            aadhaarNumber: form.aadhaarNumber.trim(),
            panNumber: form.panNumber.trim().toUpperCase(),
            address: form.address,
            emergencyContacts: form.emergencyContacts.filter((c) => c.name && c.relation && c.phone)
          }
        : {}),
      ...(isEdit && form.employmentLifecycleStatus === "probation"
        ? { employmentLifecycleStatus: "probation" }
        : {}),
    };

    setLoading(true);
    const res = isEdit
      ? await putApiWithToken(`/employees/${id}`, payload)
      : await postApiWithToken("/employees", payload);

    if (
      isEdit &&
      res?.success &&
      form.employmentLifecycleStatus !== originalLifecycleStatus
    ) {
      const action = getLifecycleAction(form.employmentLifecycleStatus);
      if (action) {
        const lifecycleRes = await putApiWithToken(
          `/employees/${id}/lifecycle-action`,
          {
            action,
            ...(isConfirmedLifecycle ? { confirmedDate: form.confirmedDate } : {}),
            ...(shouldShowLastWorkingDay ? { lastWorkingDay: form.lastWorkingDay } : {})
          }
        );
        if (!lifecycleRes?.success) {
          setLoading(false);
          toast.error(lifecycleRes?.message || "Employee updated but lifecycle action failed");
          return;
        }
      }
    }
    setLoading(false);

    if (res?.success) {
      setFieldErrors({});
      toast.success(isEdit ? "Employee updated" : "Employee created & onboarding email sent");
      if (isEdit && res?.data?._id) {
        sessionStorage.setItem("employees:last-updated", JSON.stringify(res.data));
        setEditableSections((prev) => ({ ...prev, employee: false }));
        setProfileImageUpload(null);
        fetchEmployee();
        return;
      }
      navigate("/employees");
    } else {
      const message = String(res?.message || "");
      const responseFieldErrors = mapSaveResponseToFieldErrors(message);
      if (Object.keys(responseFieldErrors).length > 0) {
        setFieldErrors((prev) => ({ ...prev, ...responseFieldErrors }));
        showValidationToast(responseFieldErrors);
        return;
      }
      toast.error(res?.message || "Failed to save employee");
    }
  };

  const handleSaveSalary = async () => {
    if (!isEdit || !id) {
      toast.error("Create employee first, then configure salary details");
      return;
    }
    if (!canManagePayroll) {
      toast.error("You do not have payroll configuration permission");
      return;
    }
    if (!salaryForm.payGroupId) {
      const nextErrors = { payGroupId: "Pay group is required" };
      setFieldErrors((prev) => ({ ...prev, ...nextErrors }));
      showValidationToast(nextErrors);
      return;
    }
    if (!salaryForm.annualCtc) {
      const nextErrors = { annualCtc: "Annual CTC is required" };
      setFieldErrors((prev) => ({ ...prev, ...nextErrors }));
      showValidationToast(nextErrors);
      return;
    }
    const componentOverrideErrors = validateEnabledComponentOverrides();
    if (Object.keys(componentOverrideErrors).length > 0) {
      setFieldErrors((prev) => ({ ...prev, ...componentOverrideErrors }));
      showValidationToast(componentOverrideErrors);
      return;
    }
    const currentSalary = getOpenSalaryRevision(salaryStructures);
    const selectedSalaryStructure =
      salaryStructures.find((row) => row.id === selectedSalaryStructureId) || currentSalary;
    const salaryStructureIdToUpdate = selectedSalaryStructureId || currentSalary?.id || "";
    const currentEffectiveFrom = normalizePayrollDate(currentSalary?.effective_from);
    const shouldCreateRevision = salaryEditMode === "revision" || !salaryStructureIdToUpdate;

    if (shouldCreateRevision && currentEffectiveFrom && salaryForm.effectiveFrom && salaryForm.effectiveFrom <= currentEffectiveFrom) {
      toast.error(
        `Choose a date after ${currentEffectiveFrom} to create a new salary revision and keep the old CTC in history.`
      );
      return;
    }
    if (
      shouldCreateRevision &&
      salaryStructures.some((row) => normalizePayrollDate(row.effective_from) === salaryForm.effectiveFrom)
    ) {
      toast.error("A salary revision already exists for this effective date. Choose a different date.");
      return;
    }
    if (!shouldCreateRevision && selectedSalaryRevisionIsClosed) {
      toast.error("Can't switch to older revision. Older completed revisions are view-only. Create a new revision for salary changes.");
      return;
    }

    const variablePayApprovalStatus = String(salaryForm.variablePayApprovalStatus || "pending").toLowerCase();
    const variablePayTargetAmount = Number(salaryBreakdown.variablePay || 0);
    const approvedVariablePayAmount = Number(salaryForm.variablePayApprovedAmount || 0);
    if (salaryForm.variablePayEnabled && ["partial", "approved"].includes(variablePayApprovalStatus)) {
      if (!Number.isFinite(approvedVariablePayAmount) || approvedVariablePayAmount < 0) {
        const nextErrors = { variablePayApprovedAmount: "Enter a valid approved variable pay amount" };
        setFieldErrors((prev) => ({ ...prev, ...nextErrors }));
        showValidationToast(nextErrors);
        return;
      }
      if (approvedVariablePayAmount - variablePayTargetAmount > 0.01) {
        const nextErrors = {
          variablePayApprovedAmount: `Approved variable pay cannot exceed ${formatInr(variablePayTargetAmount)}`
        };
        setFieldErrors((prev) => ({ ...prev, ...nextErrors }));
        showValidationToast(nextErrors);
        return;
      }
    }
    setSavingSalary(true);
    try {
      let profileId = payrollProfileId;
      if (!profileId) {
        const createProfileRes = await postApiWithToken(
          "/payroll/employee-profiles",
          {
            employeeExternalId: id,
            employeeCode: form.employeeCode || undefined,
            payGroupId: salaryForm.payGroupId,
            payrollStatus: salaryForm.payrollStatus,
            defaultPaymentMode: salaryForm.defaultPaymentMode,
            taxRegime: salaryForm.taxRegime,
            dateOfJoining: form.dateOfJoining || undefined
          },
          null,
          { requiredPermissions: ["PAYROLL_CONFIG_MANAGE"] }
        );

        if (!createProfileRes?.success || !createProfileRes?.data?.id) {
          toast.error(createProfileRes?.message || "Failed to create payroll profile");
          return;
        }
        profileId = createProfileRes.data.id;
        setPayrollProfileId(profileId);
      } else {
        const updateProfileRes = await putApiWithToken(
          `/payroll/employee-profiles/${profileId}`,
          {
            payGroupId: salaryForm.payGroupId,
            payrollStatus: salaryForm.payrollStatus,
            defaultPaymentMode: salaryForm.defaultPaymentMode,
            taxRegime: salaryForm.taxRegime
          },
          null,
          { requiredPermissions: ["PAYROLL_CONFIG_MANAGE"] }
        );
        if (!updateProfileRes?.success) {
          toast.error(updateProfileRes?.message || "Failed to update payroll profile");
          return;
        }
      }

      const salaryPayload = {
          structureName: "Standard Structure",
          annualCtc: Number(salaryForm.annualCtc),
          monthlyGross: salaryBreakdown.grossBeforeVariablePay ? Number(salaryBreakdown.grossBeforeVariablePay) : null,
          basicPay: salaryForm.basicPay ? Number(salaryForm.basicPay) : null,
          variablePay: salaryForm.variablePayEnabled ? Number(salaryBreakdown.variablePayApprovedAmount || 0) : 0,
          isCurrent:
            shouldCreateRevision ||
            Boolean(
              selectedSalaryStructure?.id &&
                selectedSalaryStructure.id === openSalaryRevision?.id
            ),
          revisionReason: salaryForm.revisionReason || "Salary update",
          metadata: {
            salaryRules: {
              componentOverrides: Object.fromEntries(
                getEffectiveComponentOverrideEntries()
                  .filter(([, override]) => Boolean(override?.code))
                  .map(([code, override]) => [
                    code,
                    {
                      enabled: override.enabled,
                      scope: override.scope,
                      name: override.name,
                      calculationMode: override.calculationMode,
                      taxable: override.taxable,
                      amount:
                        override.amount === "" || override.amount == null
                          ? null
                          : Number(override.amount),
                      base: override.base || null,
                      formulaTemplate: override.formulaTemplate || "custom",
                      formulaExpression: override.formulaExpression || null,
                      metadata: override.metadata || null,
                      ...(String(code).toUpperCase() === "BONUS"
                        ? {
                            bonusCreditTiming: override.bonusCreditTiming || "after_probation",
                            bonusEligibilityDate:
                              override.bonusCreditTiming === "after_probation"
                                ? form.confirmedDate || override.bonusEligibilityDate || null
                                : override.bonusEligibilityDate || null,
                            bonusPayoutMonths: Number(override.bonusPayoutMonths || 1),
                            metadata: {
                              ...(override.metadata || {}),
                              bonusRule: {
                                creditTiming: override.bonusCreditTiming || "after_probation",
                                eligibilityDate:
                                  override.bonusCreditTiming === "after_probation"
                                    ? form.confirmedDate || override.bonusEligibilityDate || null
                                    : override.bonusEligibilityDate || null,
                                payoutMonths: Number(override.bonusPayoutMonths || 1)
                              }
                            }
                          }
                        : {})
                    }
                  ])
              ),
              basicPercentSource: salaryForm.basicPercentSource,
              payGroupBasicPercent,
              employeeBasicPercent:
                salaryForm.basicPercentSource === "employee"
                  ? Number(salaryForm.employeeBasicPercent || effectiveBasicPercent)
                  : null,
              effectiveBasicPercent,
              includeHra: effectiveHraEnabled,
              hraPercentOfBasic: effectiveHraEnabled ? Number(salaryForm.hraPercentOfBasic || 0) : 0,
              includePf: effectivePfEnabled,
              epfMode: salaryForm.epfMode,
              epfPercentOfBasic: effectivePfEnabled ? Number(salaryForm.epfPercentOfBasic || 12) : 0,
              epfFixedAmount:
                effectivePfEnabled && salaryForm.epfMode === "fixed" ? Number(salaryForm.epfFixedAmount || 0) : null,
              restrictPfWage: salaryForm.restrictPfWage,
              pfWageCeiling: Number(salaryForm.pfWageCeiling || 15000),
              includeEsi: effectiveEsiEnabled,
              variablePayEnabled: salaryForm.variablePayEnabled,
              variablePayMode: salaryForm.variablePayEnabled
                ? salaryForm.variablePayMode
                : null,
              variablePayTargetMonthly: salaryForm.variablePayEnabled ? Number(salaryBreakdown.variablePay || 0) : 0,
              variablePayApprovedAmount: salaryForm.variablePayEnabled
                ? Number(salaryBreakdown.variablePayApprovedAmount || 0)
                : 0,
              variablePayPercentOfCtc:
                salaryForm.variablePayEnabled && isVariablePayPercentageMode
                  ? Number(salaryForm.variablePayPercentOfCtc || 0)
                  : null,
              variablePayBaseCode:
                salaryForm.variablePayEnabled && salaryForm.variablePayMode === "percentage"
                  ? String(salaryForm.variablePayBaseCode || "MONTHLY_GROSS").toUpperCase()
                  : null,
              variablePayReleaseMonths: salaryForm.variablePayEnabled
                ? variablePayReleaseMonths
                : null,
              variablePayReleasePolicy: salaryForm.variablePayEnabled
                ? "performance_based"
                : null,
              variablePayApprovalPolicy: salaryForm.variablePayEnabled
                ? "hr_can_approve_partial_or_full"
                : null,
              variablePayApprovalStatus: salaryForm.variablePayEnabled
                ? salaryForm.variablePayApprovalStatus
                : null,
              epfEmployeeRate: effectivePfEnabled ? Number(salaryForm.epfPercentOfBasic || 12) : 0,
              epfEmployerRate: effectivePfEnabled ? Number(salaryForm.epfPercentOfBasic || 12) : 0,
              esiEmployeeRate: 0.75,
              esiEmployerRate: 3.25,
              esiEligibilityThreshold: 21000
            }
          }
        };

      const saveSalaryRes = shouldCreateRevision
        ? await postApiWithToken(
            `/payroll/employee-profiles/${profileId}/salary-structures`,
            {
              structureCode: `SAL-${replaceText(new Date().toISOString().slice(0, 10), "-", "")}`,
              ...salaryPayload,
              effectiveFrom: salaryForm.effectiveFrom
            },
            null,
            { requiredPermissions: ["PAYROLL_CONFIG_MANAGE"] }
          )
        : await putApiWithToken(
            `/payroll/salary-structures/${salaryStructureIdToUpdate}`,
            {
              ...salaryPayload,
              effectiveFrom: salaryForm.effectiveFrom
            },
            null,
            { requiredPermissions: ["PAYROLL_CONFIG_MANAGE"] }
          );

      if (!saveSalaryRes?.success) {
        toast.error(saveSalaryRes?.message || "Failed to save salary structure");
        return;
      }

      setSavedSalarySetupFingerprint(
        buildSalarySetupFingerprint({
          salaryForm: {
            payGroupId: salaryForm.payGroupId,
            payrollStatus: salaryForm.payrollStatus,
            defaultPaymentMode: salaryForm.defaultPaymentMode,
            taxRegime: salaryForm.taxRegime,
            basicPercentSource: salaryForm.basicPercentSource,
            employeeBasicPercent: salaryForm.employeeBasicPercent,
            hraPercentOfBasic: salaryForm.hraPercentOfBasic,
            epfMode: salaryForm.epfMode,
            epfPercentOfBasic: salaryForm.epfPercentOfBasic,
            epfFixedAmount: salaryForm.epfFixedAmount,
            restrictPfWage: salaryForm.restrictPfWage,
            pfWageCeiling: salaryForm.pfWageCeiling,
            includeEsi: salaryForm.includeEsi,
            variablePayEnabled: salaryForm.variablePayEnabled,
            variablePayMode: salaryForm.variablePayMode,
            variablePayPercentOfCtc: salaryForm.variablePayPercentOfCtc,
            variablePayBaseCode: salaryForm.variablePayBaseCode,
            variablePayReleaseOption: salaryForm.variablePayReleaseOption,
            variablePayReleaseMonths: salaryForm.variablePayReleaseMonths,
            annualCtc: salaryForm.annualCtc,
            monthlyGross: salaryBreakdown.grossBeforeVariablePay,
            basicPay: salaryForm.basicPay,
            variablePay: salaryForm.variablePay,
            effectiveFrom: salaryForm.effectiveFrom,
            revisionReason: salaryForm.revisionReason
          },
          componentOverrides
        })
      );
      const successMessage =
        saveSalaryRes?.message ||
        (shouldCreateRevision ? "Salary revision created" : "Salary details updated");
      setSalarySaveNotice(successMessage);
      toast.success(successMessage);
      setEditableSections((prev) => ({ ...prev, salary: false }));
      fetchPayrollData();
    } finally {
      setSavingSalary(false);
    }
  };

  const handleSaveBank = async () => {
    if (!isEdit || !id) {
      toast.error("Create employee first, then configure bank details");
      return;
    }
    if (isSectionReadOnly("bank")) {
      toast.error("Click Edit in Bank Details before saving");
      return;
    }
    if (!canManagePayroll) {
      toast.error("You do not have payroll configuration permission");
      return;
    }
    if (!bankForm.effectiveFrom) {
      toast.error("Effective From date is required for bank details");
      return;
    }
    if (bankForm.paymentMode === "bank_transfer") {
      if (
        !bankForm.accountHolderName ||
        !bankForm.bankName ||
        !bankForm.accountNumber ||
        !bankForm.ifscCode
      ) {
        toast.error("For bank transfer, account holder, bank name, account number, and IFSC are required");
        return;
      }
    }
    if (bankForm.paymentMode === "upi" && !bankForm.upiId) {
      toast.error("UPI ID is required when payment mode is UPI");
      return;
    }

    setSavingBank(true);
    try {
      let profileId = payrollProfileId;
      if (!profileId) {
        const createProfileRes = await postApiWithToken(
          "/payroll/employee-profiles",
          {
            employeeExternalId: id,
            employeeCode: form.employeeCode || undefined,
            payGroupId: salaryForm.payGroupId || null,
            payrollStatus: salaryForm.payrollStatus,
            defaultPaymentMode: bankForm.paymentMode,
            taxRegime: salaryForm.taxRegime,
            dateOfJoining: form.dateOfJoining || undefined
          },
          null,
          { requiredPermissions: ["PAYROLL_CONFIG_MANAGE"] }
        );

        if (!createProfileRes?.success || !createProfileRes?.data?.id) {
          toast.error(createProfileRes?.message || "Failed to create payroll profile");
          return;
        }
        profileId = createProfileRes.data.id;
        setPayrollProfileId(profileId);
      }

      const profileUpdateRes = await putApiWithToken(
        `/payroll/employee-profiles/${profileId}`,
        {
          defaultPaymentMode: bankForm.paymentMode
        },
        null,
        { requiredPermissions: ["PAYROLL_CONFIG_MANAGE"] }
      );
      if (!profileUpdateRes?.success) {
        toast.error(profileUpdateRes?.message || "Failed to update payroll profile payment mode");
        return;
      }

      const saveBankRes = await postApiWithToken(
        `/payroll/employee-profiles/${profileId}/bank-details`,
        {
          accountHolderName: bankForm.accountHolderName || null,
          bankName: bankForm.bankName || null,
          branchName: bankForm.branchName || null,
          accountNumber: bankForm.accountNumber || null,
          ifscCode: bankForm.ifscCode || null,
          accountType: bankForm.accountType,
          paymentMode: bankForm.paymentMode,
          upiId: bankForm.upiId || null,
          isPrimary: bankForm.isPrimary,
          isVerified: bankForm.isVerified,
          effectiveFrom: bankForm.effectiveFrom
        },
        null,
        { requiredPermissions: ["PAYROLL_CONFIG_MANAGE"] }
      );

      if (!saveBankRes?.success) {
        toast.error(saveBankRes?.message || "Failed to save bank details");
        return;
      }

      const bankAction = String(saveBankRes.data?.saveAction || "");
      toast.success(
        bankAction === "updated_current"
          ? "Current bank details updated"
          : bankAction === "created_revision"
            ? "New bank revision created"
            : "Bank details saved"
      );
      setEditableSections((prev) => ({ ...prev, bank: false }));
      fetchPayrollData();
    } finally {
      setSavingBank(false);
    }
  };

  const handleSaveStatutory = async () => {
    if (!isEdit || !id) {
      toast.error("Create employee first, then configure tax and statutory details");
      return;
    }
    if (!canManagePayroll) {
      toast.error("You do not have payroll configuration permission");
      return;
    }
    if (!statutoryForm.effectiveFrom) {
      toast.error("Effective From date is required for statutory details");
      return;
    }

    setSavingStatutory(true);
    try {
      let profileId = payrollProfileId;
      if (!profileId) {
        const createProfileRes = await postApiWithToken(
          "/payroll/employee-profiles",
          {
            employeeExternalId: id,
            employeeCode: form.employeeCode || undefined,
            payGroupId: salaryForm.payGroupId || null,
            payrollStatus: salaryForm.payrollStatus,
            defaultPaymentMode: salaryForm.defaultPaymentMode,
            taxRegime: salaryForm.taxRegime,
            dateOfJoining: form.dateOfJoining || undefined
          },
          null,
          { requiredPermissions: ["PAYROLL_CONFIG_MANAGE"] }
        );

        if (!createProfileRes?.success || !createProfileRes?.data?.id) {
          toast.error(createProfileRes?.message || "Failed to create payroll profile");
          return;
        }
        profileId = createProfileRes.data.id;
        setPayrollProfileId(profileId);
      }

      const res = await postApiWithToken(
        `/payroll/employee-profiles/${profileId}/statutory-details`,
        {
          pan: statutoryForm.pan || null,
          aadhaar: statutoryForm.aadhaar || null,
          uan: statutoryForm.uan || null,
          esicNumber: statutoryForm.esicNumber || null,
          pfMember: statutoryForm.pfMember,
          epsEligible: statutoryForm.epsEligible,
          esiEligible: statutoryForm.esiEligible,
          professionalTaxApplicable: statutoryForm.professionalTaxApplicable,
          lwfApplicable: statutoryForm.lwfApplicable,
          taxRegime: salaryForm.taxRegime,
          declarationSubmitted: statutoryForm.declarationSubmitted,
          effectiveFrom: statutoryForm.effectiveFrom,
          metadata: {
            taxDeclaration: {
              previousEmployerIncomeAnnual:
                statutoryForm.previousEmployerIncomeAnnual === ""
                  ? null
                  : Number(statutoryForm.previousEmployerIncomeAnnual),
              previousEmployerTdsAnnual:
                statutoryForm.previousEmployerTdsAnnual === ""
                  ? null
                  : Number(statutoryForm.previousEmployerTdsAnnual),
              otherIncomeAnnual:
                statutoryForm.otherIncomeAnnual === ""
                  ? null
                  : Number(statutoryForm.otherIncomeAnnual),
              housingLoanInterestAnnual:
                statutoryForm.housingLoanInterestAnnual === ""
                  ? null
                  : Number(statutoryForm.housingLoanInterestAnnual),
              hraExemptionAnnual:
                statutoryForm.hraExemptionAnnual === ""
                  ? null
                  : Number(statutoryForm.hraExemptionAnnual),
              deduction80cAnnual:
                statutoryForm.deduction80cAnnual === ""
                  ? null
                  : Number(statutoryForm.deduction80cAnnual),
              deduction80ccd1bAnnual:
                statutoryForm.deduction80ccd1bAnnual === ""
                  ? null
                  : Number(statutoryForm.deduction80ccd1bAnnual),
              deduction80dAnnual:
                statutoryForm.deduction80dAnnual === ""
                  ? null
                  : Number(statutoryForm.deduction80dAnnual),
              deduction80OtherAnnual:
                statutoryForm.deduction80OtherAnnual === ""
                  ? null
                  : Number(statutoryForm.deduction80OtherAnnual)
            }
          }
        },
        null,
        { requiredPermissions: ["PAYROLL_CONFIG_MANAGE"] }
      );

      if (!res?.success) {
        toast.error(res?.message || "Failed to save statutory details");
        return;
      }

      toast.success("Tax and statutory details saved");
      setEditableSections((prev) => ({ ...prev, statutory: false }));
      fetchPayrollData();
    } finally {
      setSavingStatutory(false);
    }
  };

  const lookupBankByIfsc = async (ifscInput?: string) => {
    if (!canManagePayroll) return;
    const ifsc = String(ifscInput ?? bankForm.ifscCode ?? "")
      .trim()
      .toUpperCase();
    if (ifsc.length !== 11) return;

    setLookingUpIfsc(true);
    try {
      const res = await getApiWithToken(`/payroll/bank-details/lookup/by-ifsc/${ifsc}`, null, {
        requiredPermissions: ["PAYROLL_CONFIG_MANAGE"]
      });
      if (!res?.success || !res?.data) return;

      const bankName = String(res.data.bankName || "").trim();
      const branchName = String(res.data.branchName || "").trim();
      if (!bankName && !branchName) return;

      setBankForm((prev) => ({
        ...prev,
        ifscCode: ifsc,
        bankName: bankName || prev.bankName,
        branchName: branchName || prev.branchName
      }));
      toast.success("Bank and branch details fetched from IFSC");
    } finally {
      setLookingUpIfsc(false);
    }
  };

  const lookupBankByAccount = async (accountInput?: string) => {
    if (!canManagePayroll) return;
    const accountNumber = String(accountInput ?? bankForm.accountNumber ?? "").trim();
    if (accountNumber.length < 6) return;

    setLookingUpAccount(true);
    try {
      const res = await getApiWithToken(
        `/payroll/bank-details/lookup/by-account?accountNumber=${encodeURIComponent(accountNumber)}`,
        null,
        { requiredPermissions: ["PAYROLL_CONFIG_MANAGE"] }
      );
      if (!res?.success || !res?.data) return;

      const row = res.data;
      setBankForm((prev) => ({
        ...prev,
        accountHolderName: row.account_holder_name || prev.accountHolderName || "",
        bankName: row.bank_name || prev.bankName || "",
        branchName: row.branch_name || prev.branchName || "",
        ifscCode: row.ifsc_code || prev.ifscCode || "",
        accountType: row.account_type || prev.accountType || prev.accountType,
        paymentMode: row.payment_mode || prev.paymentMode || prev.paymentMode
      }));
      toast.success("Existing bank details found for this account number");
    } finally {
      setLookingUpAccount(false);
    }
  };

  /* ================= UI ================= */

  return (
    <MainLayout
      title={isEdit ? "Edit Employee" : "Add Employee"}
      breadcrumb={[
        { label: "Home", href: "/" },
        { label: "Employees", href: "/employees" },
        { label: isEdit ? "Edit Employee" : "Add Employee" },
      ]}
    >
      {!isEdit && (departments.length === 0 || designations.length === 0) && (
        <div className="mb-6 bg-card rounded-xl card-shadow p-4">
          <p className="text-sm text-muted-foreground mb-3">
            Please add {departments.length === 0 ? "a department" : "a designation"} before creating an employee.
          </p>
          <div className="flex gap-2">
            {departments.length === 0 && (
              <Button type="button" onClick={() => navigate("/departments")}>
                Add Department
              </Button>
            )}
            {designations.length === 0 && (
              <Button type="button" variant="outline" onClick={() => navigate("/designations")}>
                Add Designation
              </Button>
            )}
          </div>
        </div>
      )}

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          if (activeTab === "salary" && salaryHasUnsavedChanges) {
            const discard = window.confirm(
              "You have unsaved salary changes. Switch tabs without saving?"
            );
            if (!discard) return;
          }
          setActiveTab(value);
        }}
        className="w-full"
      >
        <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => navigate("/employees")}
              className="flex items-center gap-2 whitespace-nowrap text-muted-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <TabsList className="h-auto rounded-lg border bg-muted/40 p-1">
              <TabsTrigger
                value="employee"
                className="rounded-md px-4 py-2 font-medium text-muted-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
              >
                Personal & Employee Details
              </TabsTrigger>
              <TabsTrigger
                value="salary"
                className="rounded-md px-4 py-2 font-medium text-muted-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
              >
                Salary Details
              </TabsTrigger>
              <TabsTrigger
                value="bank"
                className="rounded-md px-4 py-2 font-medium text-muted-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
              >
                Bank Details
              </TabsTrigger>
              <TabsTrigger
                value="statutory"
                className="rounded-md px-4 py-2 font-medium text-muted-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
              >
                Tax & Statutory
              </TabsTrigger>
              {isEdit && (
                <TabsTrigger
                  value="idcard"
                  className="rounded-md px-4 py-2 font-medium text-muted-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
                >
                  ID Card
                </TabsTrigger>
              )}
            </TabsList>
          </div>

          {activeTab !== "salary" && isEdit && canEditActiveSection && (
            <div className="flex items-center gap-2 self-start xl:self-auto">
              {activeSectionReadOnly ? (
                <Button type="button" size="sm" className="gap-2" onClick={enableActiveSectionEdit}>
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </Button>
              ) : (
                <>
                  <Button type="button" size="sm" variant="outline" onClick={cancelActiveSectionEdit}>
                    Cancel
                  </Button>
                  <Badge variant="secondary" className="rounded-md px-3 py-2">
                    Editing {activeSectionLabel}
                  </Badge>
                </>
              )}
            </div>
          )}
        </div>

        <TabsContent value="employee">
          <fieldset
            disabled={isSectionReadOnly("employee")}
            className="stat-card grid grid-cols-1 md:grid-cols-2 gap-4 disabled:opacity-100"
          >
        {isEdit && (
          <div className="md:col-span-2 flex items-center gap-3 rounded-md border bg-muted/40 px-3 py-2">
            <Avatar className="h-12 w-12">
              <AvatarImage src={profileImageUrl || ""} />
              <AvatarFallback>
                {`${form.firstName?.[0] || ""}${form.lastName?.[0] || ""}`}
              </AvatarFallback>
            </Avatar>
            <div className="text-sm">
              <p className="font-medium">Profile Photo</p>
              <p className="text-muted-foreground">
                {profileImageUrl ? "Current profile image is shown." : "No profile image uploaded yet."}
              </p>
            </div>
          </div>
        )}

        {isEdit && (
          <div className="md:col-span-2">
            <Label>Profile Picture</Label>
            <Input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (!validateProfileImage(file)) {
                  e.target.value = "";
                  return;
                }
                const base64Data = await fileToBase64(file);
                setProfileImageUpload({
                  fileName: file.name,
                  mimeType: file.type,
                  base64Data
                });
                setProfileImageUrl(URL.createObjectURL(file));
              }}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Admin can replace the employee profile picture. JPG, PNG, or WebP up to 2MB.
            </p>
          </div>
        )}

        <div className="md:col-span-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Organization policy: probation {orgProbationDays} days, notice {orgNoticeDays} days.
          {!isEdit ? " New employees start in probation automatically." : ""}
        </div>

        <div>
          <Label>
            Email <span className="text-red-600">*</span>
          </Label>
          <Input
            validationType="email"
            infoText="Enter a valid email address. Spaces are removed and letters are stored in lowercase."
            value={form.email}
            onChange={(e) => {
              clearFieldError("email");
              setForm({ ...form, email: e.target.value });
            }}
            placeholder="employee@email.com"
            required
          />
          {getFieldError("email") && <p className="mt-1 text-xs text-red-600">{getFieldError("email")}</p>}
        </div>

        <div>
          <Label>
            Employee Code
          </Label>
          <Input
            validationType="code"
            infoText="Allowed characters: A-Z, 0-9, underscore and hyphen. Leave empty to auto-generate."
            value={form.employeeCode}
            onChange={(e) => {
              clearFieldError("employeeCode");
              setForm({ ...form, employeeCode: e.target.value.toUpperCase() });
            }}
            placeholder={!isEdit ? `${orgEmployeeCodePrefix}-0001 (optional)` : ""}
          />
          {getFieldError("employeeCode") && <p className="mt-1 text-xs text-red-600">{getFieldError("employeeCode")}</p>}
          <p className="mt-1 text-xs text-muted-foreground">
            Must be unique within this organization. Leave empty to auto-generate.
          </p>
        </div>

        <div>
          <Label>
            First Name <span className="text-red-600">*</span>
          </Label>
          <Input
            value={form.firstName}
            validationType="name"
            infoText="Use letters and spaces only."
            onChange={(e) => {
              clearFieldError("firstName");
              setForm({ ...form, firstName: e.target.value });
            }}
            required
          />
          {getFieldError("firstName") && <p className="mt-1 text-xs text-red-600">{getFieldError("firstName")}</p>}
        </div>

        <div>
          <Label>
            Last Name <span className="text-red-600">*</span>
          </Label>
          <Input
            value={form.lastName}
            validationType="name"
            infoText="Use letters and spaces only."
            onChange={(e) => {
              clearFieldError("lastName");
              setForm({ ...form, lastName: e.target.value });
            }}
            required
          />
          {getFieldError("lastName") && <p className="mt-1 text-xs text-red-600">{getFieldError("lastName")}</p>}
        </div>

        <div>
          <Label>
            Department <span className="text-red-600">*</span>
          </Label>
          <Select
            value={form.departmentId}
            onValueChange={(v) => {
              if (v === "__create__") {
                navigate("/departments");
                return;
              }
              clearFieldError("departmentId");
              setForm({ ...form, departmentId: v });
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select Department" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__create__">+ Create Department</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d._id} value={d._id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {getFieldError("departmentId") && <p className="mt-1 text-xs text-red-600">{getFieldError("departmentId")}</p>}
        </div>

        <div>
          <Label>
            Designation <span className="text-red-600">*</span>
          </Label>
          <Select
            value={form.designationId}
            onValueChange={(v) => {
              if (v === "__create__") {
                navigate("/designations");
                return;
              }
              clearFieldError("designationId");
              setForm({ ...form, designationId: v });
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select Designation" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__create__">+ Create Designation</SelectItem>
              {designations.map((d) => (
                <SelectItem key={d._id} value={d._id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {getFieldError("designationId") && <p className="mt-1 text-xs text-red-600">{getFieldError("designationId")}</p>}
        </div>

        <div>
          <Label>Reporting Manager</Label>
          <Select
            value={form.managerId}
            onValueChange={(v) =>
              setForm({ ...form, managerId: v === "none" ? "" : v })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Select Manager" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {managers.map((m) => (
                <SelectItem key={m._id} value={m._id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <div className="flex items-center gap-1 mb-1">
            <Label>Leave Approval Flow</Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent>
                Leave empty to use the organization default flow selected by your approval flow rules.
              </TooltipContent>
            </Tooltip>
          </div>
          <Select
            value={form.leaveApprovalFlowId || "none"}
            onValueChange={(v) =>
              setForm({ ...form, leaveApprovalFlowId: v === "none" ? "" : v })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Select Leave Approval Flow" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Use Organization Default</SelectItem>
              {leaveApprovalFlows.map((flow) => (
                <SelectItem key={flow._id} value={flow._id}>
                  {flow.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <div className="flex items-center gap-1 mb-1">
            <Label>Attendance Request Flow</Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent>
                Leave empty to use the organization default attendance request flow.
              </TooltipContent>
            </Tooltip>
          </div>
          <Select
            value={form.attendanceApprovalFlowId || "none"}
            onValueChange={(v) =>
              setForm({ ...form, attendanceApprovalFlowId: v === "none" ? "" : v })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Select Attendance Request Flow" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Use Organization Default</SelectItem>
              {attendanceApprovalFlows.map((flow) => (
                <SelectItem key={flow._id} value={flow._id}>
                  {flow.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <div className="flex items-center gap-1 mb-1">
            <Label>Shift</Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent>
                Assign employee shift for late/early login calculations. If none selected, default 09:00-18:00 is used.
              </TooltipContent>
            </Tooltip>
          </div>
          <Select
            value={form.shiftId}
            onValueChange={(v) => {
              if (v === "__create__") {
                navigate("/shifts");
                return;
              }
              setForm({ ...form, shiftId: v === "none" ? "" : v });
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select Shift" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None (General 09:00-18:00)</SelectItem>
              <SelectItem value="__create__">+ Create Shift</SelectItem>
              {shifts.map((s) => (
                <SelectItem key={s._id} value={s._id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label>
            Roles <span className="text-red-600">*</span>
          </Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                role="combobox"
                className="mt-2 w-full justify-between"
              >
                {form.roleIds.length === 0
                  ? "Select roles"
                  : form.roleIds.length <= 2
                    ? roles
                        .filter((r) => form.roleIds.includes(r._id))
                        .map((r) => r.name)
                        .join(", ")
                    : `${form.roleIds.length} roles selected`}
                <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="p-0 w-[320px]" align="start">
              <Command>
                <CommandInput placeholder="Search roles..." />
                <CommandList>
                  <CommandEmpty>No roles found.</CommandEmpty>
                  <CommandGroup>
                    {roles.map((r) => {
                      const checked = form.roleIds.includes(r._id);
                      return (
                        <CommandItem
                          key={r._id}
                          onSelect={() => {
                            setForm((prev) => ({
                              ...prev,
                              roleIds: checked
                                ? (prev.roleIds || []).filter((id) => id !== r._id)
                                : Array.from(new Set([...(prev.roleIds || []), r._id])),
                            }));
                            clearFieldError("roleIds");
                          }}
                        >
                          <Checkbox checked={checked} className="mr-2" />
                          <span>{r.name}</span>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          {getFieldError("roleIds") && <p className="mt-1 text-xs text-red-600">{getFieldError("roleIds")}</p>}
        </div>

        <div>
          <Label>
            Employment Type <span className="text-red-600">*</span>
          </Label>
          <Select
            value={form.employmentType}
            onValueChange={(v) => {
              clearFieldError("employmentType");
              setForm({ ...form, employmentType: v });
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="full_time">Full Time</SelectItem>
              <SelectItem value="part_time">Part Time</SelectItem>
              <SelectItem value="contract">Contract</SelectItem>
            </SelectContent>
          </Select>
          {getFieldError("employmentType") && <p className="mt-1 text-xs text-red-600">{getFieldError("employmentType")}</p>}
        </div>

        <div>
          <Label>
            Date of Joining <span className="text-red-600">*</span>
          </Label>
          <Input
            type="date"
            value={form.dateOfJoining}
            onChange={(e) => {
              clearFieldError("dateOfJoining");
              setForm({ ...form, dateOfJoining: e.target.value });
            }}
          />
          {getFieldError("dateOfJoining") && <p className="mt-1 text-xs text-red-600">{getFieldError("dateOfJoining")}</p>}
        </div>

        {isEdit && (
          <div>
            <Label>Confirmed Date</Label>
            <div className="grid grid-cols-4 gap-2">
              <div className="col-span-3">
                <Input
                  type="date"
                  value={form.confirmedDate}
                  disabled={!isConfirmedLifecycle}
                  onChange={(e) =>
                    setForm({ ...form, confirmedDate: e.target.value })
                  }
                />
              </div>
              <div className="col-span-1">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={!form.confirmedDate}
                  onClick={() => setForm({ ...form, confirmedDate: "" })}
                >
                  Clear Confirmed Date
                </Button>
              </div>
            </div>
          </div>
        )}

        {isEdit && (
          <div className="md:col-span-2 space-y-3">
            <Label>
              Employment Lifecycle Status <span className="text-red-600">*</span>
            </Label>
            <Select
              value={form.employmentLifecycleStatus}
              onValueChange={(v) =>
                setForm({
                  ...form,
                  employmentLifecycleStatus: v,
                  lastWorkingDay:
                    v === "notice" || v === "terminated" ? form.lastWorkingDay : ""
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select lifecycle status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="probation">Probation</SelectItem>
                <SelectItem value="confirmed">Confirmed</SelectItem>
                <SelectItem value="notice">Notice</SelectItem>
                <SelectItem value="terminated">Terminated</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={form.employmentLifecycleStatus === "confirmed" ? "default" : "outline"}
                onClick={() =>
                  setForm({
                    ...form,
                    employmentLifecycleStatus: "confirmed",
                    lastWorkingDay: ""
                  })
                }
              >
                Confirm
              </Button>
              <Button
                type="button"
                size="sm"
                variant={form.employmentLifecycleStatus === "notice" ? "default" : "outline"}
                onClick={() =>
                  setForm({ ...form, employmentLifecycleStatus: "notice" })
                }
              >
                Terminate with Notice
              </Button>
              <Button
                type="button"
                size="sm"
                variant={form.employmentLifecycleStatus === "terminated" ? "destructive" : "outline"}
                onClick={() =>
                  setForm({ ...form, employmentLifecycleStatus: "terminated" })
                }
              >
                Terminate without Notice
              </Button>
            </div>
            {shouldShowLastWorkingDay && (
              <div>
                <Label>
                  Last Working Day <span className="text-red-600">*</span>
                </Label>
                <Input
                  type="date"
                  value={form.lastWorkingDay}
                  onChange={(e) => {
                    clearFieldError("lastWorkingDay");
                    setForm({ ...form, lastWorkingDay: e.target.value });
                  }}
                />
                {getFieldError("lastWorkingDay") && <p className="mt-1 text-xs text-red-600">{getFieldError("lastWorkingDay")}</p>}
              </div>
            )}
          </div>
        )}

        {isEdit && (
          <div className="md:col-span-2 mt-2 rounded-md border p-4">
            <div className="mb-4">
              <h3 className="text-base font-semibold">Personal Details</h3>
              <p className="text-sm text-muted-foreground">
                Admin can update phone, KYC, address, and emergency contact details.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Phone</Label>
                <Input
                  validationType="phone"
                  inputMode="numeric"
                  maxLength={10}
                  value={form.phone}
                  onChange={(e) => {
                    clearFieldError("phone");
                    setForm({ ...form, phone: e.target.value });
                  }}
                  placeholder="10-digit Indian mobile number"
                />
                {getFieldError("phone") && <p className="mt-1 text-xs text-red-600">{getFieldError("phone")}</p>}
              </div>

              <div>
                <Label>Date of Birth</Label>
                <Input
                  type="date"
                  value={form.dob}
                  onChange={(e) => setForm({ ...form, dob: e.target.value })}
                />
              </div>

              <div>
                <Label>Gender</Label>
                <Select
                  value={form.gender || "none"}
                  onValueChange={(v) => setForm({ ...form, gender: v === "none" ? "" : v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select gender" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not set</SelectItem>
                    <SelectItem value="Male">Male</SelectItem>
                    <SelectItem value="Female">Female</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Blood Group</Label>
                <Select
                  value={form.bloodGroup || "none"}
                  onValueChange={(v) => setForm({ ...form, bloodGroup: v === "none" ? "" : v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select blood group" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not set</SelectItem>
                    {BLOOD_GROUP_OPTIONS.map((group) => (
                      <SelectItem key={group} value={group}>
                        {group}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Aadhaar Number</Label>
                <Input
                  value={form.aadhaarNumber}
                  onChange={(e) => {
                    clearFieldError("aadhaarNumber");
                    setForm({ ...form, aadhaarNumber: e.target.value.replace(/\D/g, "").slice(0, 12) });
                  }}
                  placeholder="12 digit Aadhaar number"
                />
                {getFieldError("aadhaarNumber") && <p className="mt-1 text-xs text-red-600">{getFieldError("aadhaarNumber")}</p>}
              </div>

              <div>
                <Label>PAN Number</Label>
                <Input
                  value={form.panNumber}
                  onChange={(e) => {
                    clearFieldError("panNumber");
                    setForm({ ...form, panNumber: e.target.value.toUpperCase() });
                  }}
                  placeholder="ABCDE1234F"
                />
                {getFieldError("panNumber") && <p className="mt-1 text-xs text-red-600">{getFieldError("panNumber")}</p>}
              </div>

              <div className="md:col-span-2">
                <Label>Address Line 1</Label>
                <Input
                  value={form.address.line1}
                  onChange={(e) => setForm({ ...form, address: { ...form.address, line1: e.target.value } })}
                />
              </div>

              <div className="md:col-span-2">
                <Label>Address Line 2</Label>
                <Input
                  value={form.address.line2}
                  onChange={(e) => setForm({ ...form, address: { ...form.address, line2: e.target.value } })}
                />
              </div>

              <div>
                <Label>City</Label>
                <Input
                  value={form.address.city}
                  onChange={(e) => {
                    clearFieldError("addressCity");
                    setForm({ ...form, address: { ...form.address, city: e.target.value } });
                  }}
                />
                {getFieldError("addressCity") && <p className="mt-1 text-xs text-red-600">{getFieldError("addressCity")}</p>}
              </div>

              <div>
                <Label>State</Label>
                <Input
                  value={form.address.state}
                  onChange={(e) => {
                    clearFieldError("addressState");
                    setForm({ ...form, address: { ...form.address, state: e.target.value } });
                  }}
                />
                {getFieldError("addressState") && <p className="mt-1 text-xs text-red-600">{getFieldError("addressState")}</p>}
              </div>

              <div>
                <Label>Country</Label>
                <Input
                  value={form.address.country}
                  onChange={(e) => {
                    clearFieldError("addressCountry");
                    setForm({ ...form, address: { ...form.address, country: e.target.value } });
                  }}
                />
                {getFieldError("addressCountry") && <p className="mt-1 text-xs text-red-600">{getFieldError("addressCountry")}</p>}
              </div>

              <div>
                <Label>Zip</Label>
                <Input
                  inputMode="numeric"
                  value={form.address.zip}
                  onChange={(e) => {
                    clearFieldError("addressZip");
                    setForm({ ...form, address: { ...form.address, zip: e.target.value.replace(/\D/g, "") } });
                  }}
                />
                {getFieldError("addressZip") && <p className="mt-1 text-xs text-red-600">{getFieldError("addressZip")}</p>}
              </div>

              <div>
                <Label>Emergency Contact Name</Label>
                <Input
                  validationType="name"
                  value={form.emergencyContacts[0]?.name || ""}
                  onChange={(e) =>
                    {
                      clearFieldError("emergencyName");
                      setForm({
                        ...form,
                        emergencyContacts: [
                          {
                            ...(form.emergencyContacts[0] || { name: "", relation: "", phone: "" }),
                            name: e.target.value
                          }
                        ]
                      });
                    }
                  }
                />
                {getFieldError("emergencyName") && <p className="mt-1 text-xs text-red-600">{getFieldError("emergencyName")}</p>}
              </div>

              <div>
                <Label>Emergency Relation</Label>
                <Select
                  value={form.emergencyContacts[0]?.relation || "none"}
                  onValueChange={(v) =>
                    {
                      clearFieldError("emergencyRelation");
                      setForm({
                        ...form,
                        emergencyContacts: [
                          {
                            ...(form.emergencyContacts[0] || { name: "", relation: "", phone: "" }),
                            relation: v === "none" ? "" : v
                          }
                        ]
                      });
                    }
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select relation" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not set</SelectItem>
                    {RELATION_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {getFieldError("emergencyRelation") && <p className="mt-1 text-xs text-red-600">{getFieldError("emergencyRelation")}</p>}
              </div>

              <div>
                <Label>Emergency Contact Phone</Label>
                <Input
                  validationType="phone"
                  inputMode="numeric"
                  maxLength={10}
                  value={form.emergencyContacts[0]?.phone || ""}
                  onChange={(e) =>
                    {
                      clearFieldError("emergencyPhone");
                      setForm({
                        ...form,
                        emergencyContacts: [
                          {
                            ...(form.emergencyContacts[0] || { name: "", relation: "", phone: "" }),
                            phone: e.target.value
                          }
                        ]
                      });
                    }
                  }
                />
                {getFieldError("emergencyPhone") && <p className="mt-1 text-xs text-red-600">{getFieldError("emergencyPhone")}</p>}
              </div>
            </div>
          </div>
        )}
          </fieldset>
          <div className="mt-4 flex justify-end">
            <Button
              onClick={handleSubmit}
              disabled={
                loading ||
                isSectionReadOnly("employee") ||
                (!isEdit && (departments.length === 0 || designations.length === 0))
              }
            >
              {loading
                ? isEdit
                  ? "Updating Employee..."
                  : "Creating Employee..."
                : isEdit
                  ? "Update Employee"
                  : "Create Employee"}
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="salary">
          <div className={`stat-card space-y-4 ${isSectionReadOnly("salary") ? "profile-section-readonly" : ""}`}>
            {!isEdit ? (
              <p className="text-sm text-muted-foreground">
                Save employee first. Then open this tab to configure payroll and salary details.
              </p>
            ) : !canManagePayroll ? (
              <p className="text-sm text-muted-foreground">
                You need `PAYROLL_CONFIG_MANAGE` permission to configure salary details.
              </p>
            ) : (
              <>
                <div className="flex flex-col gap-3 border-b pb-5 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-primary">Compensation workspace</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <h2 className="text-2xl font-semibold text-foreground">Salary Details</h2>
                      <Badge variant="outline" className="rounded-md">
                        {salaryModeBadgeLabel}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Add payroll, salary rules, statutory contributions, and employee-specific components in one flow.
                    </p>
                    {salaryHasUnsavedChanges && (
                      <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                        You have unsaved salary changes. Save before switching tabs if you want to keep this draft.
                      </p>
                    )}
                    {salarySaveNotice && !salaryHasUnsavedChanges && (
                      <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                        {salarySaveNotice}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-start gap-2 lg:items-end">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" className="rounded-md px-3 py-1">
                        {replaceText(salaryForm.payrollStatus, "_", " ")}
                      </Badge>
                      {selectedPayGroup && (
                        <Badge variant="outline" className="rounded-md px-3 py-1">
                          {selectedPayGroup.code}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
                  <div className="space-y-4">
                <div className="flex items-center justify-between gap-4 rounded-lg border bg-secondary/40 px-4 py-3">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Calculator className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold">Auto Calculate From CTC + Pay Group</p>
                      <p className="text-xs text-muted-foreground">
                        Monthly gross, basic, variable, and enabled statutory components update as you edit.
                      </p>
                    </div>
                  </div>
                  <Switch checked={salaryAutoCalc} onCheckedChange={setSalaryAutoCalc} />
                </div>

                {salaryStructures.length > 0 && (
                  <div className="rounded-md border p-4">
                    <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-medium">Salary Revision History</p>
                        <p className="text-xs text-muted-foreground">
                          Use New Revision for hikes or CTC changes. Payroll picks the revision whose effective period covers the payroll month.
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant={salaryEditMode === "revision" ? "default" : "outline"}
                        size="sm"
                        onClick={startNewSalaryRevision}
                      >
                        {salaryEditMode === "revision" ? "Creating New Revision" : "New Revision"}
                      </Button>
                    </div>
                    <div className="space-y-2">
                      {salaryStructures.map((salary) => {
                        const effectiveFrom = normalizePayrollDate(salary.effective_from);
                        const salaryRules = (salary.metadata?.salaryRules || {}) as Record<string, any>;
                        const variablePayApprovalStatus = String(
                          salaryRules.variablePayApprovalStatus || "pending"
                        ).toLowerCase();
                        const targetVariablePay = Number(
                          salaryRules.variablePayTargetMonthly ??
                            salary.variable_pay_target ??
                            salary.variable_pay ??
                            0
                        );
                        const approvedVariablePay = Number(
                          salaryRules.variablePayApprovedAmount ??
                            salary.variable_pay_approved_amount ??
                            salary.variable_pay ??
                            0
                        );
                        const displayedVariablePay =
                          variablePayApprovalStatus === "approved" || variablePayApprovalStatus === "partial"
                            ? approvedVariablePay
                            : targetVariablePay;
                        const isCurrentRevision = isRevisionActiveToday(salary);
                        const isScheduledRevision = isRevisionScheduledForFuture(salary);
                        const effectiveTo = isCurrentRevision
                          ? "Current"
                          : isScheduledRevision
                            ? "Scheduled"
                            : normalizePayrollDate(salary.effective_to) || "-";
                        const isSelected =
                          salaryEditMode === "update" &&
                          Boolean(salary.id) &&
                          selectedSalaryStructureId === salary.id;
                        return (
                          <button
                            key={salary.id || effectiveFrom}
                            type="button"
                            data-readonly-action="true"
                            onClick={() => applySalaryRevisionToForm(salary)}
                            className={`w-full rounded-md border p-3 text-left transition-colors ${
                              isSelected ? "border-primary bg-primary/5" : "hover:bg-muted/40"
                            }`}
                          >
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <p className="text-sm font-medium">
                                  {formatInr(salary.annual_ctc)} CTC
                                  {isCurrentRevision
                                    ? " - Current"
                                    : isScheduledRevision
                                      ? " - Scheduled"
                                      : ""}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {effectiveFrom || "-"} to {effectiveTo}
                                </p>
                              </div>
                              <div className="text-xs text-muted-foreground sm:text-right">
                                <p>Gross {formatInr(salary.monthly_gross)}</p>
                                <p>Variable {formatInr(displayedVariablePay)}</p>
                                <p className="text-[11px] uppercase tracking-wide">
                                  {variablePayApprovalStatus === "approved"
                                    ? "Approved"
                                    : variablePayApprovalStatus === "partial"
                                      ? "Partially approved"
                                      : variablePayApprovalStatus === "rejected"
                                        ? "Rejected"
                                        : "Pending approval"}
                                </p>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label>
                      Pay Group <span className="text-red-600">*</span>
                    </Label>
                    <Select
                      value={salaryForm.payGroupId}
                      onValueChange={(v) => {
                        clearFieldError("payGroupId");
                        setSalaryForm((prev) => ({
                          ...prev,
                          payGroupId: v,
                          variablePayBaseCode: "MONTHLY_GROSS"
                        }));
                        setPayrollComponents([]);
                        setPayrollComponentCodes([]);
                        setComponentOverrides({});
                        if (canManagePayroll && v) {
                          fetchPayrollComponents(v);
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select pay group" />
                      </SelectTrigger>
                      <SelectContent>
                        {payGroups
                          .filter((row) => row.is_active)
                          .map((group) => (
                            <SelectItem key={group.id} value={group.id}>
                              {group.name} ({group.code})
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    {getFieldError("payGroupId") && (
                      <p className="mt-1 text-xs text-red-600">{getFieldError("payGroupId")}</p>
                    )}
                  </div>

                  <div>
                    <Label>Payroll Status</Label>
                    <Select
                      value={salaryForm.payrollStatus}
                      onValueChange={(v) =>
                        setSalaryForm((prev) => ({ ...prev, payrollStatus: v }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="on_hold">On Hold</SelectItem>
                        <SelectItem value="exited">Exited</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Payment Mode</Label>
                    <Select
                      value={salaryForm.defaultPaymentMode}
                      onValueChange={(v) =>
                        setSalaryForm((prev) => ({ ...prev, defaultPaymentMode: v }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                        <SelectItem value="cash">Cash</SelectItem>
                        <SelectItem value="cheque">Cheque</SelectItem>
                        <SelectItem value="upi">UPI</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Tax Regime</Label>
                    <Select
                      value={salaryForm.taxRegime}
                      onValueChange={(v) =>
                        setSalaryForm((prev) => ({ ...prev, taxRegime: v }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="new">New Regime</SelectItem>
                        <SelectItem value="old">Old Regime</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="md:col-span-2">
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1">
                        <Label>
                          Annual CTC <span className="text-red-600">*</span>
                        </Label>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground" />
                            </TooltipTrigger>
                      <TooltipContent>
                            Annual CTC includes gross and employer contribution components from the payroll setup. Employee deductions are not part of CTC.
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      {Number(salaryBreakdown.annualCtc || 0) > 0 && (
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span className="rounded-md border bg-muted/40 px-2 py-1">
                            Gross {formatInr(salaryBreakdown.grossBeforeVariablePay)} / month
                          </span>
                          <span className="rounded-md border bg-muted/40 px-2 py-1">
                            Employer contribution components {formatInr(payrollSummaryTotals.employerContributionTotal)} / month
                          </span>
                        </div>
                      )}
                    </div>
                    <Input
                      type="text"
                      inputMode="decimal"
                      pattern="[0-9]*[.,]?[0-9]*"
                      value={salaryForm.annualCtc}
                      onChange={(e) => {
                        clearFieldError("annualCtc");
                        const nextValue = e.target.value.replace(/,/g, "").replace(/[^0-9.]/g, "");
                        const parts = nextValue.split(".");
                        const sanitizedValue =
                          parts.length > 2 ? `${parts[0]}.${parts.slice(1).join("")}` : nextValue;
                        setSalaryForm((prev) => ({ ...prev, annualCtc: sanitizedValue }));
                      }}
                      placeholder="e.g. 720000"
                    />
                    {getFieldError("annualCtc") && (
                      <p className="mt-1 text-xs text-red-600">{getFieldError("annualCtc")}</p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      CTC includes gross, variable pay, and employer contribution components. Monthly gross is derived first, then Basic and HRA are calculated from gross. Employee deductions are shown separately from gross.
                    </p>
                  </div>

                  <div>
                    <Label>Basic % Rule Source</Label>
                    <Select
                      value={salaryForm.basicPercentSource}
                      onValueChange={(v) =>
                        setSalaryForm((prev) => ({ ...prev, basicPercentSource: v }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pay_group">Use Pay Group %</SelectItem>
                        <SelectItem value="employee">Set Employee %</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {salaryForm.basicPercentSource === "employee" && (
                    <div>
                      <Label>Employee Basic % of CTC</Label>
                      <Input
                        type="number"
                        min={1}
                        max={100}
                        value={salaryForm.employeeBasicPercent}
                        onChange={(e) =>
                          setSalaryForm((prev) => ({
                            ...prev,
                            employeeBasicPercent: e.target.value
                          }))
                        }
                        placeholder="e.g. 45"
                      />
                    </div>
                  )}

                  <div>
                    <Label>HRA % of Basic</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={salaryForm.hraPercentOfBasic}
                      disabled={!effectiveHraEnabled}
                      onChange={(e) =>
                        setSalaryForm((prev) => ({
                          ...prev,
                          hraPercentOfBasic: e.target.value
                        }))
                      }
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {effectiveHraEnabled
                        ? "HRA is calculated from Basic, and Basic is derived from monthly gross."
                        : "HRA is disabled because this pay group does not include an HRA component."}
                    </p>
                  </div>

                  <div>
                    <Label>Monthly Gross</Label>
                    <Input
                      type="number"
                      value={salaryForm.monthlyGross}
                      onChange={(e) =>
                        setSalaryForm((prev) => ({ ...prev, monthlyGross: e.target.value }))
                      }
                      placeholder="Optional (auto from CTC if blank)"
                    />
                    {salaryAutoCalc && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Gross is auto-balanced from Annual CTC after employer contribution components. Basic, HRA, and deduction calculations use this gross value.
                      </p>
                    )}
                  </div>

                  <div>
                    <Label>Basic Pay (Monthly)</Label>
                    <Input
                      type="number"
                      value={salaryForm.basicPay}
                      onChange={(e) =>
                        setSalaryForm((prev) => ({ ...prev, basicPay: e.target.value }))
                      }
                      placeholder="Optional (engine fallback if blank)"
                    />
                    {salaryAutoCalc && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Basic uses{" "}
                        {salaryForm.basicPercentSource === "employee" ? "employee override" : "pay group"}:{" "}
                        {Number(effectiveBasicPercent || 0).toFixed(2)}% of monthly gross.
                      </p>
                    )}
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <Label>Variable Pay Target (Monthly)</Label>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Eligible</span>
                        <Switch
                          checked={salaryForm.variablePayEnabled}
                          onCheckedChange={(checked) =>
                            setSalaryForm((prev) => ({
                              ...prev,
                              variablePayEnabled: checked,
                              variablePay: checked ? prev.variablePay : "",
                              variablePayMode: checked ? prev.variablePayMode : "fixed",
                              variablePayPercentOfCtc: checked ? prev.variablePayPercentOfCtc : "",
                              variablePayReleaseOption: checked ? prev.variablePayReleaseOption : "12",
                              variablePayReleaseMonths: checked ? prev.variablePayReleaseMonths : "12",
                              variablePayApprovalStatus: checked ? prev.variablePayApprovalStatus : "pending"
                            }))
                          }
                        />
                      </div>
                    </div>
                    <Input
                      type="number"
                      value={salaryForm.variablePay}
                      disabled={!salaryForm.variablePayEnabled || isVariablePayPercentageMode}
                      onChange={(e) =>
                        setSalaryForm((prev) => ({ ...prev, variablePay: e.target.value }))
                      }
                      placeholder={
                        !salaryForm.variablePayEnabled
                          ? "Not eligible"
                          : isVariablePayPercentageMode
                            ? `Calculated from % of ${
                                salaryForm.variablePayMode === "ctc_percentage"
                                  ? "CTC"
                                  : selectedVariableBaseDisplayLabel
                              }`
                            : "Monthly target amount"
                      }
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Included in CTC. In percentage mode, target is derived from the selected earning component or CTC.
                      In payroll formulas, `VARIABLE` means this monthly target amount. Release is
                      performance-based using the schedule below.
                    </p>
                  </div>

                  {salaryForm.variablePayEnabled && (
                    <>
                      <div>
                        <Label>Variable Target Type</Label>
                        <Select
                          value={selectedVariableTargetTypeValue}
                          onValueChange={(value) => {
                            if (value === "fixed") {
                              setSalaryForm((prev) => ({
                                ...prev,
                                variablePayMode: "fixed",
                                variablePayPercentOfCtc: "",
                                variablePayBaseCode: "MONTHLY_GROSS"
                              }));
                              return;
                            }

                            if (value === "ctc_percentage") {
                              setSalaryForm((prev) => ({
                                ...prev,
                                variablePayMode: "ctc_percentage",
                                variablePayBaseCode: "MONTHLY_CTC"
                              }));
                              return;
                            }

                            if (value === "percentage") {
                              setSalaryForm((prev) => ({
                                ...prev,
                                variablePayMode: "percentage",
                                variablePayBaseCode: "MONTHLY_GROSS"
                              }));
                              return;
                            }

                            if (value.startsWith("base:")) {
                              const nextBaseCode = value.slice(5).trim().toUpperCase() || "MONTHLY_GROSS";
                              setSalaryForm((prev) => ({
                                ...prev,
                                variablePayMode: "percentage",
                                variablePayBaseCode: nextBaseCode
                              }));
                            }
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select target type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectLabel>Pay Basis</SelectLabel>
                              <SelectItem value="fixed">Fixed amount</SelectItem>
                              <SelectItem value="percentage">% of Gross</SelectItem>
                              <SelectItem value="ctc_percentage">% of CTC</SelectItem>
                            </SelectGroup>
                            {earningComponentBaseOptions.length > 0 && (
                              <SelectGroup>
                                <SelectLabel>Pay Group Components</SelectLabel>
                                {earningComponentBaseOptions
                                  .filter((option) => !["MONTHLY_GROSS", "GROSS", "MONTHLY_CTC"].includes(option.value))
                                  .map((option) => (
                                    <SelectItem key={option.value} value={`base:${option.value}`}>
                                      {option.label}
                                    </SelectItem>
                                  ))}
                              </SelectGroup>
                            )}
                            <SelectGroup>
                              <SelectLabel>Totals</SelectLabel>
                              <SelectItem value="base:MONTHLY_GROSS">Monthly Gross</SelectItem>
                              <SelectItem value="base:MONTHLY_CTC">Monthly CTC</SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </div>

                      {isVariablePayPercentageMode && (
                        <div>
                          <Label>
                            Variable % of{" "}
                            {salaryForm.variablePayMode === "ctc_percentage"
                              ? "CTC"
                              : selectedVariableBaseDisplayLabel}
                          </Label>
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            value={salaryForm.variablePayPercentOfCtc}
                            onChange={(e) =>
                              setSalaryForm((prev) => ({
                                ...prev,
                                variablePayPercentOfCtc: e.target.value
                              }))
                            }
                            placeholder="e.g. 10"
                          />
                          <p className="mt-1 text-xs text-muted-foreground">
                            Monthly target is calculated from{" "}
                            {salaryForm.variablePayMode === "ctc_percentage"
                              ? "CTC"
                              : selectedVariableBaseDisplayLabel.toLowerCase()}{" "}
                            and included in the CTC breakup.
                          </p>
                        </div>
                      )}

                      <div>
                        <Label>Approved Variable Pay (Monthly)</Label>
                        <Input
                          type="text"
                          inputMode="decimal"
                          pattern="[0-9]*[.,]?[0-9]*"
                          value={salaryForm.variablePayApprovedAmount}
                          disabled={!salaryForm.variablePayEnabled || !["partial", "approved"].includes(salaryForm.variablePayApprovalStatus)}
                          onChange={(e) => {
                            clearFieldError("variablePayApprovedAmount");
                            const nextValue = e.target.value.replace(/,/g, "").replace(/[^0-9.]/g, "");
                            const parts = nextValue.split(".");
                            const sanitizedValue =
                              parts.length > 2 ? `${parts[0]}.${parts.slice(1).join("")}` : nextValue;
                            setSalaryForm((prev) => ({
                              ...prev,
                              variablePayApprovedAmount: sanitizedValue
                            }));
                          }}
                          max={Number(salaryBreakdown.variablePay || 0) || undefined}
                          placeholder={
                            !salaryForm.variablePayEnabled
                              ? "Not eligible"
                              : "Amount approved for payroll"
                          }
                        />
                        <p className="mt-1 text-xs text-muted-foreground">
                          This is the portion HR/Admin approved for payroll. It can be lower than the target amount.
                        </p>
                        {(approvedVariablePayFieldError || getFieldError("variablePayApprovedAmount")) && (
                          <p className="mt-1 text-xs text-red-600">
                            {approvedVariablePayFieldError || getFieldError("variablePayApprovedAmount")}
                          </p>
                        )}
                      </div>

                      <div>
                        <Label>Variable Release Schedule</Label>
                        <Select
                          value={salaryForm.variablePayReleaseOption}
                          onValueChange={(value) =>
                            setSalaryForm((prev) => ({
                              ...prev,
                              variablePayReleaseOption: value,
                              variablePayReleaseMonths: value === "custom" ? prev.variablePayReleaseMonths : value
                            }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select release schedule" />
                          </SelectTrigger>
                          <SelectContent>
                            {VARIABLE_PAY_RELEASE_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Estimated release: {formatInr(variablePayReleaseAmount)} every {variablePayReleaseMonths} month{variablePayReleaseMonths === 1 ? "" : "s"}.
                        </p>
                      </div>

                      <div>
                        <Label>Variable Pay Approval</Label>
                        <Select
                          value={salaryForm.variablePayApprovalStatus}
                          onValueChange={(value) =>
                            setSalaryForm((prev) => ({
                              ...prev,
                              variablePayApprovalStatus: ["pending", "partial", "approved", "rejected"].includes(value)
                                ? value
                                : "pending",
                              variablePayApprovedAmount:
                                (value === "approved" || value === "partial") && !prev.variablePayApprovedAmount
                                  ? String(Number(prev.variablePay || salaryBreakdown.variablePay || 0))
                                  : prev.variablePayApprovedAmount
                            }))
                          }
                          disabled={!canManagePayroll}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select approval status" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="pending">Pending approval</SelectItem>
                            <SelectItem value="partial">Partially approved</SelectItem>
                            <SelectItem value="approved">Approved for payroll</SelectItem>
                            <SelectItem value="rejected">Rejected</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="mt-1 text-xs text-muted-foreground">
                          HR or admin approval is required before variable pay is credited in payroll.
                        </p>
                      </div>

                      {salaryForm.variablePayReleaseOption === "custom" && (
                        <div>
                          <Label>Custom Release Months</Label>
                          <Input
                            type="number"
                            min={1}
                            max={12}
                            value={salaryForm.variablePayReleaseMonths}
                            onChange={(e) =>
                              setSalaryForm((prev) => ({
                                ...prev,
                                variablePayReleaseMonths: e.target.value
                              }))
                            }
                            placeholder="e.g. 4"
                          />
                        </div>
                      )}

                      {dynamicSalaryComponentRows.length > 0 && (
                        <div className="rounded-md border bg-muted/20 p-3 md:col-span-2">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium">Dynamic Components</p>
                              <p className="text-xs text-muted-foreground">
                                Percentage, formula, and slab-based components are calculated automatically.
                              </p>
                            </div>
                            <Badge variant="outline" className="rounded-md">
                              {dynamicSalaryComponentRows.length} active
                            </Badge>
                          </div>
                          <div className="mt-3 grid grid-cols-1 gap-2">
                            {dynamicSalaryComponentRows.slice(0, 5).map((component) => (
                              <div
                                key={`dynamic-${component.scope}-${component.code}`}
                                className="rounded-md border bg-background px-3 py-2 text-sm"
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <div>
                                    <p className="font-medium">{component.label}</p>
                                    <p className="text-xs text-muted-foreground">
                                      {replaceText(component.scope, "_", " ")} • {component.code} • {component.mode}
                                    </p>
                                  </div>
                                  <span className="text-sm font-medium">
                                    {component.monthlyAmount != null ? formatInr(component.monthlyAmount) : "Dynamic"}
                                  </span>
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">{component.detail}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  <div className="rounded-md border p-3 md:col-span-2 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">EPF / ESI Settings</p>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={salaryForm.restrictPfWage}
                          onCheckedChange={(checked) =>
                            setSalaryForm((prev) => ({ ...prev, restrictPfWage: checked }))
                          }
                        />
                        <span className="text-xs text-muted-foreground">Restrict PF wage</span>
                      </div>
                    </div>
                    {salaryForm.restrictPfWage && (
                      <div>
                        <Label>PF Wage Ceiling</Label>
                        <Input
                          type="number"
                          value={salaryForm.pfWageCeiling}
                          onChange={(e) =>
                            setSalaryForm((prev) => ({ ...prev, pfWageCeiling: e.target.value }))
                          }
                        />
                      </div>
                    )}
                    <div>
                      <Label>EPF Calculation</Label>
                      <Select
                        value={salaryForm.epfMode}
                        onValueChange={(v) =>
                          setSalaryForm((prev) => ({ ...prev, epfMode: v }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="percentage">% of Basic</SelectItem>
                          <SelectItem value="fixed">Fixed Amount</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {salaryForm.epfMode === "percentage" ? (
                      <div>
                        <Label>EPF % of Basic</Label>
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          value={salaryForm.epfPercentOfBasic}
                          onChange={(e) =>
                            setSalaryForm((prev) => ({
                              ...prev,
                              epfPercentOfBasic: e.target.value
                            }))
                          }
                        />
                      </div>
                    ) : (
                      <div>
                        <Label>EPF Fixed Amount</Label>
                        <Input
                          type="number"
                          min={0}
                          value={salaryForm.epfFixedAmount}
                          onChange={(e) =>
                            setSalaryForm((prev) => ({
                              ...prev,
                              epfFixedAmount: e.target.value
                            }))
                          }
                        />
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={salaryForm.includeEsi}
                        onCheckedChange={(checked) =>
                          setSalaryForm((prev) => ({ ...prev, includeEsi: checked }))
                        }
                      />
                      <span className="text-xs text-muted-foreground">
                        Enable ESI when gross wages are within ₹21,000. Employee 0.75%, employer 3.25%.
                      </span>
                    </div>
                  </div>

                  <div>
                    <Label>
                      Effective From <span className="text-red-600">*</span>
                    </Label>
                    <Input
                      type="date"
                      value={salaryForm.effectiveFrom}
                      disabled={selectedSalaryRevisionIsClosed}
                      onChange={(e) =>
                        setSalaryForm((prev) => ({ ...prev, effectiveFrom: e.target.value }))
                      }
                    />
                    {salaryEditMode === "update" && !selectedSalaryRevisionIsClosed && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        You can edit this revision until its effective period ends. Use New Revision
                        for hikes or structure changes that must keep separate history.
                      </p>
                    )}
                    {salaryEditMode === "update" && selectedSalaryRevisionIsClosed && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        This revision is view-only because its effective period has ended. Use New
                        Revision for hikes or CTC changes.
                      </p>
                    )}
                    {selectedSalaryRevisionIsClosed && (
                      <p className="mt-1 text-xs text-amber-700">
                        This older revision is view-only now that a newer effective period has started.
                      </p>
                    )}
                    {salaryEditMode === "revision" && salaryStructures.length > 0 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Pick a date that does not already exist in history. The previous salary will close one day before this date.
                      </p>
                    )}
                  </div>

                  <div>
                    <Label>Revision Reason</Label>
                    <Input
                      value={salaryForm.revisionReason}
                      onChange={(e) =>
                        setSalaryForm((prev) => ({ ...prev, revisionReason: e.target.value }))
                      }
                      placeholder="Initial salary setup"
                    />
                  </div>
                </div>

                {payrollComponents.length > 0 && (
                  <div className="rounded-md border p-4 space-y-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">Employee Component Overrides</p>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              aria-label="About employee component overrides"
                              className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <Info className="h-4 w-4" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                        Enable this only for components that should differ from the selected pay group for this employee.
                      </TooltipContent>
                        </Tooltip>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Use this only when this employee’s structure differs from the pay group. You can
                        enable or disable components like bonus, ESOP, PT, TDS, or gratuity for this
                        employee and override their values.
                      </p>
                    </div>

                    <div className="space-y-3">
                      {payrollComponents.map((component) => {
                        const key = String(component.code || "").toUpperCase();
                        const override =
                          componentOverrides[key] || buildComponentOverrideState(component);
                        const overrideError = (field: string) =>
                          getFieldError(getComponentOverrideErrorKey(key, field));
                        const clearOverrideError = (field: string) =>
                          clearFieldError(getComponentOverrideErrorKey(key, field));

                        return (
                          <div key={`${component.scope}-${component.code}`} className="rounded-md border p-3 space-y-3">
                            <div className="flex items-center justify-between gap-4">
                              <div>
                                <p className="text-sm font-medium">{override.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {replaceText(component.scope, "_", " ")} • {component.code}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">Use for this employee</span>
                                <Switch
                                  checked={override.enabled}
                                  onCheckedChange={(checked) => {
                                    if (!checked) {
                                      [
                                        "name",
                                        "amount",
                                        "base",
                                        "formulaExpression",
                                        "bonusEligibilityDate",
                                        "bonusPayoutMonths"
                                      ].forEach(clearOverrideError);
                                    }
                                    setComponentOverrides((prev) => ({
                                      ...prev,
                                      [key]: { ...override, enabled: checked }
                                    }));
                                  }}
                                />
                              </div>
                            </div>

                            {override.enabled && (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div>
                                  <Label>Display Name</Label>
                                  <Input
                                    value={override.name}
                                    onChange={(e) => {
                                      clearOverrideError("name");
                                      setComponentOverrides((prev) => ({
                                        ...prev,
                                        [key]: { ...override, name: e.target.value }
                                      }));
                                    }}
                                  />
                                  {overrideError("name") && (
                                    <p className="mt-1 text-xs text-red-600">{overrideError("name")}</p>
                                  )}
                                </div>

                                <div>
                                  <Label>Calculation Mode</Label>
                                  <Select
                                    value={override.calculationMode}
                                    onValueChange={(value) => {
                                      setComponentOverrides((prev) => ({
                                        ...prev,
                                        [key]: {
                                          ...override,
                                          calculationMode: value as EmployeeComponentOverride["calculationMode"]
                                        }
                                      }));
                                      ["amount", "base", "formulaExpression"].forEach(clearOverrideError);
                                    }}
                                  >
                                    <SelectTrigger>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="fixed">Fixed Amount</SelectItem>
                                      <SelectItem value="percentage">Percentage</SelectItem>
                                      <SelectItem value="formula">Formula</SelectItem>
                                      <SelectItem value="slab">Slab</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>

                                {override.calculationMode === "percentage" ? (
                                  <>
                                    <div>
                                      <Label>Percentage</Label>
                                      <Input
                                        type="number"
                                        value={override.amount}
                                        onChange={(e) => {
                                          clearOverrideError("amount");
                                          setComponentOverrides((prev) => ({
                                            ...prev,
                                            [key]: { ...override, amount: e.target.value }
                                          }));
                                        }}
                                      />
                                      {overrideError("amount") && (
                                        <p className="mt-1 text-xs text-red-600">{overrideError("amount")}</p>
                                      )}
                                    </div>
                                    <div>
                                      <Label>Base Variable</Label>
                                      <Select
                                        value={override.base || "MONTHLY_GROSS"}
                                        onValueChange={(value) => {
                                          clearOverrideError("base");
                                          setComponentOverrides((prev) => ({
                                            ...prev,
                                            [key]: { ...override, base: value.toUpperCase() }
                                          }));
                                        }}
                                      >
                                        <SelectTrigger>
                                          <SelectValue placeholder="Select base variable" />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {earningComponentBaseOptions.map((option) => (
                                            <SelectItem key={option.value} value={option.value}>
                                              {option.label}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                      {overrideError("base") && (
                                        <p className="mt-1 text-xs text-red-600">{overrideError("base")}</p>
                                      )}
                                    </div>
                                  </>
                                ) : override.calculationMode === "formula" ? (
                                  <div className="grid grid-cols-1 gap-3 md:col-span-2 md:grid-cols-2">
                                    <div>
                                      <Label>Formula Preset</Label>
                                      <Select
                                        value={override.formulaTemplate || "custom"}
                                        onValueChange={(value) => {
                                          const preset = FORMULA_PRESETS.find((item) => item.value === value);
                                          clearOverrideError("formulaExpression");
                                          setComponentOverrides((prev) => ({
                                            ...prev,
                                            [key]: {
                                              ...override,
                                              formulaTemplate: value,
                                              formulaExpression:
                                                value === "custom"
                                                  ? override.formulaExpression
                                                  : preset?.expression || override.formulaExpression
                                            }
                                          }));
                                        }}
                                      >
                                        <SelectTrigger>
                                          <SelectValue placeholder="Select formula" />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {FORMULA_PRESETS.map((preset) => (
                                            <SelectItem key={preset.value} value={preset.value}>
                                              {preset.label}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </div>
                                    <div>
                                      <Label>Custom Formula</Label>
                                      <Input
                                        value={override.formulaExpression}
                                        onChange={(e) => {
                                          clearOverrideError("formulaExpression");
                                          setComponentOverrides((prev) => ({
                                            ...prev,
                                            [key]: {
                                              ...override,
                                              formulaTemplate: "custom",
                                              formulaExpression: e.target.value
                                            }
                                          }));
                                        }}
                                        placeholder="round(BASIC_PAY * 0.0481)"
                                      />
                                      {overrideError("formulaExpression") && (
                                        <p className="mt-1 text-xs text-red-600">
                                          {overrideError("formulaExpression")}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                ) : (
                                  <div>
                                    <Label>{override.calculationMode === "slab" ? "Manual Amount" : "Monthly Amount"}</Label>
                                    <Input
                                      type="number"
                                      value={override.amount}
                                      onChange={(e) => {
                                        clearOverrideError("amount");
                                        setComponentOverrides((prev) => ({
                                          ...prev,
                                          [key]: { ...override, amount: e.target.value }
                                        }));
                                      }}
                                    />
                                    {overrideError("amount") && (
                                      <p className="mt-1 text-xs text-red-600">{overrideError("amount")}</p>
                                    )}
                                  </div>
                                )}

                                {key === "BONUS" && (
                                  <div className="md:col-span-2 rounded-md border bg-slate-50/70 p-3">
                                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                                      <div>
                                        <Label>Credit Timing</Label>
                                        <Select
                                          value={override.bonusCreditTiming || "after_probation"}
                                          onValueChange={(value) => {
                                            clearOverrideError("bonusEligibilityDate");
                                            setComponentOverrides((prev) => ({
                                              ...prev,
                                              [key]: {
                                                ...override,
                                                bonusCreditTiming: value as EmployeeComponentOverride["bonusCreditTiming"],
                                                bonusEligibilityDate:
                                                  value === "after_probation"
                                                    ? form.confirmedDate || override.bonusEligibilityDate
                                                    : override.bonusEligibilityDate
                                              }
                                            }));
                                          }}
                                        >
                                          <SelectTrigger>
                                            <SelectValue />
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="after_probation">After Probation</SelectItem>
                                            <SelectItem value="manual_date">Custom Date</SelectItem>
                                            <SelectItem value="immediate">Immediate</SelectItem>
                                          </SelectContent>
                                        </Select>
                                      </div>
                                      <div>
                                        <Label>Eligibility Date</Label>
                                        <Input
                                          type="date"
                                          value={
                                            override.bonusCreditTiming === "after_probation"
                                              ? form.confirmedDate || override.bonusEligibilityDate
                                              : override.bonusEligibilityDate
                                          }
                                          disabled={override.bonusCreditTiming === "immediate"}
                                          onChange={(e) => {
                                            clearOverrideError("bonusEligibilityDate");
                                            setComponentOverrides((prev) => ({
                                              ...prev,
                                              [key]: {
                                                ...override,
                                                bonusCreditTiming: "manual_date",
                                                bonusEligibilityDate: e.target.value
                                              }
                                            }));
                                          }}
                                        />
                                        {overrideError("bonusEligibilityDate") && (
                                          <p className="mt-1 text-xs text-red-600">
                                            {overrideError("bonusEligibilityDate")}
                                          </p>
                                        )}
                                      </div>
                                      <div>
                                        <Label>Pay Over</Label>
                                        <Select
                                          value={override.bonusPayoutMonths || "2"}
                                          onValueChange={(value) => {
                                            clearOverrideError("bonusPayoutMonths");
                                            setComponentOverrides((prev) => ({
                                              ...prev,
                                              [key]: { ...override, bonusPayoutMonths: value }
                                            }));
                                          }}
                                        >
                                          <SelectTrigger>
                                            <SelectValue />
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="1">1 Month</SelectItem>
                                            <SelectItem value="2">2 Months</SelectItem>
                                            <SelectItem value="3">3 Months</SelectItem>
                                          </SelectContent>
                                        </Select>
                                        {overrideError("bonusPayoutMonths") && (
                                          <p className="mt-1 text-xs text-red-600">
                                            {overrideError("bonusPayoutMonths")}
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                    <p className="mt-2 text-xs text-muted-foreground">
                                      The bonus amount is treated as the total approved bonus and is released from the eligibility month across the selected payout months.
                                    </p>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                  </div>

                  <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
                    <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
                      <div className="border-b bg-primary px-5 py-4 text-primary-foreground">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-medium uppercase tracking-wide text-primary-foreground/75">Review</p>
                            <p className="text-lg font-semibold">All Salary Details</p>
                          </div>
                          <ListChecks className="h-5 w-5 text-primary-foreground/85" />
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-3">
                          <div className="rounded-md bg-white/10 p-3">
                            <p className="text-xs text-primary-foreground/70">Annual CTC</p>
                            <p className="mt-1 text-base font-semibold">{formatInr(salaryBreakdown.annualCtc)}</p>
                          </div>
                          <div className="rounded-md bg-white/10 p-3">
                            <p className="text-xs text-primary-foreground/70">CTC</p>
                            <p className="mt-1 text-base font-semibold">{formatInr(salaryBreakdown.monthlyCtc)}</p>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-5 p-5">
                        <section>
                          <div className="mb-3 flex items-center gap-2">
                            <Landmark className="h-4 w-4 text-primary" />
                            <p className="text-sm font-semibold">Payroll Setup</p>
                          </div>
                          <div className="grid gap-2 text-sm">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-muted-foreground">Pay group</span>
                              <span className="text-right font-medium">
                                {selectedPayGroup ? `${selectedPayGroup.name} (${selectedPayGroup.code})` : "Not selected"}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-muted-foreground">Payroll status</span>
                              <span className="font-medium capitalize">{replaceText(salaryForm.payrollStatus, "_", " ")}</span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-muted-foreground">Payment mode</span>
                              <span className="font-medium capitalize">{replaceText(salaryForm.defaultPaymentMode, "_", " ")}</span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-muted-foreground">Tax regime</span>
                              <span className="font-medium">{salaryForm.taxRegime === "old" ? "Old Regime" : "New Regime"}</span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-muted-foreground">Effective from</span>
                              <span className="font-medium">{salaryForm.effectiveFrom || "-"}</span>
                            </div>
                          </div>
                        </section>

                        <section className="rounded-lg border bg-muted/20">
                          <div className="grid grid-cols-[1fr_96px_96px] gap-2 border-b px-3 py-2 text-xs font-semibold text-muted-foreground">
                            <span>Component</span>
                            <span className="text-right">Monthly</span>
                            <span className="text-right">Annual</span>
                          </div>
                          {earningsSummaryRows.map(({ label, amount, description, highlight }, index) => (
                            <div
                              key={`${index}-${label}-${amount}`}
                              className={`grid grid-cols-[1fr_96px_96px] gap-2 border-b px-3 py-2 text-sm ${
                                highlight
                                  ? "bg-background/70 font-semibold"
                                  : ""
                              }`}
                            >
                              <span className="flex items-center gap-1.5">
                                <span>{label}</span>
                                {description ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Info
                                        className="h-3.5 w-3.5 cursor-help text-muted-foreground transition-colors hover:text-foreground"
                                        aria-label={`${label} formula`}
                                      />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p className="max-w-48 text-xs">{description}</p>
                                    </TooltipContent>
                                  </Tooltip>
                                ) : null}
                              </span>
                              <span className="text-right font-medium">{formatInr(amount)}</span>
                              <span className="text-right text-muted-foreground">{formatInr(Number(amount) * 12)}</span>
                            </div>
                          ))}
                          <div className="grid grid-cols-[1fr_96px_96px] gap-2 border-b px-3 py-2 text-sm bg-background/70 font-semibold">
                            <span className="flex items-center gap-1.5">
                              <span>Gross</span>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Info
                                    className="h-3.5 w-3.5 cursor-help text-muted-foreground transition-colors hover:text-foreground"
                                    aria-label="Monthly Gross formula"
                                  />
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p className="max-w-48 text-xs">
                                    Fixed Pay + Approved Variable Pay. Pending variable-pay target is excluded.
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            </span>
                            <span className="text-right font-medium">{formatInr(earningsPreviewTotal)}</span>
                            <span className="text-right text-muted-foreground">{formatInr(earningsPreviewTotal * 12)}</span>
                          </div>
                          {/* <div className="border-b px-3 py-3">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-sm font-medium">Earning Components</p>
                              <p className="text-xs text-muted-foreground">
                                {earningSalaryComponentRows.length} configured
                              </p>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Percentage, formula, and slab-based earning components update here as you
                              change the dropdowns on the left.
                            </p>
                            {earningSalaryComponentRows.length > 0 ? (
                              <div className="mt-3 grid grid-cols-1 gap-2">
                                {earningSalaryComponentRows.map((component) => (
                                  <div
                                    key={`earning-${component.code}`}
                                    className="grid grid-cols-[1fr_96px_96px] gap-2 rounded-md border bg-background px-3 py-2 text-sm"
                                  >
                                    <span className="min-w-0">
                                      <span className="block font-medium">{component.label}</span>
                                      <span className="block text-xs text-muted-foreground">
                                        {replaceText(component.scope, "_", " ")} • {component.code} • {component.mode}
                                      </span>
                                      <span className="block text-xs text-muted-foreground">
                                        {component.detail}
                                      </span>
                                    </span>
                                    <span className="text-right font-medium">
                                      {component.monthlyAmount != null ? formatInr(component.monthlyAmount) : "Dynamic"}
                                    </span>
                                    <span className="text-right text-muted-foreground">
                                      {component.monthlyAmount != null ? formatInr(component.monthlyAmount * 12) : "Dynamic"}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="mt-2 text-sm text-muted-foreground">
                                No earning components are configured for this pay group.
                              </p>
                            )}
                          </div> */}
                          {employerContributionPreviewRows.map((component) => (
                            <div
                              key={`employer-${component.code}`}
                              className="grid grid-cols-[1fr_96px_96px] gap-2 border-b px-3 py-2 text-sm"
                            >
                              <span className="flex items-center gap-1.5">
                                <span>{component.label}</span>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Info
                                      className="h-3.5 w-3.5 cursor-help text-muted-foreground transition-colors hover:text-foreground"
                                      aria-label={`${component.label} formula`}
                                    />
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p className="max-w-48 text-xs">{component.detail}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </span>
                              <span className="text-right font-medium">
                                {component.monthlyAmount != null ? formatInr(component.monthlyAmount) : "Dynamic"}
                              </span>
                              <span className="text-right text-muted-foreground">
                                {component.monthlyAmount != null ? formatInr(component.monthlyAmount * 12) : "Dynamic"}
                              </span>
                            </div>
                          ))}
                          <div className="grid grid-cols-[1fr_96px_96px] gap-2 border-b px-3 py-2 text-sm bg-background/70 font-semibold">
                            <span className="flex items-center gap-1.5">
                              <span>CTC</span>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Info
                                    className="h-3.5 w-3.5 cursor-help text-muted-foreground transition-colors hover:text-foreground"
                                    aria-label="Monthly CTC formula"
                                  />
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p className="max-w-48 text-xs">
                                    Fixed Pay + Variable Pay Target + employer contribution components
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            </span>
                            <span className="text-right font-medium">{formatInr(payrollSummaryTotals.ctc)}</span>
                            <span className="text-right text-muted-foreground">{formatInr(payrollSummaryTotals.ctc * 12)}</span>
                          </div>
                          {deductionPreviewRows.map((component) => (
                            <div
                              key={`deduction-${component.code}`}
                              className="grid grid-cols-[1fr_96px_96px] gap-2 border-b px-3 py-2 text-sm"
                            >
                              <span className="flex items-center gap-1.5">
                                <span>{component.label}</span>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Info
                                      className="h-3.5 w-3.5 cursor-help text-muted-foreground transition-colors hover:text-foreground"
                                      aria-label={`${component.label} formula`}
                                    />
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p className="max-w-48 text-xs">{component.detail}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </span>
                              <span className="text-right font-medium">
                                {component.monthlyAmount != null ? formatInr(component.monthlyAmount) : "Dynamic"}
                              </span>
                              <span className="text-right text-muted-foreground">
                                {component.monthlyAmount != null ? formatInr(component.monthlyAmount * 12) : "Dynamic"}
                              </span>
                            </div>
                          ))}
                          <div className="grid grid-cols-[1fr_96px_96px] gap-2 border-b px-3 py-2 text-sm bg-background/70 font-semibold">
                            <span className="flex items-center gap-1.5">
                              <span>Deductions</span>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Info
                                    className="h-3.5 w-3.5 cursor-help text-muted-foreground transition-colors hover:text-foreground"
                                    aria-label="Deductions formula"
                                  />
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p className="max-w-48 text-xs">
                                    Sum of all configured deduction components
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            </span>
                            <span className="text-right font-medium">{formatInr(payrollSummaryTotals.deductionTotal)}</span>
                            <span className="text-right text-muted-foreground">{formatInr(payrollSummaryTotals.deductionTotal * 12)}</span>
                          </div>
                          <div className="grid grid-cols-[1fr_96px_96px] gap-2 border-b px-3 py-2 text-sm bg-background/70 font-semibold">
                            <span className="flex items-center gap-1.5">
                              <span>Net Pay</span>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Info
                                    className="h-3.5 w-3.5 cursor-help text-muted-foreground transition-colors hover:text-foreground"
                                    aria-label="Net salary formula"
                                  />
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p className="max-w-48 text-xs">
                                    Gross - employee deductions. Variable pay enters Gross only after approval.
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            </span>
                            <span className="text-right font-medium">{formatInr(payrollSummaryTotals.netSalary)}</span>
                            <span className="text-right text-muted-foreground">{formatInr(payrollSummaryTotals.netSalary * 12)}</span>
                          </div>
                          <div className="border-t px-3 py-2 text-xs text-muted-foreground">
                            Admin summary: CTC reserves the variable-pay target. Gross contains fixed pay plus
                            only approved variable pay, and Net Pay is Gross minus employee deductions.
                          </div>
                        </section>

                        <section>
                          <p className="mb-3 text-sm font-semibold">Rules & Contributions</p>
                          <div className="grid gap-2 text-sm">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-muted-foreground">Basic rule</span>
                              <span className="font-medium">{Number(effectiveBasicPercent || 0).toFixed(2)}%</span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-muted-foreground">HRA rule</span>
                              <span className="font-medium">
                                {effectiveHraEnabled
                                  ? `${Number(salaryForm.hraPercentOfBasic || 0).toFixed(2)}% of Basic`
                                  : "Disabled"}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-muted-foreground">PF wage ceiling</span>
                              <span className="font-medium">
                                {salaryForm.restrictPfWage ? formatInr(salaryForm.pfWageCeiling) : "Not restricted"}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-muted-foreground">EPF calculation</span>
                              <span className="font-medium">
                                {!effectivePfEnabled
                                  ? "Disabled"
                                  : salaryForm.epfMode === "fixed"
                                  ? formatInr(salaryForm.epfFixedAmount)
                                  : `${Number(salaryForm.epfPercentOfBasic || 12).toFixed(2)}%`}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-muted-foreground">Employee Deductions</span>
                              <span className="font-medium">
                                {formatInr(payrollSummaryTotals.deductionTotal)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-muted-foreground">ESI</span>
                              <span className="font-medium">{effectiveEsiEnabled ? "Enabled" : "Disabled"}</span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-muted-foreground">Variable pay</span>
                              <span className="font-medium">
                                {salaryForm.variablePayEnabled
                                  ? formatInr(salaryBreakdown.variablePayApprovedAmount)
                                  : "Not eligible"}
                              </span>
                            </div>
                            {salaryForm.variablePayEnabled && (
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-muted-foreground">Variable pay status</span>
                                <span className="font-medium">
                                  {salaryBreakdown.variablePayApprovalStatus === "approved"
                                    ? "Approved"
                                    : salaryBreakdown.variablePayApprovalStatus === "partial"
                                      ? "Partially approved"
                                      : salaryBreakdown.variablePayApprovalStatus === "rejected"
                                        ? "Rejected"
                                        : "Pending approval"}
                                </span>
                              </div>
                            )}
                            {salaryForm.variablePayEnabled && (
                              <div className="flex items-center justify-between gap-3">
                              <span className="text-muted-foreground">Variable target type</span>
                              <span className="font-medium">
                                {salaryForm.variablePayMode === "ctc_percentage"
                                  ? `${Number(salaryForm.variablePayPercentOfCtc || 0).toFixed(2)}% of CTC`
                                  : salaryForm.variablePayMode === "percentage"
                                    ? `${Number(salaryForm.variablePayPercentOfCtc || 0).toFixed(2)}% of ${selectedVariableBaseDisplayLabel}`
                                    : "Fixed amount"}
                              </span>
                            </div>
                            )}
                            {salaryForm.variablePayEnabled && salaryForm.variablePayMode === "percentage" && (
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-muted-foreground">Base component</span>
                                <span className="font-medium">{selectedVariableBaseLabel}</span>
                              </div>
                            )}
                            {salaryForm.variablePayEnabled && (
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-muted-foreground">Variable release</span>
                                <span className="font-medium">
                                  {variablePayReleaseMonths} month{variablePayReleaseMonths === 1 ? "" : "s"}
                                </span>
                              </div>
                            )}
                            {salaryForm.variablePayEnabled && (
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-muted-foreground">Estimated release amount</span>
                                <span className="font-medium">{formatInr(variablePayReleaseAmount)}</span>
                              </div>
                            )}
                            {salaryForm.variablePayEnabled && (
                              <div className="rounded-md bg-secondary/60 p-2 text-xs text-muted-foreground">
                                HR can approve partial or full release against the target after performance review.
                              </div>
                            )}
                          </div>
                        </section>

                      </div>
                    </div>

                    {salaryStructures.length > 0 && (
                      <div className="rounded-lg border bg-card p-4 shadow-sm">
                        <div className="mb-3 flex items-center gap-2">
                          <History className="h-4 w-4 text-primary" />
                          <p className="text-sm font-semibold">Revision Timeline</p>
                        </div>
                        <div className="space-y-2">
                          {salaryStructures.slice(0, 4).map((salary) => {
                            const effectiveFrom = normalizePayrollDate(salary.effective_from);
                            const isCurrentRevision = isRevisionActiveToday(salary);
                            const isScheduledRevision = isRevisionScheduledForFuture(salary);
                            const effectiveTo = isCurrentRevision
                              ? "Current"
                              : isScheduledRevision
                                ? "Scheduled"
                                : normalizePayrollDate(salary.effective_to) || "-";
                            return (
                              <button
                                key={`review-${salary.id || effectiveFrom}`}
                                type="button"
                                data-readonly-action="true"
                                onClick={() => applySalaryRevisionToForm(salary)}
                                className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                                  selectedSalaryStructureId === salary.id
                                    ? "border-primary bg-primary/5"
                                    : "hover:bg-muted/40"
                                }`}
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-sm font-medium">{formatInr(salary.annual_ctc)}</span>
                                  {isCurrentRevision && <Badge className="rounded-md">Current</Badge>}
                                  {!isCurrentRevision && isScheduledRevision && (
                                    <Badge variant="secondary" className="rounded-md">
                                      Scheduled
                                    </Badge>
                                  )}
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {effectiveFrom || "-"} to {effectiveTo}
                                </p>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </aside>
                </div>

                <section className="rounded-lg border bg-card p-5 shadow-sm">
                  <div className="mb-4">
                    <h3 className="text-base font-semibold">Employee Overrides</h3>
                    <p className="text-sm text-muted-foreground">
                      Enable only the employee-specific settings this person needs, such as special bonuses, retention payouts, or stock/share grants.
                    </p>
                  </div>
                  <div className="space-y-4">
                    {employeeOverrideSettings.map(({ preset, override }) => {
                      const key = preset.code;
                      const overrideError = (field: string) =>
                        getFieldError(getComponentOverrideErrorKey(key, field));
                      const clearOverrideError = (field: string) =>
                        clearFieldError(getComponentOverrideErrorKey(key, field));

                      return (
                        <div key={key} className="rounded-lg border bg-background p-4">
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                            <div>
                              <div className="flex items-center gap-3">
                                <p className="text-sm font-medium">{override.name}</p>
                                <Switch
                                  checked={override.enabled}
                                  onCheckedChange={(checked) => {
                                    setComponentOverrides((prev) => ({
                                      ...prev,
                                      [key]: { ...override, enabled: checked }
                                    }));
                                  }}
                                />
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">{preset.description}</p>
                            </div>
                            {override.enabled && (
                              <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                                <Badge variant="outline" className="rounded-md">
                                  {formatOverrideValue(override)}
                                </Badge>
                                {override.taxable && (
                                  <Badge variant="secondary" className="rounded-md">Taxable</Badge>
                                )}
                                {override.base && override.calculationMode === "percentage" && (
                                  <Badge variant="secondary" className="rounded-md">Base {override.base}</Badge>
                                )}
                              </div>
                            )}
                          </div>

                          {override.enabled && (
                            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                              <div>
                                <Label>Display Name</Label>
                                <Input
                                  value={override.name}
                                  onChange={(e) =>
                                    setComponentOverrides((prev) => ({
                                      ...prev,
                                      [key]: { ...override, name: e.target.value }
                                    }))
                                  }
                                />
                              </div>

                              <div>
                                <Label>Calculation Mode</Label>
                                <Select
                                  value={override.calculationMode}
                                  onValueChange={(value) =>
                                    setComponentOverrides((prev) => ({
                                      ...prev,
                                      [key]: {
                                        ...override,
                                        calculationMode: value as EmployeeComponentOverride["calculationMode"]
                                      }
                                    }))
                                  }
                                >
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="fixed">Fixed Amount</SelectItem>
                                    <SelectItem value="percentage">Percentage</SelectItem>
                                    <SelectItem value="formula">Formula</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>

                              {override.calculationMode === "percentage" ? (
                                <>
                                  <div>
                                    <Label>Percentage</Label>
                                    <Input
                                      type="number"
                                      value={override.amount}
                                      onChange={(e) => {
                                        clearOverrideError("amount");
                                        setComponentOverrides((prev) => ({
                                          ...prev,
                                          [key]: { ...override, amount: e.target.value }
                                        }));
                                      }}
                                    />
                                    {overrideError("amount") && (
                                      <p className="mt-1 text-xs text-red-600">{overrideError("amount")}</p>
                                    )}
                                  </div>
                                  <div>
                                    <Label>Base Variable</Label>
                                    <Input
                                      value={override.base}
                                      onChange={(e) => {
                                        clearOverrideError("base");
                                        setComponentOverrides((prev) => ({
                                          ...prev,
                                          [key]: { ...override, base: e.target.value.toUpperCase() }
                                        }));
                                      }}
                                      placeholder="MONTHLY_GROSS or BASIC_PAY"
                                    />
                                    {overrideError("base") && (
                                      <p className="mt-1 text-xs text-red-600">{overrideError("base")}</p>
                                    )}
                                  </div>
                                </>
                              ) : override.calculationMode === "formula" ? (
                                <div className="md:col-span-2">
                                  <Label>Formula</Label>
                                  <Input
                                    value={override.formulaExpression}
                                    onChange={(e) => {
                                      clearOverrideError("formulaExpression");
                                      setComponentOverrides((prev) => ({
                                        ...prev,
                                        [key]: {
                                          ...override,
                                          formulaTemplate: "custom",
                                          formulaExpression: e.target.value
                                        }
                                      }));
                                    }}
                                    placeholder="round(BASIC_PAY * 0.12)"
                                  />
                                  {overrideError("formulaExpression") && (
                                    <p className="mt-1 text-xs text-red-600">{overrideError("formulaExpression")}</p>
                                  )}
                                </div>
                              ) : (
                                <div>
                                  <Label>
                                    {override.metadata?.unitLabel === "shares" ? "Share / Stock Units" : "Amount"}
                                  </Label>
                                  <Input
                                    type="number"
                                    step={override.metadata?.unitLabel === "shares" ? "0.1" : "1"}
                                    value={override.amount}
                                    onChange={(e) => {
                                      clearOverrideError("amount");
                                      setComponentOverrides((prev) => ({
                                        ...prev,
                                        [key]: { ...override, amount: e.target.value }
                                      }));
                                    }}
                                    placeholder={override.metadata?.placeholder || "Enter amount"}
                                  />
                                  {overrideError("amount") && (
                                    <p className="mt-1 text-xs text-red-600">{overrideError("amount")}</p>
                                  )}
                                </div>
                              )}

                              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                                <span className="text-sm">Taxable</span>
                                <Switch
                                  checked={override.taxable}
                                  onCheckedChange={(checked) =>
                                    setComponentOverrides((prev) => ({
                                      ...prev,
                                      [key]: { ...override, taxable: checked }
                                    }))
                                  }
                                />
                              </div>

                              {key === "BONUS" && (
                                <>
                                  <div>
                                    <Label>Credit Timing</Label>
                                    <Select
                                      value={override.bonusCreditTiming || "after_probation"}
                                      onValueChange={(value) =>
                                        setComponentOverrides((prev) => ({
                                          ...prev,
                                          [key]: {
                                            ...override,
                                            bonusCreditTiming: value as EmployeeComponentOverride["bonusCreditTiming"]
                                          }
                                        }))
                                      }
                                    >
                                      <SelectTrigger>
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="after_probation">After Probation</SelectItem>
                                        <SelectItem value="manual_date">Custom Date</SelectItem>
                                        <SelectItem value="immediate">Immediate</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div>
                                    <Label>Eligibility Date</Label>
                                    <Input
                                      type="date"
                                      value={override.bonusEligibilityDate}
                                      onChange={(e) => {
                                        clearOverrideError("bonusEligibilityDate");
                                        setComponentOverrides((prev) => ({
                                          ...prev,
                                          [key]: {
                                            ...override,
                                            bonusEligibilityDate: e.target.value
                                          }
                                        }));
                                      }}
                                    />
                                    {overrideError("bonusEligibilityDate") && (
                                      <p className="mt-1 text-xs text-red-600">{overrideError("bonusEligibilityDate")}</p>
                                    )}
                                  </div>
                                  <div>
                                    <Label>Pay Over</Label>
                                    <Select
                                      value={override.bonusPayoutMonths || "1"}
                                      onValueChange={(value) =>
                                        setComponentOverrides((prev) => ({
                                          ...prev,
                                          [key]: { ...override, bonusPayoutMonths: value }
                                        }))
                                      }
                                    >
                                      <SelectTrigger>
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="1">1 Month</SelectItem>
                                        <SelectItem value="2">2 Months</SelectItem>
                                        <SelectItem value="3">3 Months</SelectItem>
                                        <SelectItem value="6">6 Months</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>

                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    Save updates the selected salary details. New revisions are created only after choosing New Revision.
                  </p>
                  {selectedPayGroup && (
                    <p className="text-xs text-muted-foreground">
                      Selected Pay Group: {selectedPayGroup.name} ({selectedPayGroup.code})
                    </p>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Saving with the same Effective From updates the current salary record. Changing the
                  Effective From creates a new salary revision for future payroll periods.
                </p>
                {salarySaveNotice && !salaryHasUnsavedChanges && (
                  <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                    {salarySaveNotice}
                  </p>
                )}
              </>
            )}
          </div>
          {isEdit && canManagePayroll && (
            <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full border bg-background/95 p-2 shadow-lg backdrop-blur">
              {isSectionReadOnly("salary") ? (
                <Button
                  type="button"
                  size="sm"
                  className="gap-2"
                  data-readonly-action="true"
                  onClick={enableActiveSectionEdit}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    data-readonly-action="true"
                    onClick={cancelActiveSectionEdit}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleSaveSalary}
                    disabled={savingSalary || isSectionReadOnly("salary")}
                  >
                    {salarySaveButtonLabel}
                  </Button>
                </>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="statutory">
          <fieldset
            disabled={isSectionReadOnly("statutory")}
            className="stat-card space-y-4 disabled:opacity-100"
          >
            {!isEdit ? (
              <p className="text-sm text-muted-foreground">
                Save employee first. Then open this tab to configure tax and statutory details.
              </p>
            ) : !canManagePayroll ? (
              <p className="text-sm text-muted-foreground">
                You need `PAYROLL_CONFIG_MANAGE` permission to configure statutory details.
              </p>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3 border-b pb-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-primary">Tax workspace</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <h2 className="text-2xl font-semibold text-foreground">Tax & Statutory</h2>
                      <Badge variant="outline" className="rounded-md">
                        {statutoryModeBadgeLabel}
                      </Badge>
                    </div>
                  </div>
                </div>

                <div className="rounded-md border bg-muted/30 p-3">
                  <p className="text-sm font-medium">TDS Estimation Inputs</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    These values are used to estimate monthly TDS during payroll runs. This is a payroll
                    estimate for operations, not a final CA filing engine.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label>PAN</Label>
                    <Input
                      value={statutoryForm.pan}
                      onChange={(e) => setStatutoryForm((prev) => ({ ...prev, pan: e.target.value.toUpperCase() }))}
                      placeholder="ABCDE1234F"
                    />
                  </div>

                  <div>
                    <Label>Aadhaar</Label>
                    <Input
                      value={statutoryForm.aadhaar}
                      onChange={(e) => setStatutoryForm((prev) => ({ ...prev, aadhaar: e.target.value }))}
                      placeholder="12 digit Aadhaar"
                    />
                  </div>

                  <div>
                    <Label>UAN</Label>
                    <Input
                      value={statutoryForm.uan}
                      onChange={(e) => setStatutoryForm((prev) => ({ ...prev, uan: e.target.value }))}
                      placeholder="PF UAN"
                    />
                  </div>

                  <div>
                    <Label>ESIC Number</Label>
                    <Input
                      value={statutoryForm.esicNumber}
                      onChange={(e) => setStatutoryForm((prev) => ({ ...prev, esicNumber: e.target.value }))}
                      placeholder="ESIC number"
                    />
                  </div>

                  <div className="space-y-3 rounded-md border p-3 md:col-span-2">
                    <p className="text-sm font-medium">Applicability</p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                        <span className="text-sm">PF Member</span>
                        <Switch checked={statutoryForm.pfMember} onCheckedChange={(checked) => setStatutoryForm((prev) => ({ ...prev, pfMember: checked }))} />
                      </div>
                      <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                        <span className="text-sm">EPS Eligible</span>
                        <Switch checked={statutoryForm.epsEligible} onCheckedChange={(checked) => setStatutoryForm((prev) => ({ ...prev, epsEligible: checked }))} />
                      </div>
                      <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                        <span className="text-sm">ESI Eligible</span>
                        <Switch checked={statutoryForm.esiEligible} onCheckedChange={(checked) => setStatutoryForm((prev) => ({ ...prev, esiEligible: checked }))} />
                      </div>
                      <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                        <span className="text-sm">Professional Tax</span>
                        <Switch checked={statutoryForm.professionalTaxApplicable} onCheckedChange={(checked) => setStatutoryForm((prev) => ({ ...prev, professionalTaxApplicable: checked }))} />
                      </div>
                      <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                        <span className="text-sm">LWF Applicable</span>
                        <Switch checked={statutoryForm.lwfApplicable} onCheckedChange={(checked) => setStatutoryForm((prev) => ({ ...prev, lwfApplicable: checked }))} />
                      </div>
                      <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                        <span className="text-sm">Declarations Submitted</span>
                        <Switch checked={statutoryForm.declarationSubmitted} onCheckedChange={(checked) => setStatutoryForm((prev) => ({ ...prev, declarationSubmitted: checked }))} />
                      </div>
                    </div>
                  </div>

                  <div>
                    <Label>Previous Employer Income (Annual)</Label>
                    <Input
                      type="number"
                      value={statutoryForm.previousEmployerIncomeAnnual}
                      onChange={(e) => setStatutoryForm((prev) => ({ ...prev, previousEmployerIncomeAnnual: e.target.value }))}
                      placeholder="If joined mid-year"
                    />
                  </div>

                  <div>
                    <Label>Previous Employer TDS</Label>
                    <Input
                      type="number"
                      value={statutoryForm.previousEmployerTdsAnnual}
                      onChange={(e) => setStatutoryForm((prev) => ({ ...prev, previousEmployerTdsAnnual: e.target.value }))}
                    />
                  </div>

                  <div>
                    <Label>Other Income (Annual)</Label>
                    <Input
                      type="number"
                      value={statutoryForm.otherIncomeAnnual}
                      onChange={(e) => setStatutoryForm((prev) => ({ ...prev, otherIncomeAnnual: e.target.value }))}
                    />
                  </div>

                  <div>
                    <Label>Housing Loan Interest (Annual)</Label>
                    <Input
                      type="number"
                      value={statutoryForm.housingLoanInterestAnnual}
                      onChange={(e) => setStatutoryForm((prev) => ({ ...prev, housingLoanInterestAnnual: e.target.value }))}
                    />
                  </div>

                  <div>
                    <Label>HRA Exemption (Annual, old regime)</Label>
                    <Input
                      type="number"
                      value={statutoryForm.hraExemptionAnnual}
                      onChange={(e) => setStatutoryForm((prev) => ({ ...prev, hraExemptionAnnual: e.target.value }))}
                    />
                  </div>

                  <div>
                    <Label>80C Deduction</Label>
                    <Input
                      type="number"
                      value={statutoryForm.deduction80cAnnual}
                      onChange={(e) => setStatutoryForm((prev) => ({ ...prev, deduction80cAnnual: e.target.value }))}
                    />
                  </div>

                  <div>
                    <Label>80CCD(1B) Deduction</Label>
                    <Input
                      type="number"
                      value={statutoryForm.deduction80ccd1bAnnual}
                      onChange={(e) => setStatutoryForm((prev) => ({ ...prev, deduction80ccd1bAnnual: e.target.value }))}
                    />
                  </div>

                  <div>
                    <Label>80D Deduction</Label>
                    <Input
                      type="number"
                      value={statutoryForm.deduction80dAnnual}
                      onChange={(e) => setStatutoryForm((prev) => ({ ...prev, deduction80dAnnual: e.target.value }))}
                    />
                  </div>

                  <div>
                    <Label>Other Old-Regime Deductions</Label>
                    <Input
                      type="number"
                      value={statutoryForm.deduction80OtherAnnual}
                      onChange={(e) => setStatutoryForm((prev) => ({ ...prev, deduction80OtherAnnual: e.target.value }))}
                    />
                  </div>

                  <div>
                    <Label>Effective From</Label>
                    <Input
                      type="date"
                      value={statutoryForm.effectiveFrom}
                      onChange={(e) => setStatutoryForm((prev) => ({ ...prev, effectiveFrom: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    Payroll will use these declarations together with the selected tax regime to estimate
                    monthly TDS during run computation.
                  </p>
                  <Button onClick={handleSaveStatutory} disabled={savingStatutory}>
                    {statutorySaveButtonLabel}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Statutory details are saved as revisions. Use a new Effective From date for a new
                  revision; reusing an existing date may be rejected by the system.
                </p>
              </>
            )}
          </fieldset>
        </TabsContent>

        <TabsContent value="bank">
          <fieldset
            disabled={isSectionReadOnly("bank")}
            className="stat-card space-y-4 disabled:opacity-100"
          >
            {!isEdit ? (
              <p className="text-sm text-muted-foreground">
                Save employee first. Then open this tab to configure bank details.
              </p>
            ) : !canManagePayroll ? (
              <p className="text-sm text-muted-foreground">
                You need `PAYROLL_CONFIG_MANAGE` permission to configure bank details.
              </p>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3 border-b pb-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-primary">Payment workspace</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <h2 className="text-2xl font-semibold text-foreground">Bank Details</h2>
                      <Badge variant="outline" className="rounded-md">
                        {bankModeBadgeLabel}
                      </Badge>
                    </div>
                  </div>
                </div>

                {isSectionReadOnly("bank") && !hasSavedBankDetails && (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-muted-foreground">
                    No bank details are saved yet for this employee. Click <span className="font-medium text-foreground">Edit</span>, enter the bank details, and then use <span className="font-medium text-foreground">Save Bank Details</span>.
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label>
                      Payment Mode <span className="text-red-600">*</span>
                    </Label>
                    <Select
                      value={bankForm.paymentMode}
                      onValueChange={(v) => setBankForm((prev) => ({ ...prev, paymentMode: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                        <SelectItem value="cash">Cash</SelectItem>
                        <SelectItem value="cheque">Cheque</SelectItem>
                        <SelectItem value="upi">UPI</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>
                      Effective From <span className="text-red-600">*</span>
                    </Label>
                    <Input
                      type="date"
                      value={bankForm.effectiveFrom}
                      onChange={(e) =>
                        setBankForm((prev) => ({ ...prev, effectiveFrom: e.target.value }))
                      }
                    />
                  </div>

                  <div>
                    <Label>
                      Account Holder Name
                      {bankForm.paymentMode === "bank_transfer" && (
                        <span className="text-red-600"> *</span>
                      )}
                    </Label>
                    <Input
                      value={bankForm.accountHolderName}
                      onChange={(e) =>
                        setBankForm((prev) => ({ ...prev, accountHolderName: e.target.value }))
                      }
                      placeholder="As per bank account"
                    />
                  </div>

                  <div>
                    <Label>
                      IFSC Code
                      {bankForm.paymentMode === "bank_transfer" && (
                        <span className="text-red-600"> *</span>
                      )}
                    </Label>
                    <Input
                      value={bankForm.ifscCode}
                      onChange={(e) =>
                        setBankForm((prev) => ({
                          ...prev,
                          ifscCode: e.target.value.toUpperCase()
                        }))
                      }
                      onBlur={(e) => lookupBankByIfsc(e.target.value)}
                      placeholder="e.g. HDFC0001234"
                    />
                    {lookingUpIfsc && (
                      <p className="text-xs text-muted-foreground mt-1">Fetching bank and branch from IFSC...</p>
                    )}
                  </div>

                  <div>
                    <Label>
                      Bank Name
                      {bankForm.paymentMode === "bank_transfer" && (
                        <span className="text-red-600"> *</span>
                      )}
                    </Label>
                    <Input
                      value={bankForm.bankName}
                      onChange={(e) => setBankForm((prev) => ({ ...prev, bankName: e.target.value }))}
                      placeholder="e.g. HDFC Bank"
                    />
                  </div>

                  <div>
                    <Label>Branch Name</Label>
                    <Input
                      value={bankForm.branchName}
                      onChange={(e) =>
                        setBankForm((prev) => ({ ...prev, branchName: e.target.value }))
                      }
                      placeholder="e.g. Madhapur"
                    />
                  </div>

                  <div>
                    <Label>
                      Account Number
                      {bankForm.paymentMode === "bank_transfer" && (
                        <span className="text-red-600"> *</span>
                      )}
                    </Label>
                    <Input
                      value={bankForm.accountNumber}
                      onChange={(e) =>
                        setBankForm((prev) => ({ ...prev, accountNumber: e.target.value }))
                      }
                      onBlur={(e) => lookupBankByAccount(e.target.value)}
                      placeholder="Enter account number"
                    />
                    {lookingUpAccount && (
                      <p className="text-xs text-muted-foreground mt-1">Looking up saved account details...</p>
                    )}
                  </div>

                  <div>
                    <Label>Account Type</Label>
                    <Select
                      value={bankForm.accountType}
                      onValueChange={(v) => setBankForm((prev) => ({ ...prev, accountType: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="salary">Salary</SelectItem>
                        <SelectItem value="savings">Savings</SelectItem>
                        <SelectItem value="current">Current</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {bankForm.paymentMode === "upi" && (
                    <div className="md:col-span-2">
                      <Label>
                        UPI ID <span className="text-red-600">*</span>
                      </Label>
                      <Input
                        value={bankForm.upiId}
                        onChange={(e) => setBankForm((prev) => ({ ...prev, upiId: e.target.value }))}
                        placeholder="name@bank"
                      />
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={bankForm.isPrimary}
                      onCheckedChange={(checked) =>
                        setBankForm((prev) => ({ ...prev, isPrimary: Boolean(checked) }))
                      }
                    />
                    Primary account
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={bankForm.isVerified}
                      onCheckedChange={(checked) =>
                        setBankForm((prev) => ({ ...prev, isVerified: Boolean(checked) }))
                      }
                    />
                    Mark as verified
                  </label>
                </div>

                <p className="text-xs text-muted-foreground">
                  Saving with the same Effective From updates the current bank record. Changing the
                  Effective From creates a new bank revision.
                </p>

                <p className="text-xs text-muted-foreground">
                  If payment mode is Bank Transfer, account holder, bank name, account number, and
                  IFSC are required for payroll disbursement validation.
                </p>

                <div className="flex justify-end">
                  <Button onClick={handleSaveBank} disabled={savingBank || isSectionReadOnly("bank")}>
                    {bankSaveButtonLabel}
                  </Button>
                </div>

                <div className="space-y-3 border-t pt-4">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Bank History</h3>
                    <p className="text-xs text-muted-foreground">
                      Previous transfer bank details are kept here for audit and review.
                    </p>
                  </div>

                  {bankDetails.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Status</TableHead>
                          <TableHead>Effective From</TableHead>
                          <TableHead>Effective To</TableHead>
                          <TableHead>Account Holder</TableHead>
                          <TableHead>Bank / Branch</TableHead>
                          <TableHead>Account Number</TableHead>
                          <TableHead>IFSC</TableHead>
                          <TableHead>Mode</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {bankDetails.map((row, index) => {
                          const statusLabel = index === 0 ? "Current" : "History";
                          return (
                            <TableRow key={row.id || `${row.account_number || "bank"}-${index}`}>
                              <TableCell>
                                <Badge variant={index === 0 ? "default" : "outline"} className="rounded-md">
                                  {statusLabel}
                                </Badge>
                              </TableCell>
                              <TableCell>{formatDateDisplay(row.effective_from)}</TableCell>
                              <TableCell>{formatDateDisplay(row.effective_to)}</TableCell>
                              <TableCell>{row.account_holder_name || "-"}</TableCell>
                              <TableCell>
                                <div className="space-y-0.5">
                                  <div>{row.bank_name || "-"}</div>
                                  <div className="text-xs text-muted-foreground">{row.branch_name || "-"}</div>
                                </div>
                              </TableCell>
                              <TableCell>{row.account_number || "-"}</TableCell>
                              <TableCell>{row.ifsc_code || "-"}</TableCell>
                              <TableCell className="capitalize">
                                {String(row.payment_mode || "-").replace("_", " ")}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No bank history has been saved yet.
                    </p>
                  )}
                </div>
              </>
            )}
          </fieldset>
        </TabsContent>

        {isEdit && (
          <TabsContent value="idcard">
            <EmployeeIdCard employee={employeeIdCardData} />
          </TabsContent>
        )}
      </Tabs>
    </MainLayout>
  );
};

export default AddEmployee;
