"use strict";

module.exports = {
  id: "0004",
  name: "attendance_snapshots",
  up: [
    `
      CREATE TABLE IF NOT EXISTS payroll_attendance_snapshots (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES payroll_tenants(id) ON DELETE CASCADE,
        pay_month CHAR(7) NOT NULL CHECK (pay_month ~ '^[0-9]{4}-[0-9]{2}$'),
        organization_external_id VARCHAR(64) NOT NULL,
        employee_external_id VARCHAR(64) NOT NULL CHECK (employee_external_id ~ '^[a-fA-F0-9]{24}$'),
        employee_payroll_profile_id UUID REFERENCES employee_payroll_profiles(id) ON DELETE SET NULL,
        timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
        calendar_days SMALLINT NOT NULL DEFAULT 0 CHECK (calendar_days >= 0),
        working_days NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (working_days >= 0),
        present_days NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (present_days >= 0),
        half_days NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (half_days >= 0),
        absent_days NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (absent_days >= 0),
        paid_leave_days NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (paid_leave_days >= 0),
        unpaid_leave_days NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (unpaid_leave_days >= 0),
        week_off_days NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (week_off_days >= 0),
        holiday_days NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (holiday_days >= 0),
        lop_days NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (lop_days >= 0),
        payable_days NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (payable_days >= 0),
        overtime_minutes INTEGER NOT NULL DEFAULT 0 CHECK (overtime_minutes >= 0),
        late_by_minutes INTEGER NOT NULL DEFAULT 0 CHECK (late_by_minutes >= 0),
        early_checkout_minutes INTEGER NOT NULL DEFAULT 0 CHECK (early_checkout_minutes >= 0),
        attendance_minutes INTEGER NOT NULL DEFAULT 0 CHECK (attendance_minutes >= 0),
        min_work_minutes INTEGER NOT NULL DEFAULT 480 CHECK (min_work_minutes >= 0),
        min_half_day_minutes INTEGER NOT NULL DEFAULT 240 CHECK (min_half_day_minutes >= 0),
        source_hash VARCHAR(128),
        generation_status VARCHAR(20) NOT NULL DEFAULT 'generated'
          CHECK (generation_status IN ('generated', 'recomputed', 'locked')),
        generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by VARCHAR(64),
        updated_by VARCHAR(64),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        CONSTRAINT uq_payroll_attendance_snapshot UNIQUE (tenant_id, pay_month, employee_external_id)
      );
    `,
    `
      CREATE TABLE IF NOT EXISTS payroll_attendance_snapshot_days (
        id BIGSERIAL PRIMARY KEY,
        snapshot_id UUID NOT NULL REFERENCES payroll_attendance_snapshots(id) ON DELETE CASCADE,
        tenant_id UUID NOT NULL REFERENCES payroll_tenants(id) ON DELETE CASCADE,
        employee_external_id VARCHAR(64) NOT NULL CHECK (employee_external_id ~ '^[a-fA-F0-9]{24}$'),
        day_date DATE NOT NULL,
        day_key CHAR(10) NOT NULL CHECK (day_key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
        day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
        day_status VARCHAR(30) NOT NULL CHECK (
          day_status IN (
            'present',
            'half_day',
            'absent',
            'paid_leave',
            'paid_leave_half',
            'unpaid_leave',
            'unpaid_leave_half',
            'week_off',
            'week_off_worked',
            'holiday',
            'holiday_worked'
          )
        ),
        payable_units NUMERIC(4,2) NOT NULL DEFAULT 0 CHECK (payable_units >= 0),
        lop_units NUMERIC(4,2) NOT NULL DEFAULT 0 CHECK (lop_units >= 0),
        attendance_minutes INTEGER NOT NULL DEFAULT 0 CHECK (attendance_minutes >= 0),
        overtime_minutes INTEGER NOT NULL DEFAULT 0 CHECK (overtime_minutes >= 0),
        late_by_minutes INTEGER NOT NULL DEFAULT 0 CHECK (late_by_minutes >= 0),
        early_checkout_minutes INTEGER NOT NULL DEFAULT 0 CHECK (early_checkout_minutes >= 0),
        attendance_id VARCHAR(64),
        leave_id VARCHAR(64),
        holiday_id VARCHAR(64),
        week_off_applied BOOLEAN NOT NULL DEFAULT FALSE,
        is_holiday BOOLEAN NOT NULL DEFAULT FALSE,
        is_leave BOOLEAN NOT NULL DEFAULT FALSE,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by VARCHAR(64),
        updated_by VARCHAR(64),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        CONSTRAINT uq_snapshot_day UNIQUE (snapshot_id, day_key)
      );
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_payroll_attendance_snapshots_tenant_month
        ON payroll_attendance_snapshots (tenant_id, pay_month);
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_payroll_attendance_snapshots_employee
        ON payroll_attendance_snapshots (tenant_id, employee_external_id, pay_month);
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_payroll_attendance_snapshot_days_lookup
        ON payroll_attendance_snapshot_days (tenant_id, employee_external_id, day_date);
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_payroll_attendance_snapshot_days_status
        ON payroll_attendance_snapshot_days (snapshot_id, day_status);
    `,
    `
      CREATE TRIGGER trg_payroll_attendance_snapshots_updated_at
      BEFORE UPDATE ON payroll_attendance_snapshots
      FOR EACH ROW
      EXECUTE FUNCTION set_row_updated_at();
    `,
    `
      CREATE TRIGGER trg_payroll_attendance_snapshot_days_updated_at
      BEFORE UPDATE ON payroll_attendance_snapshot_days
      FOR EACH ROW
      EXECUTE FUNCTION set_row_updated_at();
    `
  ],
  down: [
    `
      DROP TRIGGER IF EXISTS trg_payroll_attendance_snapshot_days_updated_at ON payroll_attendance_snapshot_days;
    `,
    `
      DROP TRIGGER IF EXISTS trg_payroll_attendance_snapshots_updated_at ON payroll_attendance_snapshots;
    `,
    `
      DROP TABLE IF EXISTS payroll_attendance_snapshot_days;
    `,
    `
      DROP TABLE IF EXISTS payroll_attendance_snapshots;
    `
  ]
};
