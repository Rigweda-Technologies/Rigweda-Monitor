const { getPayrollPgPool } = require("../../config/payrollDb");
const { getTenantIdForOrganization } = require("./payrollProvisioning.service");

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toArray = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }
  return [];
};

const getTenantId = async (client, organizationId) => {
  const result = await client.query(
    `SELECT id FROM payroll_tenants WHERE organization_id = $1`,
    [String(organizationId)]
  );
  return result.rows[0]?.id || null;
};

const almostEqual = (a, b, tolerance = 1) =>
  Math.abs(toNumber(a, 0) - toNumber(b, 0)) <= tolerance;

exports.validatePayrollRun = async (req) => {
  const runId = String(req.params.runId);
  const organizationId = String(req.user.organizationId);
  const actorId = String(req.user.userId);
  const { employeeIds = [], strictMode = false } = req.body;

  const pfThreshold = toNumber(process.env.PAYROLL_PF_WAGE_THRESHOLD, 15000);
  const esiThreshold = toNumber(process.env.PAYROLL_ESI_WAGE_THRESHOLD, 21000);

  const pool = await getPayrollPgPool();
  if (!pool) throw { code: 400, message: "Payroll Postgres is not enabled" };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const tenantId = await getTenantIdForOrganization(client, organizationId, {
      actorId
    });

    const runResult = await client.query(
      `
        SELECT *
        FROM payroll_runs
        WHERE id = $1 AND tenant_id = $2
        FOR UPDATE
      `,
      [runId, tenantId]
    );
    const run = runResult.rows[0];
    if (!run) throw { code: 404, message: "Payroll run not found" };
    if (["locked", "paid", "cancelled"].includes(run.status)) {
      throw { code: 409, message: `Payroll run cannot be validated in status: ${run.status}` };
    }

    const filterByEmployees = employeeIds.length > 0;
    const runEmployeesResult = await client.query(
      `
        SELECT *
        FROM payroll_run_employees
        WHERE payroll_run_id = $1
          ${filterByEmployees ? "AND employee_external_id = ANY($2::varchar[])" : ""}
      `,
      filterByEmployees ? [runId, employeeIds] : [runId]
    );

    const runEmployees = runEmployeesResult.rows;
    if (!runEmployees.length) {
      throw { code: 400, message: "No payroll run employees found to validate" };
    }

    const employeeExternalIds = runEmployees.map((row) => String(row.employee_external_id));
    const profileIds = runEmployees
      .map((row) => row.employee_payroll_profile_id)
      .filter(Boolean);
    const snapshotIds = runEmployees.map((row) => row.attendance_snapshot_id).filter(Boolean);

    const [profilesRes, bankRes, statutoryRes, snapshotsRes, componentsRes] = await Promise.all([
      client.query(
        `
          SELECT id, employee_external_id, default_payment_mode
          FROM employee_payroll_profiles
          WHERE tenant_id = $1
            AND employee_external_id = ANY($2::varchar[])
        `,
        [tenantId, employeeExternalIds]
      ),
      profileIds.length
        ? client.query(
            `
              SELECT DISTINCT ON (employee_payroll_profile_id)
                employee_payroll_profile_id,
                payment_mode,
                account_holder_name,
                bank_name,
                account_number,
                ifsc_code,
                upi_id,
                is_verified
              FROM employee_bank_details
              WHERE employee_payroll_profile_id = ANY($1::uuid[])
                AND effective_from <= NOW()::date
                AND (effective_to IS NULL OR effective_to >= NOW()::date)
              ORDER BY employee_payroll_profile_id, is_primary DESC, effective_from DESC, version_no DESC
            `,
            [profileIds]
          )
        : { rows: [] },
      profileIds.length
        ? client.query(
            `
              SELECT DISTINCT ON (employee_payroll_profile_id)
                employee_payroll_profile_id,
                pan,
                uan,
                esic_number,
                pf_member,
                esi_eligible
              FROM employee_statutory_details
              WHERE employee_payroll_profile_id = ANY($1::uuid[])
                AND effective_from <= NOW()::date
                AND (effective_to IS NULL OR effective_to >= NOW()::date)
              ORDER BY employee_payroll_profile_id, effective_from DESC, version_no DESC
            `,
            [profileIds]
          )
        : { rows: [] },
      snapshotIds.length
        ? client.query(
            `
              SELECT id
              FROM payroll_attendance_snapshots
              WHERE id = ANY($1::uuid[])
            `,
            [snapshotIds]
          )
        : { rows: [] },
      client.query(
        `
          SELECT
            payroll_run_employee_id,
            component_scope,
            COALESCE(SUM(amount), 0) AS total_amount
          FROM payroll_run_components
          WHERE payroll_run_id = $1
          GROUP BY payroll_run_employee_id, component_scope
        `,
        [runId]
      )
    ]);

    const profileByEmployee = new Map(
      profilesRes.rows.map((row) => [String(row.employee_external_id), row])
    );
    const bankByProfile = new Map(
      bankRes.rows.map((row) => [String(row.employee_payroll_profile_id), row])
    );
    const statutoryByProfile = new Map(
      statutoryRes.rows.map((row) => [String(row.employee_payroll_profile_id), row])
    );
    const snapshotIdSet = new Set(snapshotsRes.rows.map((row) => String(row.id)));
    const componentTotalsByRunEmployee = new Map();
    for (const row of componentsRes.rows) {
      const runEmployeeId = String(row.payroll_run_employee_id);
      if (!componentTotalsByRunEmployee.has(runEmployeeId)) {
        componentTotalsByRunEmployee.set(runEmployeeId, {});
      }
      componentTotalsByRunEmployee.get(runEmployeeId)[row.component_scope] = toNumber(
        row.total_amount,
        0
      );
    }

    let totalErrors = 0;
    let totalWarnings = 0;
    const results = [];

    for (const item of runEmployees) {
      const runEmployeeId = String(item.id);
      const employeeExternalId = String(item.employee_external_id);
      const profile = profileByEmployee.get(employeeExternalId);
      const profileId = item.employee_payroll_profile_id
        ? String(item.employee_payroll_profile_id)
        : profile?.id
          ? String(profile.id)
          : null;
      const bank = profileId ? bankByProfile.get(profileId) : null;
      const statutory = profileId ? statutoryByProfile.get(profileId) : null;
      const compTotals = componentTotalsByRunEmployee.get(runEmployeeId) || {};

      const errors = [];
      const warnings = [];

      if (!item.attendance_snapshot_id || !snapshotIdSet.has(String(item.attendance_snapshot_id))) {
        errors.push("Missing attendance snapshot for employee in this payroll run.");
      }

      const paymentMode = String(bank?.payment_mode || profile?.default_payment_mode || "bank_transfer");
      if (!bank && paymentMode !== "cash") {
        errors.push("Missing bank details for payroll disbursement.");
      } else if (paymentMode === "bank_transfer") {
        if (!bank?.account_holder_name || !bank?.bank_name || !bank?.account_number || !bank?.ifsc_code) {
          errors.push("Incomplete bank details (account holder/bank/account/IFSC required).");
        }
        if (bank?.is_verified === false) {
          warnings.push("Bank details are present but not verified.");
        }
      } else if (paymentMode === "upi" && !bank?.upi_id) {
        errors.push("UPI payment mode selected but UPI ID is missing.");
      }

      if (!statutory?.pan) {
        warnings.push("PAN is missing; TDS compliance may fail.");
      }

      const pfMember = Boolean(statutory?.pf_member);
      if (pfMember && !statutory?.uan) {
        warnings.push("UAN is missing for PF eligible employee.");
      }

      const esiEligible = Boolean(statutory?.esi_eligible);
      if (esiEligible && !statutory?.esic_number) {
        warnings.push("ESI number is missing for ESI eligible employee.");
      }

      const gross = toNumber(item.gross_earnings, 0);
      const basicApprox = gross * 0.4;
      if (basicApprox <= pfThreshold && !pfMember) {
        warnings.push(
          `PF check: basic proxy is within ₹${pfThreshold}, but PF membership is disabled.`
        );
      }

      if (gross <= esiThreshold && !esiEligible) {
        warnings.push(
          `ESI check: gross earnings are within ₹${esiThreshold}, but ESI eligibility is disabled.`
        );
      }

      const computedEarnings = toNumber(compTotals.earning, 0);
      const computedDeductions = toNumber(compTotals.deduction, 0);
      const computedEmployer = toNumber(compTotals.employer_contribution, 0);
      const computedReimbursement = toNumber(compTotals.reimbursement, 0);
      const expectedNet = computedEarnings + computedReimbursement - computedDeductions;

      if (!almostEqual(item.gross_earnings, computedEarnings)) {
        errors.push(
          `Component mismatch: gross_earnings (${toNumber(
            item.gross_earnings,
            0
          )}) != earning components (${computedEarnings}).`
        );
      }
      if (!almostEqual(item.total_deductions, computedDeductions)) {
        errors.push(
          `Component mismatch: total_deductions (${toNumber(
            item.total_deductions,
            0
          )}) != deduction components (${computedDeductions}).`
        );
      }
      if (!almostEqual(item.employer_contributions, computedEmployer)) {
        warnings.push(
          `Component mismatch: employer contributions (${toNumber(
            item.employer_contributions,
            0
          )}) != employer component sum (${computedEmployer}).`
        );
      }
      if (!almostEqual(item.reimbursement_amount, computedReimbursement)) {
        warnings.push(
          `Component mismatch: reimbursement amount (${toNumber(
            item.reimbursement_amount,
            0
          )}) != reimbursement component sum (${computedReimbursement}).`
        );
      }
      if (!almostEqual(item.net_pay, expectedNet)) {
        errors.push(
          `Component mismatch: net_pay (${toNumber(item.net_pay, 0)}) != expected (${expectedNet}).`
        );
      }

      if (toNumber(item.net_pay, 0) < 0) {
        errors.push("Negative net pay computed for employee.");
      }

      const existingWarnings = toArray(item.warnings);
      const mergedWarnings = [...new Set([...existingWarnings, ...warnings])];
      const errorMessage = errors.length ? errors.join(" | ") : null;
      const status = errors.length ? "error" : "processed";

      await client.query(
        `
          UPDATE payroll_run_employees
          SET
            payroll_status = $2,
            warnings = $3::jsonb,
            error_message = $4,
            updated_by = $5
          WHERE id = $1
        `,
        [runEmployeeId, status, JSON.stringify(mergedWarnings), errorMessage, actorId]
      );

      totalErrors += errors.length;
      totalWarnings += mergedWarnings.length;
      results.push({
        payrollRunEmployeeId: runEmployeeId,
        employeeExternalId,
        errors,
        warnings: mergedWarnings
      });
    }

    const runStatus = totalErrors > 0 ? "validation_failed" : "ready_for_approval";
    const additionalMetadata = strictMode
      ? { validationMode: "strict" }
      : { validationMode: "standard" };

    await client.query(
      `
        UPDATE payroll_runs
        SET
          status = $2,
          error_count = $3,
          warning_count = $4,
          metadata = COALESCE(metadata, '{}'::jsonb) || $5::jsonb,
          updated_by = $6
        WHERE id = $1
      `,
      [
        runId,
        runStatus,
        totalErrors,
        totalWarnings,
        JSON.stringify(additionalMetadata),
        actorId
      ]
    );

    await client.query("COMMIT");
    return {
      runId,
      status: runStatus,
      strictMode,
      totals: {
        employeeCount: runEmployees.length,
        validationErrorCount: totalErrors,
        validationWarningCount: totalWarnings
      },
      results
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};
