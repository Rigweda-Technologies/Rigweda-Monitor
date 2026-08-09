const { getPayrollPgPool } = require("../../config/payrollDb");
const logger = require("../../logger/logger");
const { observePayrollCompute } = require("../../observability/payrollMetrics");
const { safeRollback } = require("./payrollTx");
const { getTenantIdForOrganization } = require("./payrollProvisioning.service");
const OrgSettings = require("../orgSettings/orgSettings.model");
const Employee = require("../employees/employee.model");
const { toDateKeyInTimeZone } = require("../../utils/timezone");

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const monthEndDate = (month) => {
  const [year, monthNum] = String(month).split("-").map(Number);
  return new Date(Date.UTC(year, monthNum, 0));
};

const DEFAULT_PAYROLL_TIMEZONE = process.env.PAYROLL_DEFAULT_TIMEZONE || "Asia/Kolkata";

const toDateKey = (value, timeZone = DEFAULT_PAYROLL_TIMEZONE) => {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  // PostgreSQL DATE values are parsed as local-midnight Date objects. Converting
  // those through the organization timezone can advance the calendar date.
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  }
  return toDateKeyInTimeZone(value, timeZone);
};

const monthStartDate = (month) => {
  const [year, monthNum] = String(month || "").split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(monthNum)) return null;
  return new Date(Date.UTC(year, monthNum - 1, 1));
};

const toMonthKey = (dateValue) => {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};

const monthDiff = (fromMonth, toMonth) => {
  const from = monthStartDate(fromMonth);
  const to = monthStartDate(toMonth);
  if (!from || !to) return 0;
  return (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
};

const computeVariablePayDueAmount = ({
  payMonth,
  effectiveFrom,
  approvalMonth,
  approvedMonthlyAmount,
  releaseMonths,
  approvalStatus
}) => {
  if (String(approvalStatus || "").toLowerCase() !== "approved" && String(approvalStatus || "").toLowerCase() !== "partial") {
    return 0;
  }

  const approvedAmount = Math.max(0, toNumber(approvedMonthlyAmount, 0));
  const cycleMonths = Math.max(1, Math.floor(toNumber(releaseMonths, 12)));
  if (approvedAmount <= 0 || !payMonth || !effectiveFrom) return 0;

  const releaseStartMonth = toMonthKey(effectiveFrom);
  if (!releaseStartMonth) return 0;
  const approvedPayMonth = String(approvalMonth || "").slice(0, 7);
  if (approvedPayMonth && approvedPayMonth !== payMonth) return 0;
  const monthsElapsed = monthDiff(releaseStartMonth, payMonth) + 1;
  if (monthsElapsed <= 0) return 0;
  // Approval is the release event. The cycle controls the accrued amount, not
  // a second calendar gate that could silently skip the approved month.
  if (!approvedPayMonth && monthsElapsed % cycleMonths !== 0) return 0;
  return roundAmount(approvedAmount * cycleMonths, "exact");
};

const clampAmount = (value, min = 0, max = Number.POSITIVE_INFINITY) =>
  Math.min(max, Math.max(min, toNumber(value, 0)));

const roundAmount = (value, policy = "nearest_rupee") => {
  const v = toNumber(value, 0);
  if (policy === "floor_rupee") return Math.floor(v);
  if (policy === "exact") return Number(v.toFixed(2));
  return Math.round(v);
};

const toVarKey = (code) => String(code || "").replace(/[^A-Za-z0-9_]/g, "_").toUpperCase();

const parseJson = (value, fallback = {}) => {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
};

const getTaxDeclaration = (statutory) => {
  const metadata = parseJson(statutory?.metadata, {});
  return parseJson(metadata.taxDeclaration, {});
};

const getRemainingPayrollMonths = (payMonth) => {
  const [, month] = String(payMonth || "").split("-").map(Number);
  if (!Number.isFinite(month) || month < 1 || month > 12) return 12;
  const fiscalMonthIndex = month >= 4 ? month - 4 : month + 8;
  return Math.max(1, 12 - fiscalMonthIndex);
};

const computeProgressiveTax = (income, slabs = []) => {
  let remaining = Math.max(0, toNumber(income, 0));
  let previousUpper = 0;
  let tax = 0;

  for (const slab of slabs) {
    const upper = slab?.upto == null ? null : toNumber(slab.upto, 0);
    const rate = toNumber(slab.rate, 0) / 100;
    const taxableSlice =
      upper == null
        ? remaining
        : Math.max(0, Math.min(remaining, upper - previousUpper));

    tax += taxableSlice * rate;
    remaining -= taxableSlice;
    if (upper == null || remaining <= 0) break;
    previousUpper = upper;
  }

  return Math.max(0, tax);
};

const computeAnnualTdsEstimate = ({
  payMonth,
  projectedTaxableMonthlyIncome,
  statutory,
  payrollProfile,
  salary,
  professionalTaxMonthly = 0
}) => {
  const declaration = getTaxDeclaration(statutory);
  const regime = String(
    statutory?.tax_regime || payrollProfile?.tax_regime || salary?.tax_regime || "new"
  ).toLowerCase();
  const annualSalaryIncome = Math.max(0, toNumber(projectedTaxableMonthlyIncome, 0) * 12);
  const previousEmployerIncome = toNumber(declaration.previousEmployerIncomeAnnual, 0);
  const otherIncome = toNumber(declaration.otherIncomeAnnual, 0);
  const hraExemption = clampAmount(declaration.hraExemptionAnnual, 0, annualSalaryIncome);
  const housingLoanInterest = Math.abs(toNumber(declaration.housingLoanInterestAnnual, 0));
  const deduction80c = clampAmount(declaration.deduction80cAnnual, 0, 150000);
  const deduction80ccd1b = clampAmount(declaration.deduction80ccd1bAnnual, 0, 50000);
  const deduction80d = clampAmount(declaration.deduction80dAnnual, 0, 50000);
  const deduction80other = clampAmount(declaration.deduction80OtherAnnual, 0);
  const previousEmployerTds = clampAmount(declaration.previousEmployerTdsAnnual, 0);
  const oldStandardDeduction = clampAmount(declaration.oldRegimeStandardDeduction, 0, 50000) || 50000;
  const newStandardDeduction = clampAmount(declaration.newRegimeStandardDeduction, 0, 75000) || 75000;
  const annualProfessionalTax = Math.max(0, toNumber(professionalTaxMonthly, 0) * 12);

  let taxableIncome = annualSalaryIncome + previousEmployerIncome + otherIncome;
  if (regime === "old") {
    taxableIncome -= oldStandardDeduction;
    taxableIncome -= hraExemption;
    taxableIncome -= Math.min(housingLoanInterest, 200000);
    taxableIncome -= annualProfessionalTax;
    taxableIncome -= deduction80c + deduction80ccd1b + deduction80d + deduction80other;
  } else {
    taxableIncome -= newStandardDeduction;
  }

  taxableIncome = Math.max(0, taxableIncome);

  const slabs =
    regime === "old"
      ? [
          { upto: 250000, rate: 0 },
          { upto: 500000, rate: 5 },
          { upto: 1000000, rate: 20 },
          { upto: null, rate: 30 }
        ]
      : [
          { upto: 400000, rate: 0 },
          { upto: 800000, rate: 5 },
          { upto: 1200000, rate: 10 },
          { upto: 1600000, rate: 15 },
          { upto: 2000000, rate: 20 },
          { upto: 2400000, rate: 25 },
          { upto: null, rate: 30 }
        ];

  let baseTax = computeProgressiveTax(taxableIncome, slabs);
  const rebate =
    regime === "old"
      ? taxableIncome <= 500000
        ? Math.min(baseTax, 12500)
        : 0
      : taxableIncome <= 1200000
        ? Math.min(baseTax, 60000)
        : 0;

  baseTax = Math.max(0, baseTax - rebate);
  const cess = baseTax * 0.04;
  const annualTaxLiability = Math.max(0, baseTax + cess - previousEmployerTds);
  const monthsRemaining = getRemainingPayrollMonths(payMonth);

  return {
    regime,
    taxableIncome,
    annualTaxLiability,
    monthlyTds: monthsRemaining > 0 ? annualTaxLiability / monthsRemaining : annualTaxLiability,
    monthsRemaining
  };
};

const computeTelanganaProfessionalTax = (monthlyIncome, applicable = true) => {
  if (!applicable) return 0;
  const income = Math.max(0, toNumber(monthlyIncome, 0));
  if (income <= 15000) return 0;
  if (income <= 20000) return 150;
  return 200;
};

const getEffectiveSnapshotWindow = ({ month, salary, timeZone = DEFAULT_PAYROLL_TIMEZONE }) => {
  const start = monthStartDate(month);
  const end = monthEndDate(month);
  const monthStartKey = toDateKey(start, timeZone);
  const monthEndKey = toDateKey(end, timeZone);
  const salaryStartKey = toDateKey(salary?.effective_from, timeZone);
  const salaryEndKey = toDateKey(salary?.effective_to, timeZone);

  return {
    startKey: salaryStartKey && salaryStartKey > monthStartKey ? salaryStartKey : monthStartKey,
    endKey: salaryEndKey && salaryEndKey < monthEndKey ? salaryEndKey : monthEndKey,
    monthStartKey,
    monthEndKey
  };
};

const resolvePayrollStartDateKey = ({ salary, employee, timeZone = DEFAULT_PAYROLL_TIMEZONE }) => {
  const salaryStartKey = toDateKey(salary?.effective_from, timeZone);
  const confirmedDateKey = toDateKey(employee?.confirmedDate, timeZone);
  if (salaryStartKey && confirmedDateKey) {
    return salaryStartKey > confirmedDateKey ? salaryStartKey : confirmedDateKey;
  }
  return salaryStartKey || confirmedDateKey;
};

const summarizeSnapshotDaysForSalaryWindow = ({
  snapshot,
  dayRows = [],
  month,
  salary,
  employee,
  timeZone = DEFAULT_PAYROLL_TIMEZONE
}) => {
  const window = getEffectiveSnapshotWindow({ month, salary, timeZone });
  const payrollStartKey = resolvePayrollStartDateKey({ salary, employee, timeZone });
  if (payrollStartKey && payrollStartKey > window.startKey) {
    window.startKey = payrollStartKey;
  }
  const eligibleRows = dayRows.filter((row) => {
    const dayKey = toDateKey(row.day_date || row.dayDate, timeZone);
    return dayKey && dayKey >= window.startKey && dayKey <= window.endKey;
  });

  if (!eligibleRows.length) {
    return {
      calendarDays: Math.max(1, toNumber(snapshot.calendar_days, 30)),
      workingDays: Math.max(1, toNumber(snapshot.working_days, toNumber(snapshot.calendar_days, 30))),
      presentDays: 0,
      paidLeaveDays: 0,
      payableDays: 0,
      lopDays: 0,
      overtimeMinutes: 0,
      attendanceMinutes: 0,
      effectiveStartKey: window.startKey,
      effectiveEndKey: window.endKey,
      isSalaryWindowProrated: window.startKey > window.monthStartKey || window.endKey < window.monthEndKey
    };
  }

  const totals = eligibleRows.reduce(
    (acc, row) => {
      const dayStatus = String(row.day_status || "").toLowerCase();
      const payableUnits = toNumber(row.payable_units, 0);
      const lopUnits = toNumber(row.lop_units, 0);

      if (["present", "half_day", "half_day_present", "holiday_worked", "week_off_worked"].includes(dayStatus)) {
        acc.presentDays += payableUnits;
      }
      if (dayStatus === "unpaid_leave_half") {
        acc.presentDays += payableUnits;
      }
      if (dayStatus === "paid_leave") {
        acc.paidLeaveDays += payableUnits;
      }
      if (dayStatus === "paid_leave_half") {
        const paidLeaveUnits = Math.min(0.5, payableUnits);
        acc.paidLeaveDays += paidLeaveUnits;
        acc.presentDays += Math.max(0, payableUnits - paidLeaveUnits);
      }
      acc.payableDays += payableUnits;
      acc.lopDays += lopUnits;
      acc.overtimeMinutes += toNumber(row.overtime_minutes, 0);
      acc.attendanceMinutes += toNumber(row.attendance_minutes, 0);
      return acc;
    },
    {
      presentDays: 0,
      paidLeaveDays: 0,
      payableDays: 0,
      lopDays: 0,
      overtimeMinutes: 0,
      attendanceMinutes: 0
    }
  );

  return {
    calendarDays: Math.max(1, toNumber(snapshot.calendar_days, 30)),
    workingDays: Math.max(1, toNumber(snapshot.working_days, snapshot.calendar_days)),
    presentDays: Number(totals.presentDays.toFixed(2)),
    paidLeaveDays: Number(totals.paidLeaveDays.toFixed(2)),
    payableDays: Number(totals.payableDays.toFixed(2)),
    lopDays: Number(totals.lopDays.toFixed(2)),
    overtimeMinutes: Math.round(totals.overtimeMinutes),
    attendanceMinutes: Math.round(totals.attendanceMinutes),
    effectiveStartKey: window.startKey,
    effectiveEndKey: window.endKey,
    isSalaryWindowProrated: window.startKey > window.monthStartKey || window.endKey < window.monthEndKey
  };
};

const getPayrollProrationUnits = ({ salaryProrationRule, presentDays, paidLeaveDays, payableDays }) =>
  Number((
    salaryProrationRule === "present_days_on_working_days"
      ? toNumber(presentDays, 0) + toNumber(paidLeaveDays, 0)
      : toNumber(payableDays, 0)
  ).toFixed(2));

const getComponentPayGroupIds = (component) => {
  const metadata = parseJson(component?.metadata, {});
  const metadataValues = Array.isArray(metadata?.payGroupIds)
    ? metadata.payGroupIds
    : Array.isArray(metadata?.applicability?.payGroupIds)
      ? metadata.applicability.payGroupIds
      : [];
  const columnValues = [
    component?.pay_group_id,
    component?.payGroupId,
    ...(Array.isArray(component?.pay_group_ids) ? component.pay_group_ids : []),
    ...(Array.isArray(component?.payGroupIds) ? component.payGroupIds : [])
  ];

  return [
    ...new Set(
      [...columnValues, ...metadataValues]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  ];
};

const getEmployeeComponentOverrides = (salary) => {
  const salaryMeta = parseJson(salary?.metadata, {});
  const rules = parseJson(salaryMeta.salaryRules, {});
  return parseJson(rules.componentOverrides || salaryMeta.componentOverrides, {});
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

const isComponentEnabledForEmployee = ({ component, payGroupId, salary }) => {
  const componentMeta = parseJson(component?.metadata, {});
  const payGroupIds = getComponentPayGroupIds(component);
  if (payGroupIds.length && (!payGroupId || !payGroupIds.includes(String(payGroupId)))) {
    return false;
  }

  const componentCode = String(component?.code || "").trim().toUpperCase();
  const salaryMeta = parseJson(salary?.metadata, {});
  const rules = parseJson(salaryMeta.salaryRules, {});
  if (rules.includePf === false && PF_COMPONENT_CODES.has(componentCode)) return false;
  if (rules.includeEsi === false && ESI_COMPONENT_CODES.has(componentCode)) return false;

  const overrides = getEmployeeComponentOverrides(salary);
  const override =
    overrides?.[componentCode] ||
    overrides?.[`${String(component?.component_scope || "").trim()}:${componentCode}`] ||
    null;

  if (override?.enabled === false) return false;

  const defaultEnabled = componentMeta.defaultEnabled !== false;
  return defaultEnabled || override?.enabled === true;
};

const applyEmployeeComponentOverride = ({ component, salary }) => {
  const componentCode = String(component?.code || "").trim().toUpperCase();
  const overrides = getEmployeeComponentOverrides(salary);
  const override =
    overrides?.[componentCode] ||
    overrides?.[`${String(component?.component_scope || "").trim()}:${componentCode}`] ||
    null;

  if (!override) return component;

  const metadata = {
    ...parseJson(component?.metadata, {}),
    ...parseJson(override?.metadata, {})
  };

  const overrideCalculationMode = override.calculationMode || component.calculation_mode;
  if (override.amount != null) {
    if (overrideCalculationMode === "percentage") {
      metadata.percentage = toNumber(override.amount, 0);
    } else {
      metadata.monthlyAmount = toNumber(override.amount, 0);
    }
  }
  if (override.percentage != null) {
    metadata.percentage = toNumber(override.percentage, 0);
  }
  if (override.base) {
    metadata.base = String(override.base);
  }
  if (override.formulaExpression) {
    metadata.expression = String(override.formulaExpression);
  }
  if (
    componentCode === "BONUS" &&
    (override.bonusCreditTiming || override.bonusEligibilityDate || override.bonusPayoutMonths || override.metadata?.bonusRule)
  ) {
    metadata.bonusRule = {
      ...parseJson(metadata.bonusRule, {}),
      ...parseJson(override.metadata?.bonusRule, {}),
      creditTiming: override.bonusCreditTiming || override.metadata?.bonusRule?.creditTiming || "after_probation",
      eligibilityDate:
        override.bonusEligibilityDate ||
        override.metadata?.bonusRule?.eligibilityDate ||
        null,
      payoutMonths: toNumber(
        override.bonusPayoutMonths || override.metadata?.bonusRule?.payoutMonths || 1,
        1
      )
    };
  }
  if (Array.isArray(override.slabs)) {
    metadata.slabs = override.slabs;
  }
  if (override.maxAmount != null) {
    metadata.maxAmount = toNumber(override.maxAmount, 0);
  }

  return {
    ...component,
    name: override.name || component.name,
    display_name: override.displayName || component.display_name,
    taxable: typeof override.taxable === "boolean" ? override.taxable : component.taxable,
    calculation_mode: overrideCalculationMode,
    metadata
  };
};

const computeSalaryContextFromRules = ({ salary }) => {
  const annualCtc = toNumber(salary.annual_ctc, 0);
  const monthlyCtc = annualCtc / 12;
  const salaryMeta = parseJson(salary.metadata, {});
  const rules = parseJson(salaryMeta.salaryRules, {});
  const variablePayApprovalStatus = String(
    rules.variablePayApprovalStatus || salaryMeta.variablePayApprovalStatus || "pending"
  ).toLowerCase();
  const variablePayTargetMonthly = toNumber(
    rules.variablePayTargetMonthly,
    toNumber(salary.variable_pay_target, toNumber(salary.variable_pay, 0))
  );
  const variablePayApprovedAmountMonthly = toNumber(
    rules.variablePayApprovedAmount,
    variablePayApprovalStatus === "approved" || variablePayApprovalStatus === "partial"
      ? toNumber(salary.variable_pay, 0)
      : 0
  );
  const variablePayReleaseMonths = Math.max(1, Math.floor(toNumber(rules.variablePayReleaseMonths, 12)));
  const variablePayApprovalMonth = String(
    rules.variablePayApprovalMonth || salaryMeta.variablePayApprovalMonth || ""
  ).slice(0, 7);
  const grossBeforeVariablePayConfigured = Math.max(
    0,
    toNumber(
      rules.grossBeforeVariablePay,
      toNumber(salary.gross_before_variable_pay, 0)
    )
  );

  const hasRuleOverride = Object.keys(rules).length > 0;
  if (!hasRuleOverride) {
    const monthlyGross =
      Math.max(0, toNumber(salary.monthly_gross, 0) || monthlyCtc);
    const basicPay = toNumber(salary.basic_pay, 0) || monthlyGross * 0.4;
    return {
      monthlyCtc,
      monthlyGross,
      grossBeforeVariablePay: Math.max(0, toNumber(salary.monthly_gross, 0) || monthlyCtc),
      basicPay,
      variablePay: 0,
      variablePayTargetMonthly,
      variablePayApprovedAmountMonthly,
      variablePayReleaseMonths,
      variablePayApprovalMonth,
      employerEpf: 0,
      esiAmount: 0,
      effectiveBasicPercent: basicPay > 0 && monthlyCtc > 0 ? (basicPay / monthlyCtc) * 100 : 0,
      hraPercentOfBasic: 0
    };
  }

  const roundPayrollAmount = (value) => Number(toNumber(value, 0).toFixed(2));
  const computeEmployerEpfAmount = ({
    basicPay,
    epfMode,
    epfFixedAmount,
    epfEmployerRate,
    restrictPfWage,
    pfWageCeiling
  }) => {
    const epfBase = restrictPfWage ? Math.min(basicPay, pfWageCeiling) : basicPay;
    return epfMode === "fixed"
      ? epfFixedAmount
      : roundPayrollAmount((epfBase * epfEmployerRate) / 100);
  };
  const computeEmployerEsiAmount = ({ monthlyGross, includeEsi, esiEligibilityThreshold, esiEmployerRate }) =>
    includeEsi && monthlyGross > 0 && monthlyGross <= esiEligibilityThreshold
      ? roundPayrollAmount((monthlyGross * esiEmployerRate) / 100)
      : 0;
  const deriveGrossFromMonthlyCtc = ({ fixedBasicPay }) => {
    const reservedVariablePayTarget = Math.max(0, variablePayTargetMonthly);
    let monthlyGross = grossBeforeVariablePayConfigured > 0
      ? grossBeforeVariablePayConfigured
      : Math.max(0, monthlyCtc || toNumber(salary.monthly_gross, 0));

    for (let index = 0; index < 25; index += 1) {
      const basicPay = fixedBasicPay > 0
        ? fixedBasicPay
        : roundPayrollAmount(monthlyGross * (effectiveBasicPercent / 100));
      const employerEpf = computeEmployerEpfAmount({
        basicPay,
        epfMode,
        epfFixedAmount,
        epfEmployerRate,
        restrictPfWage,
        pfWageCeiling
      });
      const employerEsiAmount = computeEmployerEsiAmount({
        monthlyGross,
        includeEsi,
        esiEligibilityThreshold,
        esiEmployerRate
      });
      const nextGross = roundPayrollAmount(
        Math.max(0, monthlyCtc - employerEpf - employerEsiAmount - reservedVariablePayTarget)
      );
      if (Math.abs(nextGross - monthlyGross) < 0.01) {
        monthlyGross = nextGross;
        break;
      }
      monthlyGross = nextGross;
    }

    const basicPay = fixedBasicPay > 0
      ? fixedBasicPay
      : roundPayrollAmount(monthlyGross * (effectiveBasicPercent / 100));
    const employerEpf = computeEmployerEpfAmount({
      basicPay,
      epfMode,
      epfFixedAmount,
      epfEmployerRate,
      restrictPfWage,
      pfWageCeiling
    });
    const employerEsiAmount = computeEmployerEsiAmount({
      monthlyGross,
      includeEsi,
      esiEligibilityThreshold,
      esiEmployerRate
    });

    return {
      monthlyGross,
      basicPay,
      employerEpf,
      employerEsiAmount
    };
  };

  const payGroupBasicPercent = toNumber(rules.payGroupBasicPercent, 50);
  const basicPercentSource = String(rules.basicPercentSource || "pay_group");
  const employeeBasicPercent = toNumber(rules.employeeBasicPercent, payGroupBasicPercent);
  const effectiveBasicPercent =
    basicPercentSource === "employee" ? employeeBasicPercent : payGroupBasicPercent;
  const includeHra = rules.includeHra !== false;
  const hraPercentOfBasic = includeHra ? toNumber(rules.hraPercentOfBasic, 50) : 0;
  const pfWageCeiling = toNumber(rules.pfWageCeiling, 15000);
  const epfEmployeeRate = toNumber(rules.epfEmployeeRate, 12);
  const epfEmployerRate = toNumber(rules.epfEmployerRate, 12);
  const esiEligibilityThreshold = toNumber(rules.esiEligibilityThreshold, 21000);
  const esiEmployeeRate = toNumber(rules.esiEmployeeRate, 0.75);
  const esiEmployerRate = toNumber(rules.esiEmployerRate, 3.25);
  const bonusAmount = toNumber(rules.bonusAmount, 0);
  const tdsAmount = toNumber(rules.tdsAmount, 0);

  const epfMode = String(rules.epfMode || "percentage");
  const epfPercentOfBasic = toNumber(rules.epfPercentOfBasic, 12);
  const epfFixedAmount = toNumber(rules.epfFixedAmount, 0);
  const restrictPfWage = rules.restrictPfWage !== false;
  const includeEsi = rules.includeEsi === true;
  const storedBasicPay = toNumber(salary.basic_pay, 0);
  const derivedSalary = deriveGrossFromMonthlyCtc({ fixedBasicPay: storedBasicPay });
  const basicPay = derivedSalary.basicPay;
  const employerEpf = derivedSalary.employerEpf;
  const grossBeforeVariablePay = derivedSalary.monthlyGross;
  const ctcAllocatableGross = grossBeforeVariablePay + variablePayTargetMonthly;
  const esiWages = toNumber(rules.esiWages, 0) || grossBeforeVariablePay;
  const esiCovered = includeEsi && esiWages > 0 && esiWages <= esiEligibilityThreshold;
  const esiEmployeeAmount = esiCovered ? (esiWages * esiEmployeeRate) / 100 : 0;
  const esiEmployerAmount = derivedSalary.employerEsiAmount;
  const hraAmount = (basicPay * hraPercentOfBasic) / 100;

  return {
    monthlyCtc,
    monthlyGross: Math.max(0, grossBeforeVariablePay),
    ctcAllocatableGross: Math.max(0, ctcAllocatableGross),
    grossBeforeVariablePay: Math.max(0, grossBeforeVariablePay),
    basicPay: Math.max(0, basicPay),
    variablePay: 0,
    variablePayTargetMonthly: Math.max(0, variablePayTargetMonthly),
    variablePayApprovedAmountMonthly: Math.max(0, variablePayApprovedAmountMonthly),
    variablePayReleaseMonths,
    variablePayApprovalMonth,
    variablePayApprovalStatus,
    employerEpf: Math.max(0, employerEpf),
    esiEmployeeAmount: Math.max(0, esiEmployeeAmount),
    esiEmployerAmount: Math.max(0, esiEmployerAmount),
    pfWageCeiling,
    epfEmployeeRate,
    epfEmployerRate,
    esiEligibilityThreshold,
    esiEmployeeRate,
    esiEmployerRate,
    bonusAmount: Math.max(0, bonusAmount),
    tdsAmount: Math.max(0, tdsAmount),
    effectiveBasicPercent: Math.max(0, effectiveBasicPercent),
    hraPercentOfBasic: Math.max(0, hraPercentOfBasic)
  };
};

const findFormulaForComponent = (formulaMap, scope, componentId) => {
  const entries = formulaMap.get(`${scope}:${componentId}`) || [];
  if (!entries.length) return null;
  return entries[0];
};

const FORMULA_HELPER_NAMES = new Set([
  "min",
  "max",
  "round",
  "ceil",
  "floor",
  "abs",
  "pow",
  "if",
  "__if"
]);

const tokenizeIdentifiers = (expression) => {
  const matches = String(expression).match(/[A-Za-z_][A-Za-z0-9_]*/g);
  return matches ? [...new Set(matches)] : [];
};

const getComponentFormulaExpression = ({ component, scope, formulaMap }) => {
  const metadata = parseJson(component?.metadata, {});
  const formula = findFormulaForComponent(formulaMap, scope, component?.id);
  if (formula?.formula_expression) return String(formula.formula_expression);
  if (component?.calculation_mode === "formula" && metadata.expression) {
    return String(metadata.expression);
  }
  if (component?.calculation_mode === "percentage") {
    return `${String(metadata.base || "MONTHLY_GROSS")} * ${toNumber(metadata.percentage, 0)} / 100`;
  }
  if (component?.calculation_mode === "slab") {
    return `slab(${String(metadata.base || "MONTHLY_GROSS")})`;
  }

  const componentCode = toVarKey(component?.code);
  if (scope === "earning") {
    if (componentCode === "BASIC") return "BASIC_PAY";
    if (componentCode === "HRA") return "BASIC_PAY * HRA_PERCENT_OF_BASIC / 100";
    if (componentCode === "VARIABLE" || componentCode === "VARIABLE_PAY") {
      return "VARIABLE_PAY";
    }
    if (componentCode === "OTHER_ALLOWANCE") {
      return "max(MONTHLY_GROSS - BASIC - HRA, 0)";
    }
    if (componentCode === "BONUS") return "BONUS_AMOUNT";
  }
  if (scope === "deduction") {
    if (componentCode === "EPF" || componentCode === "EMPLOYEEPF") {
      return "min(BASIC_PAY, PF_WAGE_LIMIT) * EPF_EMPLOYEE_RATE / 100";
    }
    if (componentCode === "ESI") return "ESI_EMPLOYEE_AMOUNT";
    if (componentCode === "TDS") return "TDS_AMOUNT";
  }
  if (scope === "employer_contribution") {
    if (componentCode === "EMPLOYER_EPF" || componentCode === "EMPLOYERPF") {
      return "EMPLOYER_EPF";
    }
    if (componentCode === "ESI_ER") return "ESI_EMPLOYER_AMOUNT";
    if (componentCode === "GRATUITY") return "BASIC_PAY * 0.0481";
  }

  return `fixed(${toNumber(
    metadata.monthlyAmount ?? metadata.amount ?? metadata.defaultAmount,
    0
  )})`;
};

const isLegacyEmployerContributionComponent = (component) => {
  const componentCode = toVarKey(component?.code);
  if (componentCode === "EMPLOYER_EPF" || componentCode === "EMPLOYERPF") {
    return true;
  }

  const componentName = String(component?.name || component?.display_name || "")
    .trim()
    .toLowerCase();
  return componentName === "employer pf" || componentName === "employer provident fund";
};

const orderComponentsByDependencies = ({ components, scope, formulaMap }) => {
  const remaining = [...components];
  const ordered = [];
  const componentCodes = new Set(remaining.map((component) => toVarKey(component.code)));
  const resolvedCodes = new Set();

  while (remaining.length) {
    const nextIndex = remaining.findIndex((component) => {
      const componentCode = toVarKey(component.code);
      const expression = getComponentFormulaExpression({ component, scope, formulaMap });
      const dependencies = tokenizeIdentifiers(expression)
        .map(toVarKey)
        .filter(
          (identifier) =>
            !FORMULA_HELPER_NAMES.has(identifier.toLowerCase()) &&
            identifier !== componentCode &&
            componentCodes.has(identifier)
        );
      return dependencies.every((identifier) => resolvedCodes.has(identifier));
    });

    if (nextIndex < 0) {
      ordered.push(...remaining);
      break;
    }

    const [component] = remaining.splice(nextIndex, 1);
    ordered.push(component);
    resolvedCodes.add(toVarKey(component.code));
  }

  return ordered;
};

const buildComponentFormulaSnapshot = ({
  component,
  scope,
  formulaMap,
  context,
  prorationFactor,
  amount
}) => {
  const expression = getComponentFormulaExpression({ component, scope, formulaMap });
  const inputs = {};
  for (const identifier of tokenizeIdentifiers(expression)) {
    if (FORMULA_HELPER_NAMES.has(identifier.toLowerCase())) continue;
    const key = toVarKey(identifier);
    if (Object.prototype.hasOwnProperty.call(context, key)) {
      inputs[key] = roundAmount(context[key], "exact");
    }
  }

  return {
    expression,
    inputs,
    prorationFactor:
      scope === "earning" ? roundAmount(prorationFactor, "exact") : 1,
    calculatedAmount: roundAmount(amount, "exact")
  };
};

const normalizeConditionalFormulaExpression = (expression) =>
  String(expression || "")
    .replace(/\bif\s*\(/gi, "__if(")
    .trim();

const evaluateFormula = (expression, context = {}) => {
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
    __if: (condition, trueValue, falseValue) => (condition ? trueValue : falseValue)
  };

  const mergedContext = { ...helpers, ...context };
  const identifiers = tokenizeIdentifiers(expr);

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
  return toNumber(result, 0);
};

const computeSlabAmount = (baseValue, slabs) => {
  if (!Array.isArray(slabs) || !slabs.length) return 0;
  const input = toNumber(baseValue, 0);
  let amount = 0;

  for (const slab of slabs) {
    const upto = slab?.upto == null ? null : toNumber(slab.upto);
    const fixedAmount = toNumber(slab.amount, 0);
    const rate = toNumber(slab.rate, 0);
    if (upto == null || input <= upto) {
      amount = fixedAmount || (input * rate) / 100;
      break;
    }
  }

  return amount;
};

const applyBonusReleaseRule = ({ amount, component, metadata, payMonth }) => {
  if (String(component?.code || "").trim().toUpperCase() !== "BONUS") return amount;

  const bonusRule = parseJson(metadata?.bonusRule, {});
  const payoutMonths = Math.max(1, Math.min(12, Math.floor(toNumber(bonusRule.payoutMonths, 1))));
  const creditTiming = String(bonusRule.creditTiming || "immediate");
  if (creditTiming === "immediate") {
    return amount / payoutMonths;
  }

  const eligibilityMonth = toMonthKey(bonusRule.eligibilityDate);
  if (!eligibilityMonth || !payMonth) return 0;

  const offset = monthDiff(eligibilityMonth, payMonth);
  if (offset < 0 || offset >= payoutMonths) return 0;
  return amount / payoutMonths;
};

const resolveComponentAmount = ({
  component,
  scope,
  formulaMap,
  context,
  prorationFactor,
  shouldProrateEarning,
  payMonth
}) => {
  const metadata = parseJson(component.metadata, {});
  const formula = findFormulaForComponent(formulaMap, scope, component.id);
  let amount = 0;

  const componentCode = String(component?.code || "").trim().toUpperCase();
  const fallbackFromContext = () => {
    switch (scope) {
      case "earning":
        if (componentCode === "BASIC") return toNumber(context.BASIC_PAY, 0);
        if (componentCode === "HRA") {
          return (toNumber(context.BASIC_PAY, 0) * toNumber(context.HRA_PERCENT_OF_BASIC, 0)) / 100;
        }
        if (componentCode === "VARIABLE") return toNumber(context.VARIABLE_PAY, 0);
        if (componentCode === "OTHER_ALLOWANCE") {
          return Math.max(
            0,
            toNumber(context.MONTHLY_GROSS, 0) -
              toNumber(context.BASIC, 0) -
              toNumber(context.HRA, 0) -
              toNumber(context.VARIABLE, 0)
          );
        }
        if (componentCode === "BONUS") return toNumber(context.BONUS_AMOUNT, 0);
        break;
      case "deduction":
        if (componentCode === "EPF") {
          return (Math.min(toNumber(context.BASIC_PAY, 0), toNumber(context.PF_WAGE_LIMIT, 15000)) *
            toNumber(context.EPF_EMPLOYEE_RATE, 12)) / 100;
        }
        if (componentCode === "ESI") return toNumber(context.ESI_EMPLOYEE_AMOUNT, 0);
        if (componentCode === "TDS") return toNumber(context.TDS_AMOUNT, 0);
        if (componentCode === "PT") return computeSlabAmount(toNumber(context.MONTHLY_GROSS, 0), metadata.slabs);
        break;
      case "employer_contribution":
        if (componentCode === "EMPLOYER_EPF") return toNumber(context.EMPLOYER_EPF, 0);
        if (componentCode === "ESI_ER") return toNumber(context.ESI_EMPLOYER_AMOUNT, 0);
        if (componentCode === "GRATUITY") {
          return (toNumber(context.BASIC_PAY, 0) * 0.0481);
        }
        break;
      default:
        break;
    }
    return 0;
  };

  if (formula?.formula_expression) {
    const formulaVars = parseJson(formula.formula_variables, {});
    try {
      amount = evaluateFormula(formula.formula_expression, { ...context, ...formulaVars });
    } catch (error) {
      amount = fallbackFromContext();
    }
  } else if (component.calculation_mode === "percentage") {
    const baseKey = String(metadata.base || "MONTHLY_GROSS");
    const percentage = toNumber(metadata.percentage, 0);
    amount = (toNumber(context[baseKey], 0) * percentage) / 100;
  } else if (component.calculation_mode === "slab") {
    const baseKey = String(metadata.base || "MONTHLY_GROSS");
    amount = computeSlabAmount(toNumber(context[baseKey], 0), metadata.slabs);
  } else if (component.calculation_mode === "formula") {
    amount = evaluateFormula(String(metadata.expression || "0"), context);
  } else {
    amount = toNumber(
      metadata.monthlyAmount ?? metadata.amount ?? metadata.defaultAmount ?? 0,
      0
    );
    if (!amount) amount = fallbackFromContext();
  }

  if (scope === "earning" && shouldProrateEarning(component, metadata)) {
    amount *= prorationFactor;
  }

  amount = applyBonusReleaseRule({ amount, component, metadata, payMonth });

  const maxAmount = toNumber(metadata.maxAmount, 0);
  if (maxAmount > 0) {
    amount = Math.min(amount, maxAmount);
  }
  if (component.cap_amount != null) {
    amount = Math.min(amount, toNumber(component.cap_amount, amount));
  }

  return roundAmount(amount, component.rounding_policy);
};

const sortByPriority = (rows) =>
  [...rows].sort((a, b) => toNumber(a.priority, 100) - toNumber(b.priority, 100));

const mapByEmployee = (rows, key = "employee_external_id") => {
  const map = new Map();
  for (const row of rows) {
    const employeeId = String(row[key]);
    if (!map.has(employeeId)) map.set(employeeId, []);
    map.get(employeeId).push(row);
  }
  return map;
};

const normalizeComponentRows = (rows) => {
  const merged = new Map();
  for (const row of rows) {
    const key = `${row.component_scope}|${row.component_code}|${row.source_type}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        ...row,
        metadata: { ...(row.metadata || {}) }
      });
      continue;
    }

    existing.amount = roundAmount(toNumber(existing.amount, 0) + toNumber(row.amount, 0), "exact");
    existing.quantity = existing.quantity == null && row.quantity == null
      ? null
      : toNumber(existing.quantity, 0) + toNumber(row.quantity, 0);
    existing.rate = row.rate ?? existing.rate ?? null;
    existing.taxable = Boolean(existing.taxable || row.taxable);
    existing.affects_net_pay = Boolean(existing.affects_net_pay || row.affects_net_pay);
    existing.remarks = [existing.remarks, row.remarks].filter(Boolean).join(" | ") || null;
    existing.metadata = {
      ...(existing.metadata || {}),
      mergedLineCount: toNumber(existing.metadata?.mergedLineCount, 1) + 1
    };
  }

  return [...merged.values()];
};

const insertRunComponents = async (client, runEmployeeId, actorId, rows) => {
  if (!rows.length) return;

  const columns = [
    "tenant_id",
    "payroll_run_id",
    "payroll_run_employee_id",
    "component_scope",
    "component_code",
    "component_name",
    "source_type",
    "calculation_mode",
    "quantity",
    "rate",
    "amount",
    "taxable",
    "affects_net_pay",
    "formula_snapshot",
    "remarks",
    "metadata",
    "created_by",
    "updated_by"
  ];

  const params = [];
  const values = [];
  let p = 1;
  for (const row of rows) {
    params.push(
      `($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`
    );
    values.push(
      row.tenant_id,
      row.payroll_run_id,
      runEmployeeId,
      row.component_scope,
      row.component_code,
      row.component_name,
      row.source_type,
      row.calculation_mode,
      row.quantity ?? null,
      row.rate ?? null,
      row.amount,
      row.taxable,
      row.affects_net_pay,
      row.formula_snapshot ? JSON.stringify(row.formula_snapshot) : null,
      row.remarks || null,
      JSON.stringify(row.metadata || {}),
      actorId,
      actorId
    );
  }

  await client.query(
    `INSERT INTO payroll_run_components (${columns.join(",")}) VALUES ${params.join(",")}`,
    values
  );
};

const getTenantId = async (client, organizationId) => {
  const result = await client.query(
    `SELECT id FROM payroll_tenants WHERE organization_id = $1`,
    [String(organizationId)]
  );
  return result.rows[0]?.id || null;
};

exports.computePayrollRun = async (req) => {
  const startedAt = Date.now();
  const runId = String(req.params.runId);
  const organizationId = String(req.user.organizationId);
  const actorId = String(req.user.userId);
  const { employeeIds = [], forceRecompute = false, _executionMode = "sync" } = req.body;

  const pool = await getPayrollPgPool();
  if (!pool) throw { code: 400, message: "Payroll Postgres is not enabled" };

  const client = await pool.connect();
  let runAdvisoryLockAcquired = false;
  try {
    logger.info("payroll.compute.started", {
      runId,
      organizationId,
      actorId,
      forceRecompute,
      executionMode: _executionMode,
      employeeFilterCount: employeeIds.length
    });

    const tenantId = await getTenantIdForOrganization(client, organizationId, {
      actorId
    });

    const initialRunResult = await client.query(
      `
        SELECT id, pay_month, status
        FROM payroll_runs
        WHERE id = $1 AND tenant_id = $2
      `,
      [runId, tenantId]
    );
    const initialRun = initialRunResult.rows[0];
    if (!initialRun) throw { code: 404, message: "Payroll run not found" };
    if (["locked", "paid", "cancelled"].includes(initialRun.status)) {
      throw {
        code: 409,
        message: `Payroll run cannot be recomputed in status: ${initialRun.status}`
      };
    }

    const advisoryLockResult = await client.query(
      `SELECT pg_try_advisory_lock(hashtext($1)) AS acquired`,
      [runId]
    );
    runAdvisoryLockAcquired = advisoryLockResult.rows[0]?.acquired === true;
    if (!runAdvisoryLockAcquired) {
      throw {
        code: 409,
        message: "This payroll run is already being recomputed. Please wait for it to finish."
      };
    }

    if (forceRecompute) {
      const existingRunEmployeesResult = await client.query(
        `
          SELECT employee_external_id
          FROM payroll_run_employees
          WHERE payroll_run_id = $1
            AND tenant_id = $2
        `,
        [runId, tenantId]
      );
      const runScopedEmployeeIds = existingRunEmployeesResult.rows
        .map((row) => String(row.employee_external_id || "").trim())
        .filter(Boolean);
      const effectiveEmployeeIds = employeeIds.length > 0 ? employeeIds : runScopedEmployeeIds;
      const payrollAttendanceService = require("./payrollAttendance.service");
      const snapshotRefreshResult =
        await payrollAttendanceService.generateMonthlyAttendanceSnapshots({
          ...req,
          body: {
            month: initialRun.pay_month,
            forceRebuild: true,
            employeeIds: effectiveEmployeeIds.length ? effectiveEmployeeIds : undefined
          }
        });

      logger.info("payroll.compute.snapshots.refreshed", {
        runId,
        organizationId,
        month: initialRun.pay_month,
        employeeFilterCount: effectiveEmployeeIds.length,
        generatedCount: snapshotRefreshResult?.generatedCount || 0
      });
    }

    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '60s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '60s'");

    const runResult = await client.query(
      `
        SELECT *
        FROM payroll_runs
        WHERE id = $1 AND tenant_id = $2
        FOR UPDATE NOWAIT
      `,
      [runId, tenantId]
    );
    const run = runResult.rows[0];
    if (!run) throw { code: 404, message: "Payroll run not found" };
    if (["locked", "paid", "cancelled"].includes(run.status)) {
      throw { code: 409, message: `Payroll run cannot be recomputed in status: ${run.status}` };
    }

    const settingsResult = await client.query(
      `SELECT * FROM payroll_settings WHERE tenant_id = $1 LIMIT 1`,
      [tenantId]
    );
    const settings = settingsResult.rows[0] || {};
    const settingsMetadata = parseJson(settings.metadata, {});
    const payrollTimeZone = String(settings.timezone || DEFAULT_PAYROLL_TIMEZONE);
    const orgSettings = await OrgSettings.findOne({ organizationId: req.user.organizationId })
      .select("salaryProrationRule")
      .lean();
    const salaryProrationRule = String(
      settingsMetadata?.attendance?.salaryProrationRule ||
      orgSettings?.salaryProrationRule ||
      "payable_days"
    );
    const autoOvertimeEnabled =
      typeof settingsMetadata?.attendance?.enableAutoOvertime === "boolean"
        ? settingsMetadata.attendance.enableAutoOvertime
        : true;

    const month = run.pay_month;
    const periodEnd = monthEndDate(month);
    const existingRunEmployeesResult = await client.query(
      `
        SELECT employee_external_id
        FROM payroll_run_employees
        WHERE payroll_run_id = $1
          AND tenant_id = $2
      `,
      [runId, tenantId]
    );
    const runScopedEmployeeIds = existingRunEmployeesResult.rows
      .map((row) => String(row.employee_external_id || "").trim())
      .filter(Boolean);
    const effectiveEmployeeIds = employeeIds.length > 0 ? employeeIds : runScopedEmployeeIds;
    const filterByEmployees = effectiveEmployeeIds.length > 0;

    const snapshotsResult = await client.query(
      `
        SELECT *
        FROM payroll_attendance_snapshots
        WHERE tenant_id = $1
          AND pay_month = $2
          ${filterByEmployees ? "AND employee_external_id = ANY($3::varchar[])" : ""}
      `,
      filterByEmployees ? [tenantId, month, effectiveEmployeeIds] : [tenantId, month]
    );
    const snapshots = snapshotsResult.rows;
    if (!snapshots.length) {
      throw { code: 400, message: `No attendance snapshots found for pay month ${month}` };
    }

    const snapshotIds = snapshots.map((row) => row.id).filter(Boolean);
    const snapshotDaysResult = snapshotIds.length
      ? await client.query(
          `
            SELECT
              snapshot_id,
              day_date,
              day_status,
              payable_units,
              lop_units,
              overtime_minutes,
              attendance_minutes,
              week_off_applied,
              is_holiday
            FROM payroll_attendance_snapshot_days
            WHERE snapshot_id = ANY($1::uuid[])
            ORDER BY snapshot_id, day_date
          `,
          [snapshotIds]
        )
      : { rows: [] };
    const snapshotDaysBySnapshotId = new Map();
    for (const row of snapshotDaysResult.rows) {
      const key = String(row.snapshot_id);
      const rows = snapshotDaysBySnapshotId.get(key) || [];
      rows.push(row);
      snapshotDaysBySnapshotId.set(key, rows);
    }

    const allEmployeeExternalIds = snapshots.map((row) => String(row.employee_external_id));
    const profileResult = await client.query(
      `
        SELECT id, employee_external_id, pay_group_id, tax_regime
        FROM employee_payroll_profiles
        WHERE tenant_id = $1
          AND employee_external_id = ANY($2::varchar[])
      `,
      [tenantId, allEmployeeExternalIds]
    );
    const profileMap = new Map(
      profileResult.rows.map((row) => [String(row.employee_external_id), row])
    );

    const snapshotsForRun = snapshots.filter((row) => {
      const employeeId = String(row.employee_external_id || "").trim();
      const profile = profileMap.get(employeeId);
      if (!employeeId || !profile) return false;
      if (run.pay_group_id && String(profile.pay_group_id || "") !== String(run.pay_group_id)) {
        return false;
      }
      return true;
    });
    const runWarnings = new Set();
    if (snapshotsForRun.length !== snapshots.length) {
      runWarnings.add(
        "Some attendance snapshots were excluded because the employee payroll profile was not found for this run."
      );
    }
    if (!snapshotsForRun.length) {
      throw {
        code: 409,
        message: `No eligible employees found for the selected payroll run in pay month ${month}`
      };
    }

    await client.query(
      `
        DELETE FROM payroll_run_components
        WHERE payroll_run_employee_id IN (
          SELECT id
          FROM payroll_run_employees
          WHERE payroll_run_id = $1
            AND tenant_id = $2
        )
      `,
      [runId, tenantId]
    );
    await client.query(
      `
        DELETE FROM payroll_run_employees
        WHERE payroll_run_id = $1
          AND tenant_id = $2
      `,
      [runId, tenantId]
    );

    const eligibleEmployeeExternalIds = snapshotsForRun.map((row) => String(row.employee_external_id));
    await client.query(
      `
        DELETE FROM payroll_run_employees
        WHERE payroll_run_id = $1
          AND tenant_id = $2
          AND NOT (employee_external_id = ANY($3::varchar[]))
      `,
      [runId, tenantId, eligibleEmployeeExternalIds]
    );
    const employeeRows = await Employee.find({ _id: { $in: eligibleEmployeeExternalIds } })
      .select("_id confirmedDate dateOfJoining employmentLifecycleStatus")
      .lean();
    const employeeMap = new Map(employeeRows.map((employee) => [String(employee._id), employee]));

    const profileIds = profileResult.rows.map((row) => row.id);
    const salaryResult =
      profileIds.length > 0
        ? await client.query(
            `
              SELECT DISTINCT ON (employee_payroll_profile_id) *
              FROM employee_salary_structures
              WHERE employee_payroll_profile_id = ANY($1::uuid[])
                AND effective_from <= $2::date
                AND (effective_to IS NULL OR effective_to >= $2::date)
              ORDER BY employee_payroll_profile_id, effective_from DESC, version_no DESC
            `,
            [profileIds, periodEnd.toISOString().slice(0, 10)]
          )
        : { rows: [] };
    const salaryByProfile = new Map(
      salaryResult.rows.map((row) => [String(row.employee_payroll_profile_id), row])
    );
    const statutoryResult =
      profileIds.length > 0
        ? await client.query(
            `
              SELECT DISTINCT ON (employee_payroll_profile_id) *
              FROM employee_statutory_details
              WHERE employee_payroll_profile_id = ANY($1::uuid[])
                AND effective_from <= $2::date
                AND (effective_to IS NULL OR effective_to >= $2::date)
              ORDER BY employee_payroll_profile_id, effective_from DESC, version_no DESC
            `,
            [profileIds, periodEnd.toISOString().slice(0, 10)]
          )
        : { rows: [] };
    const statutoryByProfile = new Map(
      statutoryResult.rows.map((row) => [String(row.employee_payroll_profile_id), row])
    );

    const [earningsResult, deductionsResult, employerResult, formulasResult] = await Promise.all([
      client.query(
        `
          SELECT *
          FROM earning_components
          WHERE tenant_id = $1
            AND is_active = true
            AND effective_from <= $2::date
            AND (effective_to IS NULL OR effective_to >= $2::date)
        `,
        [tenantId, periodEnd.toISOString().slice(0, 10)]
      ),
      client.query(
        `
          SELECT *
          FROM deduction_components
          WHERE tenant_id = $1
            AND is_active = true
            AND effective_from <= $2::date
            AND (effective_to IS NULL OR effective_to >= $2::date)
        `,
        [tenantId, periodEnd.toISOString().slice(0, 10)]
      ),
      client.query(
        `
          SELECT *
          FROM employer_contribution_components
          WHERE tenant_id = $1
            AND is_active = true
            AND effective_from <= $2::date
            AND (effective_to IS NULL OR effective_to >= $2::date)
        `,
        [tenantId, periodEnd.toISOString().slice(0, 10)]
      ),
      client.query(
        `
          SELECT *
          FROM component_formulas
          WHERE tenant_id = $1
            AND is_active = true
            AND effective_from <= $2::date
            AND (effective_to IS NULL OR effective_to >= $2::date)
          ORDER BY execution_order ASC, version_no DESC, effective_from DESC
        `,
        [tenantId, periodEnd.toISOString().slice(0, 10)]
      )
    ]);

    const earningComponents = sortByPriority(earningsResult.rows);
    const deductionComponents = sortByPriority(deductionsResult.rows);
    const legacyEmployerComponents = deductionComponents.filter(
      isLegacyEmployerContributionComponent
    );
    const employeeDeductionComponents = deductionComponents.filter(
      (component) => !isLegacyEmployerContributionComponent(component)
    );
    const employerComponents = sortByPriority(employerResult.rows);
    const formulaMap = new Map();
    for (const row of formulasResult.rows) {
      const componentId =
        row.earning_component_id ||
        row.deduction_component_id ||
        row.employer_contribution_component_id;
      const key = `${row.component_scope}:${componentId}`;
      if (!formulaMap.has(key)) formulaMap.set(key, []);
      formulaMap.get(key).push(row);
    }

    const adjustmentsResult = await client.query(
      `
        SELECT *
        FROM payroll_adjustments
        WHERE tenant_id = $1
          AND effective_month = $2
          AND approval_status = 'approved'
          AND employee_external_id = ANY($3::varchar[])
          AND (payroll_run_id IS NULL OR payroll_run_id = $4)
      `,
      [tenantId, month, eligibleEmployeeExternalIds, runId]
    );
    const arrearsResult = await client.query(
      `
        SELECT *
        FROM payroll_arrears
        WHERE tenant_id = $1
          AND current_effective_month = $2
          AND status IN ('pending', 'processed')
          AND employee_external_id = ANY($3::varchar[])
          AND (payroll_run_id IS NULL OR payroll_run_id = $4)
      `,
      [tenantId, month, eligibleEmployeeExternalIds, runId]
    );
    const reimbursementsResult = await client.query(
      `
        SELECT *
        FROM payroll_reimbursements
        WHERE tenant_id = $1
          AND effective_month = $2
          AND payout_status IN ('approved', 'paid')
          AND employee_external_id = ANY($3::varchar[])
          AND (payroll_run_id IS NULL OR payroll_run_id = $4)
      `,
      [tenantId, month, eligibleEmployeeExternalIds, runId]
    );
    const loansResult = await client.query(
      `
        SELECT *
        FROM payroll_loans
        WHERE tenant_id = $1
          AND employee_external_id = ANY($2::varchar[])
          AND loan_status = 'active'
          AND start_month <= $3
          AND (end_month IS NULL OR end_month >= $3)
          AND (payroll_run_id IS NULL OR payroll_run_id = $4)
      `,
      [tenantId, eligibleEmployeeExternalIds, month, runId]
    );

    const adjustmentsByEmployee = mapByEmployee(adjustmentsResult.rows);
    const arrearsByEmployee = mapByEmployee(arrearsResult.rows);
    const reimbursementsByEmployee = mapByEmployee(reimbursementsResult.rows);
    const loansByEmployee = mapByEmployee(loansResult.rows);

    let grossTotal = 0;
    let deductionTotal = 0;
    let reimbursementTotal = 0;
    let employerContributionTotal = 0;
    let netPayTotal = 0;
    let processedCount = 0;
    let errorCount = 0;
    let warningCount = 0;

    const shouldProrateEarning = (component, metadata) =>
      component.prorate_with_attendance !== false &&
      metadata.prorateWithAttendance !== false &&
      metadata.ignoreProration !== true;

    for (const snapshot of snapshotsForRun) {
      const employeeExternalId = String(snapshot.employee_external_id);
      const runEmployeeWarnings = [];

      try {
        const upsertEmployee = await client.query(
          `
            INSERT INTO payroll_run_employees (
              tenant_id,
              payroll_run_id,
              employee_external_id,
              employee_payroll_profile_id,
              attendance_snapshot_id,
              payroll_status,
              payable_days,
              lop_days,
              overtime_minutes,
              warnings,
              created_by,
              updated_by
            )
            VALUES (
              $1,$2,$3,$4,$5,'pending',$6,$7,$8,'[]'::jsonb,$9,$9
            )
            ON CONFLICT (payroll_run_id, employee_external_id)
            DO UPDATE SET
              employee_payroll_profile_id = EXCLUDED.employee_payroll_profile_id,
              attendance_snapshot_id = EXCLUDED.attendance_snapshot_id,
              payroll_status = 'pending',
              payable_days = EXCLUDED.payable_days,
              lop_days = EXCLUDED.lop_days,
              overtime_minutes = EXCLUDED.overtime_minutes,
              error_message = NULL,
              warnings = '[]'::jsonb,
              updated_by = EXCLUDED.updated_by
            RETURNING id
          `,
          [
            tenantId,
            runId,
            employeeExternalId,
            profileMap.get(employeeExternalId)?.id || null,
            snapshot.id,
            toNumber(snapshot.payable_days, 0),
            toNumber(snapshot.lop_days, 0),
            toNumber(snapshot.overtime_minutes, 0),
            actorId
          ]
        );
        const runEmployeeId = upsertEmployee.rows[0].id;

        await client.query(
          `DELETE FROM payroll_run_components WHERE payroll_run_employee_id = $1`,
          [runEmployeeId]
        );

        const profile = profileMap.get(employeeExternalId) || null;
        const profileId = profile?.id || null;
        const payGroupId = profile?.pay_group_id || null;
        const salary = profileId ? salaryByProfile.get(profileId) : null;
        const statutory = profileId ? statutoryByProfile.get(profileId) : null;
        const employee = employeeMap.get(employeeExternalId) || null;
        if (!salary) {
          throw new Error("Active salary structure not found for employee profile");
        }

        const salaryContext = computeSalaryContextFromRules({ salary });
        const monthlyGross = salaryContext.monthlyGross;
        const basicPay = salaryContext.basicPay;
        const variablePay = computeVariablePayDueAmount({
          payMonth: month,
          effectiveFrom: salary.effective_from,
          approvalMonth: salaryContext.variablePayApprovalMonth,
          approvedMonthlyAmount: salaryContext.variablePayApprovedAmountMonthly,
          releaseMonths: salaryContext.variablePayReleaseMonths,
          approvalStatus: salaryContext.variablePayApprovalStatus
        });
        const effectiveSnapshot = summarizeSnapshotDaysForSalaryWindow({
          snapshot,
          dayRows: snapshotDaysBySnapshotId.get(String(snapshot.id)) || [],
          month,
          salary,
          employee,
          timeZone: payrollTimeZone
        });
        const calendarDays = effectiveSnapshot.calendarDays;
        const workingDays = effectiveSnapshot.workingDays;
        const presentDays = effectiveSnapshot.presentDays;
        const paidLeaveDays = effectiveSnapshot.paidLeaveDays;
        const payableDays = effectiveSnapshot.payableDays;
        const lopDays = effectiveSnapshot.lopDays;
        const overtimeMinutes = effectiveSnapshot.overtimeMinutes;
        const minWorkMinutes = Math.max(1, toNumber(snapshot.min_work_minutes, 480));
        const denominator =
          salaryProrationRule === "present_days_on_working_days"
            ? workingDays
            : settings.lop_calculation_method === "working_days"
              ? workingDays
              : calendarDays;
        const payrollPayableDays = getPayrollProrationUnits({
          salaryProrationRule,
          presentDays,
          paidLeaveDays,
          payableDays
        });
        const prorationUnits = payrollPayableDays;
        const prorationFactor = Math.max(0, Math.min(1, prorationUnits / Math.max(1, denominator)));
        const lopFactor = Math.max(0, Math.min(1, lopDays / Math.max(1, denominator)));
        const perDayRate = monthlyGross / Math.max(1, denominator);
        const perMinuteRate = perDayRate / minWorkMinutes;
        const overtimeRateMultiplier = Number(process.env.PAYROLL_OT_MULTIPLIER || 1);
        const overtimeAmountAuto = roundAmount(
          overtimeMinutes * perMinuteRate * overtimeRateMultiplier,
          settings.rounding_policy || "nearest_rupee"
        );

        const baseContext = {
          // Fixed earning formulas must use fixed gross. Variable pay is
          // reserved in CTC and enters earnings separately only when approved.
          MONTHLY_GROSS: monthlyGross,
          GROSS: monthlyGross,
          CTC_EARNINGS_POOL: salaryContext.ctcAllocatableGross || monthlyGross,
          MONTHLY_CTC: salaryContext.monthlyCtc,
          ANNUAL_CTC: toNumber(salary.annual_ctc, 0),
          BASIC_PAY: basicPay,
          VARIABLE_PAY: salaryContext.variablePayTargetMonthly,
          VARIABLE_PAY_TARGET: salaryContext.variablePayTargetMonthly,
          VARIABLE_PAY_APPROVED: variablePay,
          VARIABLE: salaryContext.variablePayTargetMonthly,
          EMPLOYER_EPF: salaryContext.employerEpf,
          ESI_EMPLOYEE_AMOUNT: salaryContext.esiEmployeeAmount,
          ESI_EMPLOYER_AMOUNT: salaryContext.esiEmployerAmount,
          ESI_AMOUNT: salaryContext.esiEmployeeAmount,
          BONUS_AMOUNT: salaryContext.bonusAmount,
          TDS_AMOUNT: salaryContext.tdsAmount,
          PF_WAGE_LIMIT: salaryContext.pfWageCeiling,
          EPF_EMPLOYEE_RATE: salaryContext.epfEmployeeRate,
          EPF_EMPLOYER_RATE: salaryContext.epfEmployerRate,
          ESI_ELIGIBILITY_THRESHOLD: salaryContext.esiEligibilityThreshold,
          ESI_EMPLOYEE_RATE: salaryContext.esiEmployeeRate,
          ESI_EMPLOYER_RATE: salaryContext.esiEmployerRate,
          EFFECTIVE_BASIC_PERCENT: salaryContext.effectiveBasicPercent,
          HRA_PERCENT_OF_BASIC: salaryContext.hraPercentOfBasic,
          PRESENT_DAYS: presentDays,
          PAID_LEAVE_DAYS: paidLeaveDays,
          PAYABLE_DAYS: payrollPayableDays,
          LOP_DAYS: lopDays,
          OVERTIME_MINUTES: overtimeMinutes,
          OVERTIME_HOURS: overtimeMinutes / 60,
          CALENDAR_DAYS: calendarDays,
          WORKING_DAYS: workingDays,
          PRORATION_FACTOR: prorationFactor,
          LOP_FACTOR: lopFactor,
          PER_DAY_RATE: perDayRate,
          PER_MINUTE_RATE: perMinuteRate
        };

        const componentRows = [];
        const computedVars = { ...baseContext };
        for (const componentRow of [...earningComponents, ...deductionComponents, ...employerComponents]) {
          const key = toVarKey(componentRow.code);
          if (!(key in computedVars)) {
            computedVars[key] = 0;
          }
        }
        let regularEarnings = 0;
        let regularDeductions = 0;
        let regularEmployer = 0;
        let projectedTaxableMonthlyIncome = 0;
        let tdsAmount = 0;

        const enabledEarningComponents = earningComponents
          .filter((componentRow) =>
            isComponentEnabledForEmployee({ component: componentRow, payGroupId, salary })
          )
          .map((componentRow) =>
            applyEmployeeComponentOverride({ component: componentRow, salary })
          );
        const orderedEarningComponents = orderComponentsByDependencies({
          components: enabledEarningComponents,
          scope: "earning",
          formulaMap
        });

        for (const component of orderedEarningComponents) {
          const componentKey = toVarKey(component.code);
          const monthlyAmount =
            componentKey === "VARIABLE" || componentKey === "VARIABLE_PAY"
              ? variablePay
              : resolveComponentAmount({
                  component,
                  scope: "earning",
                  formulaMap,
                  context: computedVars,
                  prorationFactor: 1,
                  shouldProrateEarning,
                  payMonth: month
                });
          const amount =
            componentKey === "VARIABLE" || componentKey === "VARIABLE_PAY"
              ? variablePay
              : resolveComponentAmount({
                  component,
                  scope: "earning",
                  formulaMap,
                  context: computedVars,
                  prorationFactor,
                  shouldProrateEarning,
                  payMonth: month
                });
          if (!amount) continue;

          regularEarnings += amount;
          if (component.taxable) projectedTaxableMonthlyIncome += amount;

          if (componentKey !== "VARIABLE" && componentKey !== "VARIABLE_PAY") {
            computedVars[componentKey] = monthlyAmount;
          }

          componentRows.push({
            tenant_id: tenantId,
            payroll_run_id: runId,
            component_scope: "earning",
            component_code: component.code,
            component_name: component.name,
            source_type: "system",
            calculation_mode: component.calculation_mode,
            amount,
            taxable: Boolean(component.taxable),
            affects_net_pay: true,
            formula_snapshot: buildComponentFormulaSnapshot({
              component,
              scope: "earning",
              formulaMap,
              context: computedVars,
              prorationFactor,
              amount
            }),
            metadata: {}
          });
        }

        const hasExplicitVariablePayComponent = componentRows.some((row) => {
          const componentCode = String(row.component_code || "").toUpperCase();
          return row.component_scope === "earning" && (componentCode === "VARIABLE" || componentCode === "VARIABLE_PAY");
        });
        if (variablePay > 0 && !hasExplicitVariablePayComponent) {
          regularEarnings += variablePay;
          projectedTaxableMonthlyIncome += variablePay;
          componentRows.push({
            tenant_id: tenantId,
            payroll_run_id: runId,
            component_scope: "earning",
            component_code: "VARIABLE_PAY",
            component_name: "Variable Pay",
            source_type: "system",
            calculation_mode: "fixed",
            amount: variablePay,
            taxable: true,
            affects_net_pay: true,
            formula_snapshot: {
              expression: "APPROVED_VARIABLE_PAY"
            },
            metadata: {}
          });
        }

        if (
          autoOvertimeEnabled &&
          overtimeAmountAuto > 0 &&
          !componentRows.some((row) => row.component_code === "OT")
        ) {
          regularEarnings += overtimeAmountAuto;
          projectedTaxableMonthlyIncome += overtimeAmountAuto;
          computedVars.OT = overtimeAmountAuto;
          componentRows.push({
            tenant_id: tenantId,
            payroll_run_id: runId,
            component_scope: "earning",
            component_code: "OT_AUTO",
            component_name: "Overtime (Auto)",
            source_type: "system",
            calculation_mode: "formula",
            quantity: overtimeMinutes,
            rate: perMinuteRate * overtimeRateMultiplier,
            amount: overtimeAmountAuto,
            taxable: true,
            affects_net_pay: true,
            formula_snapshot: {
              expression: "OVERTIME_MINUTES * PER_MINUTE_RATE * OT_MULTIPLIER",
              OT_MULTIPLIER: overtimeRateMultiplier
            },
            metadata: {}
          });
        }

        computedVars.GROSS_EARNINGS = regularEarnings;
        computedVars.PAYABLE_GROSS = regularEarnings;
        const professionalTaxComponent = employeeDeductionComponents.find((componentRow) => {
          if (toVarKey(componentRow.code) !== "PT") return false;
          return isComponentEnabledForEmployee({ component: componentRow, payGroupId, salary });
        });
        const professionalTaxContext = {
          ...computedVars,
          MONTHLY_GROSS: regularEarnings,
          GROSS: regularEarnings
        };
        const professionalTaxMonthly = professionalTaxComponent
          ? resolveComponentAmount({
              component: applyEmployeeComponentOverride({
                component: professionalTaxComponent,
                salary
              }),
              scope: "deduction",
              formulaMap,
              context: professionalTaxContext,
              prorationFactor,
              shouldProrateEarning,
              payMonth: month
            })
          : computeTelanganaProfessionalTax(
              regularEarnings,
              statutory?.professional_tax_applicable !== false
            );
        const tdsEstimate = computeAnnualTdsEstimate({
          payMonth: month,
          projectedTaxableMonthlyIncome,
          statutory,
          payrollProfile: profile,
          salary,
          professionalTaxMonthly
        });
        computedVars.TDS_AMOUNT = tdsEstimate.monthlyTds;

        for (const componentRow of employeeDeductionComponents) {
          if (!isComponentEnabledForEmployee({ component: componentRow, payGroupId, salary })) {
            continue;
          }
          const component = applyEmployeeComponentOverride({ component: componentRow, salary });
          const componentKey = toVarKey(component.code);
          const deductionContext =
            componentKey === "PT" || componentKey === "PROFESSIONAL_TAX" || componentKey === "P_TAX"
              ? professionalTaxContext
              : computedVars;
          const amount = resolveComponentAmount({
            component,
            scope: "deduction",
            formulaMap,
            context: deductionContext,
            prorationFactor,
            shouldProrateEarning,
            payMonth: month
          });
          if (!amount) continue;

          regularDeductions += amount;
          if (String(component.code || "").toUpperCase() === "TDS") {
            tdsAmount += amount;
          }

          const key = toVarKey(component.code);
          computedVars[key] = amount;

          componentRows.push({
            tenant_id: tenantId,
            payroll_run_id: runId,
            component_scope: "deduction",
            component_code: component.code,
            component_name: component.name,
            source_type: "system",
            calculation_mode: component.calculation_mode,
            amount,
            taxable: false,
            affects_net_pay: true,
            formula_snapshot: buildComponentFormulaSnapshot({
              component,
              scope: "deduction",
              formulaMap,
              context: deductionContext,
              prorationFactor,
              amount
            }),
            metadata:
              String(component.code || "").toUpperCase() === "TDS"
                ? {
                    annualTaxableIncome: roundAmount(tdsEstimate.taxableIncome, "exact"),
                    annualTaxLiability: roundAmount(tdsEstimate.annualTaxLiability, "exact"),
                    monthsRemaining: tdsEstimate.monthsRemaining,
                    taxRegime: tdsEstimate.regime
                  }
                : {}
          });
        }

        for (const componentRow of legacyEmployerComponents) {
          if (!isComponentEnabledForEmployee({ component: componentRow, payGroupId, salary })) {
            continue;
          }
          const component = applyEmployeeComponentOverride({ component: componentRow, salary });
          const amount = resolveComponentAmount({
            component,
            scope: "deduction",
            formulaMap,
            context: computedVars,
            prorationFactor,
            shouldProrateEarning,
            payMonth: month
          });
          if (!amount) continue;

          regularEmployer += amount;
          computedVars.EMPLOYER_EPF = amount;

          componentRows.push({
            tenant_id: tenantId,
            payroll_run_id: runId,
            component_scope: "employer_contribution",
            component_code: "EMPLOYER_EPF",
            component_name: component.name || "Employer PF",
            source_type: "system",
            calculation_mode: component.calculation_mode,
            amount,
            taxable: false,
            affects_net_pay: false,
            formula_snapshot: buildComponentFormulaSnapshot({
              component,
              scope: "deduction",
              formulaMap,
              context: computedVars,
              prorationFactor,
              amount
            }),
            metadata: {
              normalizedFromLegacyScope: "deduction",
              originalComponentCode: component.code
            }
          });
        }

        for (const componentRow of employerComponents) {
          if (!isComponentEnabledForEmployee({ component: componentRow, payGroupId, salary })) {
            continue;
          }
          const component = applyEmployeeComponentOverride({ component: componentRow, salary });
          const amount = resolveComponentAmount({
            component,
            scope: "employer_contribution",
            formulaMap,
            context: computedVars,
            prorationFactor,
            shouldProrateEarning,
            payMonth: month
          });
          if (!amount) continue;

          regularEmployer += amount;

          const key = toVarKey(component.code);
          computedVars[key] = amount;

          componentRows.push({
            tenant_id: tenantId,
            payroll_run_id: runId,
            component_scope: "employer_contribution",
            component_code: component.code,
            component_name: component.name,
            source_type: "system",
            calculation_mode: component.calculation_mode,
            amount,
            taxable: false,
            affects_net_pay: false,
            formula_snapshot: buildComponentFormulaSnapshot({
              component,
              scope: "employer_contribution",
              formulaMap,
              context: computedVars,
              prorationFactor,
              amount
            }),
            metadata: {}
          });
        }

        const adjustments = adjustmentsByEmployee.get(employeeExternalId) || [];
        const arrears = arrearsByEmployee.get(employeeExternalId) || [];
        const reimbursements = reimbursementsByEmployee.get(employeeExternalId) || [];
        const loans = loansByEmployee.get(employeeExternalId) || [];

        let adjustmentAmount = 0;
        let arrearsAmount = 0;
        let reimbursementAmount = 0;
        let loanDeductionAmount = 0;

        for (const row of adjustments) {
          const amount = toNumber(row.amount, 0);
          if (!amount) continue;
          const sign = row.adjustment_type === "deduction" ? -1 : 1;
          adjustmentAmount += sign * amount;

          componentRows.push({
            tenant_id: tenantId,
            payroll_run_id: runId,
            component_scope: row.adjustment_type === "deduction" ? "deduction" : "earning",
            component_code: row.adjustment_code,
            component_name: row.adjustment_code,
            source_type: "manual",
            calculation_mode: "fixed",
            amount,
            taxable: Boolean(row.taxable),
            affects_net_pay: true,
            remarks: row.description,
            metadata: { adjustmentId: row.id }
          });
        }

        for (const row of arrears) {
          const amount = Math.abs(toNumber(row.difference_amount, 0));
          if (!amount) continue;
          const sign = row.arrear_type === "deduction" ? -1 : 1;
          arrearsAmount += sign * amount;

          componentRows.push({
            tenant_id: tenantId,
            payroll_run_id: runId,
            component_scope: row.arrear_type === "deduction" ? "deduction" : "earning",
            component_code: row.component_code,
            component_name: `${row.component_code} Arrear`,
            source_type: "arrear",
            calculation_mode: "fixed",
            amount,
            taxable: Boolean(row.taxable),
            affects_net_pay: true,
            metadata: { arrearId: row.id }
          });
        }

        for (const row of reimbursements) {
          const amount = toNumber(row.approved_amount, 0);
          if (!amount) continue;
          reimbursementAmount += amount;

          componentRows.push({
            tenant_id: tenantId,
            payroll_run_id: runId,
            component_scope: "reimbursement",
            component_code: row.reimbursement_code,
            component_name: row.reimbursement_code,
            source_type: "reimbursement",
            calculation_mode: "fixed",
            amount,
            taxable: Boolean(row.taxable),
            affects_net_pay: true,
            remarks: row.description,
            metadata: { reimbursementId: row.id }
          });
        }

        for (const row of loans) {
          const installment = toNumber(row.installment_amount, 0);
          const outstanding = toNumber(row.outstanding_amount, 0);
          const deducted = Math.min(
            outstanding,
            Math.max(0, toNumber(row.deducted_amount_this_run, installment))
          );
          if (!deducted) continue;
          loanDeductionAmount += deducted;

          componentRows.push({
            tenant_id: tenantId,
            payroll_run_id: runId,
            component_scope: "deduction",
            component_code: "LOAN",
            component_name: `Loan Deduction (${row.loan_reference_no})`,
            source_type: "loan",
            calculation_mode: "fixed",
            amount: deducted,
            taxable: false,
            affects_net_pay: true,
            metadata: { loanId: row.id, loanReferenceNo: row.loan_reference_no }
          });
        }

        const grossEarnings = roundAmount(
          regularEarnings +
            Math.max(0, adjustmentAmount) +
            Math.max(0, arrearsAmount),
          settings.rounding_policy || "nearest_rupee"
        );
        if (grossEarnings <= 0) {
          runWarnings.add(
            "One or more employees produced zero gross pay. Check salary mapping, component applicability, and employee overrides."
          );
        }
        const totalDeductions = roundAmount(
          regularDeductions +
            Math.max(0, -adjustmentAmount) +
            Math.max(0, -arrearsAmount) +
            loanDeductionAmount,
          settings.rounding_policy || "nearest_rupee"
        );
        const netPay = roundAmount(
          grossEarnings + reimbursementAmount - totalDeductions,
          settings.rounding_policy || "nearest_rupee"
        );

        if (netPay < 0) {
          runEmployeeWarnings.push("Net pay is negative after deductions");
        }
        if (prorationFactor < 1 && lopDays > 0) {
          runEmployeeWarnings.push("LOP applied through attendance snapshot");
        }
        if (effectiveSnapshot.isSalaryWindowProrated) {
          runEmployeeWarnings.push(
            `Salary effective window applied from ${effectiveSnapshot.effectiveStartKey} to ${effectiveSnapshot.effectiveEndKey}`
          );
        }

        await client.query(
          `
            UPDATE payroll_run_employees
            SET
              payroll_status = 'processed',
              payable_days = $2,
              lop_days = $3,
              overtime_minutes = $4,
              arrears_amount = $5,
              adjustment_amount = $6,
              reimbursement_amount = $7,
              loan_deduction_amount = $8,
              gross_earnings = $9,
              total_deductions = $10,
              employer_contributions = $11,
              taxable_income = $12,
              tds_amount = $13,
              net_pay = $14,
              warnings = $15::jsonb,
              error_message = NULL,
              updated_by = $16
            WHERE id = $1
          `,
          [
            runEmployeeId,
            payrollPayableDays,
            lopDays,
            overtimeMinutes,
            roundAmount(arrearsAmount, settings.rounding_policy),
            roundAmount(adjustmentAmount, settings.rounding_policy),
            roundAmount(reimbursementAmount, settings.rounding_policy),
            roundAmount(loanDeductionAmount, settings.rounding_policy),
            grossEarnings,
            totalDeductions,
            roundAmount(regularEmployer, settings.rounding_policy),
            roundAmount(tdsEstimate.taxableIncome, settings.rounding_policy),
            roundAmount(tdsAmount, settings.rounding_policy),
            netPay,
            JSON.stringify(runEmployeeWarnings),
            actorId
          ]
        );

        await insertRunComponents(
          client,
          runEmployeeId,
          actorId,
          normalizeComponentRows(componentRows)
        );

        if (adjustments.length) {
          await client.query(
            `
              UPDATE payroll_adjustments
              SET payroll_run_id = $1, payroll_run_employee_id = $2, updated_by = $3
              WHERE id = ANY($4::uuid[])
            `,
            [runId, runEmployeeId, actorId, adjustments.map((row) => row.id)]
          );
        }

        if (arrears.length) {
          await client.query(
            `
              UPDATE payroll_arrears
              SET payroll_run_id = $1, payroll_run_employee_id = $2, status = 'processed', updated_by = $3
              WHERE id = ANY($4::uuid[])
            `,
            [runId, runEmployeeId, actorId, arrears.map((row) => row.id)]
          );
        }

        if (reimbursements.length) {
          await client.query(
            `
              UPDATE payroll_reimbursements
              SET payroll_run_id = $1, payroll_run_employee_id = $2, payout_status = 'paid', updated_by = $3
              WHERE id = ANY($4::uuid[])
            `,
            [runId, runEmployeeId, actorId, reimbursements.map((row) => row.id)]
          );
        }

        if (loans.length) {
          await client.query(
            `
              UPDATE payroll_loans
              SET
                payroll_run_id = $1,
                payroll_run_employee_id = $2,
                deducted_amount_this_run = LEAST(outstanding_amount, GREATEST(0, COALESCE(deducted_amount_this_run, installment_amount))),
                outstanding_amount = GREATEST(0, outstanding_amount - LEAST(outstanding_amount, GREATEST(0, COALESCE(deducted_amount_this_run, installment_amount)))),
                current_installment_no = current_installment_no + 1,
                loan_status = CASE
                  WHEN GREATEST(0, outstanding_amount - LEAST(outstanding_amount, GREATEST(0, COALESCE(deducted_amount_this_run, installment_amount)))) = 0 THEN 'closed'
                  ELSE loan_status
                END,
                updated_by = $3
              WHERE id = ANY($4::uuid[])
            `,
            [runId, runEmployeeId, actorId, loans.map((row) => row.id)]
          );
        }

        grossTotal += grossEarnings;
        deductionTotal += totalDeductions;
        reimbursementTotal += reimbursementAmount;
        employerContributionTotal += regularEmployer;
        netPayTotal += netPay;
        processedCount += 1;
        warningCount += runEmployeeWarnings.length;
        logger.info("payroll.compute.employee.completed", {
          runId,
          employeeExternalId,
          processedCount,
          totalEmployees: snapshotsForRun.length
        });
      } catch (error) {
        errorCount += 1;
        const message = error?.message || "Payroll computation failed";
        await client.query(
          `
            UPDATE payroll_run_employees
            SET payroll_status = 'error', error_message = $2, updated_by = $3
            WHERE payroll_run_id = $1 AND employee_external_id = $4
          `,
          [runId, message, actorId, employeeExternalId]
        );
      }
    }

    const runStatus = errorCount > 0 ? "validation_failed" : "ready_for_approval";
    await client.query(
      `
        UPDATE payroll_runs
        SET
          status = $2,
          attendance_snapshot_status = 'fetched',
          employee_count = $3,
          processed_employee_count = $4,
          warning_count = $5,
          error_count = $6,
          gross_total = $7,
          deduction_total = $8,
          reimbursement_total = $9,
          employer_contribution_total = $10,
          net_pay_total = $11,
          metadata = CASE
            WHEN COALESCE(metadata, '{}'::jsonb) = '{}'::jsonb THEN jsonb_build_object('runWarnings', $12::jsonb)
            ELSE COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('runWarnings', $12::jsonb)
          END,
          updated_by = $13
        WHERE id = $1
      `,
      [
        runId,
        runStatus,
        snapshots.length,
        processedCount,
        warningCount,
        errorCount,
        roundAmount(grossTotal, settings.rounding_policy),
        roundAmount(deductionTotal, settings.rounding_policy),
        roundAmount(reimbursementTotal, settings.rounding_policy),
        roundAmount(employerContributionTotal, settings.rounding_policy),
        roundAmount(netPayTotal, settings.rounding_policy),
        JSON.stringify([...runWarnings]),
        actorId
      ]
    );

    await client.query("COMMIT");
    const response = {
      runId,
      payMonth: month,
      forceRecompute,
      status: runStatus,
      totalEmployees: snapshots.length,
      processedEmployees: processedCount,
      errorEmployees: errorCount,
      warningCount,
      totals: {
        gross: roundAmount(grossTotal, settings.rounding_policy),
        deductions: roundAmount(deductionTotal, settings.rounding_policy),
        reimbursements: roundAmount(reimbursementTotal, settings.rounding_policy),
        employerContributions: roundAmount(employerContributionTotal, settings.rounding_policy),
        netPay: roundAmount(netPayTotal, settings.rounding_policy)
      }
    };

    observePayrollCompute({
      outcome: "success",
      mode: _executionMode,
      durationMs: Date.now() - startedAt
    });
    logger.info("payroll.compute.completed", {
      runId,
      organizationId,
      status: response.status,
      durationMs: Date.now() - startedAt,
      processedEmployees: response.processedEmployees,
      errorEmployees: response.errorEmployees
    });
    return response;
  } catch (error) {
    await safeRollback(client);
    if (error?.code === "55P03") {
      throw {
        code: 409,
        message: "This payroll run is already being recomputed. Please wait for it to finish."
      };
    }
    observePayrollCompute({
      outcome: "failure",
      mode: req.body?._executionMode || "sync",
      durationMs: Date.now() - startedAt
    });
    logger.error("payroll.compute.failed", {
      runId,
      organizationId,
      durationMs: Date.now() - startedAt,
      message: error?.message || error
    });
    throw error;
  } finally {
    if (runAdvisoryLockAcquired) {
      try {
        await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [runId]);
      } catch (unlockError) {
        logger.warn("payroll.compute.advisory_unlock_failed", {
          runId,
          organizationId,
          message: unlockError?.message || unlockError
        });
      }
    }
    client.release();
  }
};

exports.__test__ = {
  toNumber,
  monthEndDate,
  roundAmount,
  toVarKey,
  parseJson,
  getComponentPayGroupIds,
  getEmployeeComponentOverrides,
  isComponentEnabledForEmployee,
  applyEmployeeComponentOverride,
  getTaxDeclaration,
  getRemainingPayrollMonths,
  computeProgressiveTax,
  computeAnnualTdsEstimate,
  computeTelanganaProfessionalTax,
  getEffectiveSnapshotWindow,
  resolvePayrollStartDateKey,
  summarizeSnapshotDaysForSalaryWindow,
  getPayrollProrationUnits,
  computeSalaryContextFromRules,
  computeVariablePayDueAmount,
  tokenizeIdentifiers,
  getComponentFormulaExpression,
  isLegacyEmployerContributionComponent,
  orderComponentsByDependencies,
  buildComponentFormulaSnapshot,
  evaluateFormula,
  computeSlabAmount,
  resolveComponentAmount,
  normalizeComponentRows
};
