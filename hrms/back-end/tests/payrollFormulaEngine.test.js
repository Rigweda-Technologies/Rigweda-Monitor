const test = require("node:test");
const assert = require("node:assert/strict");

const { __test__ } = require("../src/modules/payroll/payrollRun.service");

const {
  evaluateFormula,
  computeSlabAmount,
  resolveComponentAmount,
  roundAmount,
  normalizeComponentRows,
  isComponentEnabledForEmployee,
  applyEmployeeComponentOverride,
  computeAnnualTdsEstimate,
  computeTelanganaProfessionalTax,
  computeSalaryContextFromRules,
  computeVariablePayDueAmount,
  isLegacyEmployerContributionComponent,
  orderComponentsByDependencies,
  resolvePayrollStartDateKey,
  summarizeSnapshotDaysForSalaryWindow,
  getPayrollProrationUnits
} = __test__;

test("variable pay is released only in its recorded approval month", () => {
  const input = {
    effectiveFrom: "2026-01-01",
    approvalMonth: "2026-07",
    approvedMonthlyAmount: 1000,
    releaseMonths: 12,
    approvalStatus: "approved"
  };

  assert.equal(computeVariablePayDueAmount({ ...input, payMonth: "2026-06" }), 0);
  assert.equal(computeVariablePayDueAmount({ ...input, payMonth: "2026-07" }), 12000);
  assert.equal(computeVariablePayDueAmount({ ...input, payMonth: "2026-08" }), 0);
});

test("pending variable pay stays reserved but is never paid", () => {
  assert.equal(
    computeVariablePayDueAmount({
      payMonth: "2026-07",
      effectiveFrom: "2026-01-01",
      approvalMonth: "2026-07",
      approvedMonthlyAmount: 1000,
      releaseMonths: 12,
      approvalStatus: "pending"
    }),
    0
  );
});

test("legacy Employer PF aliases are treated as employer contributions", () => {
  assert.equal(
    isLegacyEmployerContributionComponent({
      code: "EMPLOYERPF",
      name: "Employer PF"
    }),
    true
  );
  assert.equal(
    isLegacyEmployerContributionComponent({
      code: "EMPLOYEEPF",
      name: "Employee PF"
    }),
    false
  );
});

test("earning components are ordered after the components used by their formulas", () => {
  const components = [
    {
      id: "allowance",
      code: "ALLOWANCE",
      calculation_mode: "formula",
      metadata: {
        expression: "max(MONTHLY_GROSS - (BASIC + HRA + VARIABLE), 0) * 0.80"
      }
    },
    {
      id: "hra",
      code: "HRA",
      calculation_mode: "percentage",
      metadata: { base: "BASIC", percentage: 50 }
    },
    {
      id: "basic",
      code: "BASIC",
      calculation_mode: "percentage",
      metadata: { base: "MONTHLY_GROSS", percentage: 50 }
    }
  ];

  const ordered = orderComponentsByDependencies({
    components,
    scope: "earning",
    formulaMap: new Map()
  });

  assert.deepEqual(
    ordered.map((component) => component.code),
    ["BASIC", "HRA", "ALLOWANCE"]
  );
});

test("dependent earnings use monthly values before attendance proration", () => {
  const components = [
    {
      id: "allowance",
      code: "ALLOWANCE",
      calculation_mode: "formula",
      rounding_policy: "nearest_rupee",
      metadata: {
        expression: "max(MONTHLY_GROSS - (BASIC + HRA + VARIABLE), 0) * 0.80"
      }
    },
    {
      id: "conveyance",
      code: "CONVEYANCE",
      calculation_mode: "formula",
      rounding_policy: "nearest_rupee",
      metadata: {
        expression: "max(MONTHLY_GROSS - (BASIC + HRA + VARIABLE), 0) * 0.20"
      }
    },
    {
      id: "hra",
      code: "HRA",
      calculation_mode: "percentage",
      rounding_policy: "nearest_rupee",
      metadata: { base: "BASIC", percentage: 50 }
    },
    {
      id: "basic",
      code: "BASIC",
      calculation_mode: "percentage",
      rounding_policy: "nearest_rupee",
      metadata: { base: "MONTHLY_GROSS", percentage: 50 }
    }
  ];
  const ordered = orderComponentsByDependencies({
    components,
    scope: "earning",
    formulaMap: new Map()
  });
  const context = {
    MONTHLY_GROSS: 13066,
    VARIABLE: 0
  };
  let gross = 0;

  for (const component of ordered) {
    const monthlyAmount = resolveComponentAmount({
      component,
      scope: "earning",
      formulaMap: new Map(),
      context,
      prorationFactor: 1,
      shouldProrateEarning: () => true
    });
    const payrollAmount = resolveComponentAmount({
      component,
      scope: "earning",
      formulaMap: new Map(),
      context,
      prorationFactor: 0.96,
      shouldProrateEarning: () => true
    });
    context[component.code] = monthlyAmount;
    gross += payrollAmount;
  }

  assert.equal(context.BASIC, 6533);
  assert.equal(context.HRA, 3267);
  assert.equal(gross, 12543);
});

test("evaluateFormula supports math helpers and context variables", () => {
  const value = evaluateFormula("round((BASIC + HRA) * 0.1) + max(PT, 200)", {
    BASIC: 20000,
    HRA: 8000,
    PT: 150
  });

  assert.equal(value, 3000);
});

test("evaluateFormula rejects unknown variables", () => {
  assert.throws(() => evaluateFormula("BASIC + unknown_x", { BASIC: 1000 }), /Unknown variable/);
});

test("evaluateFormula supports nested conditional comparisons", () => {
  const value = evaluateFormula("if(MONTHLY_GROSS <= 15000, 0, if(MONTHLY_GROSS <= 20000, 150, 200))", {
    MONTHLY_GROSS: 18000
  });

  assert.equal(value, 150);
  assert.equal(
    evaluateFormula("if(MONTHLY_GROSS <= 15000, 0, if(MONTHLY_GROSS <= 20000, 150, 200))", {
      MONTHLY_GROSS: 25000
    }),
    200
  );
  assert.equal(
    evaluateFormula("if(MONTHLY_GROSS <= 15000, 0, if(MONTHLY_GROSS <= 20000, 150, 200))", {
      MONTHLY_GROSS: 14000
    }),
    0
  );
});

test("computeSlabAmount picks first matching slab", () => {
  const slabs = [
    { upto: 10000, rate: 5 },
    { upto: 20000, rate: 10 },
    { upto: null, amount: 2500 }
  ];

  assert.equal(computeSlabAmount(9000, slabs), 450);
  assert.equal(computeSlabAmount(18000, slabs), 1800);
  assert.equal(computeSlabAmount(30000, slabs), 2500);
});

test("resolveComponentAmount applies formula, proration and cap", () => {
  const component = {
    id: "cmp-earning-basic",
    calculation_mode: "fixed",
    cap_amount: 6000,
    rounding_policy: "nearest_rupee",
    prorate_with_attendance: true,
    metadata: {
      monthlyAmount: 10000,
      maxAmount: 7000
    }
  };

  const formulaMap = new Map([
    [
      "earning:cmp-earning-basic",
      [
        {
          formula_expression: "BASIC * 0.5",
          formula_variables: { BONUS_FACTOR: 1 }
        }
      ]
    ]
  ]);

  const amount = resolveComponentAmount({
    component,
    scope: "earning",
    formulaMap,
    context: { BASIC: 12000 },
    prorationFactor: 0.5,
    shouldProrateEarning: () => true
  });

  assert.equal(amount, 3000);
});

test("normalizeComponentRows merges duplicate component lines", () => {
  const merged = normalizeComponentRows([
    {
      component_scope: "earning",
      component_code: "BASIC",
      source_type: "salary_structure",
      amount: 1000,
      quantity: 1,
      taxable: true,
      affects_net_pay: true,
      metadata: {}
    },
    {
      component_scope: "earning",
      component_code: "BASIC",
      source_type: "salary_structure",
      amount: 500,
      quantity: 0.5,
      taxable: false,
      affects_net_pay: true,
      metadata: {}
    }
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].amount, roundAmount(1500, "exact"));
  assert.equal(merged[0].quantity, 1.5);
  assert.equal(merged[0].taxable, true);
  assert.equal(merged[0].affects_net_pay, true);
});

test("isComponentEnabledForEmployee respects pay group applicability and employee disable override", () => {
  const component = {
    code: "BONUS",
    metadata: {
      payGroupIds: ["pay-group-1"],
      defaultEnabled: false
    }
  };

  assert.equal(
    isComponentEnabledForEmployee({
      component,
      payGroupId: "pay-group-1",
      salary: {
        metadata: {
          salaryRules: {
            componentOverrides: {
              BONUS: { enabled: true }
            }
          }
        }
      }
    }),
    true
  );

  assert.equal(
    isComponentEnabledForEmployee({
      component,
      payGroupId: "pay-group-2",
      salary: { metadata: {} }
    }),
    false
  );
});

test("isComponentEnabledForEmployee respects the component pay_group_id column", () => {
  const component = {
    code: "BASIC",
    pay_group_id: "lv-interns",
    metadata: { defaultEnabled: true }
  };

  assert.equal(
    isComponentEnabledForEmployee({
      component,
      payGroupId: "lv-interns",
      salary: { metadata: {} }
    }),
    true
  );
  assert.equal(
    isComponentEnabledForEmployee({
      component,
      payGroupId: "full-time",
      salary: { metadata: {} }
    }),
    false
  );
  assert.equal(
    isComponentEnabledForEmployee({
      component,
      payGroupId: null,
      salary: { metadata: {} }
    }),
    false
  );
});

test("isComponentEnabledForEmployee skips PF components when salary rules disable PF", () => {
  assert.equal(
    isComponentEnabledForEmployee({
      component: {
        code: "EMPLOYER_EPF",
        metadata: {
          payGroupIds: ["pay-group-1"],
          defaultEnabled: true
        }
      },
      payGroupId: "pay-group-1",
      salary: {
        metadata: {
          salaryRules: {
            includePf: false
          }
        }
      }
    }),
    false
  );
});

test("applyEmployeeComponentOverride merges employee-specific calculation metadata", () => {
  const component = {
    code: "BONUS",
    name: "Bonus",
    calculation_mode: "fixed",
    taxable: true,
    metadata: { monthlyAmount: 0 }
  };

  const overridden = applyEmployeeComponentOverride({
    component,
    salary: {
      metadata: {
        salaryRules: {
          componentOverrides: {
            BONUS: {
              name: "Quarterly Bonus",
              calculationMode: "percentage",
              amount: 20,
              base: "MONTHLY_GROSS",
              taxable: true
            }
          }
        }
      }
    }
  });

  assert.equal(overridden.name, "Quarterly Bonus");
  assert.equal(overridden.calculation_mode, "percentage");
  assert.equal(overridden.metadata.percentage, 20);
  assert.equal(overridden.metadata.base, "MONTHLY_GROSS");
});

test("computeTelanganaProfessionalTax uses Telangana monthly slabs", () => {
  assert.equal(computeTelanganaProfessionalTax(14000, true), 0);
  assert.equal(computeTelanganaProfessionalTax(18000, true), 150);
  assert.equal(computeTelanganaProfessionalTax(30000, true), 200);
});

test("computeAnnualTdsEstimate calculates monthly TDS for new regime with declarations", () => {
  const estimate = computeAnnualTdsEstimate({
    payMonth: "2026-04",
    projectedTaxableMonthlyIncome: 120000,
    statutory: {
      tax_regime: "new",
      metadata: {
        taxDeclaration: {
          previousEmployerTdsAnnual: 10000
        }
      }
    },
    salary: {},
    professionalTaxMonthly: 200
  });

  assert.equal(estimate.regime, "new");
  assert.ok(estimate.taxableIncome > 0);
  assert.ok(estimate.annualTaxLiability > 0);
  assert.equal(estimate.monthsRemaining, 12);
  assert.ok(estimate.monthlyTds > 0);
});

test("computeSalaryContextFromRules derives gross first and applies basic percent on gross", () => {
  const salaryContext = computeSalaryContextFromRules({
    salary: {
      annual_ctc: 1199999,
      monthly_gross: null,
      basic_pay: null,
      variable_pay: 9999.99,
      metadata: {
        salaryRules: {
          payGroupBasicPercent: 50,
          basicPercentSource: "pay_group",
          hraPercentOfBasic: 50,
          epfMode: "percentage",
          epfPercentOfBasic: 12,
          epfEmployerRate: 12,
          restrictPfWage: true,
          pfWageCeiling: 15000,
          includeEsi: true,
          esiEligibilityThreshold: 21000,
          esiEmployerRate: 3.25,
          esiEmployeeRate: 0.75
        }
      }
    }
  });

  assert.equal(salaryContext.monthlyGross, 88199.93);
  assert.equal(salaryContext.ctcAllocatableGross, 98199.92);
  assert.equal(salaryContext.grossBeforeVariablePay, 88199.93);
  assert.equal(salaryContext.variablePayTargetMonthly, 9999.99);
  assert.equal(salaryContext.basicPay, 44099.96);
  assert.equal(salaryContext.employerEpf, 1800);
  assert.equal(salaryContext.effectiveBasicPercent, 50);
  assert.equal(
    Number((salaryContext.ctcAllocatableGross + salaryContext.employerEpf).toFixed(2)),
    Number((1199999 / 12).toFixed(2))
  );
});

test("computeSalaryContextFromRules disables HRA when salary rules exclude HRA", () => {
  const salaryContext = computeSalaryContextFromRules({
    salary: {
      annual_ctc: 60000,
      monthly_gross: 5000,
      basic_pay: 5000,
      variable_pay: 0,
      metadata: {
        salaryRules: {
          payGroupBasicPercent: 100,
          basicPercentSource: "pay_group",
          includeHra: false,
          hraPercentOfBasic: 50,
          includePf: false,
          epfEmployeeRate: 0,
          epfEmployerRate: 0,
          includeEsi: false
        }
      }
    }
  });

  assert.equal(salaryContext.basicPay, 5000);
  assert.equal(salaryContext.hraPercentOfBasic, 0);
  assert.equal(salaryContext.employerEpf, 0);
});

test("summarizeSnapshotDaysForSalaryWindow trims payable days before salary effective date", () => {
  const snapshot = {
    calendar_days: 30,
    working_days: 22,
    present_days: 19,
    payable_days: 19,
    lop_days: 0,
    overtime_minutes: 0,
    attendance_minutes: 0
  };
  const dayRows = [
    { day_date: "2026-06-28", day_status: "present", payable_units: 1, lop_units: 0 },
    { day_date: "2026-06-29", day_status: "present", payable_units: 1, lop_units: 0 },
    { day_date: "2026-06-29T18:30:00.000Z", day_status: "present", payable_units: 1, lop_units: 0 }
  ];

  const summary = summarizeSnapshotDaysForSalaryWindow({
    snapshot,
    dayRows,
    month: "2026-06",
    salary: {
      effective_from: "2026-06-29T18:30:00.000Z",
      effective_to: null
    },
    timeZone: "Asia/Kolkata"
  });

  assert.equal(summary.calendarDays, 30);
  assert.equal(summary.workingDays, 22);
  assert.equal(summary.presentDays, 1);
  assert.equal(summary.payableDays, 1);
  assert.equal(summary.isSalaryWindowProrated, true);
});

test("resolvePayrollStartDateKey converts GMT stored salary date into org calendar date", () => {
  assert.equal(resolvePayrollStartDateKey({
    salary: { effective_from: "2026-06-22T18:30:00.000Z" },
    employee: null,
    timeZone: "Asia/Kolkata"
  }), "2026-06-23");
});

test("summarizeSnapshotDaysForSalaryWindow counts half day as present units", () => {
  const summary = summarizeSnapshotDaysForSalaryWindow({
    snapshot: {
      calendar_days: 30,
      working_days: 22,
      present_days: 17,
      half_days: 0.5,
      payable_days: 17.5,
      lop_days: 0.5
    },
    dayRows: [
      { day_date: "2026-06-29", day_status: "present", payable_units: 1, lop_units: 0 },
      { day_date: "2026-06-30", day_status: "half_day", payable_units: 0.5, lop_units: 0.5 }
    ],
    month: "2026-06",
    salary: {
      effective_from: "2026-06-29",
      effective_to: null
    },
    timeZone: "Asia/Kolkata"
  });

  assert.equal(summary.presentDays, 1.5);
  assert.equal(summary.payableDays, 1.5);
  assert.equal(summary.lopDays, 0.5);
});

test("summarizeSnapshotDaysForSalaryWindow preserves present half from half leave days", () => {
  const summary = summarizeSnapshotDaysForSalaryWindow({
    snapshot: {
      calendar_days: 30,
      working_days: 25,
      present_days: 19,
      half_days: 0.5,
      paid_leave_days: 0.5,
      payable_days: 19.5,
      lop_days: 0.5
    },
    dayRows: [
      { day_date: "2026-06-29", day_status: "present", payable_units: 1, lop_units: 0 },
      { day_date: "2026-06-30", day_status: "paid_leave_half", payable_units: 1, lop_units: 0 },
      { day_date: "2026-06-30", day_status: "unpaid_leave_half", payable_units: 0.5, lop_units: 0.5 }
    ],
    month: "2026-06",
    salary: {
      effective_from: "2026-06-29",
      effective_to: null
    },
    timeZone: "Asia/Kolkata"
  });

  assert.equal(summary.presentDays, 2);
  assert.equal(summary.paidLeaveDays, 0.5);
  assert.equal(summary.payableDays, 2.5);
  assert.equal(getPayrollProrationUnits({
    salaryProrationRule: "present_days_on_working_days",
    presentDays: summary.presentDays,
    paidLeaveDays: summary.paidLeaveDays,
    payableDays: summary.payableDays
  }), 2.5);
});

test("present days proration excludes week offs and holidays from payable units", () => {
  assert.equal(getPayrollProrationUnits({
    salaryProrationRule: "present_days_on_working_days",
    presentDays: 17.5,
    paidLeaveDays: 6.5,
    payableDays: 29
  }), 24);
});

test("summarizeSnapshotDaysForSalaryWindow starts from confirmation date when later than salary date", () => {
  const summary = summarizeSnapshotDaysForSalaryWindow({
    snapshot: {
      calendar_days: 30,
      working_days: 22,
      present_days: 19,
      payable_days: 19,
      lop_days: 0
    },
    dayRows: [
      { day_date: "2026-06-29", day_status: "present", payable_units: 1, lop_units: 0 },
      { day_date: "2026-06-30", day_status: "paid_leave", payable_units: 1, lop_units: 0 },
      { day_date: "2026-06-30", day_status: "present", payable_units: 1, lop_units: 0 }
    ],
    month: "2026-06",
    salary: {
      effective_from: "2026-06-01",
      effective_to: null
    },
    employee: {
      confirmedDate: "2026-06-30"
    }
  });

  assert.equal(resolvePayrollStartDateKey({
    salary: { effective_from: "2026-06-01" },
    employee: { confirmedDate: "2026-06-30" }
  }), "2026-06-30");
  assert.equal(summary.paidLeaveDays, 1);
  assert.equal(summary.payableDays, 2);
  assert.equal(summary.effectiveStartKey, "2026-06-30");
});
