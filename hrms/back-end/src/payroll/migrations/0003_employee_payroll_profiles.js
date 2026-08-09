"use strict";

module.exports = {
  id: "0003",
  name: "employee_payroll_profiles",
  up: [
    `
      CREATE EXTENSION IF NOT EXISTS btree_gist;
    `,
    `
      CREATE TABLE IF NOT EXISTS employee_payroll_profiles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES payroll_tenants(id) ON DELETE CASCADE,
        employee_external_id VARCHAR(64) NOT NULL,
        employee_code VARCHAR(64),
        pay_group_id UUID REFERENCES pay_groups(id) ON DELETE SET NULL,
        payroll_status VARCHAR(20) NOT NULL DEFAULT 'active'
          CHECK (payroll_status IN ('active', 'on_hold', 'exited')),
        default_payment_mode VARCHAR(20) NOT NULL DEFAULT 'bank_transfer'
          CHECK (default_payment_mode IN ('bank_transfer', 'cash', 'cheque', 'upi')),
        tax_regime VARCHAR(10) NOT NULL DEFAULT 'new'
          CHECK (tax_regime IN ('old', 'new')),
        date_of_joining DATE,
        date_of_exit DATE,
        cost_center_code VARCHAR(60),
        location_code VARCHAR(60),
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by VARCHAR(64),
        updated_by VARCHAR(64),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        CONSTRAINT chk_employee_external_id_objectid CHECK (
          employee_external_id ~ '^[a-fA-F0-9]{24}$'
        ),
        CONSTRAINT chk_profile_dates CHECK (
          date_of_exit IS NULL OR date_of_joining IS NULL OR date_of_exit >= date_of_joining
        ),
        CONSTRAINT uq_employee_profile_external UNIQUE (tenant_id, employee_external_id)
      );
    `,
    `
      CREATE TABLE IF NOT EXISTS employee_salary_structures (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES payroll_tenants(id) ON DELETE CASCADE,
        employee_payroll_profile_id UUID NOT NULL REFERENCES employee_payroll_profiles(id) ON DELETE CASCADE,
        structure_code VARCHAR(60) NOT NULL,
        structure_name VARCHAR(120) NOT NULL,
        annual_ctc NUMERIC(14,2) NOT NULL CHECK (annual_ctc >= 0),
        monthly_gross NUMERIC(14,2) CHECK (monthly_gross IS NULL OR monthly_gross >= 0),
        basic_pay NUMERIC(14,2) CHECK (basic_pay IS NULL OR basic_pay >= 0),
        variable_pay NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (variable_pay >= 0),
        is_current BOOLEAN NOT NULL DEFAULT TRUE,
        revision_reason TEXT,
        approved_by VARCHAR(64),
        approved_at TIMESTAMPTZ,
        effective_from DATE NOT NULL,
        effective_to DATE,
        version_no INTEGER NOT NULL DEFAULT 1 CHECK (version_no > 0),
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by VARCHAR(64),
        updated_by VARCHAR(64),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        CONSTRAINT chk_salary_structure_effective_range CHECK (
          effective_to IS NULL OR effective_to >= effective_from
        ),
        CONSTRAINT uq_employee_salary_structure_version UNIQUE (
          employee_payroll_profile_id,
          version_no
        ),
        CONSTRAINT uq_employee_salary_structure_effective_start UNIQUE (
          employee_payroll_profile_id,
          effective_from
        )
      );
    `,
    `
      CREATE TABLE IF NOT EXISTS employee_bank_details (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES payroll_tenants(id) ON DELETE CASCADE,
        employee_payroll_profile_id UUID NOT NULL REFERENCES employee_payroll_profiles(id) ON DELETE CASCADE,
        account_holder_name VARCHAR(140),
        bank_name VARCHAR(140),
        branch_name VARCHAR(140),
        account_number VARCHAR(64),
        ifsc_code VARCHAR(11),
        account_type VARCHAR(20) DEFAULT 'savings'
          CHECK (account_type IN ('savings', 'current', 'salary', 'other')),
        payment_mode VARCHAR(20) NOT NULL DEFAULT 'bank_transfer'
          CHECK (payment_mode IN ('bank_transfer', 'cash', 'cheque', 'upi')),
        upi_id VARCHAR(120),
        is_primary BOOLEAN NOT NULL DEFAULT TRUE,
        is_verified BOOLEAN NOT NULL DEFAULT FALSE,
        verified_by VARCHAR(64),
        verified_at TIMESTAMPTZ,
        effective_from DATE NOT NULL,
        effective_to DATE,
        version_no INTEGER NOT NULL DEFAULT 1 CHECK (version_no > 0),
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by VARCHAR(64),
        updated_by VARCHAR(64),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        CONSTRAINT chk_bank_effective_range CHECK (
          effective_to IS NULL OR effective_to >= effective_from
        ),
        CONSTRAINT chk_bank_ifsc CHECK (
          ifsc_code IS NULL OR ifsc_code ~ '^[A-Z]{4}0[A-Z0-9]{6}$'
        ),
        CONSTRAINT chk_bank_account_required_for_transfer CHECK (
          payment_mode <> 'bank_transfer' OR
          (
            account_holder_name IS NOT NULL AND
            bank_name IS NOT NULL AND
            account_number IS NOT NULL AND
            ifsc_code IS NOT NULL
          )
        ),
        CONSTRAINT chk_upi_required_when_upi_mode CHECK (
          payment_mode <> 'upi' OR upi_id IS NOT NULL
        ),
        CONSTRAINT uq_employee_bank_version UNIQUE (
          employee_payroll_profile_id,
          version_no
        ),
        CONSTRAINT uq_employee_bank_effective_start UNIQUE (
          employee_payroll_profile_id,
          effective_from
        )
      );
    `,
    `
      CREATE TABLE IF NOT EXISTS employee_statutory_details (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES payroll_tenants(id) ON DELETE CASCADE,
        employee_payroll_profile_id UUID NOT NULL REFERENCES employee_payroll_profiles(id) ON DELETE CASCADE,
        pan VARCHAR(10),
        aadhaar VARCHAR(12),
        uan VARCHAR(12),
        esic_number VARCHAR(20),
        pf_member BOOLEAN NOT NULL DEFAULT TRUE,
        eps_eligible BOOLEAN NOT NULL DEFAULT TRUE,
        esi_eligible BOOLEAN NOT NULL DEFAULT FALSE,
        professional_tax_applicable BOOLEAN NOT NULL DEFAULT TRUE,
        lwf_applicable BOOLEAN NOT NULL DEFAULT FALSE,
        tax_regime VARCHAR(10) NOT NULL DEFAULT 'new'
          CHECK (tax_regime IN ('old', 'new')),
        declaration_submitted BOOLEAN NOT NULL DEFAULT FALSE,
        declaration_submitted_at TIMESTAMPTZ,
        effective_from DATE NOT NULL,
        effective_to DATE,
        version_no INTEGER NOT NULL DEFAULT 1 CHECK (version_no > 0),
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by VARCHAR(64),
        updated_by VARCHAR(64),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        CONSTRAINT chk_statutory_effective_range CHECK (
          effective_to IS NULL OR effective_to >= effective_from
        ),
        CONSTRAINT chk_pan_format CHECK (
          pan IS NULL OR pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]{1}$'
        ),
        CONSTRAINT chk_aadhaar_format CHECK (
          aadhaar IS NULL OR aadhaar ~ '^[0-9]{12}$'
        ),
        CONSTRAINT chk_uan_format CHECK (
          uan IS NULL OR uan ~ '^[0-9]{12}$'
        ),
        CONSTRAINT uq_employee_statutory_version UNIQUE (
          employee_payroll_profile_id,
          version_no
        ),
        CONSTRAINT uq_employee_statutory_effective_start UNIQUE (
          employee_payroll_profile_id,
          effective_from
        )
      );
    `,
    `
      CREATE TABLE IF NOT EXISTS employee_payroll_revision_history (
        id BIGSERIAL PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES payroll_tenants(id) ON DELETE CASCADE,
        employee_payroll_profile_id UUID NOT NULL REFERENCES employee_payroll_profiles(id) ON DELETE CASCADE,
        entity_type VARCHAR(40) NOT NULL
          CHECK (entity_type IN (
            'employee_payroll_profile',
            'employee_salary_structure',
            'employee_bank_detail',
            'employee_statutory_detail'
          )),
        entity_id UUID NOT NULL,
        revision_type VARCHAR(30) NOT NULL
          CHECK (revision_type IN (
            'create',
            'update',
            'delete',
            'approval',
            'effective_change',
            'system_sync'
          )),
        revision_no INTEGER NOT NULL DEFAULT 1 CHECK (revision_no > 0),
        change_summary TEXT,
        before_data JSONB,
        after_data JSONB,
        changed_by VARCHAR(64),
        changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        source_module VARCHAR(40) NOT NULL DEFAULT 'payroll',
        request_id VARCHAR(80),
        ip_address INET,
        user_agent TEXT
      );
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_emp_payroll_profiles_tenant_status
        ON employee_payroll_profiles (tenant_id, payroll_status);
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_emp_payroll_profiles_group
        ON employee_payroll_profiles (tenant_id, pay_group_id);
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_emp_salary_structures_active
        ON employee_salary_structures (tenant_id, employee_payroll_profile_id, is_current);
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_emp_salary_structures_effective
        ON employee_salary_structures (
          employee_payroll_profile_id,
          effective_from,
          COALESCE(effective_to, '9999-12-31'::date)
        );
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_emp_bank_details_primary
        ON employee_bank_details (tenant_id, employee_payroll_profile_id, is_primary);
    `,
    `
      CREATE UNIQUE INDEX IF NOT EXISTS uq_emp_bank_primary_current
        ON employee_bank_details (employee_payroll_profile_id)
        WHERE is_primary = TRUE AND effective_to IS NULL;
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_emp_bank_effective
        ON employee_bank_details (
          employee_payroll_profile_id,
          effective_from,
          COALESCE(effective_to, '9999-12-31'::date)
        );
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_emp_statutory_effective
        ON employee_statutory_details (
          employee_payroll_profile_id,
          effective_from,
          COALESCE(effective_to, '9999-12-31'::date)
        );
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_emp_revision_history_profile_changed_at
        ON employee_payroll_revision_history (employee_payroll_profile_id, changed_at DESC);
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_emp_revision_history_entity
        ON employee_payroll_revision_history (entity_type, entity_id, changed_at DESC);
    `,
    `
      ALTER TABLE employee_salary_structures
      ADD CONSTRAINT ex_employee_salary_structure_no_overlap
      EXCLUDE USING gist (
        employee_payroll_profile_id WITH =,
        daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]') WITH &&
      );
    `,
    `
      ALTER TABLE employee_bank_details
      ADD CONSTRAINT ex_employee_bank_detail_no_overlap
      EXCLUDE USING gist (
        employee_payroll_profile_id WITH =,
        is_primary WITH =,
        daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]') WITH &&
      ) WHERE (is_primary = TRUE);
    `,
    `
      ALTER TABLE employee_statutory_details
      ADD CONSTRAINT ex_employee_statutory_no_overlap
      EXCLUDE USING gist (
        employee_payroll_profile_id WITH =,
        daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]') WITH &&
      );
    `,
    `
      CREATE TRIGGER trg_employee_payroll_profiles_updated_at
      BEFORE UPDATE ON employee_payroll_profiles
      FOR EACH ROW
      EXECUTE FUNCTION set_row_updated_at();
    `,
    `
      CREATE TRIGGER trg_employee_salary_structures_updated_at
      BEFORE UPDATE ON employee_salary_structures
      FOR EACH ROW
      EXECUTE FUNCTION set_row_updated_at();
    `,
    `
      CREATE TRIGGER trg_employee_bank_details_updated_at
      BEFORE UPDATE ON employee_bank_details
      FOR EACH ROW
      EXECUTE FUNCTION set_row_updated_at();
    `,
    `
      CREATE TRIGGER trg_employee_statutory_details_updated_at
      BEFORE UPDATE ON employee_statutory_details
      FOR EACH ROW
      EXECUTE FUNCTION set_row_updated_at();
    `
  ],
  down: [
    `
      DROP TRIGGER IF EXISTS trg_employee_statutory_details_updated_at ON employee_statutory_details;
    `,
    `
      DROP TRIGGER IF EXISTS trg_employee_bank_details_updated_at ON employee_bank_details;
    `,
    `
      DROP TRIGGER IF EXISTS trg_employee_salary_structures_updated_at ON employee_salary_structures;
    `,
    `
      DROP TRIGGER IF EXISTS trg_employee_payroll_profiles_updated_at ON employee_payroll_profiles;
    `,
    `
      DROP TABLE IF EXISTS employee_payroll_revision_history;
    `,
    `
      DROP TABLE IF EXISTS employee_statutory_details;
    `,
    `
      DROP TABLE IF EXISTS employee_bank_details;
    `,
    `
      DROP TABLE IF EXISTS employee_salary_structures;
    `,
    `
      DROP TABLE IF EXISTS employee_payroll_profiles;
    `
  ]
};
