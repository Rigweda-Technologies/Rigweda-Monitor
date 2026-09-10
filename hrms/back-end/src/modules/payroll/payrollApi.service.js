const { getPayrollPgPool } = require("../../config/payrollDb");
const { safeRollback } = require("./payrollTx");
const Employee = require("../employees/employee.model");
const OrgSettings = require("../orgSettings/orgSettings.model");
const { getTenantIdForOrganization } = require("./payrollProvisioning.service");

const toJson = (value, fallback = {}) => {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
};

const toDateKey = (value) => {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? trimmed.slice(0, 10) : parsed.toISOString().slice(0, 10);
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return String(value).slice(0, 10);
};

const stripComponentPayGroupMetadata = (metadata) => {
  const normalized = { ...toJson(metadata, {}) };
  delete normalized.payGroupId;
  delete normalized.pay_group_id;
  delete normalized.payGroupIds;
  if (normalized.applicability && typeof normalized.applicability === "object") {
    const applicability = { ...normalized.applicability };
    delete applicability.payGroupId;
    delete applicability.pay_group_id;
    delete applicability.payGroupIds;
    if (Object.keys(applicability).length > 0) normalized.applicability = applicability;
    else delete normalized.applicability;
  }
  return normalized;
};

const normalizeComponentNameKey = (value) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

const normalizeGeneratedComponentCode = (value) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const COMPONENT_NAME_CODE_PRESETS = [
  { names: ["Basic Pay", "Basic", "Basic Salary"], code: "BASIC" },
  { names: ["House Rent Allowance", "HRA"], code: "HRA" },
  { names: ["Food Coupons"], code: "FOOD_COUPONS" },
  { names: ["Children Education Allowance", "Children Edu Allowance"], code: "CHILDREN_EDU_ALLOW" },
  { names: ["Other Allowance"], code: "OTHER_ALLOWANCE" },
  { names: ["Employee Provident Fund", "Employee PF", "EPF"], code: "EPF" },
  { names: ["Employee State Insurance", "ESI"], code: "ESI" },
  { names: ["Professional Tax", "PT"], code: "PT" },
  { names: ["Tax Deducted at Source", "TDS"], code: "TDS" },
  { names: ["Parents Medical Premium"], code: "PARENTS_MEDICAL_PREM" },
  { names: ["Employer Provident Fund", "Employer PF", "Employer EPF"], code: "EMPLOYER_EPF" }
];

const getCanonicalComponentCodeFromName = (name) => {
  const normalizedName = normalizeComponentNameKey(name);
  if (!normalizedName) return "";
  const match = COMPONENT_NAME_CODE_PRESETS.find((preset) =>
    preset.names.some((candidate) => normalizeComponentNameKey(candidate) === normalizedName)
  );
  return match?.code || "";
};

const buildUniqueGeneratedComponentCode = (baseCode, takenCodes = new Set()) => {
  const normalizedBaseCode = normalizeGeneratedComponentCode(baseCode) || "CUSTOM_COMPONENT";
  let candidate = normalizedBaseCode;
  let suffix = 2;
  while (takenCodes.has(candidate)) {
    candidate = `${normalizedBaseCode}_${suffix}`;
    suffix += 1;
  }
  return candidate;
};

const listExistingComponentCodes = async ({ client, tenantId, scope }) => {
  const tableName = tableByScope[scope];
  if (!tableName) return new Set();

  const result = await client.query(
    `
      SELECT DISTINCT UPPER(code) AS code
      FROM ${tableName}
      WHERE tenant_id = $1
    `,
    [tenantId]
  );
  return new Set(
    result.rows.map((row) => String(row.code || "").trim()).filter(Boolean)
  );
};

const resolveComponentCode = async ({ client, tenantId, scope, payload, currentCode = "" }) => {
  const existingCodes = await listExistingComponentCodes({ client, tenantId, scope });
  const normalizedCurrentCode = normalizeGeneratedComponentCode(currentCode);
  if (normalizedCurrentCode) existingCodes.delete(normalizedCurrentCode);

  const canonicalCode = getCanonicalComponentCodeFromName(payload?.name || "");
  const requestedCode = normalizeGeneratedComponentCode(payload?.code || "");
  const baseCode =
    canonicalCode ||
    requestedCode ||
    normalizeGeneratedComponentCode(payload?.name || "") ||
    normalizedCurrentCode;

  if (!baseCode) return buildUniqueGeneratedComponentCode("CUSTOM_COMPONENT", existingCodes);
  if (!existingCodes.has(baseCode)) return baseCode;
  return buildUniqueGeneratedComponentCode(baseCode, existingCodes);
};

const shiftDateKey = (value, dayOffset = 0) => {
  const normalized = toDateKey(value);
  if (!normalized) return "";

  const [year, month, day] = normalized.split("-").map((part) => Number(part));
  if (![year, month, day].every((part) => Number.isFinite(part))) return "";

  return new Date(Date.UTC(year, month - 1, day + dayOffset)).toISOString().slice(0, 10);
};

const isRevisionEditableByDate = (effectiveTo, currentDate = new Date()) => {
  const normalizedEffectiveTo = toDateKey(effectiveTo);
  if (!normalizedEffectiveTo) return true;
  return toDateKey(currentDate.toISOString()) <= normalizedEffectiveTo;
};

const tableByScope = {
  earning: "earning_components",
  deduction: "deduction_components",
  employer_contribution: "employer_contribution_components"
};

const getComponentPayGroupId = (component) => {
  const directPayGroupId = String(component?.pay_group_id || component?.payGroupId || "").trim();
  if (directPayGroupId) return directPayGroupId;

  const metadata = toJson(component?.metadata, {});
  const nestedPayGroupId = String(
    metadata?.payGroupId ||
      metadata?.pay_group_id ||
      metadata?.applicability?.payGroupId ||
      metadata?.applicability?.pay_group_id ||
      ""
  ).trim();
  if (nestedPayGroupId) return nestedPayGroupId;

  const fromArray = [
    ...(Array.isArray(metadata?.payGroupIds) ? metadata.payGroupIds : []),
    ...(Array.isArray(metadata?.applicability?.payGroupIds) ? metadata.applicability.payGroupIds : [])
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  return fromArray[0] || "";
};

exports.__test__ = {
  isRevisionEditableByDate,
  toDateKey,
  normalizeComponentNameKey,
  normalizeGeneratedComponentCode,
  getCanonicalComponentCodeFromName,
  buildUniqueGeneratedComponentCode
};

const starterConstraintByScope = {
  earning: "uq_earning_component_version",
  deduction: "uq_deduction_component_version",
  employer_contribution: "uq_employer_component_version"
};

const ensurePool = async () => {
  const pool = await getPayrollPgPool();
  if (!pool) throw { code: 400, message: "Payroll Postgres is not enabled" };
  return pool;
};

const isWizardComponentCreate = (payload = {}) =>
  String(payload?.metadata?.wizardVersion || "").trim().toLowerCase() === "v1";

const fetchExistingSalaryComponentByCode = async ({ client, tenantId, scope, code }) => {
  const tableName = tableByScope[scope];
  if (!tableName) return null;

  const result = await client.query(
    `
      SELECT *
      FROM ${tableName}
      WHERE tenant_id = $1
        AND code = $2
      ORDER BY version_no DESC, effective_from DESC, created_at DESC
      LIMIT 1
    `,
    [tenantId, code]
  );

  return result.rows[0] || null;
};

const getOrgPayrollSettings = async (organizationId) =>
  OrgSettings.findOne({ organizationId })
    .select("payrollEnabled payrollCutoffDay payrollSalaryPayDay")
    .lean();

const getComponentPayGroupIds = (component) => {
  const directPayGroupId = getComponentPayGroupId(component);
  const metadata = toJson(component?.metadata, {});
  const normalizeValues = (value) => {
    if (Array.isArray(value)) return value;
    if (typeof value === "string" && value.trim()) return [value];
    return [];
  };
  const fromMetadata = [
    ...normalizeValues(directPayGroupId),
    ...normalizeValues(metadata?.payGroupIds),
    ...normalizeValues(metadata?.payGroupId),
    ...normalizeValues(metadata?.pay_group_id),
    ...normalizeValues(metadata?.applicability?.payGroupIds),
    ...normalizeValues(metadata?.applicability?.payGroupId),
    ...normalizeValues(metadata?.applicability?.pay_group_id)
  ];

  return [...new Set(fromMetadata.map((value) => String(value || "").trim()).filter(Boolean))];
};

const isComponentApplicableToPayGroup = (component, payGroupId) => {
  if (!payGroupId) return true;
  const payGroupIds = getComponentPayGroupIds(component);
  return payGroupIds.includes(String(payGroupId));
};

const getNormalizedComponentMetadata = (component, payGroupId) => {
  const metadata = stripComponentPayGroupMetadata(component?.metadata);
  const calculationMode = String(component?.calculation_mode || component?.calculationMode || "")
    .trim()
    .toLowerCase();
  const normalized = { ...metadata };

  if (calculationMode === "percentage") {
    const percentage = Number(
      normalized.percentage ?? normalized.amount ?? normalized.monthlyAmount ?? 0
    );
    normalized.base = String(normalized.base || "MONTHLY_GROSS");
    normalized.percentage = Number.isFinite(percentage) ? percentage : 0;
    delete normalized.amount;
    delete normalized.monthlyAmount;
    delete normalized.defaultAmount;
  } else if (calculationMode === "formula") {
    normalized.expression = String(
      normalized.expression || normalized.formulaExpression || component?.formulaExpression || ""
    ).trim();
    delete normalized.amount;
    delete normalized.monthlyAmount;
    delete normalized.defaultAmount;
  } else {
    const monthlyAmount = Number(
      normalized.monthlyAmount ?? normalized.amount ?? normalized.defaultAmount ?? 0
    );
    normalized.monthlyAmount = Number.isFinite(monthlyAmount) ? monthlyAmount : 0;
    delete normalized.percentage;
  }

  return normalized;
};

const backfillPayGroupComponentMetadata = async ({ client, tenantId, payGroupId, components, actorId }) => {
  let updatedCount = 0;
  for (const component of components || []) {
    if (!component?.id || !component?.scope) continue;
    const normalizedMetadata = getNormalizedComponentMetadata(component);
    const currentMetadata = toJson(component.metadata, {});
    const currentPayGroupId = String(component?.pay_group_id || component?.payGroupId || "").trim();
    if (
      JSON.stringify(normalizedMetadata) === JSON.stringify(currentMetadata) &&
      currentPayGroupId === String(payGroupId || "").trim()
    ) {
      continue;
    }

    const tableName = tableByScope[component.scope];
    if (!tableName) continue;

    await client.query(
      `
        UPDATE ${tableName}
        SET pay_group_id = $3,
            metadata = $4::jsonb,
            updated_by = $5,
            updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2
      `,
      [component.id, tenantId, payGroupId || null, JSON.stringify(normalizedMetadata), actorId]
    );
    updatedCount += 1;
  }
  return updatedCount;
};

const resolvePayGroupCutoffDay = async (organizationId, payloadCutoffDay) => {
  if (payloadCutoffDay !== undefined) return payloadCutoffDay ?? null;
  const orgSettings = await getOrgPayrollSettings(organizationId);
  return Number(orgSettings?.payrollCutoffDay ?? 25);
};

const updateSalaryComponentRecord = async ({
  client,
  tenantId,
  scope,
  componentId,
  payload,
  actorId,
  forceActive = false
}) => {
  if (scope === "earning") {
    return client.query(
      `
        UPDATE earning_components
        SET
          pay_group_id = COALESCE($3, pay_group_id),
          name = COALESCE($4, name),
          display_name = COALESCE($5, display_name),
          description = COALESCE($6, description),
          calculation_mode = COALESCE($7, calculation_mode),
          taxable = COALESCE($8, taxable),
          priority = COALESCE($9, priority),
          pf_applicable = COALESCE($10, pf_applicable),
          esi_applicable = COALESCE($11, esi_applicable),
          prorate_with_attendance = COALESCE($12, prorate_with_attendance),
          rounding_policy = COALESCE($13, rounding_policy),
          effective_from = COALESCE($14, effective_from),
          effective_to = CASE
            WHEN $16::boolean = true AND $15::date IS NULL THEN NULL
            ELSE COALESCE($15, effective_to)
          END,
          is_active = COALESCE($16, is_active),
          metadata = CASE WHEN $17::jsonb = '{}'::jsonb THEN metadata ELSE metadata || $17::jsonb END,
          updated_by = $18
        WHERE id = $1 AND tenant_id = $2
        RETURNING *
      `,
      [
        componentId,
        tenantId,
        payload.payGroupId ?? null,
        payload.name ?? null,
        payload.displayName ?? null,
        payload.description ?? null,
        payload.calculationMode ?? null,
        payload.taxable ?? null,
        payload.priority ?? null,
        payload.pfApplicable ?? null,
        payload.esiApplicable ?? null,
        payload.prorateWithAttendance ?? null,
        payload.roundingPolicy ?? null,
        payload.effectiveFrom ?? null,
        payload.effectiveTo ?? null,
        forceActive ? true : payload.isActive ?? null,
        JSON.stringify(stripComponentPayGroupMetadata(payload.metadata || {})),
        actorId
      ]
    );
  }

  if (scope === "deduction") {
    return client.query(
      `
        UPDATE deduction_components
        SET
          pay_group_id = COALESCE($3, pay_group_id),
          name = COALESCE($4, name),
          display_name = COALESCE($5, display_name),
          description = COALESCE($6, description),
          calculation_mode = COALESCE($7, calculation_mode),
          taxable = COALESCE($8, taxable),
          priority = COALESCE($9, priority),
          is_statutory = COALESCE($10, is_statutory),
          employee_share_only = COALESCE($11, employee_share_only),
          cap_amount = COALESCE($12, cap_amount),
          rounding_policy = COALESCE($13, rounding_policy),
          effective_from = COALESCE($14, effective_from),
          effective_to = CASE
            WHEN $16::boolean = true AND $15::date IS NULL THEN NULL
            ELSE COALESCE($15, effective_to)
          END,
          is_active = COALESCE($16, is_active),
          metadata = CASE WHEN $17::jsonb = '{}'::jsonb THEN metadata ELSE metadata || $17::jsonb END,
          updated_by = $18
        WHERE id = $1 AND tenant_id = $2
        RETURNING *
      `,
      [
        componentId,
        tenantId,
        payload.payGroupId ?? null,
        payload.name ?? null,
        payload.displayName ?? null,
        payload.description ?? null,
        payload.calculationMode ?? null,
        payload.taxable ?? null,
        payload.priority ?? null,
        payload.isStatutory ?? null,
        payload.employeeShareOnly ?? null,
        payload.capAmount ?? null,
        payload.roundingPolicy ?? null,
        payload.effectiveFrom ?? null,
        payload.effectiveTo ?? null,
        forceActive ? true : payload.isActive ?? null,
        JSON.stringify(stripComponentPayGroupMetadata(payload.metadata || {})),
        actorId
      ]
    );
  }

  return client.query(
    `
      UPDATE employer_contribution_components
      SET
        pay_group_id = COALESCE($3, pay_group_id),
        name = COALESCE($4, name),
        display_name = COALESCE($5, display_name),
        description = COALESCE($6, description),
        calculation_mode = COALESCE($7, calculation_mode),
        priority = COALESCE($8, priority),
        contributes_to_ctc = COALESCE($9, contributes_to_ctc),
        linked_deduction_code = COALESCE($10, linked_deduction_code),
        rounding_policy = COALESCE($11, rounding_policy),
        effective_from = COALESCE($12, effective_from),
        effective_to = CASE
          WHEN $14::boolean = true AND $13::date IS NULL THEN NULL
          ELSE COALESCE($13, effective_to)
        END,
        is_active = COALESCE($14, is_active),
        metadata = CASE WHEN $15::jsonb = '{}'::jsonb THEN metadata ELSE metadata || $15::jsonb END,
        updated_by = $16
      WHERE id = $1 AND tenant_id = $2
      RETURNING *
    `,
    [
      componentId,
      tenantId,
      payload.payGroupId ?? null,
      payload.name ?? null,
      payload.displayName ?? null,
      payload.description ?? null,
      payload.calculationMode ?? null,
      payload.priority ?? null,
      payload.contributesToCtc ?? null,
      payload.linkedDeductionCode ?? null,
      payload.roundingPolicy ?? null,
      payload.effectiveFrom ?? null,
      payload.effectiveTo ?? null,
      forceActive ? true : payload.isActive ?? null,
      JSON.stringify(stripComponentPayGroupMetadata(payload.metadata || {})),
      actorId
    ]
  );
};

const closeSalaryComponentRevision = async ({
  client,
  tenantId,
  scope,
  componentId,
  effectiveTo,
  actorId
}) => {
  const tableName = tableByScope[scope];
  if (!tableName) throw { code: 400, message: "Invalid component scope" };

  return client.query(
    `
      UPDATE ${tableName}
      SET
        effective_to = $3,
        updated_by = $4,
        updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2
      RETURNING *
    `,
    [componentId, tenantId, effectiveTo, actorId]
  );
};

const insertSalaryComponentRevision = async ({
  client,
  tenantId,
  scope,
  payload,
  actorId,
  versionNo
}) => {
  if (scope === "earning") {
    return client.query(
      `
        INSERT INTO earning_components (
          tenant_id, pay_group_id, code, name, display_name, description, calculation_mode, taxable,
          priority, pf_applicable, esi_applicable, prorate_with_attendance, rounding_policy,
          effective_from, effective_to, version_no, is_active, metadata, created_by, updated_by
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$19
        )
        RETURNING *
      `,
      [
        tenantId,
        payload.payGroupId ?? null,
        payload.code,
        payload.name,
        payload.displayName || null,
        payload.description || null,
        payload.calculationMode,
        payload.taxable ?? true,
        payload.priority ?? 100,
        payload.pfApplicable ?? false,
        payload.esiApplicable ?? false,
        payload.prorateWithAttendance ?? true,
        payload.roundingPolicy || "nearest_rupee",
        payload.effectiveFrom,
        payload.effectiveTo || null,
        versionNo,
        payload.isActive ?? true,
        JSON.stringify(stripComponentPayGroupMetadata(payload.metadata || {})),
        actorId
      ]
    );
  }

  if (scope === "deduction") {
    return client.query(
      `
        INSERT INTO deduction_components (
          tenant_id, pay_group_id, code, name, display_name, description, calculation_mode, taxable,
          priority, is_statutory, employee_share_only, cap_amount, rounding_policy,
          effective_from, effective_to, version_no, is_active, metadata, created_by, updated_by
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$19
        )
        RETURNING *
      `,
      [
        tenantId,
        payload.payGroupId ?? null,
        payload.code,
        payload.name,
        payload.displayName || null,
        payload.description || null,
        payload.calculationMode,
        payload.taxable ?? false,
        payload.priority ?? 100,
        payload.isStatutory ?? false,
        payload.employeeShareOnly ?? true,
        payload.capAmount ?? null,
        payload.roundingPolicy || "nearest_rupee",
        payload.effectiveFrom,
        payload.effectiveTo || null,
        versionNo,
        payload.isActive ?? true,
        JSON.stringify(stripComponentPayGroupMetadata(payload.metadata || {})),
        actorId
      ]
    );
  }

  return client.query(
    `
      INSERT INTO employer_contribution_components (
        tenant_id, pay_group_id, code, name, display_name, description, calculation_mode, priority,
        contributes_to_ctc, linked_deduction_code, rounding_policy,
        effective_from, effective_to, version_no, is_active, metadata, created_by, updated_by
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$17
      )
      RETURNING *
    `,
    [
      tenantId,
      payload.payGroupId ?? null,
      payload.code,
      payload.name,
      payload.displayName || null,
      payload.description || null,
      payload.calculationMode,
      payload.priority ?? 100,
      payload.contributesToCtc ?? true,
      payload.linkedDeductionCode || null,
      payload.roundingPolicy || "nearest_rupee",
      payload.effectiveFrom,
      payload.effectiveTo || null,
      versionNo,
      payload.isActive ?? true,
      JSON.stringify(stripComponentPayGroupMetadata(payload.metadata || {})),
      actorId
    ]
  );
};

const throwPayGroupConflictError = (error) => {
  if (error?.code !== "23505") throw error;

  if (error?.constraint === "uq_pay_groups_tenant_code") {
    throw {
      code: 409,
      message: "Pay group code already exists for this organization"
    };
  }

  if (error?.constraint === "uq_pay_groups_tenant_name") {
    throw {
      code: 409,
      message: "Pay group name already exists for this organization"
    };
  }

  throw {
    code: 409,
    message: "Pay group with same details already exists"
  };
};

exports.getSettings = async (req) => {
  const orgSettings = await getOrgPayrollSettings(req.user.organizationId);
  if (!orgSettings?.payrollEnabled) {
    return {
      payrollEnabled: false,
      payrollCutoffDay: Number(orgSettings?.payrollCutoffDay ?? 25),
      payrollSalaryPayDay: Number(orgSettings?.payrollSalaryPayDay ?? 30)
    };
  }

  const pool = await ensurePool();
  const client = await pool.connect();
  try {
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId,
      orgSettings
    });
    const result = await client.query(
      `
        SELECT *
        FROM payroll_settings
        WHERE tenant_id = $1
        LIMIT 1
      `,
      [tenantId]
    );
    return {
      ...(result.rows[0] || {}),
      payrollEnabled: true,
      payrollCutoffDay: Number(orgSettings?.payrollCutoffDay ?? 25),
      payrollSalaryPayDay: Number(orgSettings?.payrollSalaryPayDay ?? 30)
    };
  } finally {
    client.release();
  }
};

exports.listPayGroups = async (req) => {
  const pool = await ensurePool();
  const client = await pool.connect();
  try {
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });
    const includeInactive =
      req.query?.includeInactive === true || req.query?.includeInactive === "true";

    const result = await client.query(
      `
        SELECT
          id,
          code,
          name,
          pay_frequency,
          cutoff_day,
          salary_pay_day,
          is_active,
          metadata
        FROM pay_groups
        WHERE tenant_id = $1
          AND ($2::boolean = true OR is_active = true)
        ORDER BY is_active DESC, name ASC, code ASC
      `,
      [tenantId, includeInactive]
    );
    return result.rows;
  } finally {
    client.release();
  }
};

exports.getPayGroup = async (req) => {
  const pool = await ensurePool();
  const client = await pool.connect();
  try {
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });

    const result = await client.query(
      `
        SELECT
          id,
          code,
          name,
          description,
          pay_frequency,
          cutoff_day,
          salary_pay_day,
          work_week_days,
          is_active,
          metadata
        FROM pay_groups
        WHERE id = $1
          AND tenant_id = $2
      `,
      [req.params.payGroupId, tenantId]
    );

    if (!result.rows[0]) throw { code: 404, message: "Pay group not found" };

    const includeComponents =
      String(req.query?.includeComponents || "").trim().toLowerCase() === "true";
    if (!includeComponents) {
      return result.rows[0];
    }

    const [earningRows, deductionRows, employerRows] = await Promise.all([
      exports.listSalaryComponents({
        ...req,
        query: { scope: "earning", payGroupId: req.params.payGroupId, includeInactive: true }
      }),
      exports.listSalaryComponents({
        ...req,
        query: { scope: "deduction", payGroupId: req.params.payGroupId, includeInactive: true }
      }),
      exports.listSalaryComponents({
        ...req,
        query: {
          scope: "employer_contribution",
          payGroupId: req.params.payGroupId,
          includeInactive: true
        }
      })
    ]);

    return {
      ...result.rows[0],
      components: dedupeLatestComponents([
        ...earningRows.map((item) => ({ ...item, scope: "earning" })),
        ...deductionRows.map((item) => ({ ...item, scope: "deduction" })),
        ...employerRows.map((item) => ({ ...item, scope: "employer_contribution" }))
      ])
    };
  } finally {
    client.release();
  }
};

exports.createPayGroup = async (req) => {
  const pool = await ensurePool();
  const client = await pool.connect();
  try {
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });
    const actorId = String(req.user.userId);
    const payload = req.body;
    const cutoffDay = await resolvePayGroupCutoffDay(req.user.organizationId, payload.cutoffDay);

    try {
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
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$11
          )
          RETURNING
            id,
            code,
            name,
            description,
            pay_frequency,
            cutoff_day,
            salary_pay_day,
            work_week_days,
            is_active,
            metadata
        `,
        [
          tenantId,
          payload.code,
          payload.name,
          payload.description || null,
          payload.payFrequency,
          cutoffDay,
          payload.salaryPayDay,
          payload.workWeekDays ?? 6,
          payload.isActive ?? true,
          JSON.stringify(payload.metadata || {}),
          actorId
        ]
      );
      return result.rows[0];
    } catch (error) {
      throwPayGroupConflictError(error);
    }
  } finally {
    client.release();
  }
};

exports.updatePayGroup = async (req) => {
  const pool = await ensurePool();
  const client = await pool.connect();
  try {
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });
    const actorId = String(req.user.userId);
    const payload = req.body;
    const cutoffDay = await resolvePayGroupCutoffDay(req.user.organizationId, payload.cutoffDay);

    try {
      const result = await client.query(
        `
          UPDATE pay_groups
          SET
            code = COALESCE($3, code),
            name = COALESCE($4, name),
            description = CASE WHEN $5::text IS NULL THEN description ELSE $5 END,
            pay_frequency = COALESCE($6, pay_frequency),
            cutoff_day = CASE WHEN $7::smallint IS NULL THEN cutoff_day ELSE $7 END,
            salary_pay_day = COALESCE($8, salary_pay_day),
            work_week_days = COALESCE($9, work_week_days),
            is_active = COALESCE($10, is_active),
            metadata = CASE
              WHEN $11::jsonb = '{}'::jsonb THEN metadata
              ELSE metadata || $11::jsonb
            END,
            updated_by = $12
          WHERE id = $1
            AND tenant_id = $2
          RETURNING
            id,
            code,
            name,
            description,
            pay_frequency,
            cutoff_day,
            salary_pay_day,
            work_week_days,
            is_active,
            metadata
        `,
        [
          req.params.payGroupId,
          tenantId,
          payload.code ?? null,
          payload.name ?? null,
          Object.prototype.hasOwnProperty.call(payload, "description")
            ? (payload.description || null)
            : null,
          payload.payFrequency ?? null,
          cutoffDay,
          payload.salaryPayDay ?? null,
          payload.workWeekDays ?? null,
          payload.isActive ?? null,
          JSON.stringify(payload.metadata || {}),
          actorId
        ]
      );

      if (!result.rows[0]) throw { code: 404, message: "Pay group not found" };
      return result.rows[0];
    } catch (error) {
      throwPayGroupConflictError(error);
    }
  } finally {
    client.release();
  }
};

exports.archivePayGroup = async (req) => {
  const pool = await ensurePool();
  const client = await pool.connect();
  try {
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });
    const actorId = String(req.user.userId);

    const result = await client.query(
      `
        UPDATE pay_groups
        SET
          is_active = false,
          updated_by = $3
        WHERE id = $1
          AND tenant_id = $2
        RETURNING id, code, name, is_active
      `,
      [req.params.payGroupId, tenantId, actorId]
    );

    if (!result.rows[0]) throw { code: 404, message: "Pay group not found" };
    return result.rows[0];
  } finally {
    client.release();
  }
};

exports.upsertSettings = async (req) => {
  const pool = await ensurePool();
  const client = await pool.connect();
  try {
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });
    const actorId = String(req.user.userId);
    const payload = req.body;

    const result = await client.query(
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
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$16
        )
        ON CONFLICT (tenant_id)
        DO UPDATE SET
          default_pay_group_id = COALESCE(EXCLUDED.default_pay_group_id, payroll_settings.default_pay_group_id),
          country_code = COALESCE(EXCLUDED.country_code, payroll_settings.country_code),
          state_code = COALESCE(EXCLUDED.state_code, payroll_settings.state_code),
          attendance_source = COALESCE(EXCLUDED.attendance_source, payroll_settings.attendance_source),
          attendance_lock_mode = COALESCE(EXCLUDED.attendance_lock_mode, payroll_settings.attendance_lock_mode),
          attendance_lock_after_days = COALESCE(EXCLUDED.attendance_lock_after_days, payroll_settings.attendance_lock_after_days),
          rounding_policy = COALESCE(EXCLUDED.rounding_policy, payroll_settings.rounding_policy),
          default_working_days = COALESCE(EXCLUDED.default_working_days, payroll_settings.default_working_days),
          lop_calculation_method = COALESCE(EXCLUDED.lop_calculation_method, payroll_settings.lop_calculation_method),
          enable_proration = COALESCE(EXCLUDED.enable_proration, payroll_settings.enable_proration),
          enable_arrears = COALESCE(EXCLUDED.enable_arrears, payroll_settings.enable_arrears),
          enable_reimbursements = COALESCE(EXCLUDED.enable_reimbursements, payroll_settings.enable_reimbursements),
          enable_loan_deductions = COALESCE(EXCLUDED.enable_loan_deductions, payroll_settings.enable_loan_deductions),
          metadata = payroll_settings.metadata || EXCLUDED.metadata,
          updated_by = EXCLUDED.updated_by
        RETURNING *
      `,
      [
        tenantId,
        payload.defaultPayGroupId || null,
        payload.countryCode || "IN",
        payload.stateCode || "TS",
        payload.attendanceSource || "mongo_timesheet",
        payload.attendanceLockMode || "payroll_cutoff",
        payload.attendanceLockAfterDays ?? 7,
        payload.roundingPolicy || "nearest_rupee",
        payload.defaultWorkingDays ?? 30,
        payload.lopCalculationMethod || "calendar_days",
        payload.enableProration ?? true,
        payload.enableArrears ?? true,
        payload.enableReimbursements ?? true,
        payload.enableLoanDeductions ?? true,
        JSON.stringify(payload.metadata || {}),
        actorId
      ]
    );

    return result.rows[0];
  } finally {
    client.release();
  }
};

const toSetupChildRequest = (req, overrides = {}) => ({
  ...req,
  params: {
    ...(req.params || {}),
    ...(overrides.params || {})
  },
  query: {
    ...(req.query || {}),
    ...(overrides.query || {})
  },
  body: overrides.body || req.body
});

const dedupeLatestComponents = (rows) => {
  const seen = new Set();
  const result = [];
  for (const row of rows) {
    const scopeKey = String(row.scope || "").trim();
    const codeKey = String(row.code || "").trim().toUpperCase();
    if (!scopeKey || !codeKey) continue;
    const compoundKey = `${scopeKey}:${codeKey}`;
    if (seen.has(compoundKey)) continue;
    seen.add(compoundKey);
    result.push(row);
  }
  return result;
};

exports.savePayrollSetup = async (req) => {
  const { payGroupId, payGroup, settings, components = [], removedComponents = [] } = req.body || {};
  if (!payGroupId) {
    throw { code: 400, message: "payGroupId is required" };
  }
  const pool = await ensurePool();
  const client = await pool.connect();
  try {
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });
    const incomingPayGroupCode = String(payGroup?.code || "").trim().toUpperCase();
    let resolvedPayGroupCode = incomingPayGroupCode;
    if (!resolvedPayGroupCode) {
      const existingPayGroup = await exports.getPayGroup({
        ...req,
        params: { ...(req.params || {}), payGroupId },
        query: {}
      });
      resolvedPayGroupCode = String(existingPayGroup?.code || "").trim().toUpperCase();
    }
    if (!resolvedPayGroupCode) {
      throw { code: 400, message: "payGroup.code is required" };
    }

    const updatedPayGroup = await exports.updatePayGroup(
      toSetupChildRequest(req, {
        params: { payGroupId },
        body: {
          ...(payGroup || {}),
          code: resolvedPayGroupCode
        }
      })
    );

    const updatedSettings = await exports.upsertSettings(
      toSetupChildRequest(req, {
        body: {
          ...(settings || {}),
          defaultPayGroupId: payGroupId
        }
      })
    );

    let createdCount = 0;
    let updatedCount = 0;
    let removedCount = 0;

    for (const removedComponent of removedComponents) {
      if (!removedComponent?.id || !removedComponent?.scope) continue;
      await exports.deleteSalaryComponent(
        toSetupChildRequest(req, {
          params: { id: removedComponent.id },
          query: { scope: removedComponent.scope },
          body: {}
        })
      );
      removedCount += 1;
    }

    const annotateRowsWithScope = (rows, scope) =>
      (rows || []).map((row) => ({
        ...row,
        scope
      }));

    let [existingEarningRows, existingDeductionRows, existingEmployerRows] = await Promise.all([
      exports.listSalaryComponents({
        ...req,
        query: { scope: "earning", payGroupId }
      }),
      exports.listSalaryComponents({
        ...req,
        query: { scope: "deduction", payGroupId }
      }),
      exports.listSalaryComponents({
        ...req,
        query: { scope: "employer_contribution", payGroupId }
      })
    ]);
    const loadInactiveRows = async (scope, rows) => {
      if (rows?.length) return rows;
      return exports.listSalaryComponents({
        ...req,
        query: { scope, payGroupId, includeInactive: true }
      });
    };
    [existingEarningRows, existingDeductionRows, existingEmployerRows] = await Promise.all([
      loadInactiveRows("earning", existingEarningRows),
      loadInactiveRows("deduction", existingDeductionRows),
      loadInactiveRows("employer_contribution", existingEmployerRows)
    ]);
    const existingComponentMap = new Map(
      [
        ...annotateRowsWithScope(existingEarningRows, "earning"),
        ...annotateRowsWithScope(existingDeductionRows, "deduction"),
        ...annotateRowsWithScope(existingEmployerRows, "employer_contribution")
      ]
        .filter((row) => row?.id && row?.code)
        .map((row) => [
          `${String(row.scope || "").trim()}:${String(row.code || "").trim().toUpperCase()}`,
          row
        ])
    );
    for (const component of components) {
      const componentScope = String(component.scope || "").trim();
      const componentCode = await resolveComponentCode({
        client,
        tenantId,
        scope: component.scope,
        payload: component,
        currentCode: component.code || ""
      });
      const componentKey = `${componentScope}:${componentCode}`;
      const existingComponent = existingComponentMap.get(componentKey) || null;
      const payload = {
        payGroupId,
        scope: component.scope,
        code: componentCode,
        name: component.name,
        displayName: component.displayName || null,
        description: component.description || null,
        calculationMode: component.calculationMode,
        taxable: component.taxable,
        effectiveFrom: component.effectiveFrom,
        effectiveTo: component.effectiveTo || null,
        priority: component.priority,
        pfApplicable: component.pfApplicable,
        esiApplicable: component.esiApplicable,
        prorateWithAttendance: component.prorateWithAttendance,
        isStatutory: component.isStatutory,
        employeeShareOnly: component.employeeShareOnly,
        contributesToCtc: component.contributesToCtc,
        linkedDeductionCode: component.linkedDeductionCode,
        capAmount: component.capAmount,
        roundingPolicy: component.roundingPolicy,
        isActive: component.isActive,
        metadata: stripComponentPayGroupMetadata(component.metadata || {})
      };

      const resolvedComponentId = component.id || existingComponent?.id || null;

      if (resolvedComponentId) {
        await exports.updateSalaryComponent(
          toSetupChildRequest(req, {
            params: { id: resolvedComponentId },
            query: { scope: component.scope, preserveTimeline: "true" },
            body: payload
          })
        );
        updatedCount += 1;
      } else {
        await exports.createSalaryComponent(
          toSetupChildRequest(req, {
            body: payload
          })
        );
        createdCount += 1;
      }
    }

    return {
      payGroup: updatedPayGroup,
      settings: updatedSettings,
      summary: {
        createdCount,
        updatedCount,
        removedCount
      }
    };
  } finally {
    client.release();
  }
};

exports.getPayrollSetupBootstrap = async (req) => {
  const pool = await ensurePool();
  const client = await pool.connect();
  try {
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });
    const [settings, payGroups] = await Promise.all([
      exports.getSettings(req),
      exports.listPayGroups({ ...req, query: { includeInactive: true } })
    ]);

    const resolvedPayGroupId =
      String(req.query?.payGroupId || "").trim() ||
      String(settings?.default_pay_group_id || settings?.defaultPayGroupId || "").trim() ||
      String(payGroups.find((group) => group.is_active)?.id || payGroups[0]?.id || "").trim();

    const componentQuery = (scope) => ({
      scope,
      payGroupId: resolvedPayGroupId,
      currentOnly: true
    });
    const [earningRows, deductionRows, employerRows] = resolvedPayGroupId
      ? await Promise.all([
          exports.listSalaryComponents({ ...req, query: componentQuery("earning") }),
          exports.listSalaryComponents({ ...req, query: componentQuery("deduction") }),
          exports.listSalaryComponents({
            ...req,
            query: componentQuery("employer_contribution")
          })
        ])
      : [[], [], []];
    const exactPayGroupComponents = dedupeLatestComponents([
      ...earningRows.map((item) => ({ ...item, scope: "earning" })),
      ...deductionRows.map((item) => ({ ...item, scope: "deduction" })),
      ...employerRows.map((item) => ({ ...item, scope: "employer_contribution" }))
    ]);
    const components = dedupeLatestComponents(exactPayGroupComponents);
    const selectedPayGroup =
      payGroups.find((group) => String(group.id) === resolvedPayGroupId) || null;
    const selectedPayGroupWithComponents = resolvedPayGroupId
      ? await exports.getPayGroup({
          ...req,
          params: { payGroupId: resolvedPayGroupId },
          query: { includeComponents: "true" }
        })
      : selectedPayGroup;

    if (selectedPayGroupWithComponents?.components?.length) {
      await backfillPayGroupComponentMetadata({
        client,
        tenantId,
        payGroupId: resolvedPayGroupId,
        components: selectedPayGroupWithComponents.components,
        actorId: String(req.user.userId)
      });
    }

    const loadedComponentIds = components
      .map((component) => String(component.id || ""))
      .filter(Boolean);
    const loadedComponentScopeMap = components.reduce((acc, component) => {
      if (component.id) acc[String(component.id)] = component.scope;
      return acc;
    }, {});

    return {
      settings,
      payGroups,
      selectedPayGroupId: resolvedPayGroupId,
      selectedPayGroup: selectedPayGroupWithComponents || selectedPayGroup,
      components,
      hasExplicitComponents: exactPayGroupComponents.length > 0,
      loadedComponentIds,
      loadedComponentScopeMap
    };
  } finally {
    client.release();
  }
};

exports.createSalaryComponent = async (req) => {
  const pool = await ensurePool();
  const client = await pool.connect();
  try {
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });
    const actorId = String(req.user.userId);
    const payload = req.body;
    const tableName = tableByScope[payload.scope];
    if (!tableName) throw { code: 400, message: "Invalid component scope" };
    const payGroupId = String(payload.payGroupId || payload.pay_group_id || "").trim() || null;
    const resolvedCode = await resolveComponentCode({
      client,
      tenantId,
      scope: payload.scope,
      payload
    });

    try {
      const normalizedEffectiveFrom = toDateKey(payload.effectiveFrom);
      const normalizedEffectiveTo = payload.effectiveTo ? toDateKey(payload.effectiveTo) : null;
      let result;
      if (payload.scope === "earning") {
        result = await client.query(
          `
            INSERT INTO earning_components (
              tenant_id, pay_group_id, code, name, display_name, description, calculation_mode, taxable,
              priority, pf_applicable, esi_applicable, prorate_with_attendance, rounding_policy,
              effective_from, effective_to, version_no, is_active, metadata, created_by, updated_by
            )
            VALUES (
              $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,1,true,$16::jsonb,$17,$17
            )
            RETURNING *
          `,
          [
            tenantId,
            payGroupId,
            resolvedCode,
            payload.name,
            payload.displayName || null,
            payload.description || null,
            payload.calculationMode,
            payload.taxable ?? true,
            payload.priority ?? 100,
            payload.pfApplicable ?? false,
            payload.esiApplicable ?? false,
            payload.prorateWithAttendance ?? true,
            payload.roundingPolicy || "nearest_rupee",
            normalizedEffectiveFrom,
            normalizedEffectiveTo,
            JSON.stringify(stripComponentPayGroupMetadata(payload.metadata || {})),
            actorId
          ]
        );
      } else if (payload.scope === "deduction") {
        result = await client.query(
          `
            INSERT INTO deduction_components (
              tenant_id, pay_group_id, code, name, display_name, description, calculation_mode, taxable,
              priority, is_statutory, employee_share_only, cap_amount, rounding_policy,
              effective_from, effective_to, version_no, is_active, metadata, created_by, updated_by
            )
            VALUES (
              $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,1,true,$16::jsonb,$17,$17
            )
            RETURNING *
          `,
          [
            tenantId,
            payGroupId,
            resolvedCode,
            payload.name,
            payload.displayName || null,
            payload.description || null,
            payload.calculationMode,
            payload.taxable ?? false,
            payload.priority ?? 100,
            payload.isStatutory ?? false,
            payload.employeeShareOnly ?? true,
            payload.capAmount ?? null,
            payload.roundingPolicy || "nearest_rupee",
            normalizedEffectiveFrom,
            normalizedEffectiveTo,
            JSON.stringify(stripComponentPayGroupMetadata(payload.metadata || {})),
            actorId
          ]
        );
      } else {
        result = await client.query(
          `
            INSERT INTO employer_contribution_components (
              tenant_id, pay_group_id, code, name, display_name, description, calculation_mode, priority,
              contributes_to_ctc, linked_deduction_code, rounding_policy,
              effective_from, effective_to, version_no, is_active, metadata, created_by, updated_by
            )
            VALUES (
              $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,1,true,$14::jsonb,$15,$15
            )
            RETURNING *
          `,
          [
            tenantId,
            payGroupId,
            resolvedCode,
            payload.name,
            payload.displayName || null,
            payload.description || null,
            payload.calculationMode,
            payload.priority ?? 100,
            payload.contributesToCtc ?? true,
            payload.linkedDeductionCode || null,
            payload.roundingPolicy || "nearest_rupee",
            normalizedEffectiveFrom,
            normalizedEffectiveTo,
            JSON.stringify(stripComponentPayGroupMetadata(payload.metadata || {})),
            actorId
          ]
        );
      }
      return result.rows[0];
    } catch (error) {
      const isExpectedDuplicate =
        error?.code === "23505" && error?.constraint === starterConstraintByScope[payload.scope];
      if (!isExpectedDuplicate || !isWizardComponentCreate(payload)) {
        throw error;
      }

      const existing = await fetchExistingSalaryComponentByCode({
        client,
        tenantId,
        scope: payload.scope,
        code: payload.code
      });
      if (!existing) {
        throw error;
      }

      const updated = await updateSalaryComponentRecord({
        client,
        tenantId,
        scope: payload.scope,
        componentId: existing.id,
        payload,
        actorId,
        forceActive: true
      });
      return updated.rows[0] || existing;
    }
  } finally {
    client.release();
  }
};

exports.listSalaryComponents = async (req) => {
  const pool = await ensurePool();
  const client = await pool.connect();
  try {
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });
    const { scope, includeInactive, currentOnly, code, payGroupId } = req.query;
    const scopes = scope
      ? [scope]
      : ["earning", "deduction", "employer_contribution"];

    const fetchRowsForScope = async (componentScope) => {
      const tableName = tableByScope[componentScope];
      if (!tableName) throw { code: 400, message: "Invalid component scope" };

      const params = [tenantId];
      const filters = ["tenant_id = $1"];

      if (!includeInactive) {
        filters.push("is_active = true");
      }
      if (currentOnly === true || currentOnly === "true") {
        filters.push("effective_to IS NULL");
      }
      if (code) {
        params.push(code);
        filters.push(`code = $${params.length}`);
      }

      const result = await client.query(
        `
          SELECT *
          FROM ${tableName}
          WHERE ${filters.join(" AND ")}
          ORDER BY code ASC, effective_from DESC, version_no DESC, created_at DESC
        `,
        params
      );
      const filteredRows = result.rows.filter((row) =>
        isComponentApplicableToPayGroup(row, payGroupId)
      );
      const latestByCode = new Map();
      for (const row of filteredRows) {
        const codeKey = String(row.code || "").trim().toUpperCase();
        if (!codeKey || latestByCode.has(codeKey)) continue;
        latestByCode.set(codeKey, row);
      }
      return Array.from(latestByCode.values()).map((row) => ({
        ...row,
        scope: componentScope
      }));
    };

    const rowsByScope = await Promise.all(scopes.map(fetchRowsForScope));
    return rowsByScope.flat();
  } finally {
    client.release();
  }
};

exports.getSalaryComponentById = async (req) => {
  const pool = await ensurePool();
  const client = await pool.connect();
  try {
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });
    const { scope } = req.query;
    const tableName = tableByScope[scope];
    if (!tableName) throw { code: 400, message: "scope query is required" };

    const result = await client.query(
      `SELECT * FROM ${tableName} WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, tenantId]
    );
    if (!result.rows[0]) throw { code: 404, message: "Salary component not found" };
    return result.rows[0];
  } finally {
    client.release();
  }
};

exports.updateSalaryComponent = async (req) => {
  const pool = await ensurePool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });
    const actorId = String(req.user.userId);
    const { scope } = req.query;
    const tableName = tableByScope[scope];
    if (!tableName) throw { code: 400, message: "scope query is required" };

    const payload = req.body;
    const preserveTimeline = String(req.query?.preserveTimeline || "").trim().toLowerCase() === "true";
    const currentRes = await client.query(
      `SELECT * FROM ${tableName} WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [req.params.id, tenantId]
    );
    const currentRow = currentRes.rows[0] || null;
    if (!currentRow) throw { code: 404, message: "Salary component not found" };
    const payGroupId = String(
      payload.payGroupId || payload.pay_group_id || currentRow.pay_group_id || ""
    ).trim() || null;
    const mergedMetadata = {
      ...toJson(currentRow.metadata, {}),
      ...(payload.metadata || {})
    };
    const sanitizedMetadata = stripComponentPayGroupMetadata(mergedMetadata);

    if (preserveTimeline) {
      const updatedCurrent = await updateSalaryComponentRecord({
        client,
        tenantId,
        scope,
        componentId: currentRow.id,
        payload: {
          ...payload,
          payGroupId,
          effectiveTo: null,
          metadata: sanitizedMetadata
        },
        actorId,
        forceActive: payload.isActive ?? false
      });
      await client.query("COMMIT");
      return {
        ...updatedCurrent.rows[0],
        saveAction: "updated_current"
      };
    }

    const targetEffectiveFromKey = toDateKey(payload.effectiveFrom || currentRow.effective_from);
    if (!targetEffectiveFromKey) {
      throw { code: 400, message: "Invalid effectiveFrom date" };
    }
    const currentEffectiveFromKey = toDateKey(currentRow.effective_from);
    const targetIsLater = targetEffectiveFromKey > currentEffectiveFromKey;
    const targetIsEarlier = targetEffectiveFromKey < currentEffectiveFromKey;

    const sameDateRowRes = await client.query(
      `
        SELECT *
        FROM ${tableName}
        WHERE tenant_id = $1
          AND code = $2
          AND effective_from = $3::date
        ORDER BY version_no DESC, created_at DESC
        LIMIT 1
      `,
      [tenantId, payload.code || currentRow.code, targetEffectiveFromKey]
    );
    const sameDateRow = sameDateRowRes.rows[0] || null;
    if (sameDateRow && sameDateRow.id !== currentRow.id) {
      if (targetIsLater) {
        await closeSalaryComponentRevision({
          client,
          tenantId,
          scope,
          componentId: currentRow.id,
          effectiveTo: shiftDateKey(targetEffectiveFromKey, -1),
          actorId
        });
      }

      if (targetIsEarlier) {
        payload.effectiveTo = payload.effectiveTo || shiftDateKey(currentEffectiveFromKey, -1);
      }

      const updatedSameDateRow = await updateSalaryComponentRecord({
        client,
        tenantId,
        scope,
        componentId: sameDateRow.id,
        payload: {
          ...payload,
          payGroupId,
          metadata: sanitizedMetadata
        },
        actorId,
        forceActive: payload.isActive ?? false
      });
      await client.query("COMMIT");
      return {
        ...updatedSameDateRow.rows[0],
        saveAction: "updated_existing_revision"
      };
    }

    if (targetEffectiveFromKey === currentEffectiveFromKey) {
      const updatedCurrent = await updateSalaryComponentRecord({
        client,
        tenantId,
        scope,
        componentId: currentRow.id,
        payload: {
          ...payload,
          payGroupId,
          metadata: sanitizedMetadata
        },
        actorId,
        forceActive: payload.isActive ?? false
      });
      await client.query("COMMIT");
      return {
        ...updatedCurrent.rows[0],
        saveAction: "updated_current"
      };
    }

    const nextVersionRes = await client.query(
      `
        SELECT COALESCE(MAX(version_no), 0) + 1 AS next_version
        FROM ${tableName}
        WHERE tenant_id = $1
          AND code = $2
      `,
      [tenantId, currentRow.code]
    );
    const nextVersion = Number(nextVersionRes.rows[0]?.next_version || 1);

    if (targetIsLater) {
      await closeSalaryComponentRevision({
        client,
        tenantId,
        scope,
        componentId: currentRow.id,
        effectiveTo: shiftDateKey(targetEffectiveFromKey, -1),
        actorId
      });
    }

    if (targetIsEarlier) {
      payload.effectiveTo = payload.effectiveTo || shiftDateKey(currentEffectiveFromKey, -1);
    }

    const inserted = await insertSalaryComponentRevision({
      client,
      tenantId,
      scope,
      payload: {
        ...payload,
        code: payload.code || currentRow.code,
        payGroupId,
        metadata: sanitizedMetadata,
        effectiveFrom: targetEffectiveFromKey
      },
      actorId,
      versionNo: nextVersion
    });
    await client.query("COMMIT");
    return {
      ...inserted.rows[0],
      saveAction: "created_revision"
    };
  } catch (error) {
    await safeRollback(client);
    throw error;
  } finally {
    client.release();
  }
};

exports.deleteSalaryComponent = async (req) => {
  const pool = await ensurePool();
  const client = await pool.connect();
  try {
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });
    const actorId = String(req.user.userId);
    const { scope } = req.query;
    const tableName = tableByScope[scope];
    if (!tableName) throw { code: 400, message: "scope query is required" };

    const result = await client.query(
      `
        UPDATE ${tableName}
        SET is_active = false, effective_to = COALESCE(effective_to, NOW()::date), updated_by = $3
        WHERE id = $1 AND tenant_id = $2
        RETURNING id, code, is_active, effective_to
      `,
      [req.params.id, tenantId, actorId]
    );
    if (!result.rows[0]) throw { code: 404, message: "Salary component not found" };
    return result.rows[0];
  } finally {
    client.release();
  }
};

exports.createEmployeeProfile = async (req) => {
  const pool = await ensurePool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });
    const actorId = String(req.user.userId);
    const p = req.body;

    const profileResult = await client.query(
      `
        INSERT INTO employee_payroll_profiles (
          tenant_id,
          employee_external_id,
          employee_code,
          pay_group_id,
          payroll_status,
          default_payment_mode,
          tax_regime,
          date_of_joining,
          date_of_exit,
          cost_center_code,
          location_code,
          metadata,
          created_by,
          updated_by
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$13)
        ON CONFLICT (tenant_id, employee_external_id)
        DO UPDATE SET
          employee_code = COALESCE(EXCLUDED.employee_code, employee_payroll_profiles.employee_code),
          pay_group_id = COALESCE(EXCLUDED.pay_group_id, employee_payroll_profiles.pay_group_id),
          payroll_status = COALESCE(EXCLUDED.payroll_status, employee_payroll_profiles.payroll_status),
          default_payment_mode = COALESCE(EXCLUDED.default_payment_mode, employee_payroll_profiles.default_payment_mode),
          tax_regime = COALESCE(EXCLUDED.tax_regime, employee_payroll_profiles.tax_regime),
          date_of_joining = COALESCE(EXCLUDED.date_of_joining, employee_payroll_profiles.date_of_joining),
          date_of_exit = COALESCE(EXCLUDED.date_of_exit, employee_payroll_profiles.date_of_exit),
          cost_center_code = COALESCE(EXCLUDED.cost_center_code, employee_payroll_profiles.cost_center_code),
          location_code = COALESCE(EXCLUDED.location_code, employee_payroll_profiles.location_code),
          metadata = employee_payroll_profiles.metadata || EXCLUDED.metadata,
          updated_by = EXCLUDED.updated_by
        RETURNING *
      `,
      [
        tenantId,
        p.employeeExternalId,
        p.employeeCode || null,
        p.payGroupId || null,
        p.payrollStatus || "active",
        p.defaultPaymentMode || "bank_transfer",
        p.taxRegime || "new",
        p.dateOfJoining || null,
        p.dateOfExit || null,
        p.costCenterCode || null,
        p.locationCode || null,
        JSON.stringify(p.metadata || {}),
        actorId
      ]
    );

    await client.query("COMMIT");
    return profileResult.rows[0];
  } catch (error) {
    await safeRollback(client);
    throw error;
  } finally {
    client.release();
  }
};

exports.listEmployeeProfiles = async (req) => {
  const pool = await ensurePool();
  const client = await pool.connect();
  try {
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });
    const { payrollStatus, employeeExternalId, payGroupId, includeLatest, limit, offset } = req.query;
    const params = [tenantId];
    const filters = ["tenant_id = $1"];

    if (payrollStatus) {
      params.push(payrollStatus);
      filters.push(`payroll_status = $${params.length}`);
    }
    if (employeeExternalId) {
      params.push(employeeExternalId);
      filters.push(`employee_external_id = $${params.length}`);
    }
    if (payGroupId) {
      params.push(payGroupId);
      filters.push(`pay_group_id = $${params.length}`);
    }
    params.push(limit, offset);

    const baseFilters = filters
      .map((filter) => filter.replace(/\btenant_id\b/g, "epp.tenant_id"))
      .join(" AND ");

    const queryText =
      includeLatest === true || includeLatest === "true"
        ? `
            SELECT
              epp.*,
              latest_salary.id AS latest_salary_structure_id,
              latest_salary.annual_ctc,
              latest_salary.monthly_gross,
              latest_salary.basic_pay,
              COALESCE(
                (latest_salary.metadata->'salaryRules'->>'variablePayTargetMonthly')::numeric,
                latest_salary.variable_pay,
                0
              ) AS variable_pay_target,
              CASE
                WHEN COALESCE((latest_salary.metadata->'salaryRules'->>'variablePayApprovalStatus'), 'pending') IN ('approved', 'partial')
                  THEN COALESCE((latest_salary.metadata->'salaryRules'->>'variablePayApprovedAmount')::numeric, latest_salary.variable_pay, 0)
                ELSE 0
              END AS variable_pay,
              COALESCE((latest_salary.metadata->'salaryRules'->>'variablePayApprovedAmount')::numeric, latest_salary.variable_pay, 0) AS variable_pay_approved_amount,
              COALESCE((latest_salary.metadata->'salaryRules'->>'variablePayApprovalStatus'), 'pending') AS variable_pay_approval_status,
              latest_salary.effective_from AS latest_salary_effective_from,
              latest_salary.metadata AS latest_salary_metadata,
              latest_bank.account_holder_name,
              latest_bank.bank_name,
              latest_bank.branch_name,
              latest_bank.account_number,
              latest_bank.ifsc_code,
              latest_bank.account_type,
              latest_bank.payment_mode,
              latest_bank.upi_id
            FROM employee_payroll_profiles epp
            LEFT JOIN LATERAL (
              SELECT
                id,
                annual_ctc,
                monthly_gross,
                basic_pay,
                variable_pay,
                effective_from,
                metadata
              FROM employee_salary_structures
              WHERE employee_payroll_profile_id = epp.id
              ORDER BY is_current DESC, version_no DESC, effective_from DESC
              LIMIT 1
            ) latest_salary ON true
            LEFT JOIN LATERAL (
              SELECT
                account_holder_name,
                bank_name,
                branch_name,
                account_number,
                ifsc_code,
                account_type,
                payment_mode,
                upi_id
              FROM employee_bank_details
              WHERE employee_payroll_profile_id = epp.id
              ORDER BY is_primary DESC, version_no DESC, effective_from DESC
              LIMIT 1
            ) latest_bank ON true
            WHERE ${baseFilters}
            ORDER BY epp.created_at DESC
            LIMIT $${params.length - 1}
            OFFSET $${params.length}
          `
        : `
            SELECT *
            FROM employee_payroll_profiles
            WHERE ${filters.join(" AND ")}
            ORDER BY created_at DESC
            LIMIT $${params.length - 1}
            OFFSET $${params.length}
          `;

    const result = await client.query(queryText, params);
    const rows = result.rows;
    if (!rows.length) return rows;

    const employeeIds = rows
      .map((row) => String(row.employee_external_id || "").trim())
      .filter(Boolean);

    const employees = await Employee.find({ _id: { $in: employeeIds } })
      .select("_id firstName lastName employeeCode profileImage confirmedDate")
      .lean();

    const employeeMap = new Map(
      employees.map((employee) => [
        String(employee._id),
        (() => {
          const fullName = `${employee.firstName || ""} ${employee.lastName || ""}`.trim();
          const employeeCode = employee.employeeCode || null;
          return {
            employee_name: fullName || employeeCode || "Employee",
            employee_display_name: fullName || employeeCode || "Employee",
            employee_code: employeeCode,
            employee_profile_image: employee.profileImage || null,
            confirmed_date: employee.confirmedDate || null
          };
        })()
      ])
    );

    return rows.map((row) => ({
      ...row,
      ...(employeeMap.get(String(row.employee_external_id)) || {})
    }));
  } finally {
    client.release();
  }
};

exports.getEmployeeProfile = async (req) => {
  const pool = await ensurePool();
  const client = await pool.connect();
  try {
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });
    const profileId = req.params.profileId;

    const profileResult = await client.query(
      `
        SELECT *
        FROM employee_payroll_profiles
        WHERE id = $1 AND tenant_id = $2
      `,
      [profileId, tenantId]
    );
    const profile = profileResult.rows[0];
    if (!profile) throw { code: 404, message: "Employee payroll profile not found" };

    const [bankResult, statutoryResult, salaryResult] = await Promise.all([
      client.query(
        `
          SELECT *
          FROM employee_bank_details
          WHERE employee_payroll_profile_id = $1
          ORDER BY version_no DESC, effective_from DESC
        `,
        [profileId]
      ),
      client.query(
        `
          SELECT *
          FROM employee_statutory_details
          WHERE employee_payroll_profile_id = $1
          ORDER BY version_no DESC, effective_from DESC
        `,
        [profileId]
      ),
      client.query(
        `
          SELECT *
          FROM employee_salary_structures
          WHERE employee_payroll_profile_id = $1
          ORDER BY version_no DESC, effective_from DESC
        `,
        [profileId]
      )
    ]);

    return {
      ...profile,
      bankDetails: bankResult.rows,
      statutoryDetails: statutoryResult.rows,
      salaryStructures: salaryResult.rows
    };
  } finally {
    client.release();
  }
};

exports.updateEmployeeProfile = async (req) => {
  const pool = await ensurePool();
  const client = await pool.connect();
  try {
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });
    const actorId = String(req.user.userId);
    const p = req.body;

    const result = await client.query(
      `
        UPDATE employee_payroll_profiles
        SET
          employee_code = COALESCE($3, employee_code),
          pay_group_id = COALESCE($4, pay_group_id),
          payroll_status = COALESCE($5, payroll_status),
          default_payment_mode = COALESCE($6, default_payment_mode),
          tax_regime = COALESCE($7, tax_regime),
          date_of_joining = COALESCE($8, date_of_joining),
          date_of_exit = COALESCE($9, date_of_exit),
          cost_center_code = COALESCE($10, cost_center_code),
          location_code = COALESCE($11, location_code),
          metadata = CASE
            WHEN $12::jsonb = '{}'::jsonb THEN metadata
            ELSE metadata || $12::jsonb
          END,
          updated_by = $13
        WHERE id = $1 AND tenant_id = $2
        RETURNING *
      `,
      [
        req.params.profileId,
        tenantId,
        p.employeeCode ?? null,
        p.payGroupId ?? null,
        p.payrollStatus ?? null,
        p.defaultPaymentMode ?? null,
        p.taxRegime ?? null,
        p.dateOfJoining ?? null,
        p.dateOfExit ?? null,
        p.costCenterCode ?? null,
        p.locationCode ?? null,
        JSON.stringify(p.metadata || {}),
        actorId
      ]
    );
    if (!result.rows[0]) throw { code: 404, message: "Employee payroll profile not found" };
    return result.rows[0];
  } finally {
    client.release();
  }
};

exports.deleteEmployeeProfile = async (req) => {
  const pool = await ensurePool();
  const client = await pool.connect();
  try {
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });
    const result = await client.query(
      `
        DELETE FROM employee_payroll_profiles
        WHERE id = $1 AND tenant_id = $2
        RETURNING id, employee_external_id
      `,
      [req.params.profileId, tenantId]
    );
    if (!result.rows[0]) throw { code: 404, message: "Employee payroll profile not found" };
    return result.rows[0];
  } finally {
    client.release();
  }
};

exports.upsertBankDetail = async (req) => {
  const pool = await ensurePool();
  const client = await pool.connect();
  try {
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });
    const actorId = String(req.user.userId);
    const profileId = req.params.profileId;
    const p = req.body;

    await client.query("BEGIN");

    const currentRes = await client.query(
      `
        SELECT *
        FROM employee_bank_details
        WHERE id = (
          SELECT id
          FROM employee_bank_details
          WHERE employee_payroll_profile_id = $1
          ORDER BY version_no DESC, effective_from DESC, created_at DESC
          LIMIT 1
        )
        FOR UPDATE
      `,
      [profileId]
    );
    const currentRow = currentRes.rows[0] || null;
    const targetEffectiveFrom = new Date(p.effectiveFrom);
    if (Number.isNaN(targetEffectiveFrom.getTime())) {
      throw { code: 400, message: "Invalid effectiveFrom date" };
    }

    if (currentRow && toDateKey(currentRow.effective_from) === toDateKey(p.effectiveFrom)) {
      const updatedRes = await client.query(
        `
          UPDATE employee_bank_details
          SET
            account_holder_name = $3,
            bank_name = $4,
            branch_name = $5,
            account_number = $6,
            ifsc_code = $7,
            account_type = $8,
            payment_mode = $9,
            upi_id = $10,
            is_primary = $11,
            is_verified = $12,
            effective_to = $13,
            metadata = $14::jsonb,
            updated_by = $15,
            updated_at = NOW()
          WHERE id = $1
            AND tenant_id = $2
          RETURNING *
        `,
        [
          currentRow.id,
          tenantId,
          p.accountHolderName || null,
          p.bankName || null,
          p.branchName || null,
          p.accountNumber || null,
          p.ifscCode || null,
          p.accountType || "savings",
          p.paymentMode || "bank_transfer",
          p.upiId || null,
          p.isPrimary ?? true,
          p.isVerified ?? false,
          p.effectiveTo || null,
          JSON.stringify(p.metadata || {}),
          actorId
        ]
      );
      await client.query("COMMIT");
      return {
        ...updatedRes.rows[0],
        saveAction: "updated_current"
      };
    }

    const nextVersion = Number(currentRow?.version_no || 0) + 1 || 1;
    if (currentRow?.effective_to == null && currentRow?.is_primary) {
      const closedEffectiveTo = new Date(targetEffectiveFrom);
      closedEffectiveTo.setDate(closedEffectiveTo.getDate() - 1);
      await client.query(
        `
          UPDATE employee_bank_details
          SET
            effective_to = $2,
            is_primary = FALSE,
            updated_by = $3,
            updated_at = NOW()
          WHERE id = $1
            AND tenant_id = $4
        `,
        [currentRow.id, closedEffectiveTo.toISOString().slice(0, 10), actorId, tenantId]
      );
    }

    const result = await client.query(
      `
        INSERT INTO employee_bank_details (
          tenant_id,
          employee_payroll_profile_id,
          account_holder_name,
          bank_name,
          branch_name,
          account_number,
          ifsc_code,
          account_type,
          payment_mode,
          upi_id,
          is_primary,
          is_verified,
          effective_from,
          effective_to,
          version_no,
          metadata,
          created_by,
          updated_by
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$17)
        RETURNING *
      `,
        [
          tenantId,
          profileId,
        p.accountHolderName || null,
        p.bankName || null,
        p.branchName || null,
        p.accountNumber || null,
        p.ifscCode || null,
        p.accountType || "savings",
        p.paymentMode || "bank_transfer",
        p.upiId || null,
        p.isPrimary ?? true,
        p.isVerified ?? false,
        p.effectiveFrom,
          p.effectiveTo || null,
          nextVersion,
          JSON.stringify(p.metadata || {}),
          actorId
        ]
      );
    await client.query("COMMIT");
    return {
      ...result.rows[0],
      saveAction: "created_revision"
    };
  } catch (error) {
    await safeRollback(client);
    throw error;
  } finally {
    client.release();
  }
};

exports.lookupBankByAccount = async (req) => {
  const pool = await ensurePool();
  const client = await pool.connect();
  try {
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });
    const accountNumber = String(req.query.accountNumber || "").trim();

    const result = await client.query(
      `
        SELECT
          account_holder_name,
          bank_name,
          branch_name,
          ifsc_code,
          account_type,
          payment_mode,
          upi_id,
          is_verified,
          effective_from
        FROM employee_bank_details
        WHERE tenant_id = $1
          AND account_number = $2
        ORDER BY effective_from DESC, version_no DESC
        LIMIT 1
      `,
      [tenantId, accountNumber]
    );

    return result.rows[0] || null;
  } finally {
    client.release();
  }
};

exports.lookupBankByIfsc = async (req) => {
  const ifscCode = String(req.params.ifscCode || "").trim().toUpperCase();
  const baseUrl = (process.env.IFSC_LOOKUP_BASE_URL || "https://ifsc.razorpay.com").replace(
    /\/+$/,
    ""
  );
  const url = `${baseUrl}/${encodeURIComponent(ifscCode)}`;

  let response;
  try {
    response = await fetch(url);
  } catch (_) {
    throw { code: 502, message: "Unable to reach IFSC lookup service" };
  }

  if (!response.ok) {
    throw { code: 404, message: "IFSC code not found in lookup service" };
  }

  const payload = await response.json();
  return {
    ifscCode,
    bankName: payload?.BANK || payload?.bank || null,
    branchName: payload?.BRANCH || payload?.branch || null,
    address: payload?.ADDRESS || payload?.address || null,
    city: payload?.CITY || payload?.city || null,
    state: payload?.STATE || payload?.state || null
  };
};

exports.upsertStatutoryDetail = async (req) => {
  const pool = await ensurePool();
  const client = await pool.connect();
  try {
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });
    const actorId = String(req.user.userId);
    const profileId = req.params.profileId;
    const p = req.body;

    const versionRes = await client.query(
      `
        SELECT COALESCE(MAX(version_no), 0) + 1 AS next_version
        FROM employee_statutory_details
        WHERE employee_payroll_profile_id = $1
      `,
      [profileId]
    );
    const nextVersion = Number(versionRes.rows[0]?.next_version || 1);

    const result = await client.query(
      `
        INSERT INTO employee_statutory_details (
          tenant_id,
          employee_payroll_profile_id,
          pan,
          aadhaar,
          uan,
          esic_number,
          pf_member,
          eps_eligible,
          esi_eligible,
          professional_tax_applicable,
          lwf_applicable,
          tax_regime,
          declaration_submitted,
          effective_from,
          effective_to,
          version_no,
          metadata,
          created_by,
          updated_by
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$18)
        RETURNING *
      `,
      [
        tenantId,
        profileId,
        p.pan || null,
        p.aadhaar || null,
        p.uan || null,
        p.esicNumber || null,
        p.pfMember ?? true,
        p.epsEligible ?? true,
        p.esiEligible ?? false,
        p.professionalTaxApplicable ?? true,
        p.lwfApplicable ?? false,
        p.taxRegime || "new",
        p.declarationSubmitted ?? false,
        p.effectiveFrom,
        p.effectiveTo || null,
        nextVersion,
        JSON.stringify(p.metadata || {}),
        actorId
      ]
    );
    return result.rows[0];
  } finally {
    client.release();
  }
};

const validateVariablePayApprovalPayload = (salaryRules, fallbackTargetAmount) => {
  if (!salaryRules || typeof salaryRules !== "object") {
    return;
  }
  if (!salaryRules.variablePayEnabled) {
    return;
  }
  const approvalStatus = String(salaryRules.variablePayApprovalStatus || "pending").toLowerCase();
  if (!["partial", "approved"].includes(approvalStatus)) {
    return;
  }
  const targetAmount = Number(
    salaryRules.variablePayTargetMonthly ?? fallbackTargetAmount ?? 0
  );
  const approvedAmount = Number(salaryRules.variablePayApprovedAmount ?? 0);
  if (!Number.isFinite(approvedAmount) || approvedAmount < 0) {
    throw { code: 400, message: "Approved variable pay amount must be a valid number" };
  }
  if (approvedAmount - targetAmount > 0.01) {
    throw {
      code: 400,
      message: "Approved variable pay cannot exceed the monthly variable pay target"
    };
  }
};

const stampVariablePayApprovalMonth = (metadata = {}, existingMetadata = {}) => {
  const nextMetadata = { ...(metadata || {}) };
  const salaryRules = { ...(nextMetadata.salaryRules || {}) };
  const existingRules = existingMetadata?.salaryRules || {};
  const status = String(salaryRules.variablePayApprovalStatus || "pending").toLowerCase();
  if (["approved", "partial"].includes(status)) {
    salaryRules.variablePayApprovalMonth =
      String(salaryRules.variablePayApprovalMonth || "").slice(0, 7) ||
      String(existingRules.variablePayApprovalMonth || "").slice(0, 7) ||
      new Date().toISOString().slice(0, 7);
  } else {
    salaryRules.variablePayApprovalMonth = null;
  }
  nextMetadata.salaryRules = salaryRules;
  return nextMetadata;
};

exports.createSalaryStructure = async (req) => {
  const pool = await ensurePool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });
    const actorId = String(req.user.userId);
    const profileId = req.params.profileId;
    const p = req.body;
    p.metadata = stampVariablePayApprovalMonth(p.metadata);
    const effectiveFrom = p.effectiveFrom;
    validateVariablePayApprovalPayload(p.metadata?.salaryRules || {}, p.variablePay);

    const existingEffectiveStart = await client.query(
      `
        SELECT id
        FROM employee_salary_structures
        WHERE tenant_id = $1
          AND employee_payroll_profile_id = $2
          AND effective_from = $3::date
        LIMIT 1
      `,
      [tenantId, profileId, effectiveFrom]
    );
    if (existingEffectiveStart.rows[0]) {
      throw {
        code: 409,
        message:
          "A salary revision already exists for this effective date. Choose a later effective date to keep salary history."
      };
    }

    const versionRes = await client.query(
      `
        SELECT COALESCE(MAX(version_no), 0) + 1 AS next_version
        FROM employee_salary_structures
        WHERE tenant_id = $1
          AND employee_payroll_profile_id = $2
      `,
      [tenantId, profileId]
    );
    const nextVersion = Number(versionRes.rows[0]?.next_version || 1);

    if (p.isCurrent) {
      await client.query(
        `
          UPDATE employee_salary_structures
          SET
            is_current = false,
            effective_to = ($2::date - INTERVAL '1 day')::date,
            updated_by = $3
          WHERE employee_payroll_profile_id = $1 AND is_current = true
            AND tenant_id = $4
            AND effective_from <> $2::date
            AND effective_from < $2::date
        `,
        [profileId, effectiveFrom, actorId, tenantId]
      );
    }

    const result = await client.query(
      `
        INSERT INTO employee_salary_structures (
          tenant_id,
          employee_payroll_profile_id,
          structure_code,
          structure_name,
          annual_ctc,
          monthly_gross,
          basic_pay,
          variable_pay,
          is_current,
          revision_reason,
          approved_by,
          approved_at,
          effective_from,
          effective_to,
          version_no,
          metadata,
          created_by,
          updated_by
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),$12,$13,$14,$15::jsonb,$16,$16)
        RETURNING *
      `,
      [
        tenantId,
        profileId,
        p.structureCode,
        p.structureName,
        p.annualCtc,
        p.monthlyGross ?? null,
        p.basicPay ?? null,
        p.variablePay ?? 0,
        p.isCurrent ?? true,
        p.revisionReason || null,
        actorId,
        effectiveFrom,
        p.effectiveTo || null,
        nextVersion,
        JSON.stringify(p.metadata || {}),
        actorId
      ]
    );
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await safeRollback(client);
    throw error;
  } finally {
    client.release();
  }
};

exports.updateSalaryStructure = async (req) => {
  const pool = await ensurePool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });
    const actorId = String(req.user.userId);
    const p = req.body;
    validateVariablePayApprovalPayload(p.metadata?.salaryRules || {}, p.variablePay);
    const targetRes = await client.query(
      `
        SELECT employee_payroll_profile_id, effective_from, effective_to, metadata
             , is_current
        FROM employee_salary_structures
        WHERE id = $1 AND tenant_id = $2
      `,
      [req.params.salaryStructureId, tenantId]
    );
    const targetSalary = targetRes.rows[0];
    if (!targetSalary) throw { code: 404, message: "Salary structure not found" };
    p.metadata = stampVariablePayApprovalMonth(
      p.metadata,
      targetSalary.metadata || {}
    );
    const {
      employee_payroll_profile_id: profileId,
      effective_from: targetEffectiveFrom
    } = targetSalary;
    const targetEffectiveFromKey = toDateKey(targetEffectiveFrom);
    if (!isRevisionEditableByDate(targetSalary.effective_to)) {
      throw {
        code: 409,
        message:
          "This salary revision is view-only after its effective period ends. Create a new revision for future changes."
      };
    }
    const nextRevisionRes = await client.query(
      `
        SELECT effective_from
        FROM employee_salary_structures
        WHERE tenant_id = $1
          AND employee_payroll_profile_id = $2
          AND id <> $3
          AND effective_from > $4::date
        ORDER BY effective_from ASC, version_no ASC, created_at ASC
        LIMIT 1
      `,
      [tenantId, profileId, req.params.salaryStructureId, targetEffectiveFromKey]
    );
    const nextRevisionStartKey = nextRevisionRes.rows[0]?.effective_from
      ? toDateKey(nextRevisionRes.rows[0].effective_from)
      : "";
    if (p.isCurrent) {
      if (nextRevisionStartKey && targetEffectiveFromKey && targetEffectiveFromKey >= nextRevisionStartKey) {
        throw {
          code: 409,
          message:
            "This revision cannot be extended past the next scheduled revision. Move the later revision or create a new timeline."
        };
      }
      await client.query(
        `
          UPDATE employee_salary_structures
          SET
            is_current = false,
            effective_to = LEAST(
              COALESCE(effective_to, ($3::date - INTERVAL '1 day')::date),
              ($3::date - INTERVAL '1 day')::date
            ),
            updated_by = $2
          WHERE employee_payroll_profile_id = $1
            AND tenant_id = $4
            AND id <> $5
            AND is_current = true
            AND effective_from < $3::date
        `,
        [profileId, actorId, targetEffectiveFrom, tenantId, req.params.salaryStructureId]
      );
      const targetEffectiveTo = nextRevisionStartKey
        ? new Date(`${nextRevisionStartKey}T00:00:00`)
        : null;
      if (targetEffectiveTo) {
        targetEffectiveTo.setDate(targetEffectiveTo.getDate() - 1);
      }
      await client.query(
        `
          UPDATE employee_salary_structures
          SET
            effective_to = $3,
            is_current = true
          WHERE id = $1 AND tenant_id = $2
        `,
        [
          req.params.salaryStructureId,
          tenantId,
          targetEffectiveTo ? targetEffectiveTo.toISOString().slice(0, 10) : null
        ]
      );
    }

    const result = await client.query(
      `
        UPDATE employee_salary_structures
        SET
          structure_name = COALESCE($2, structure_name),
          annual_ctc = COALESCE($3, annual_ctc),
          monthly_gross = COALESCE($4, monthly_gross),
          basic_pay = COALESCE($5, basic_pay),
          variable_pay = COALESCE($6, variable_pay),
          is_current = COALESCE($7, is_current),
          revision_reason = COALESCE($8, revision_reason),
          effective_from = COALESCE($9, effective_from),
          metadata = CASE
            WHEN $10::jsonb = '{}'::jsonb THEN metadata
            ELSE metadata || $10::jsonb
          END,
          updated_by = $11
        WHERE id = $1
          AND tenant_id = $12
        RETURNING *
      `,
      [
        req.params.salaryStructureId,
        p.structureName ?? null,
        p.annualCtc ?? null,
        p.monthlyGross ?? null,
        p.basicPay ?? null,
        p.variablePay ?? null,
        p.isCurrent ?? null,
        p.revisionReason ?? null,
        p.effectiveFrom ?? null,
        JSON.stringify(p.metadata || {}),
        actorId,
        tenantId
      ]
    );
    if (!result.rows[0]) throw { code: 404, message: "Salary structure not found" };
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

exports.deleteSalaryStructure = async (req) => {
  const pool = await ensurePool();
  const client = await pool.connect();
  try {
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });
    const actorId = String(req.user.userId);
    const result = await client.query(
      `
        UPDATE employee_salary_structures
        SET is_current = false, effective_to = COALESCE(effective_to, NOW()::date), updated_by = $2
        WHERE id = $1
          AND tenant_id = $3
        RETURNING id, is_current, effective_to
      `,
      [req.params.salaryStructureId, actorId, tenantId]
    );
    if (!result.rows[0]) throw { code: 404, message: "Salary structure not found" };
    return result.rows[0];
  } finally {
    client.release();
  }
};

exports.createPayrollRun = async (req) => {
  const pool = await ensurePool();
  const client = await pool.connect();
  let tenantId = null;
  let payload = null;
  try {
    await client.query("BEGIN");
    tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });
    const actorId = String(req.user.userId);
    payload = req.body;
    const hasSelectedEmployees = Array.isArray(payload.employeeIds) && payload.employeeIds.length > 0;
    let resolvedRunType = payload.runType || "regular";
    if (resolvedRunType === "regular" && hasSelectedEmployees) {
      const regularExistsResult = await client.query(
        `
          SELECT id
          FROM payroll_runs
          WHERE tenant_id = $1
            AND pay_group_id = $2
            AND pay_month = $3
            AND run_type = 'regular'
          LIMIT 1
        `,
        [tenantId, payload.payGroupId, payload.payMonth]
      );
      if (regularExistsResult.rows[0]) {
        resolvedRunType = "supplementary";
      }
    }
    const versionResult = await client.query(
      `
        SELECT COALESCE(MAX(version), 0) + 1 AS next_version
        FROM payroll_runs
        WHERE tenant_id = $1
          AND pay_group_id = $2
          AND pay_month = $3
          AND run_type = $4
      `,
      [tenantId, payload.payGroupId, payload.payMonth, resolvedRunType]
    );
    const nextVersion = Number(versionResult.rows[0]?.next_version || 1);
    const runCode =
      payload.runCode ||
      `PR-${payload.payMonth.replace("-", "")}-${Date.now().toString().slice(-6)}`;
    const runName =
      payload.runName ||
      `Payroll ${payload.payMonth} (${resolvedRunType}${nextVersion > 1 ? ` v${nextVersion}` : ""})`;

    const runResult = await client.query(
      `
        INSERT INTO payroll_runs (
          tenant_id,
          pay_group_id,
          pay_period_id,
          run_code,
          run_name,
          pay_month,
          run_type,
          version,
          status,
          attendance_snapshot_status,
          idempotency_key,
          metadata,
          created_by,
          updated_by
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft','pending',$9,$10::jsonb,$11,$11)
        RETURNING *
      `,
      [
        tenantId,
        payload.payGroupId,
        payload.payPeriodId || null,
        runCode,
        runName,
        payload.payMonth,
        resolvedRunType,
        nextVersion,
        req.idempotencyKey || null,
        JSON.stringify({
          ...(payload.metadata || {}),
          requestedRunType: payload.runType || "regular",
          autoResolvedRunType: resolvedRunType,
          employeeSelectionMode: hasSelectedEmployees ? "selected_employees" : "all_assigned_employees"
        }),
        actorId
      ]
    );
    const run = runResult.rows[0];

    const employeeFilter = payload.employeeIds?.length
      ? `AND employee_external_id = ANY($3::varchar[])`
      : "";
    const snapshotsResult = await client.query(
      `
        SELECT id, employee_external_id, employee_payroll_profile_id, payable_days, lop_days, overtime_minutes
        FROM payroll_attendance_snapshots
        WHERE tenant_id = $1
          AND pay_month = $2
          ${employeeFilter}
      `,
      payload.employeeIds?.length
        ? [tenantId, payload.payMonth, payload.employeeIds]
        : [tenantId, payload.payMonth]
    );

    const snapshots = snapshotsResult.rows;
    const snapshotEmployeeIds = snapshots
      .map((row) => String(row.employee_external_id || "").trim())
      .filter(Boolean);
    const coveredEmployeesResult = snapshotEmployeeIds.length
      ? await client.query(
          `
            SELECT DISTINCT pre.employee_external_id
            FROM payroll_run_employees pre
            INNER JOIN payroll_runs pr
              ON pr.id = pre.payroll_run_id
            WHERE pr.tenant_id = $1
              AND pr.pay_group_id = $2
              AND pr.pay_month = $3
              AND pr.status NOT IN ('rejected', 'cancelled')
              AND pre.employee_external_id = ANY($4::varchar[])
          `,
          [tenantId, payload.payGroupId, payload.payMonth, snapshotEmployeeIds]
        )
      : { rows: [] };
    const coveredEmployeeIds = new Set(
      coveredEmployeesResult.rows
        .map((row) => String(row.employee_external_id || "").trim())
        .filter(Boolean)
    );

    const eligibleEmployeeIds = snapshotEmployeeIds.length
      ? new Set(
          (
            await Employee.find({
              _id: { $in: snapshotEmployeeIds },
              isDeleted: false,
              status: { $ne: "resigned" },
              employmentLifecycleStatus: { $ne: "terminated" }
            })
              .select("_id")
              .lean()
          ).map((employee) => String(employee._id))
        )
      : new Set();

    const activeProfileResult = snapshotEmployeeIds.length
      ? await client.query(
          `
            SELECT employee_external_id
            FROM employee_payroll_profiles
            WHERE tenant_id = $1
              AND pay_group_id = $2
              AND employee_external_id = ANY($3::varchar[])
              AND payroll_status <> 'exited'
          `,
          [tenantId, payload.payGroupId, snapshotEmployeeIds]
        )
      : { rows: [] };

    const activeProfileEmployeeIds = new Set(
      activeProfileResult.rows.map((row) => String(row.employee_external_id))
    );

    const eligibleSnapshots = snapshots.filter((row) => {
      const employeeId = String(row.employee_external_id || "").trim();
      if (!employeeId) return false;
      if (coveredEmployeeIds.has(employeeId)) return false;
      if (!eligibleEmployeeIds.has(employeeId)) return false;
      return activeProfileEmployeeIds.size === 0 || activeProfileEmployeeIds.has(employeeId);
    });

    if (!eligibleSnapshots.length) {
      throw {
        code: 409,
        message: hasSelectedEmployees
          ? `Selected employees are already included in another payroll run for ${payload.payMonth}.`
          : `All eligible employees are already included in another payroll run for ${payload.payMonth}.`
      };
    }

    if (eligibleSnapshots.length) {
      const values = [];
      const placeholders = [];
      let idx = 1;
      for (const row of eligibleSnapshots) {
        placeholders.push(
          `($${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++})`
        );
        values.push(
          tenantId,
          run.id,
          row.employee_external_id,
          row.employee_payroll_profile_id || null,
          row.id,
          "pending",
          row.payable_days || 0,
          row.lop_days || 0,
          row.overtime_minutes || 0,
          "[]",
          actorId,
          actorId
        );
      }

      await client.query(
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
          VALUES ${placeholders.join(",")}
        `,
        values
      );
    }

    await client.query(
      `
        UPDATE payroll_runs
        SET employee_count = $2, processed_employee_count = 0, updated_by = $3
        WHERE id = $1
      `,
      [run.id, eligibleSnapshots.length, actorId]
    );

    await client.query("COMMIT");
    return {
      ...run,
      seededEmployees: eligibleSnapshots.length
    };
  } catch (error) {
    await safeRollback(client);
    if (
      error?.code === "23505" &&
      error?.constraint === "uq_payroll_run_month_group" &&
      tenantId &&
      payload?.payGroupId &&
      payload?.payMonth
    ) {
      const existingResult = await client.query(
        `
          SELECT id, run_code, run_name, status
          FROM payroll_runs
          WHERE tenant_id = $1
            AND pay_group_id = $2
            AND pay_month = $3
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [tenantId, payload.payGroupId, payload.payMonth]
      );
      const existing = existingResult.rows[0];
      if (existing) {
        throw {
          code: 409,
          message: `Payroll run already exists for ${payload.payMonth} in this pay group (run: ${existing.run_code}, status: ${existing.status}). Open existing run instead.`,
          existingRunId: existing.id
        };
      }
      throw {
        code: 409,
        message:
          "Payroll run already exists for selected pay month and pay group. Open existing run instead."
      };
    }
    throw error;
  } finally {
    client.release();
  }
};

exports.listPayrollRuns = async (req) => {
  const pool = await ensurePool();
  const client = await pool.connect();
  try {
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });
    const { payMonth, status, payGroupId, limit, offset } = req.query;

    const filters = ["tenant_id = $1"];
    const params = [tenantId];
    if (payMonth) {
      params.push(payMonth);
      filters.push(`pay_month = $${params.length}`);
    }
    if (status) {
      params.push(status);
      filters.push(`status = $${params.length}`);
    }
    if (payGroupId) {
      params.push(payGroupId);
      filters.push(`pay_group_id = $${params.length}`);
    }
    params.push(limit, offset);

    const result = await client.query(
      `
        SELECT *
        FROM payroll_runs
        WHERE ${filters.join(" AND ")}
        ORDER BY created_at DESC
        LIMIT $${params.length - 1}
        OFFSET $${params.length}
      `,
      params
    );
    return result.rows;
  } finally {
    client.release();
  }
};

exports.getPayrollRun = async (req) => {
  const pool = await ensurePool();
  const client = await pool.connect();
  try {
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });
    const runId = req.params.runId;

    const runRes = await client.query(
      `
        SELECT *
        FROM payroll_runs
        WHERE id = $1 AND tenant_id = $2
      `,
      [runId, tenantId]
    );
    const run = runRes.rows[0];
    if (!run) throw { code: 404, message: "Payroll run not found" };

    const employeesRes = await client.query(
      `
        SELECT
          re.*,
          snap.present_days,
          snap.working_days,
          snap.paid_leave_days,
          snap.week_off_days,
          snap.holiday_days,
          snap.half_days
        FROM payroll_run_employees re
        LEFT JOIN payroll_attendance_snapshots snap
          ON snap.id = re.attendance_snapshot_id
        WHERE re.payroll_run_id = $1
        ORDER BY re.employee_external_id
      `,
      [runId]
    );

    return {
      ...run,
      employees: employeesRes.rows
    };
  } finally {
    client.release();
  }
};

exports.previewPayrollRun = async (req) => {
  const pool = await ensurePool();
  const client = await pool.connect();
  try {
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });
    const runId = req.params.runId;
    const { includeComponents, includeEmployees, limitEmployees } = req.body;

    const runRes = await client.query(
      `
        SELECT *
        FROM payroll_runs
        WHERE id = $1 AND tenant_id = $2
      `,
      [runId, tenantId]
    );
    const run = runRes.rows[0];
    if (!run) throw { code: 404, message: "Payroll run not found" };

    const payload = { ...run };

    if (includeEmployees) {
      const employeeRes = await client.query(
        `
          SELECT
            re.*,
            snap.present_days,
            snap.working_days,
            snap.paid_leave_days,
            snap.week_off_days,
            snap.holiday_days,
            snap.half_days
          FROM payroll_run_employees re
          LEFT JOIN payroll_attendance_snapshots snap
            ON snap.id = re.attendance_snapshot_id
          WHERE re.payroll_run_id = $1
          ORDER BY re.net_pay DESC, re.employee_external_id ASC
          LIMIT $2
        `,
        [runId, limitEmployees]
      );
      payload.employees = employeeRes.rows;
    }

    if (includeComponents) {
      const compRes = await client.query(
        `
          SELECT
            component_scope,
            component_code,
            component_name,
            SUM(amount) AS total_amount
          FROM payroll_run_components
          WHERE payroll_run_id = $1
          GROUP BY component_scope, component_code, component_name
          ORDER BY component_scope, component_code
        `,
        [runId]
      );
      payload.componentSummary = compRes.rows;
    }

    return payload;
  } finally {
    client.release();
  }
};

exports.getRunEmployeeBreakdown = async (req) => {
  const pool = await ensurePool();
  const client = await pool.connect();
  try {
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });
    const runId = req.params.runId;
    const search = String(req.query?.search || "").trim().toLowerCase();
    const limit = Number(req.query?.limit || 500);

    const runRes = await client.query(
      `
        SELECT id, run_code, run_name, pay_month, status, pay_group_id, employee_count
        FROM payroll_runs
        WHERE id = $1 AND tenant_id = $2
      `,
      [runId, tenantId]
    );
    const run = runRes.rows[0];
    if (!run) throw { code: 404, message: "Payroll run not found" };

    const employeeRes = await client.query(
      `
        SELECT
          re.*,
          snap.present_days,
          snap.working_days,
          snap.paid_leave_days,
          snap.week_off_days,
          snap.holiday_days
        FROM payroll_run_employees re
        LEFT JOIN payroll_attendance_snapshots snap
          ON snap.id = re.attendance_snapshot_id
        WHERE re.payroll_run_id = $1
        ORDER BY employee_external_id ASC
        LIMIT $2
      `,
      [runId, limit]
    );
    const employees = employeeRes.rows;
    if (!employees.length) {
      return {
        run,
        employees: []
      };
    }

    const runEmployeeIds = employees.map((row) => row.id);
    const componentsRes = await client.query(
      `
        SELECT
          payroll_run_employee_id,
          component_scope,
          component_code,
          component_name,
          amount,
          quantity,
          rate,
          taxable,
          affects_net_pay,
          source_type,
          remarks
        FROM payroll_run_components
        WHERE payroll_run_id = $1
          AND payroll_run_employee_id = ANY($2::uuid[])
        ORDER BY component_scope, component_code
      `,
      [runId, runEmployeeIds]
    );

    const componentMap = new Map();
    for (const row of componentsRes.rows) {
      const key = String(row.payroll_run_employee_id);
      if (!componentMap.has(key)) componentMap.set(key, []);
      componentMap.get(key).push(row);
    }

    const employeeIds = [...new Set(employees.map((row) => String(row.employee_external_id)))];
    const mongoEmployees = await Employee.find({ _id: { $in: employeeIds } })
      .select("_id firstName lastName employeeCode")
      .lean();
    const mongoMap = new Map(
      mongoEmployees.map((emp) => [
        String(emp._id),
        {
          fullName: `${emp.firstName || ""} ${emp.lastName || ""}`.trim(),
          employeeCode: emp.employeeCode || null
        }
      ])
    );

    const rows = employees
      .map((row) => {
        const meta = mongoMap.get(String(row.employee_external_id)) || null;
        const components = componentMap.get(String(row.id)) || [];

        const totalEarnings = components
          .filter((c) => c.component_scope === "earning")
          .reduce((sum, c) => sum + Number(c.amount || 0), 0);
        const totalDeductions = components
          .filter((c) => c.component_scope === "deduction")
          .reduce((sum, c) => sum + Number(c.amount || 0), 0);
        const totalEmployerContributions = components
          .filter((c) => c.component_scope === "employer_contribution")
          .reduce((sum, c) => sum + Number(c.amount || 0), 0);

        return {
          ...row,
          employee_name: meta?.fullName || null,
          employee_code: meta?.employeeCode || null,
          components,
          component_totals: {
            earnings: totalEarnings,
            deductions: totalDeductions,
            employerContributions: totalEmployerContributions
          }
        };
      })
      .filter((row) => {
        if (!search) return true;
        const haystack = [
          row.employee_external_id,
          row.employee_name || "",
          row.employee_code || "",
          row.payroll_status || ""
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(search);
      });

    return {
      run,
      employees: rows
    };
  } finally {
    client.release();
  }
};
