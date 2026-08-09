const { getPayrollPgPool } = require("../../config/payrollDb");
const OrgSettings = require("../orgSettings/orgSettings.model");
const Organization = require("../organizations/organization.model");
const { ensurePayrollSchema } = require("./payrollSchema.service");

const DEFAULT_COUNTRY_CODE = String(process.env.PAYROLL_COUNTRY || "IN").toUpperCase();
const DEFAULT_STATE_CODE = String(process.env.PAYROLL_STATE_CODE || "TS").toUpperCase();
const DEFAULT_TIMEZONE = String(process.env.PAYROLL_DEFAULT_TIMEZONE || "Asia/Kolkata");
const DEFAULT_SALARY_PAY_DAY = Math.min(
  31,
  Math.max(1, Number(process.env.PAYROLL_DEFAULT_SALARY_PAY_DAY || 30))
);
const STARTER_EFFECTIVE_FROM = "2000-01-01";

const STARTER_COMPONENTS = {
  earning: [
    {
      code: "BASIC",
      name: "Basic Pay",
      display_name: "Basic",
      calculation_mode: "formula",
      taxable: true,
      pf_applicable: true,
      esi_applicable: true,
      prorate_with_attendance: true,
      rounding_policy: "nearest_rupee",
      priority: 10
    },
    {
      code: "HRA",
      name: "House Rent Allowance",
      display_name: "HRA",
      calculation_mode: "formula",
      taxable: true,
      pf_applicable: false,
      esi_applicable: true,
      prorate_with_attendance: true,
      rounding_policy: "nearest_rupee",
      priority: 20
    },
    {
      code: "FOOD_COUPONS",
      name: "Food Coupons",
      display_name: "Food Coupons",
      calculation_mode: "fixed",
      taxable: false,
      pf_applicable: false,
      esi_applicable: false,
      prorate_with_attendance: false,
      rounding_policy: "nearest_rupee",
      priority: 25,
      metadata: {
        defaultEnabled: false,
        monthlyAmount: 2200
      }
    },
    {
      code: "CHILDREN_EDU_ALLOW",
      name: "Children Education Allowance",
      display_name: "Children Edu. Allow.",
      calculation_mode: "fixed",
      taxable: false,
      pf_applicable: false,
      esi_applicable: false,
      prorate_with_attendance: false,
      rounding_policy: "nearest_rupee",
      priority: 27,
      metadata: {
        defaultEnabled: false,
        monthlyAmount: 200
      }
    },
    {
      code: "VARIABLE",
      name: "Variable Pay",
      display_name: "Variable",
      calculation_mode: "formula",
      taxable: true,
      pf_applicable: false,
      esi_applicable: false,
      prorate_with_attendance: true,
      rounding_policy: "nearest_rupee",
      priority: 30
    },
    {
      code: "OTHER_ALLOWANCE",
      name: "Other Allowance",
      display_name: "Other Allowance",
      calculation_mode: "formula",
      taxable: true,
      pf_applicable: false,
      esi_applicable: true,
      prorate_with_attendance: true,
      rounding_policy: "nearest_rupee",
      priority: 40,
      metadata: {
        defaultEnabled: true
      }
    },
    {
      code: "BONUS",
      name: "Bonus",
      display_name: "Bonus",
      calculation_mode: "fixed",
      taxable: true,
      pf_applicable: false,
      esi_applicable: false,
      prorate_with_attendance: false,
      rounding_policy: "nearest_rupee",
      priority: 50,
      metadata: {
        defaultEnabled: false,
        frequency: "monthly"
      }
    },
    {
      code: "ESOP",
      name: "ESOP Perquisite",
      display_name: "ESOP",
      calculation_mode: "fixed",
      taxable: true,
      pf_applicable: false,
      esi_applicable: false,
      prorate_with_attendance: false,
      rounding_policy: "nearest_rupee",
      priority: 60,
      metadata: {
        defaultEnabled: false,
        frequency: "event_based"
      }
    }
  ],
  deduction: [
    {
      code: "EPF",
      name: "Employee Provident Fund",
      display_name: "EPF",
      calculation_mode: "formula",
      taxable: false,
      is_statutory: true,
      employee_share_only: true,
      rounding_policy: "nearest_rupee",
      priority: 110
    },
    {
      code: "ESI",
      name: "Employee State Insurance",
      display_name: "ESI",
      calculation_mode: "formula",
      taxable: false,
      is_statutory: true,
      employee_share_only: true,
      rounding_policy: "nearest_rupee",
      priority: 120
    },
    {
      code: "PT",
      name: "Professional Tax",
      display_name: "PT",
      calculation_mode: "formula",
      taxable: false,
      is_statutory: true,
      employee_share_only: true,
      rounding_policy: "nearest_rupee",
      priority: 130,
      metadata: {
        defaultEnabled: true,
        expression: "if(MONTHLY_GROSS <= 15000, 0, if(MONTHLY_GROSS <= 20000, 150, 200))"
      }
    },
    {
      code: "TDS",
      name: "Tax Deducted at Source",
      display_name: "TDS",
      calculation_mode: "formula",
      taxable: false,
      is_statutory: true,
      employee_share_only: true,
      rounding_policy: "nearest_rupee",
      priority: 140,
      metadata: {
        defaultEnabled: false
      }
    },
    {
      code: "PARENTS_MEDICAL_PREM",
      name: "Parents Medical Premium",
      display_name: "Parents Medical Prem",
      calculation_mode: "fixed",
      taxable: false,
      is_statutory: false,
      employee_share_only: true,
      rounding_policy: "nearest_rupee",
      priority: 145,
      metadata: {
        defaultEnabled: false,
        monthlyAmount: 7859
      }
    }
  ],
  employer_contribution: [
    {
      code: "EMPLOYER_EPF",
      name: "Employer Provident Fund",
      display_name: "Employer EPF",
      calculation_mode: "formula",
      contributes_to_ctc: true,
      linked_deduction_code: "EPF",
      rounding_policy: "nearest_rupee",
      priority: 210
    },
    {
      code: "ESI_ER",
      name: "Employer State Insurance",
      display_name: "Employer ESI",
      calculation_mode: "formula",
      contributes_to_ctc: true,
      linked_deduction_code: "ESI",
      rounding_policy: "nearest_rupee",
      priority: 220,
      metadata: {
        defaultEnabled: false
      }
    },
    {
      code: "GRATUITY",
      name: "Gratuity Provision",
      display_name: "Gratuity",
      calculation_mode: "formula",
      contributes_to_ctc: true,
      linked_deduction_code: null,
      rounding_policy: "nearest_rupee",
      priority: 230,
      metadata: {
        defaultEnabled: false,
        eligibilityNote: "Payable after 5 years of service under the Gratuity Act"
      }
    }
  ]
};

const STARTER_FORMULAS = [
  {
    scope: "earning",
    componentCode: "BASIC",
    formulaCode: "BASIC_AUTO",
    formulaName: "Basic From Salary Structure",
    expression: "BASIC_PAY",
    executionOrder: 10
  },
  {
    scope: "earning",
    componentCode: "HRA",
    formulaCode: "HRA_AUTO",
    formulaName: "HRA From Basic",
    expression: "round(BASIC_PAY * HRA_PERCENT_OF_BASIC / 100)",
    executionOrder: 20
  },
  {
    scope: "earning",
    componentCode: "VARIABLE",
    formulaCode: "VARIABLE_AUTO",
    formulaName: "Variable From Salary Structure",
    expression: "VARIABLE_PAY",
    executionOrder: 30
  },
  {
    scope: "earning",
    componentCode: "OTHER_ALLOWANCE",
    formulaCode: "OTHER_ALLOWANCE_AUTO",
    formulaName: "Other Allowance Balancing Figure",
    expression: "round(max(MONTHLY_GROSS - (BASIC + HRA), 0))",
    executionOrder: 40
  },
  {
    scope: "deduction",
    componentCode: "EPF",
    formulaCode: "EPF_AUTO",
    formulaName: "Employee EPF",
    expression: "round(min(BASIC_PAY, 15000) * 0.12)",
    executionOrder: 110
  },
  {
    scope: "deduction",
    componentCode: "ESI",
    formulaCode: "ESI_AUTO",
    formulaName: "Employee ESI",
    expression: "round(ESI_EMPLOYEE_AMOUNT)",
    executionOrder: 120
  },
  {
    scope: "deduction",
    componentCode: "TDS",
    formulaCode: "TDS_AUTO",
    formulaName: "TDS From Employee Tax Engine",
    expression: "round(TDS_AMOUNT)",
    executionOrder: 140
  },
  {
    scope: "employer_contribution",
    componentCode: "EMPLOYER_EPF",
    formulaCode: "EMPLOYER_EPF_AUTO",
    formulaName: "Employer EPF",
    expression: "round(EMPLOYER_EPF)",
    executionOrder: 210
  },
  {
    scope: "employer_contribution",
    componentCode: "ESI_ER",
    formulaCode: "EMPLOYER_ESI_AUTO",
    formulaName: "Employer ESI",
    expression: "round(ESI_EMPLOYER_AMOUNT)",
    executionOrder: 220
  },
  {
    scope: "employer_contribution",
    componentCode: "GRATUITY",
    formulaCode: "GRATUITY_AUTO",
    formulaName: "Gratuity Provision",
    expression: "round(BASIC_PAY * 0.0481)",
    executionOrder: 230
  }
];

const toDay = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(31, Math.max(1, Math.trunc(parsed)));
};

const toSafeCode = (value, fallback = "ORG") =>
  String(value || fallback)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42) || fallback;

const isMissingPayrollSchemaError = (error) =>
  error?.code === "42P01" || /relation\s+"?payroll_/i.test(String(error?.message || ""));

const isPayrollSchemaPermissionError = (error) =>
  error?.code === "42501" && /schema public/i.test(String(error?.message || ""));

const toPayrollSetupError = (error) => {
  if (isPayrollSchemaPermissionError(error)) {
    return {
      code: 500,
      statusCode: 500,
      message:
        "Payroll Postgres is connected, but this database user cannot create payroll tables in schema public. Grant CREATE/USAGE on the schema or run payroll migrations with a privileged user first."
    };
  }

  if (isMissingPayrollSchemaError(error)) {
    return {
      code: 500,
      statusCode: 500,
      message:
        "Payroll database schema is not initialized yet. Enable payroll from Organization Settings or run the payroll migration once with a user that can create tables."
    };
  }

  if (error?.code === "ECONNRESET") {
    return {
      code: 503,
      statusCode: 503,
      message:
        "Payroll Postgres connection was reset while preparing payroll setup. Please verify the database connection and try again."
    };
  }

  return error;
};

const getOrgSettings = async (organizationId, orgSettings = null) => {
  if (orgSettings) return orgSettings;
  return OrgSettings.findOne({ organizationId })
    .select(
      "payrollEnabled payrollCutoffDay payrollSalaryPayDay timezone attendanceLockMode attendanceLockAfterDays"
    )
    .lean();
};

const getOrganization = async (organizationId) => {
  const organization = await Organization.findById(organizationId)
    .select("name code timezone")
    .lean();

  if (!organization) {
    throw { code: 404, message: "Organization not found" };
  }

  return organization;
};

const queryTenantId = async (client, organizationId) => {
  const result = await client.query(
    `SELECT id FROM payroll_tenants WHERE organization_id = $1`,
    [String(organizationId)]
  );
  return result.rows[0]?.id || null;
};

const ensurePool = async () => {
  const pool = await getPayrollPgPool();
  if (!pool) {
    throw {
      code: 400,
      message:
        "Payroll is enabled for this organization, but Payroll Postgres is not configured on the server."
    };
  }
  return pool;
};

const hasRows = async (client, sql, params) => {
  const result = await client.query(sql, params);
  return Number(result.rows[0]?.count || 0) > 0;
};

const buildStarterMetadata = (component) => ({
  autoProvisioned: true,
  starterPack: true,
  ...(component.metadata || {})
});

const insertStarterEarningComponent = async (client, tenantId, component, actorId) => {
  const result = await client.query(
    `
      INSERT INTO earning_components (
        tenant_id, code, name, display_name, description, calculation_mode, taxable,
        priority, pf_applicable, esi_applicable, prorate_with_attendance, rounding_policy,
        effective_from, effective_to, version_no, is_active, metadata, created_by, updated_by
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NULL,1,true,$14::jsonb,$15,$15
      )
      ON CONFLICT (tenant_id, code, effective_from)
      DO UPDATE SET
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
      RETURNING id, code
    `,
    [
      tenantId,
      component.code,
      component.name,
      component.display_name,
      "Auto-created when payroll was enabled",
      component.calculation_mode,
      component.taxable,
      component.priority,
      component.pf_applicable,
      component.esi_applicable,
      component.prorate_with_attendance,
      component.rounding_policy,
      STARTER_EFFECTIVE_FROM,
      JSON.stringify(buildStarterMetadata(component)),
      actorId
    ]
  );
  return result.rows[0];
};

const insertStarterDeductionComponent = async (client, tenantId, component, actorId) => {
  const result = await client.query(
    `
      INSERT INTO deduction_components (
        tenant_id, code, name, display_name, description, calculation_mode, taxable,
        priority, is_statutory, employee_share_only, cap_amount, rounding_policy,
        effective_from, effective_to, version_no, is_active, metadata, created_by, updated_by
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL,$11,$12,NULL,1,true,$13::jsonb,$14,$14
      )
      ON CONFLICT (tenant_id, code, effective_from)
      DO UPDATE SET
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
      RETURNING id, code
    `,
    [
      tenantId,
      component.code,
      component.name,
      component.display_name,
      "Auto-created when payroll was enabled",
      component.calculation_mode,
      component.taxable,
      component.priority,
      component.is_statutory,
      component.employee_share_only,
      component.rounding_policy,
      STARTER_EFFECTIVE_FROM,
      JSON.stringify(buildStarterMetadata(component)),
      actorId
    ]
  );
  return result.rows[0];
};

const insertStarterEmployerComponent = async (client, tenantId, component, actorId) => {
  const result = await client.query(
    `
      INSERT INTO employer_contribution_components (
        tenant_id, code, name, display_name, description, calculation_mode, priority,
        contributes_to_ctc, linked_deduction_code, rounding_policy,
        effective_from, effective_to, version_no, is_active, metadata, created_by, updated_by
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,1,true,$12::jsonb,$13,$13
      )
      ON CONFLICT (tenant_id, code, effective_from)
      DO UPDATE SET
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
      RETURNING id, code
    `,
    [
      tenantId,
      component.code,
      component.name,
      component.display_name,
      "Auto-created when payroll was enabled",
      component.calculation_mode,
      component.priority,
      component.contributes_to_ctc,
      component.linked_deduction_code,
      component.rounding_policy,
      STARTER_EFFECTIVE_FROM,
      JSON.stringify(buildStarterMetadata(component)),
      actorId
    ]
  );
  return result.rows[0];
};

const ensureStarterPayrollComponents = async ({ client, tenantId, actorId }) => {
  const actor = String(actorId || "system");
  const componentIdByScopeCode = new Map();

  const earningExists = await hasRows(
    client,
    `SELECT COUNT(*)::int AS count FROM earning_components WHERE tenant_id = $1`,
    [tenantId]
  );
  if (!earningExists) {
    for (const component of STARTER_COMPONENTS.earning) {
      const row = await insertStarterEarningComponent(client, tenantId, component, actor);
      componentIdByScopeCode.set(`earning:${row.code}`, row.id);
    }
  } else {
    const rows = await client.query(
      `SELECT id, code FROM earning_components WHERE tenant_id = $1`,
      [tenantId]
    );
    for (const row of rows.rows) {
      componentIdByScopeCode.set(`earning:${row.code}`, row.id);
    }
  }

  const deductionExists = await hasRows(
    client,
    `SELECT COUNT(*)::int AS count FROM deduction_components WHERE tenant_id = $1`,
    [tenantId]
  );
  if (!deductionExists) {
    for (const component of STARTER_COMPONENTS.deduction) {
      const row = await insertStarterDeductionComponent(client, tenantId, component, actor);
      componentIdByScopeCode.set(`deduction:${row.code}`, row.id);
    }
  } else {
    const rows = await client.query(
      `SELECT id, code FROM deduction_components WHERE tenant_id = $1`,
      [tenantId]
    );
    for (const row of rows.rows) {
      componentIdByScopeCode.set(`deduction:${row.code}`, row.id);
    }
  }

  const employerExists = await hasRows(
    client,
    `SELECT COUNT(*)::int AS count FROM employer_contribution_components WHERE tenant_id = $1`,
    [tenantId]
  );
  if (!employerExists) {
    for (const component of STARTER_COMPONENTS.employer_contribution) {
      const row = await insertStarterEmployerComponent(client, tenantId, component, actor);
      componentIdByScopeCode.set(`employer_contribution:${row.code}`, row.id);
    }
  } else {
    const rows = await client.query(
      `SELECT id, code FROM employer_contribution_components WHERE tenant_id = $1`,
      [tenantId]
    );
    for (const row of rows.rows) {
      componentIdByScopeCode.set(`employer_contribution:${row.code}`, row.id);
    }
  }

  const formulaExists = await hasRows(
    client,
    `SELECT COUNT(*)::int AS count FROM component_formulas WHERE tenant_id = $1`,
    [tenantId]
  );
  if (formulaExists) {
    return;
  }

  for (const formula of STARTER_FORMULAS) {
    const componentId = componentIdByScopeCode.get(`${formula.scope}:${formula.componentCode}`);
    if (!componentId) continue;

    await client.query(
      `
        INSERT INTO component_formulas (
          tenant_id,
          component_scope,
          earning_component_id,
          deduction_component_id,
          employer_contribution_component_id,
          formula_code,
          formula_name,
          formula_expression,
          formula_variables,
          execution_order,
          is_fallback_formula,
          effective_from,
          effective_to,
          version_no,
          is_active,
          metadata,
          created_by,
          updated_by
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,'{}'::jsonb,$9,false,$10,NULL,1,true,$11::jsonb,$12,$12
        )
        ON CONFLICT (tenant_id, component_scope, formula_code, version_no)
        DO UPDATE SET
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW()
      `,
      [
        tenantId,
        formula.scope,
        formula.scope === "earning" ? componentId : null,
        formula.scope === "deduction" ? componentId : null,
        formula.scope === "employer_contribution" ? componentId : null,
        formula.formulaCode,
        formula.formulaName,
        formula.expression,
        formula.executionOrder,
        STARTER_EFFECTIVE_FROM,
        JSON.stringify({ autoProvisioned: true, starterPack: true }),
        actor
      ]
    );
  }
};

const ensureDefaultPayGroup = async ({
  client,
  tenantId,
  organization,
  cutoffDay,
  salaryPayDay,
  actorId
}) => {
  const existingResult = await client.query(
    `
      SELECT id
      FROM pay_groups
      WHERE tenant_id = $1
      ORDER BY is_active DESC, created_at ASC
      LIMIT 1
    `,
    [tenantId]
  );

  if (existingResult.rows[0]?.id) {
    await client.query(
      `
        UPDATE pay_groups
        SET
          cutoff_day = $2,
          salary_pay_day = $3,
          updated_by = $4
        WHERE tenant_id = $1
      `,
      [tenantId, cutoffDay, salaryPayDay, actorId]
    );
    return existingResult.rows[0].id;
  }

  const code = `${toSafeCode(organization.code || organization.name)}-MONTHLY`.slice(0, 50);
  const name = `${String(organization.name || "Organization").trim().slice(0, 90)} Monthly`;

  const result = await client.query(
    `
      INSERT INTO pay_groups (
        tenant_id,
        code,
        name,
        description,
        pay_frequency,
        cutoff_day,
        salary_pay_day,
        work_week_days,
        is_active,
        metadata,
        created_by,
        updated_by
      )
      VALUES (
        $1,$2,$3,$4,'monthly',$5,$6,6,true,$7::jsonb,$8,$8
      )
      RETURNING id
    `,
    [
      tenantId,
      code,
      name,
      "Auto-created from organization settings",
      cutoffDay,
      salaryPayDay,
      JSON.stringify({ autoProvisioned: true }),
      actorId
    ]
  );

  return result.rows[0]?.id || null;
};

const upsertPayrollSettings = async ({
  client,
  tenantId,
  defaultPayGroupId,
  orgSettings,
  actorId
}) => {
  await client.query(
    `
      INSERT INTO payroll_settings (
        tenant_id,
        default_pay_group_id,
        country_code,
        state_code,
        attendance_source,
        attendance_lock_mode,
        attendance_lock_after_days,
        rounding_policy,
        default_working_days,
        lop_calculation_method,
        enable_proration,
        enable_arrears,
        enable_reimbursements,
        enable_loan_deductions,
        metadata,
        created_by,
        updated_by
      )
      VALUES (
        $1,$2,$3,$4,'mongo_timesheet',$5,$6,'nearest_rupee',30,'working_days',
        true,true,true,true,$7::jsonb,$8,$8
      )
      ON CONFLICT (tenant_id)
      DO UPDATE SET
        default_pay_group_id = COALESCE(payroll_settings.default_pay_group_id, EXCLUDED.default_pay_group_id),
        attendance_lock_mode = EXCLUDED.attendance_lock_mode,
        attendance_lock_after_days = EXCLUDED.attendance_lock_after_days,
        updated_by = EXCLUDED.updated_by,
        metadata = payroll_settings.metadata || EXCLUDED.metadata
    `,
    [
      tenantId,
      defaultPayGroupId,
      DEFAULT_COUNTRY_CODE,
      DEFAULT_STATE_CODE,
      String(orgSettings?.attendanceLockMode || "payroll_cutoff"),
      Number(orgSettings?.attendanceLockAfterDays ?? 7),
      JSON.stringify({
        autoProvisioned: true,
        orgSettingsCutoffDay: toDay(orgSettings?.payrollCutoffDay, 25)
      }),
      actorId
    ]
  );
};

exports.ensurePayrollTenantAndDefaults = async ({
  organizationId,
  actorId = "system",
  orgSettings = null,
  client: existingClient = null
}) => {
  const settings = await getOrgSettings(organizationId, orgSettings);
  if (!settings?.payrollEnabled) {
    throw {
      code: 400,
      message: "Payroll is disabled for this organization. Enable it in Organization Settings first."
    };
  }

  const organization = await getOrganization(organizationId);
  const pool = existingClient ? null : await ensurePool();
  const client = existingClient || (await pool.connect());

  try {
    await ensurePayrollSchema(client);

    const timezone = String(settings?.timezone || organization?.timezone || DEFAULT_TIMEZONE);
    const result = await client.query(
      `
        INSERT INTO payroll_tenants (
          organization_id,
          legal_name,
          trade_name,
          country_code,
          state_code,
          timezone,
          currency_code,
          is_active,
          metadata,
          created_by,
          updated_by
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,'INR',true,$7::jsonb,$8,$8
        )
        ON CONFLICT (organization_id)
        DO UPDATE SET
          legal_name = EXCLUDED.legal_name,
          trade_name = EXCLUDED.trade_name,
          state_code = EXCLUDED.state_code,
          timezone = EXCLUDED.timezone,
          is_active = true,
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW()
        RETURNING id
      `,
      [
        String(organizationId),
        String(organization.name || "Organization"),
        String(organization.code || organization.name || "Organization"),
        DEFAULT_COUNTRY_CODE,
        DEFAULT_STATE_CODE,
        timezone,
        JSON.stringify({ autoProvisioned: true }),
        String(actorId || "system")
      ]
    );

    const tenantId = result.rows[0]?.id;
    const cutoffDay = toDay(settings?.payrollCutoffDay, 25);
    const salaryPayDay = toDay(settings?.payrollSalaryPayDay, DEFAULT_SALARY_PAY_DAY);
    const defaultPayGroupId = await ensureDefaultPayGroup({
      client,
      tenantId,
      organization,
      cutoffDay,
      salaryPayDay,
      actorId: String(actorId || "system")
    });

    await upsertPayrollSettings({
      client,
      tenantId,
      defaultPayGroupId,
      orgSettings: settings,
      actorId: String(actorId || "system")
    });

    await ensureStarterPayrollComponents({
      client,
      tenantId,
      actorId: String(actorId || "system")
    });

    return {
      tenantId,
      defaultPayGroupId,
      payrollCutoffDay: cutoffDay,
      payrollSalaryPayDay: salaryPayDay
    };
  } finally {
    if (!existingClient && client) client.release();
  }
};

exports.getTenantIdForOrganization = async (
  client,
  organizationId,
  {
    actorId = "system",
    orgSettings = null,
    autoProvision = true,
    requirePayrollEnabled = true
  } = {}
) => {
  const settings = await getOrgSettings(organizationId, orgSettings);
  if (requirePayrollEnabled && !settings?.payrollEnabled) {
    throw {
      code: 400,
      message: "Payroll is disabled for this organization. Enable it in Organization Settings first."
    };
  }

  let tenantId = null;
  try {
    tenantId = await queryTenantId(client, organizationId);
  } catch (error) {
    if (!autoProvision) {
      throw toPayrollSetupError(error);
    }

    if (!isMissingPayrollSchemaError(error)) {
      throw toPayrollSetupError(error);
    }
  }

  if (!tenantId && autoProvision) {
    try {
      const provisioned = await exports.ensurePayrollTenantAndDefaults({
        organizationId,
        actorId,
        orgSettings: settings,
        client
      });
      tenantId = provisioned.tenantId;
    } catch (error) {
      throw toPayrollSetupError(error);
    }
  }

  if (!tenantId) {
    throw {
      code: 400,
      message:
        "Payroll tenant could not be resolved for this organization. Enable payroll in Organization Settings to provision it automatically."
    };
  }

  return tenantId;
};
