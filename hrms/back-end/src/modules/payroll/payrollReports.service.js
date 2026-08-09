const { getPayrollPgPool } = require("../../config/payrollDb");
const { getTenantIdForOrganization } = require("./payrollProvisioning.service");

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const csvEscape = (value) => {
  const raw = value == null ? "" : String(value);
  if (/[",\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
};

const rowsToCsv = (headers, rows) => {
  const head = headers.map((h) => csvEscape(h)).join(",");
  const body = rows
    .map((row) => headers.map((h) => csvEscape(row[h])).join(","))
    .join("\n");
  return `${head}\n${body}`;
};

const getTenantId = async (client, organizationId) => {
  const result = await client.query(
    `SELECT id FROM payroll_tenants WHERE organization_id = $1`,
    [String(organizationId)]
  );
  return result.rows[0]?.id || null;
};

const ensurePool = async () => {
  const pool = await getPayrollPgPool();
  if (!pool) throw { code: 400, message: "Payroll Postgres is not enabled" };
  return pool;
};

const resolveRuns = async (client, tenantId, query) => {
  const { runId, month, payGroupId, includeUnfinalized } = query;
  const params = [tenantId];
  const filters = ["tenant_id = $1"];

  if (!includeUnfinalized) {
    filters.push(`status IN ('approved', 'locked', 'paid')`);
  }
  if (runId) {
    params.push(runId);
    filters.push(`id = $${params.length}`);
  }
  if (month) {
    params.push(month);
    filters.push(`pay_month = $${params.length}`);
  }
  if (payGroupId) {
    params.push(payGroupId);
    filters.push(`pay_group_id = $${params.length}`);
  }

  const result = await client.query(
    `
      SELECT id, run_code, run_name, pay_month, pay_group_id, status, currency_code
      FROM payroll_runs
      WHERE ${filters.join(" AND ")}
      ORDER BY pay_month DESC, created_at DESC
    `,
    params
  );

  const runs = result.rows;
  if (!runs.length) {
    throw { code: 404, message: "No payroll runs found for provided filters" };
  }
  return runs;
};

const withRunFilter = (columnName, runIds, params, baseIndex) => {
  params.push(runIds);
  return `${columnName} = ANY($${baseIndex + 1}::uuid[])`;
};

exports.getPayrollRegister = async (req) => {
  const pool = await ensurePool();
  const client = await pool.connect();
  try {
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });

    const runs = await resolveRuns(client, tenantId, req.query);
    const runIds = runs.map((r) => r.id);
    const params = [tenantId];
    const runFilter = withRunFilter("re.payroll_run_id", runIds, params, params.length);

    const result = await client.query(
      `
        SELECT
          re.payroll_run_id,
          r.run_code,
          r.pay_month,
          re.employee_external_id,
          ep.employee_code,
          ep.cost_center_code,
          re.payable_days,
          re.lop_days,
          re.overtime_minutes,
          re.gross_earnings,
          re.total_deductions,
          re.reimbursement_amount,
          re.employer_contributions,
          re.net_pay,
          re.payroll_status
        FROM payroll_run_employees re
        INNER JOIN payroll_runs r ON r.id = re.payroll_run_id
        LEFT JOIN employee_payroll_profiles ep ON ep.id = re.employee_payroll_profile_id
        WHERE r.tenant_id = $1
          AND ${runFilter}
        ORDER BY r.pay_month DESC, re.employee_external_id ASC
      `,
      params
    );

    const totals = result.rows.reduce(
      (acc, row) => {
        acc.gross += toNumber(row.gross_earnings, 0);
        acc.deductions += toNumber(row.total_deductions, 0);
        acc.reimbursements += toNumber(row.reimbursement_amount, 0);
        acc.employerContributions += toNumber(row.employer_contributions, 0);
        acc.netPay += toNumber(row.net_pay, 0);
        return acc;
      },
      {
        gross: 0,
        deductions: 0,
        reimbursements: 0,
        employerContributions: 0,
        netPay: 0
      }
    );

    return {
      filters: req.query,
      runs,
      count: result.rows.length,
      totals,
      rows: result.rows
    };
  } finally {
    client.release();
  }
};

exports.getBankTransferExport = async (req) => {
  const pool = await ensurePool();
  const client = await pool.connect();
  try {
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });

    const runs = await resolveRuns(client, tenantId, req.query);
    const runIds = runs.map((r) => r.id);
    const params = [tenantId];
    const runFilter = withRunFilter("re.payroll_run_id", runIds, params, params.length);

    const result = await client.query(
      `
        SELECT
          r.run_code,
          r.pay_month,
          re.employee_external_id,
          ep.employee_code,
          COALESCE(bd.account_holder_name, '') AS account_holder_name,
          COALESCE(bd.bank_name, '') AS bank_name,
          COALESCE(bd.account_number, '') AS account_number,
          COALESCE(bd.ifsc_code, '') AS ifsc_code,
          COALESCE(bd.payment_mode, ep.default_payment_mode, 'bank_transfer') AS payment_mode,
          COALESCE(bd.upi_id, '') AS upi_id,
          re.net_pay AS transfer_amount
        FROM payroll_run_employees re
        INNER JOIN payroll_runs r ON r.id = re.payroll_run_id
        LEFT JOIN employee_payroll_profiles ep ON ep.id = re.employee_payroll_profile_id
        LEFT JOIN LATERAL (
          SELECT *
          FROM employee_bank_details bd
          WHERE bd.employee_payroll_profile_id = ep.id
          ORDER BY bd.is_primary DESC, bd.version_no DESC
          LIMIT 1
        ) bd ON TRUE
        WHERE r.tenant_id = $1
          AND ${runFilter}
        ORDER BY r.pay_month DESC, re.employee_external_id ASC
      `,
      params
    );

    const rows = result.rows.map((row) => ({
      run_code: row.run_code,
      pay_month: row.pay_month,
      employee_external_id: row.employee_external_id,
      employee_code: row.employee_code,
      account_holder_name: row.account_holder_name,
      bank_name: row.bank_name,
      account_number: row.account_number,
      ifsc_code: row.ifsc_code,
      payment_mode: row.payment_mode,
      upi_id: row.upi_id,
      transfer_amount: Number(toNumber(row.transfer_amount, 0).toFixed(2))
    }));

    const transferTotal = rows.reduce((sum, row) => sum + toNumber(row.transfer_amount, 0), 0);
    const payload = {
      filters: req.query,
      runs,
      count: rows.length,
      transferTotal: Number(transferTotal.toFixed(2)),
      rows
    };

    if (req.query.exportFormat === "csv") {
      const headers = [
        "run_code",
        "pay_month",
        "employee_external_id",
        "employee_code",
        "account_holder_name",
        "bank_name",
        "account_number",
        "ifsc_code",
        "payment_mode",
        "upi_id",
        "transfer_amount"
      ];
      payload.csv = rowsToCsv(headers, rows);
    }

    return payload;
  } finally {
    client.release();
  }
};

exports.getDeductionSummary = async (req) => {
  const pool = await ensurePool();
  const client = await pool.connect();
  try {
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });

    const runs = await resolveRuns(client, tenantId, req.query);
    const runIds = runs.map((r) => r.id);
    const params = [tenantId];
    const runFilter = withRunFilter("c.payroll_run_id", runIds, params, params.length);

    const result = await client.query(
      `
        SELECT
          c.component_code,
          c.component_name,
          COUNT(*) AS line_count,
          COALESCE(SUM(c.amount), 0) AS total_amount
        FROM payroll_run_components c
        INNER JOIN payroll_runs r ON r.id = c.payroll_run_id
        WHERE r.tenant_id = $1
          AND ${runFilter}
          AND c.component_scope = 'deduction'
        GROUP BY c.component_code, c.component_name
        ORDER BY c.component_code ASC
      `,
      params
    );

    const totalDeductions = result.rows.reduce(
      (sum, row) => sum + toNumber(row.total_amount, 0),
      0
    );

    return {
      filters: req.query,
      runs,
      totalDeductions: Number(totalDeductions.toFixed(2)),
      rows: result.rows.map((row) => ({
        componentCode: row.component_code,
        componentName: row.component_name,
        lineCount: Number(row.line_count),
        totalAmount: Number(toNumber(row.total_amount, 0).toFixed(2))
      }))
    };
  } finally {
    client.release();
  }
};

exports.getEmployerContributionSummary = async (req) => {
  const pool = await ensurePool();
  const client = await pool.connect();
  try {
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });

    const runs = await resolveRuns(client, tenantId, req.query);
    const runIds = runs.map((r) => r.id);
    const params = [tenantId];
    const runFilter = withRunFilter("c.payroll_run_id", runIds, params, params.length);

    const result = await client.query(
      `
        SELECT
          c.component_code,
          c.component_name,
          COUNT(*) AS line_count,
          COALESCE(SUM(c.amount), 0) AS total_amount
        FROM payroll_run_components c
        INNER JOIN payroll_runs r ON r.id = c.payroll_run_id
        WHERE r.tenant_id = $1
          AND ${runFilter}
          AND c.component_scope = 'employer_contribution'
        GROUP BY c.component_code, c.component_name
        ORDER BY c.component_code ASC
      `,
      params
    );

    const total = result.rows.reduce((sum, row) => sum + toNumber(row.total_amount, 0), 0);

    return {
      filters: req.query,
      runs,
      totalEmployerContributions: Number(total.toFixed(2)),
      rows: result.rows.map((row) => ({
        componentCode: row.component_code,
        componentName: row.component_name,
        lineCount: Number(row.line_count),
        totalAmount: Number(toNumber(row.total_amount, 0).toFixed(2))
      }))
    };
  } finally {
    client.release();
  }
};

exports.getCostCenterTotals = async (req) => {
  const pool = await ensurePool();
  const client = await pool.connect();
  try {
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });

    const runs = await resolveRuns(client, tenantId, req.query);
    const runIds = runs.map((r) => r.id);
    const params = [tenantId];
    const runFilter = withRunFilter("re.payroll_run_id", runIds, params, params.length);

    const result = await client.query(
      `
        SELECT
          COALESCE(ep.cost_center_code, 'UNASSIGNED') AS cost_center_code,
          COUNT(*) AS employee_count,
          COALESCE(SUM(re.gross_earnings), 0) AS gross_earnings,
          COALESCE(SUM(re.total_deductions), 0) AS total_deductions,
          COALESCE(SUM(re.reimbursement_amount), 0) AS reimbursements,
          COALESCE(SUM(re.employer_contributions), 0) AS employer_contributions,
          COALESCE(SUM(re.net_pay), 0) AS net_pay
        FROM payroll_run_employees re
        INNER JOIN payroll_runs r ON r.id = re.payroll_run_id
        LEFT JOIN employee_payroll_profiles ep ON ep.id = re.employee_payroll_profile_id
        WHERE r.tenant_id = $1
          AND ${runFilter}
        GROUP BY COALESCE(ep.cost_center_code, 'UNASSIGNED')
        ORDER BY cost_center_code ASC
      `,
      params
    );

    return {
      filters: req.query,
      runs,
      rows: result.rows.map((row) => ({
        costCenterCode: row.cost_center_code,
        employeeCount: Number(row.employee_count),
        grossEarnings: Number(toNumber(row.gross_earnings, 0).toFixed(2)),
        totalDeductions: Number(toNumber(row.total_deductions, 0).toFixed(2)),
        reimbursements: Number(toNumber(row.reimbursements, 0).toFixed(2)),
        employerContributions: Number(toNumber(row.employer_contributions, 0).toFixed(2)),
        netPay: Number(toNumber(row.net_pay, 0).toFixed(2))
      }))
    };
  } finally {
    client.release();
  }
};
