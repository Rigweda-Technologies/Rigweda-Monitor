"use strict";

module.exports = {
  id: "0005",
  name: "payroll_run_lifecycle",
  up: [
    `
      CREATE TABLE IF NOT EXISTS payroll_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES payroll_tenants(id) ON DELETE CASCADE,
        pay_group_id UUID NOT NULL REFERENCES pay_groups(id) ON DELETE RESTRICT,
        pay_period_id UUID REFERENCES pay_periods(id) ON DELETE SET NULL,
        run_code VARCHAR(80) NOT NULL,
        run_name VARCHAR(140) NOT NULL,
        pay_month CHAR(7) NOT NULL CHECK (pay_month ~ '^[0-9]{4}-[0-9]{2}$'),
        run_type VARCHAR(20) NOT NULL DEFAULT 'regular'
          CHECK (run_type IN ('regular', 'off_cycle', 'final_settlement', 'supplementary')),
        status VARCHAR(25) NOT NULL DEFAULT 'draft'
          CHECK (status IN (
            'draft',
            'validating',
            'validation_failed',
            'ready_for_approval',
            'approved',
            'locked',
            'paid',
            'cancelled'
          )),
        attendance_snapshot_status VARCHAR(20) NOT NULL DEFAULT 'pending'
          CHECK (attendance_snapshot_status IN ('pending', 'fetched', 'stale')),
        employee_count INTEGER NOT NULL DEFAULT 0 CHECK (employee_count >= 0),
        processed_employee_count INTEGER NOT NULL DEFAULT 0 CHECK (processed_employee_count >= 0),
        warning_count INTEGER NOT NULL DEFAULT 0 CHECK (warning_count >= 0),
        error_count INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0),
        gross_total NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (gross_total >= 0),
        deduction_total NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (deduction_total >= 0),
        reimbursement_total NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (reimbursement_total >= 0),
        employer_contribution_total NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (employer_contribution_total >= 0),
        net_pay_total NUMERIC(16,2) NOT NULL DEFAULT 0,
        currency_code CHAR(3) NOT NULL DEFAULT 'INR',
        approved_by VARCHAR(64),
        approved_at TIMESTAMPTZ,
        locked_by VARCHAR(64),
        locked_at TIMESTAMPTZ,
        paid_by VARCHAR(64),
        paid_at TIMESTAMPTZ,
        idempotency_key VARCHAR(120),
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by VARCHAR(64),
        updated_by VARCHAR(64),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        CONSTRAINT uq_payroll_run_code UNIQUE (tenant_id, run_code),
        CONSTRAINT uq_payroll_run_month_group UNIQUE (tenant_id, pay_group_id, pay_month, run_type, version)
      );
    `,
    `
      CREATE TABLE IF NOT EXISTS payroll_run_employees (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES payroll_tenants(id) ON DELETE CASCADE,
        payroll_run_id UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
        employee_external_id VARCHAR(64) NOT NULL CHECK (employee_external_id ~ '^[a-fA-F0-9]{24}$'),
        employee_payroll_profile_id UUID REFERENCES employee_payroll_profiles(id) ON DELETE SET NULL,
        attendance_snapshot_id UUID REFERENCES payroll_attendance_snapshots(id) ON DELETE SET NULL,
        payroll_status VARCHAR(20) NOT NULL DEFAULT 'pending'
          CHECK (payroll_status IN ('pending', 'processed', 'error', 'held')),
        payable_days NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (payable_days >= 0),
        lop_days NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (lop_days >= 0),
        overtime_minutes INTEGER NOT NULL DEFAULT 0 CHECK (overtime_minutes >= 0),
        arrears_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        adjustment_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        reimbursement_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        loan_deduction_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        gross_earnings NUMERIC(14,2) NOT NULL DEFAULT 0,
        total_deductions NUMERIC(14,2) NOT NULL DEFAULT 0,
        employer_contributions NUMERIC(14,2) NOT NULL DEFAULT 0,
        taxable_income NUMERIC(14,2) NOT NULL DEFAULT 0,
        tds_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        net_pay NUMERIC(14,2) NOT NULL DEFAULT 0,
        currency_code CHAR(3) NOT NULL DEFAULT 'INR',
        error_message TEXT,
        warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by VARCHAR(64),
        updated_by VARCHAR(64),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        CONSTRAINT uq_payroll_run_employee UNIQUE (payroll_run_id, employee_external_id)
      );
    `,
    `
      CREATE TABLE IF NOT EXISTS payroll_run_components (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES payroll_tenants(id) ON DELETE CASCADE,
        payroll_run_id UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
        payroll_run_employee_id UUID NOT NULL REFERENCES payroll_run_employees(id) ON DELETE CASCADE,
        component_scope VARCHAR(30) NOT NULL
          CHECK (component_scope IN ('earning', 'deduction', 'employer_contribution', 'reimbursement', 'adjustment')),
        component_code VARCHAR(60) NOT NULL,
        component_name VARCHAR(140) NOT NULL,
        source_type VARCHAR(30) NOT NULL DEFAULT 'system'
          CHECK (source_type IN ('system', 'manual', 'arrear', 'loan', 'reimbursement')),
        calculation_mode VARCHAR(20) NOT NULL DEFAULT 'fixed'
          CHECK (calculation_mode IN ('fixed', 'percentage', 'formula', 'slab')),
        quantity NUMERIC(10,4),
        rate NUMERIC(14,6),
        amount NUMERIC(14,2) NOT NULL DEFAULT 0,
        taxable BOOLEAN NOT NULL DEFAULT TRUE,
        affects_net_pay BOOLEAN NOT NULL DEFAULT TRUE,
        formula_snapshot JSONB,
        remarks TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by VARCHAR(64),
        updated_by VARCHAR(64),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        CONSTRAINT uq_run_component_line UNIQUE (
          payroll_run_employee_id,
          component_scope,
          component_code,
          source_type
        )
      );
    `,
    `
      CREATE TABLE IF NOT EXISTS payroll_adjustments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES payroll_tenants(id) ON DELETE CASCADE,
        payroll_run_id UUID REFERENCES payroll_runs(id) ON DELETE SET NULL,
        payroll_run_employee_id UUID REFERENCES payroll_run_employees(id) ON DELETE SET NULL,
        employee_external_id VARCHAR(64) NOT NULL CHECK (employee_external_id ~ '^[a-fA-F0-9]{24}$'),
        adjustment_type VARCHAR(20) NOT NULL CHECK (adjustment_type IN ('earning', 'deduction')),
        adjustment_code VARCHAR(60) NOT NULL,
        description TEXT,
        amount NUMERIC(14,2) NOT NULL,
        taxable BOOLEAN NOT NULL DEFAULT TRUE,
        approval_status VARCHAR(20) NOT NULL DEFAULT 'approved'
          CHECK (approval_status IN ('pending', 'approved', 'rejected')),
        reference_document VARCHAR(255),
        effective_month CHAR(7) NOT NULL CHECK (effective_month ~ '^[0-9]{4}-[0-9]{2}$'),
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by VARCHAR(64),
        updated_by VARCHAR(64),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)
      );
    `,
    `
      CREATE TABLE IF NOT EXISTS payroll_arrears (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES payroll_tenants(id) ON DELETE CASCADE,
        payroll_run_id UUID REFERENCES payroll_runs(id) ON DELETE SET NULL,
        payroll_run_employee_id UUID REFERENCES payroll_run_employees(id) ON DELETE SET NULL,
        employee_external_id VARCHAR(64) NOT NULL CHECK (employee_external_id ~ '^[a-fA-F0-9]{24}$'),
        arrear_type VARCHAR(20) NOT NULL CHECK (arrear_type IN ('earning', 'deduction')),
        component_code VARCHAR(60) NOT NULL,
        previous_effective_month CHAR(7) NOT NULL CHECK (previous_effective_month ~ '^[0-9]{4}-[0-9]{2}$'),
        current_effective_month CHAR(7) NOT NULL CHECK (current_effective_month ~ '^[0-9]{4}-[0-9]{2}$'),
        difference_amount NUMERIC(14,2) NOT NULL,
        taxable BOOLEAN NOT NULL DEFAULT TRUE,
        status VARCHAR(20) NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'processed', 'cancelled')),
        remarks TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by VARCHAR(64),
        updated_by VARCHAR(64),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)
      );
    `,
    `
      CREATE TABLE IF NOT EXISTS payroll_loans (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES payroll_tenants(id) ON DELETE CASCADE,
        payroll_run_id UUID REFERENCES payroll_runs(id) ON DELETE SET NULL,
        payroll_run_employee_id UUID REFERENCES payroll_run_employees(id) ON DELETE SET NULL,
        employee_external_id VARCHAR(64) NOT NULL CHECK (employee_external_id ~ '^[a-fA-F0-9]{24}$'),
        loan_reference_no VARCHAR(80) NOT NULL,
        loan_type VARCHAR(40) NOT NULL DEFAULT 'general',
        principal_amount NUMERIC(14,2) NOT NULL CHECK (principal_amount >= 0),
        sanctioned_amount NUMERIC(14,2) NOT NULL CHECK (sanctioned_amount >= 0),
        disbursed_amount NUMERIC(14,2) NOT NULL CHECK (disbursed_amount >= 0),
        installment_amount NUMERIC(14,2) NOT NULL CHECK (installment_amount >= 0),
        total_installments INTEGER NOT NULL CHECK (total_installments > 0),
        current_installment_no INTEGER NOT NULL DEFAULT 0 CHECK (current_installment_no >= 0),
        deducted_amount_this_run NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (deducted_amount_this_run >= 0),
        outstanding_amount NUMERIC(14,2) NOT NULL CHECK (outstanding_amount >= 0),
        loan_status VARCHAR(20) NOT NULL DEFAULT 'active'
          CHECK (loan_status IN ('active', 'closed', 'hold')),
        start_month CHAR(7) NOT NULL CHECK (start_month ~ '^[0-9]{4}-[0-9]{2}$'),
        end_month CHAR(7),
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by VARCHAR(64),
        updated_by VARCHAR(64),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        CONSTRAINT uq_payroll_loan_ref UNIQUE (tenant_id, loan_reference_no)
      );
    `,
    `
      CREATE TABLE IF NOT EXISTS payroll_reimbursements (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES payroll_tenants(id) ON DELETE CASCADE,
        payroll_run_id UUID REFERENCES payroll_runs(id) ON DELETE SET NULL,
        payroll_run_employee_id UUID REFERENCES payroll_run_employees(id) ON DELETE SET NULL,
        employee_external_id VARCHAR(64) NOT NULL CHECK (employee_external_id ~ '^[a-fA-F0-9]{24}$'),
        claim_reference_no VARCHAR(80) NOT NULL,
        reimbursement_code VARCHAR(60) NOT NULL,
        description TEXT,
        claim_amount NUMERIC(14,2) NOT NULL CHECK (claim_amount >= 0),
        approved_amount NUMERIC(14,2) NOT NULL CHECK (approved_amount >= 0),
        taxable BOOLEAN NOT NULL DEFAULT FALSE,
        payout_status VARCHAR(20) NOT NULL DEFAULT 'approved'
          CHECK (payout_status IN ('submitted', 'approved', 'rejected', 'paid')),
        approved_by VARCHAR(64),
        approved_at TIMESTAMPTZ,
        bill_date DATE,
        effective_month CHAR(7) NOT NULL CHECK (effective_month ~ '^[0-9]{4}-[0-9]{2}$'),
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by VARCHAR(64),
        updated_by VARCHAR(64),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        CONSTRAINT uq_reimbursement_claim UNIQUE (tenant_id, claim_reference_no)
      );
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_payroll_runs_tenant_month_status
        ON payroll_runs (tenant_id, pay_month, status);
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_payroll_runs_group_month
        ON payroll_runs (pay_group_id, pay_month);
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_payroll_run_employees_run_status
        ON payroll_run_employees (payroll_run_id, payroll_status);
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_payroll_run_employees_employee
        ON payroll_run_employees (tenant_id, employee_external_id);
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_payroll_run_components_run_employee
        ON payroll_run_components (payroll_run_employee_id, component_scope);
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_payroll_adjustments_employee_month
        ON payroll_adjustments (tenant_id, employee_external_id, effective_month);
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_payroll_arrears_employee_month
        ON payroll_arrears (tenant_id, employee_external_id, current_effective_month);
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_payroll_loans_employee_status
        ON payroll_loans (tenant_id, employee_external_id, loan_status);
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_payroll_reimbursements_employee_month
        ON payroll_reimbursements (tenant_id, employee_external_id, effective_month);
    `,
    `
      CREATE TRIGGER trg_payroll_runs_updated_at
      BEFORE UPDATE ON payroll_runs
      FOR EACH ROW
      EXECUTE FUNCTION set_row_updated_at();
    `,
    `
      CREATE TRIGGER trg_payroll_run_employees_updated_at
      BEFORE UPDATE ON payroll_run_employees
      FOR EACH ROW
      EXECUTE FUNCTION set_row_updated_at();
    `,
    `
      CREATE TRIGGER trg_payroll_run_components_updated_at
      BEFORE UPDATE ON payroll_run_components
      FOR EACH ROW
      EXECUTE FUNCTION set_row_updated_at();
    `,
    `
      CREATE TRIGGER trg_payroll_adjustments_updated_at
      BEFORE UPDATE ON payroll_adjustments
      FOR EACH ROW
      EXECUTE FUNCTION set_row_updated_at();
    `,
    `
      CREATE TRIGGER trg_payroll_arrears_updated_at
      BEFORE UPDATE ON payroll_arrears
      FOR EACH ROW
      EXECUTE FUNCTION set_row_updated_at();
    `,
    `
      CREATE TRIGGER trg_payroll_loans_updated_at
      BEFORE UPDATE ON payroll_loans
      FOR EACH ROW
      EXECUTE FUNCTION set_row_updated_at();
    `,
    `
      CREATE TRIGGER trg_payroll_reimbursements_updated_at
      BEFORE UPDATE ON payroll_reimbursements
      FOR EACH ROW
      EXECUTE FUNCTION set_row_updated_at();
    `
  ],
  down: [
    `
      DROP TRIGGER IF EXISTS trg_payroll_reimbursements_updated_at ON payroll_reimbursements;
    `,
    `
      DROP TRIGGER IF EXISTS trg_payroll_loans_updated_at ON payroll_loans;
    `,
    `
      DROP TRIGGER IF EXISTS trg_payroll_arrears_updated_at ON payroll_arrears;
    `,
    `
      DROP TRIGGER IF EXISTS trg_payroll_adjustments_updated_at ON payroll_adjustments;
    `,
    `
      DROP TRIGGER IF EXISTS trg_payroll_run_components_updated_at ON payroll_run_components;
    `,
    `
      DROP TRIGGER IF EXISTS trg_payroll_run_employees_updated_at ON payroll_run_employees;
    `,
    `
      DROP TRIGGER IF EXISTS trg_payroll_runs_updated_at ON payroll_runs;
    `,
    `
      DROP TABLE IF EXISTS payroll_reimbursements;
    `,
    `
      DROP TABLE IF EXISTS payroll_loans;
    `,
    `
      DROP TABLE IF EXISTS payroll_arrears;
    `,
    `
      DROP TABLE IF EXISTS payroll_adjustments;
    `,
    `
      DROP TABLE IF EXISTS payroll_run_components;
    `,
    `
      DROP TABLE IF EXISTS payroll_run_employees;
    `,
    `
      DROP TABLE IF EXISTS payroll_runs;
    `
  ]
};
