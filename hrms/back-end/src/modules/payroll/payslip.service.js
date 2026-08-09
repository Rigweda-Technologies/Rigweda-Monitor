const { getPayrollPgPool } = require("../../config/payrollDb");
const Employee = require("../employees/employee.model");
require("../departments/department.model");
require("../designations/designation.model");
const Organization = require("../organizations/organization.model");
const OrgSettings = require("../orgSettings/orgSettings.model");
const { getTenantIdForOrganization } = require("./payrollProvisioning.service");

const EMPLOYEE_VISIBLE_PAYROLL_STATUSES = new Set(["approved", "locked", "paid"]);

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseJson = (value, fallback = null) => {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
};

const toPayrollDateKey = (value) => {
  if (!value) return "";
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || "";
};

const getTenantId = async (client, organizationId) => {
  const result = await client.query(
    `SELECT id FROM payroll_tenants WHERE organization_id = $1`,
    [String(organizationId)]
  );
  return result.rows[0]?.id || null;
};

const getEmployeeExternalIdCandidatesForUser = async (req) => {
  const employees = await Employee.find({
    userId: req.user.userId,
    organizationId: req.user.organizationId
  })
    .select("_id employeeCode")
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();

  if (!Array.isArray(employees) || employees.length === 0) {
    throw { code: 404, message: "Employee profile not found for current user" };
  }

  const byId = employees
    .map((row) => String(row?._id || "").trim())
    .filter(Boolean);

  const primaryCode = String(employees[0]?.employeeCode || "").trim();
  if (!primaryCode) return [...new Set(byId)];

  const sameCodeEmployees = await Employee.find({
    organizationId: req.user.organizationId,
    employeeCode: primaryCode
  })
    .select("_id")
    .lean();

  const byCode = sameCodeEmployees
    .map((row) => String(row?._id || "").trim())
    .filter(Boolean);

  return [...new Set([...byId, ...byCode])];
};

const findRunByEmployeeCodeForMonth = async ({ req, month, employeeCode }) => {
  if (!employeeCode) return null;
  const pool = await getPayrollPgPool();
  if (!pool) return null;

  const client = await pool.connect();
  try {
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });

    const result = await client.query(
      `
        SELECT r.id AS run_id, re.employee_external_id
        FROM payroll_runs r
        INNER JOIN payroll_run_employees re ON re.payroll_run_id = r.id
        INNER JOIN employee_payroll_profiles epp ON epp.id = re.employee_payroll_profile_id
        WHERE r.tenant_id = $1
          AND r.pay_month = $2
          AND epp.employee_code = $3
          AND r.status IN ('approved', 'locked', 'paid')
        ORDER BY
          CASE WHEN re.attendance_snapshot_id IS NOT NULL THEN 0 ELSE 1 END,
          CASE r.status
            WHEN 'paid' THEN 1
            WHEN 'locked' THEN 2
            WHEN 'approved' THEN 3
            ELSE 4
          END,
          r.updated_at DESC
        LIMIT 1
      `,
      [tenantId, month, String(employeeCode).trim()]
    );

    return result.rows[0] || null;
  } finally {
    client.release();
  }
};

const getRunMatchForEmployee = async ({ client, tenantId, runId, employeeExternalIds }) => {
  const result = await client.query(
    `
      SELECT re.employee_external_id
      FROM payroll_run_employees re
      INNER JOIN payroll_runs r ON r.id = re.payroll_run_id
      WHERE r.id = $1
        AND r.tenant_id = $2
        AND r.status IN ('approved', 'locked', 'paid')
        AND re.employee_external_id = ANY($3::varchar[])
      ORDER BY
        CASE re.payroll_status
          WHEN 'processed' THEN 1
          WHEN 'pending' THEN 2
          WHEN 'held' THEN 3
          ELSE 4
        END,
        re.updated_at DESC
      LIMIT 1
    `,
    [runId, tenantId, employeeExternalIds]
  );
  return result.rows[0]?.employee_external_id || null;
};

const parseMonth = (month) => {
  const [year, monthNum] = String(month).split("-").map(Number);
  return { year, monthNum };
};

const monthStart = (year) => `${year}-01`;

const aggregateByComponent = (rows) => {
  const map = new Map();
  for (const row of rows) {
    const key = `${row.component_scope}|${row.component_code}`;
    const prev = map.get(key) || 0;
    map.set(key, prev + toNumber(row.amount, 0));
  }
  return [...map.entries()].map(([key, amount]) => {
    const [scope, code] = key.split("|");
    return {
      scope,
      code,
      amount: Number(amount.toFixed(2))
    };
  });
};

const buildLineItems = (components, scope) =>
  components
    .filter((row) => row.component_scope === scope)
    .map((row) => ({
      code: row.component_code,
      name: row.component_name,
      amount: toNumber(row.amount, 0),
      sourceType: row.source_type,
      taxable: Boolean(row.taxable),
      calculationMode: row.calculation_mode,
      formulaSnapshot: parseJson(row.formula_snapshot, null)
    }))
    .sort((a, b) => a.code.localeCompare(b.code));

const getEmployeeBrief = async (organizationId, employeeExternalId) => {
  const employee = await Employee.findOne({
    _id: employeeExternalId,
    organizationId
  })
    .select("firstName lastName employeeCode dateOfJoining departmentId designationId address panNumber")
    .populate("departmentId", "name")
    .populate("designationId", "name")
    .lean();
  return employee || null;
};

const getOrganizationBrief = async (organizationId) => {
  const org = await Organization.findById(organizationId)
    .select("name code currency timezone")
    .lean();
  const settings = await OrgSettings.findOne({ organizationId })
    .select("logoUrl")
    .lean();
  return {
    ...(org || null),
    logoUrl: settings?.logoUrl || null
  };
};

const fetchRunContext = async (client, tenantId, runId, employeeExternalId) => {
  const runResult = await client.query(
    `
      SELECT *
      FROM payroll_runs
      WHERE id = $1 AND tenant_id = $2
      LIMIT 1
    `,
    [runId, tenantId]
  );
  const run = runResult.rows[0];
  if (!run) throw { code: 404, message: "Payroll run not found" };

  const runEmployeeResult = await client.query(
    `
      SELECT *
      FROM payroll_run_employees
      WHERE payroll_run_id = $1
        AND employee_external_id = $2
      LIMIT 1
    `,
    [runId, employeeExternalId]
  );
  const runEmployee = runEmployeeResult.rows[0];
  if (!runEmployee) {
    throw { code: 404, message: "Payroll run employee entry not found for requested employee" };
  }

  const componentsResult = await client.query(
    `
      SELECT *
      FROM payroll_run_components
      WHERE payroll_run_employee_id = $1
      ORDER BY component_scope, component_code
    `,
    [runEmployee.id]
  );

  const attendanceResult = runEmployee.attendance_snapshot_id
    ? await client.query(
        `
          SELECT *
          FROM payroll_attendance_snapshots
          WHERE id = $1
          LIMIT 1
        `,
        [runEmployee.attendance_snapshot_id]
      )
    : await client.query(
        `
          SELECT *
          FROM payroll_attendance_snapshots
          WHERE tenant_id = $1
            AND pay_month = $2
            AND employee_external_id = $3
          ORDER BY updated_at DESC
          LIMIT 1
        `,
        [tenantId, run.pay_month, employeeExternalId]
      );

  const attendanceDaysResult = attendanceResult.rows[0]?.id
    ? await client.query(
        `
          SELECT day_key, day_status, payable_units, lop_units
          FROM payroll_attendance_snapshot_days
          WHERE snapshot_id = $1
          ORDER BY day_key
        `,
        [attendanceResult.rows[0].id]
      )
    : { rows: [] };

  const profileResult = runEmployee.employee_payroll_profile_id
    ? await client.query(
        `
          SELECT *
          FROM employee_payroll_profiles
          WHERE id = $1
          LIMIT 1
        `,
        [runEmployee.employee_payroll_profile_id]
      )
    : { rows: [] };

  const salaryResult = runEmployee.employee_payroll_profile_id
    ? await client.query(
        `
          SELECT effective_from, effective_to
          FROM employee_salary_structures
          WHERE employee_payroll_profile_id = $1
            AND effective_from <= ($2 || '-01')::date + INTERVAL '1 month - 1 day'
            AND (effective_to IS NULL OR effective_to >= ($2 || '-01')::date)
          ORDER BY effective_from DESC, version_no DESC
          LIMIT 1
        `,
        [runEmployee.employee_payroll_profile_id, run.pay_month]
      )
    : { rows: [] };

  const bankResult = runEmployee.employee_payroll_profile_id
    ? await client.query(
        `
          SELECT *
          FROM employee_bank_details
          WHERE employee_payroll_profile_id = $1
          ORDER BY is_primary DESC, version_no DESC
          LIMIT 1
        `,
        [runEmployee.employee_payroll_profile_id]
      )
    : { rows: [] };

  const statutoryResult = runEmployee.employee_payroll_profile_id
    ? await client.query(
        `
          SELECT *
          FROM employee_statutory_details
          WHERE employee_payroll_profile_id = $1
          ORDER BY version_no DESC
          LIMIT 1
        `,
        [runEmployee.employee_payroll_profile_id]
      )
    : { rows: [] };

  return {
    run,
    runEmployee,
    components: componentsResult.rows,
    attendance: attendanceResult.rows[0] || null,
    attendanceDays: attendanceDaysResult.rows,
    salary: salaryResult.rows[0] || null,
    profile: profileResult.rows[0] || null,
    bank: bankResult.rows[0] || null,
    statutory: statutoryResult.rows[0] || null
  };
};

const fetchYtd = async (client, tenantId, run, employeeExternalId, employeeVisibleOnly = false) => {
  const { year } = parseMonth(run.pay_month);
  const ytdStart = monthStart(year);

  const totalsResult = await client.query(
    `
      SELECT
        COALESCE(SUM(re.gross_earnings), 0) AS gross_earnings,
        COALESCE(SUM(re.total_deductions), 0) AS total_deductions,
        COALESCE(SUM(re.reimbursement_amount), 0) AS reimbursements,
        COALESCE(SUM(re.employer_contributions), 0) AS employer_contributions,
        COALESCE(SUM(re.net_pay), 0) AS net_pay
      FROM payroll_run_employees re
      INNER JOIN payroll_runs r ON r.id = re.payroll_run_id
      WHERE r.tenant_id = $1
        AND re.employee_external_id = $2
        AND r.pay_month >= $3
        AND r.pay_month <= $4
        AND r.status IN (${employeeVisibleOnly
          ? "'approved', 'locked', 'paid'"
          : "'ready_for_approval', 'approved', 'locked', 'paid'"})
    `,
    [tenantId, employeeExternalId, ytdStart, run.pay_month]
  );

  const componentsResult = await client.query(
    `
      SELECT
        c.component_scope,
        c.component_code,
        c.amount
      FROM payroll_run_components c
      INNER JOIN payroll_run_employees re ON re.id = c.payroll_run_employee_id
      INNER JOIN payroll_runs r ON r.id = c.payroll_run_id
      WHERE r.tenant_id = $1
        AND re.employee_external_id = $2
        AND r.pay_month >= $3
        AND r.pay_month <= $4
        AND r.status IN (${employeeVisibleOnly
          ? "'approved', 'locked', 'paid'"
          : "'ready_for_approval', 'approved', 'locked', 'paid'"})
    `,
    [tenantId, employeeExternalId, ytdStart, run.pay_month]
  );

  const totals = totalsResult.rows[0] || {};
  return {
    period: {
      fromMonth: ytdStart,
      toMonth: run.pay_month
    },
    totals: {
      grossEarnings: toNumber(totals.gross_earnings, 0),
      totalDeductions: toNumber(totals.total_deductions, 0),
      reimbursements: toNumber(totals.reimbursements, 0),
      employerContributions: toNumber(totals.employer_contributions, 0),
      netPay: toNumber(totals.net_pay, 0)
    },
    components: aggregateByComponent(componentsResult.rows)
  };
};

const buildPayslipPayload = ({
  organization,
  employee,
  run,
  runEmployee,
  components,
  attendance,
  attendanceDays,
  salary,
  profile,
  bank,
  statutory,
  ytd
}) => {
  const earnings = buildLineItems(components, "earning");
  const deductions = buildLineItems(components, "deduction");
  const reimbursements = buildLineItems(components, "reimbursement");
  const employerContributions = buildLineItems(components, "employer_contribution");

  const monthStartKey = `${run.pay_month}-01`;
  const [payYear, payMonthNumber] = String(run.pay_month).split("-").map(Number);
  const monthEndKey = `${run.pay_month}-${String(new Date(Date.UTC(payYear, payMonthNumber, 0)).getUTCDate()).padStart(2, "0")}`;
  const salaryStartKey = toPayrollDateKey(salary?.effective_from);
  const salaryEndKey = toPayrollDateKey(salary?.effective_to);
  const effectiveStartKey = salaryStartKey && salaryStartKey > monthStartKey ? salaryStartKey : monthStartKey;
  const effectiveEndKey = salaryEndKey && salaryEndKey < monthEndKey ? salaryEndKey : monthEndKey;
  const effectiveDays = (attendanceDays || []).filter((row) => {
    const dayKey = toPayrollDateKey(row.day_key);
    return dayKey && dayKey >= effectiveStartKey && dayKey <= effectiveEndKey;
  });
  const effectiveBreakdown = effectiveDays.reduce(
    (total, row) => {
      const status = String(row.day_status || "").toLowerCase();
      const payableUnits = toNumber(row.payable_units, 0);
      if (["present", "holiday_worked", "week_off_worked"].includes(status)) total.presentDays += payableUnits;
      if (["half_day", "unpaid_leave_half", "paid_leave_half"].includes(status)) total.halfDays += 0.5;
      if (status === "paid_leave") total.paidLeaveDays += payableUnits;
      if (status === "paid_leave_half") total.paidLeaveDays += Math.min(0.5, payableUnits);
      if (status === "unpaid_leave") total.unpaidLeaveDays += 1;
      if (status === "unpaid_leave_half") total.unpaidLeaveDays += 0.5;
      if (status === "absent") total.absentDays += 1;
      if (status === "week_off") total.weekOffDays += 1;
      if (status === "holiday") total.holidayDays += 1;
      return total;
    },
    {
      presentDays: 0,
      halfDays: 0,
      paidLeaveDays: 0,
      unpaidLeaveDays: 0,
      absentDays: 0,
      weekOffDays: 0,
      holidayDays: 0
    }
  );

  const attendanceSummary = {
    month: run.pay_month,
    calendarDays: effectiveDays.length || toNumber(attendance?.calendar_days, 0),
    workingDays: effectiveDays.length
      ? effectiveDays.filter((row) => !["week_off", "holiday"].includes(String(row.day_status || "").toLowerCase())).length
      : toNumber(attendance?.working_days, 0),
    payableDays: toNumber(runEmployee?.payable_days, toNumber(attendance?.payable_days, 0)),
    lopDays: toNumber(runEmployee?.lop_days, toNumber(attendance?.lop_days, 0)),
    presentDays: effectiveDays.length ? effectiveBreakdown.presentDays : toNumber(attendance?.present_days, 0),
    halfDays: effectiveDays.length ? effectiveBreakdown.halfDays : toNumber(attendance?.half_days, 0),
    paidLeaveDays: effectiveDays.length ? effectiveBreakdown.paidLeaveDays : toNumber(attendance?.paid_leave_days, 0),
    unpaidLeaveDays: effectiveDays.length ? effectiveBreakdown.unpaidLeaveDays : toNumber(attendance?.unpaid_leave_days, 0),
    absentDays: effectiveDays.length ? effectiveBreakdown.absentDays : toNumber(attendance?.absent_days, 0),
    holidayDays: effectiveDays.length ? effectiveBreakdown.holidayDays : toNumber(attendance?.holiday_days, 0),
    weekOffDays: effectiveDays.length ? effectiveBreakdown.weekOffDays : toNumber(attendance?.week_off_days, 0),
    effectiveFrom: effectiveStartKey,
    effectiveTo: effectiveEndKey,
    overtimeMinutes: toNumber(attendance?.overtime_minutes, toNumber(runEmployee?.overtime_minutes, 0)),
    lateByMinutes: toNumber(attendance?.late_by_minutes, 0),
    attendanceMinutes: toNumber(attendance?.attendance_minutes, 0)
  };

  const totals = {
    grossEarnings: toNumber(runEmployee.gross_earnings, 0),
    totalDeductions: toNumber(runEmployee.total_deductions, 0),
    reimbursements: toNumber(runEmployee.reimbursement_amount, 0),
    employerContributions: toNumber(runEmployee.employer_contributions, 0),
    taxableIncome: toNumber(runEmployee.taxable_income, 0),
    tds: toNumber(runEmployee.tds_amount, 0),
    netPay: toNumber(runEmployee.net_pay, 0)
  };

  const payslipJson = {
    payslipId: `${run.run_code}-${runEmployee.employee_external_id}`,
    runId: run.id,
    payMonth: run.pay_month,
    payrollStatus: run.status,
    currency: run.currency_code || "INR",
    company: {
      name: organization?.name || null,
      code: organization?.code || null,
      timezone: organization?.timezone || "Asia/Kolkata",
      logoUrl: organization?.logoUrl || null
    },
    employee: {
      employeeExternalId: runEmployee.employee_external_id,
      employeeCode: employee?.employeeCode || profile?.employee_code || null,
      name: employee ? `${employee.firstName || ""} ${employee.lastName || ""}`.trim() : null,
      dateOfJoining: employee?.dateOfJoining || profile?.date_of_joining || null,
      taxRegime: profile?.tax_regime || null,
      department: employee?.departmentId?.name || null,
      designation: employee?.designationId?.name || null,
      address: employee?.address || null
    },
    bank: bank
      ? {
          paymentMode: bank.payment_mode,
          accountHolderName: bank.account_holder_name,
          bankName: bank.bank_name,
          branchName: bank.branch_name || null,
          accountNumberMasked: bank.account_number
            ? `XXXXXX${String(bank.account_number).slice(-4)}`
            : null,
          ifscCode: bank.ifsc_code,
          upiId: bank.upi_id
        }
      : null,
    statutory: statutory
      ? {
          pan: statutory.pan || employee?.panNumber || null,
          uan: statutory.uan || null,
          esicNumber: statutory.esic_number || null
        }
      : null,
    attendanceSummary,
    earnings,
    deductions,
    reimbursements,
    employerContributions,
    totals,
    ytd
  };

  const pdfPayload = {
    templateCode: "payslip_v1_india",
    documentMeta: {
      title: `Payslip - ${run.pay_month}`,
      generatedAt: new Date().toISOString(),
      locale: "en-IN",
      currency: run.currency_code || "INR"
    },
    header: {
      companyName: payslipJson.company.name,
      companyCode: payslipJson.company.code,
      companyLogoUrl: payslipJson.company.logoUrl,
      payslipMonth: run.pay_month,
      payrollRunCode: run.run_code
    },
    employeeCard: {
      name: payslipJson.employee.name,
      employeeCode: payslipJson.employee.employeeCode,
      dateOfJoining: payslipJson.employee.dateOfJoining,
      taxRegime: payslipJson.employee.taxRegime,
      paymentMode: payslipJson.bank?.paymentMode || null
    },
    attendanceCard: attendanceSummary,
    sections: {
      earnings,
      deductions,
      reimbursements,
      employerContributions
    },
    totalsCard: totals,
    ytdCard: ytd,
    footNotes: [
      "This is a system-generated payslip.",
      "For queries contact payroll/HR team."
    ]
  };

  return {
    payslipJson,
    pdfPayload
  };
};

exports.getPayslipByRun = async (req) => {
  const pool = await getPayrollPgPool();
  if (!pool) throw { code: 400, message: "Payroll Postgres is not enabled" };

  const client = await pool.connect();
  try {
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });

    const { runId, employeeExternalId } = req.params;
    const context = await fetchRunContext(client, tenantId, runId, employeeExternalId);
    if (
      req.employeePayslipSelfMode
      && !EMPLOYEE_VISIBLE_PAYROLL_STATUSES.has(String(context.run?.status || "").toLowerCase())
    ) {
      throw { code: 404, message: `Payroll not processed for ${context.run?.pay_month || "selected month"}` };
    }
    const ytd = await fetchYtd(
      client,
      tenantId,
      context.run,
      employeeExternalId,
      Boolean(req.employeePayslipSelfMode)
    );
    const [employee, organization] = await Promise.all([
      getEmployeeBrief(req.user.organizationId, employeeExternalId),
      getOrganizationBrief(req.user.organizationId)
    ]);

    return buildPayslipPayload({
      organization,
      employee,
      ...context,
      ytd
    });
  } finally {
    client.release();
  }
};

exports.getPayslipByMonth = async (req) => {
  const pool = await getPayrollPgPool();
  if (!pool) throw { code: 400, message: "Payroll Postgres is not enabled" };

  const client = await pool.connect();
  try {
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });

    const { month, employeeExternalId } = req.query;
    const runResult = await client.query(
      `
        SELECT r.id
        FROM payroll_runs r
        INNER JOIN payroll_run_employees re ON re.payroll_run_id = r.id
        WHERE r.tenant_id = $1
          AND r.pay_month = $2
          AND re.employee_external_id = $3
          AND r.status IN (${req.employeePayslipSelfMode
            ? "'approved', 'locked', 'paid'"
            : "'ready_for_approval', 'approved', 'locked', 'paid'"})
        ORDER BY
          CASE r.status
            WHEN 'paid' THEN 1
            WHEN 'locked' THEN 2
            WHEN 'approved' THEN 3
            ELSE 4
          END,
          r.updated_at DESC
        LIMIT 1
      `,
      [tenantId, month, employeeExternalId]
    );

    const runId = runResult.rows[0]?.id;
    if (!runId) {
      throw { code: 404, message: `Payslip not found for month ${month} and employee` };
    }

    req.params = {
      ...req.params,
      runId,
      employeeExternalId
    };
    return exports.getPayslipByRun(req);
  } finally {
    client.release();
  }
};

exports.getMyPayslipByMonth = async (req) => {
  const myEmployee = await Employee.findOne({
    userId: req.user.userId,
    organizationId: req.user.organizationId
  })
    .select("_id employeeCode")
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();

  const employeeExternalIds = await getEmployeeExternalIdCandidatesForUser(req);
  const employeeExternalId = employeeExternalIds[0];

  req.query = {
    ...req.query,
    employeeExternalId
  };
  req.employeePayslipSelfMode = true;
  try {
    return await exports.getPayslipByMonth(req);
  } catch (error) {
    if (error?.code !== 404 || employeeExternalIds.length <= 1) throw error;

    for (const candidate of employeeExternalIds.slice(1)) {
      try {
        req.query = {
          ...req.query,
          employeeExternalId: candidate
        };
        return await exports.getPayslipByMonth(req);
      } catch (innerError) {
        if (innerError?.code !== 404) throw innerError;
      }
    }
    const matchedRun = await findRunByEmployeeCodeForMonth({
      req,
      month: req.query?.month,
      employeeCode: myEmployee?.employeeCode
    });
    if (matchedRun?.run_id && matchedRun?.employee_external_id) {
      req.params = {
        ...req.params,
        runId: matchedRun.run_id,
        employeeExternalId: String(matchedRun.employee_external_id)
      };
      return exports.getPayslipByRun(req);
    }

    throw error;
  }
};

exports.listMyPayslipMonths = async (req) => {
  const pool = await getPayrollPgPool();
  if (!pool) throw { code: 400, message: "Payroll Postgres is not enabled" };

  const employeeExternalIds = await getEmployeeExternalIdCandidatesForUser(req);
  const client = await pool.connect();
  try {
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });

    const result = await client.query(
      `
        SELECT DISTINCT r.pay_month
        FROM payroll_runs r
        INNER JOIN payroll_run_employees re ON re.payroll_run_id = r.id
        WHERE r.tenant_id = $1
          AND re.employee_external_id = ANY($2::varchar[])
          AND r.status IN ('approved', 'locked', 'paid')
        ORDER BY r.pay_month DESC
      `,
      [tenantId, employeeExternalIds]
    );

    return result.rows.map((row) => row.pay_month).filter(Boolean);
  } finally {
    client.release();
  }
};

exports.listMyPayslipRuns = async (req) => {
  const pool = await getPayrollPgPool();
  if (!pool) throw { code: 400, message: "Payroll Postgres is not enabled" };

  const employeeExternalIds = await getEmployeeExternalIdCandidatesForUser(req);
  const client = await pool.connect();
  try {
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });

    const result = await client.query(
      `
        WITH candidate_runs AS (
          SELECT
            r.id AS run_id,
            r.run_code,
            r.pay_month,
            r.status,
            re.employee_external_id,
            CASE r.status
              WHEN 'paid' THEN 1
              WHEN 'locked' THEN 2
              WHEN 'approved' THEN 3
              ELSE 4
            END AS status_rank,
            row_number() OVER (
              PARTITION BY r.pay_month
              ORDER BY
                CASE WHEN re.attendance_snapshot_id IS NOT NULL THEN 0 ELSE 1 END,
                CASE r.status
                  WHEN 'paid' THEN 1
                  WHEN 'locked' THEN 2
                  WHEN 'approved' THEN 3
                  ELSE 4
                END,
                r.updated_at DESC
            ) AS month_rank
          FROM payroll_runs r
          INNER JOIN payroll_run_employees re ON re.payroll_run_id = r.id
          WHERE r.tenant_id = $1
            AND re.employee_external_id = ANY($2::varchar[])
            AND r.status IN ('approved', 'locked', 'paid')
        )
        SELECT run_id, run_code, pay_month, status, employee_external_id
        FROM candidate_runs
        WHERE month_rank = 1
        ORDER BY pay_month DESC
      `,
      [tenantId, employeeExternalIds]
    );

    return result.rows.map((row) => ({
      runId: row.run_id,
      runCode: row.run_code,
      month: row.pay_month,
      status: row.status,
      employeeExternalId: row.employee_external_id
    }));
  } finally {
    client.release();
  }
};

exports.getMyPayslipByRun = async (req) => {
  const pool = await getPayrollPgPool();
  if (!pool) throw { code: 400, message: "Payroll Postgres is not enabled" };

  const employeeExternalIds = await getEmployeeExternalIdCandidatesForUser(req);
  const client = await pool.connect();
  try {
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });

    const { runId } = req.params;
    const employeeExternalId = await getRunMatchForEmployee({
      client,
      tenantId,
      runId,
      employeeExternalIds
    });

    if (!employeeExternalId) {
      throw { code: 404, message: "Payslip not found for the selected payroll run" };
    }

    req.params = {
      ...req.params,
      employeeExternalId
    };
    req.employeePayslipSelfMode = true;

    return exports.getPayslipByRun(req);
  } finally {
    client.release();
  }
};
