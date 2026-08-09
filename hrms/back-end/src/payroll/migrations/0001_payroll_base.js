"use strict";

module.exports = {
  id: "0001",
  name: "payroll_base",
  up: [
    `
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
    `,
    `
      CREATE OR REPLACE FUNCTION set_row_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `,
    `
      CREATE TABLE IF NOT EXISTS payroll_tenants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id VARCHAR(64) NOT NULL UNIQUE,
        legal_name VARCHAR(200) NOT NULL,
        trade_name VARCHAR(200),
        country_code CHAR(2) NOT NULL DEFAULT 'IN' CHECK (country_code = 'IN'),
        state_code CHAR(2) NOT NULL DEFAULT 'TS',
        timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
        currency_code CHAR(3) NOT NULL DEFAULT 'INR' CHECK (currency_code = 'INR'),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by VARCHAR(64),
        updated_by VARCHAR(64),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)
      );
    `,
    `
      CREATE TABLE IF NOT EXISTS pay_groups (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES payroll_tenants(id) ON DELETE CASCADE,
        code VARCHAR(50) NOT NULL,
        name VARCHAR(120) NOT NULL,
        description TEXT,
        pay_frequency VARCHAR(20) NOT NULL CHECK (pay_frequency IN ('monthly', 'semi_monthly', 'weekly')),
        cutoff_day SMALLINT CHECK (cutoff_day BETWEEN 1 AND 31),
        salary_pay_day SMALLINT NOT NULL CHECK (salary_pay_day BETWEEN 1 AND 31),
        work_week_days SMALLINT NOT NULL DEFAULT 6 CHECK (work_week_days BETWEEN 1 AND 7),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by VARCHAR(64),
        updated_by VARCHAR(64),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        CONSTRAINT uq_pay_groups_tenant_code UNIQUE (tenant_id, code),
        CONSTRAINT uq_pay_groups_tenant_name UNIQUE (tenant_id, name)
      );
    `,
    `
      CREATE TABLE IF NOT EXISTS pay_periods (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES payroll_tenants(id) ON DELETE CASCADE,
        pay_group_id UUID NOT NULL REFERENCES pay_groups(id) ON DELETE CASCADE,
        period_label VARCHAR(32) NOT NULL,
        period_start DATE NOT NULL,
        period_end DATE NOT NULL,
        attendance_cutoff_date DATE NOT NULL,
        pay_date DATE NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'draft'
          CHECK (status IN ('draft', 'open', 'processing', 'approved', 'locked', 'paid', 'cancelled')),
        locked_at TIMESTAMPTZ,
        locked_by VARCHAR(64),
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by VARCHAR(64),
        updated_by VARCHAR(64),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        CONSTRAINT chk_pay_period_dates CHECK (period_end >= period_start),
        CONSTRAINT chk_pay_period_cutoff CHECK (attendance_cutoff_date >= period_start AND attendance_cutoff_date <= period_end),
        CONSTRAINT chk_pay_period_pay_date CHECK (pay_date >= attendance_cutoff_date),
        CONSTRAINT uq_pay_period UNIQUE (pay_group_id, period_start, period_end)
      );
    `,
    `
      CREATE TABLE IF NOT EXISTS payroll_settings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL UNIQUE REFERENCES payroll_tenants(id) ON DELETE CASCADE,
        default_pay_group_id UUID REFERENCES pay_groups(id) ON DELETE SET NULL,
        country_code CHAR(2) NOT NULL DEFAULT 'IN' CHECK (country_code = 'IN'),
        state_code CHAR(2) NOT NULL DEFAULT 'TS',
        attendance_source VARCHAR(40) NOT NULL DEFAULT 'mongo_timesheet',
        attendance_lock_mode VARCHAR(20) NOT NULL DEFAULT 'payroll_cutoff'
          CHECK (attendance_lock_mode IN ('days_window', 'payroll_cutoff')),
        attendance_lock_after_days SMALLINT NOT NULL DEFAULT 7 CHECK (attendance_lock_after_days >= 0),
        rounding_policy VARCHAR(20) NOT NULL DEFAULT 'nearest_rupee'
          CHECK (rounding_policy IN ('nearest_rupee', 'floor_rupee', 'exact')),
        default_working_days SMALLINT NOT NULL DEFAULT 30 CHECK (default_working_days BETWEEN 1 AND 31),
        lop_calculation_method VARCHAR(20) NOT NULL DEFAULT 'calendar_days'
          CHECK (lop_calculation_method IN ('calendar_days', 'working_days')),
        enable_proration BOOLEAN NOT NULL DEFAULT TRUE,
        enable_arrears BOOLEAN NOT NULL DEFAULT TRUE,
        enable_reimbursements BOOLEAN NOT NULL DEFAULT TRUE,
        enable_loan_deductions BOOLEAN NOT NULL DEFAULT TRUE,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by VARCHAR(64),
        updated_by VARCHAR(64),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)
      );
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_payroll_tenants_is_active
        ON payroll_tenants (is_active);
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_pay_groups_tenant_active
        ON pay_groups (tenant_id, is_active);
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_pay_periods_tenant_status
        ON pay_periods (tenant_id, status);
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_pay_periods_group_status
        ON pay_periods (pay_group_id, status);
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_pay_periods_group_dates
        ON pay_periods (pay_group_id, period_start, period_end);
    `,
    `
      CREATE TRIGGER trg_payroll_tenants_updated_at
      BEFORE UPDATE ON payroll_tenants
      FOR EACH ROW
      EXECUTE FUNCTION set_row_updated_at();
    `,
    `
      CREATE TRIGGER trg_pay_groups_updated_at
      BEFORE UPDATE ON pay_groups
      FOR EACH ROW
      EXECUTE FUNCTION set_row_updated_at();
    `,
    `
      CREATE TRIGGER trg_pay_periods_updated_at
      BEFORE UPDATE ON pay_periods
      FOR EACH ROW
      EXECUTE FUNCTION set_row_updated_at();
    `,
    `
      CREATE TRIGGER trg_payroll_settings_updated_at
      BEFORE UPDATE ON payroll_settings
      FOR EACH ROW
      EXECUTE FUNCTION set_row_updated_at();
    `
  ],
  down: [
    `
      DROP TRIGGER IF EXISTS trg_payroll_settings_updated_at ON payroll_settings;
    `,
    `
      DROP TRIGGER IF EXISTS trg_pay_periods_updated_at ON pay_periods;
    `,
    `
      DROP TRIGGER IF EXISTS trg_pay_groups_updated_at ON pay_groups;
    `,
    `
      DROP TRIGGER IF EXISTS trg_payroll_tenants_updated_at ON payroll_tenants;
    `,
    `
      DROP TABLE IF EXISTS payroll_settings;
    `,
    `
      DROP TABLE IF EXISTS pay_periods;
    `,
    `
      DROP TABLE IF EXISTS pay_groups;
    `,
    `
      DROP TABLE IF EXISTS payroll_tenants;
    `,
    `
      DROP FUNCTION IF EXISTS set_row_updated_at;
    `
  ]
};
