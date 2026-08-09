"use strict";

module.exports = {
  id: "0002",
  name: "salary_components_master",
  up: [
    `
      CREATE EXTENSION IF NOT EXISTS btree_gist;
    `,
    `
      CREATE TABLE IF NOT EXISTS earning_components (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES payroll_tenants(id) ON DELETE CASCADE,
        code VARCHAR(60) NOT NULL,
        name VARCHAR(120) NOT NULL,
        display_name VARCHAR(120),
        description TEXT,
        category VARCHAR(30) NOT NULL DEFAULT 'earning'
          CHECK (category IN ('earning', 'allowance', 'reimbursement')),
        taxable BOOLEAN NOT NULL DEFAULT TRUE,
        pf_applicable BOOLEAN NOT NULL DEFAULT FALSE,
        esi_applicable BOOLEAN NOT NULL DEFAULT FALSE,
        prorate_with_attendance BOOLEAN NOT NULL DEFAULT TRUE,
        calculation_mode VARCHAR(20) NOT NULL DEFAULT 'fixed'
          CHECK (calculation_mode IN ('fixed', 'percentage', 'formula')),
        rounding_policy VARCHAR(20) NOT NULL DEFAULT 'nearest_rupee'
          CHECK (rounding_policy IN ('nearest_rupee', 'floor_rupee', 'exact')),
        priority SMALLINT NOT NULL DEFAULT 100,
        effective_from DATE NOT NULL,
        effective_to DATE,
        version_no INTEGER NOT NULL DEFAULT 1 CHECK (version_no > 0),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by VARCHAR(64),
        updated_by VARCHAR(64),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        CONSTRAINT chk_earning_effective_range CHECK (
          effective_to IS NULL OR effective_to >= effective_from
        ),
        CONSTRAINT uq_earning_component_version UNIQUE (tenant_id, code, version_no),
        CONSTRAINT uq_earning_component_effective_start UNIQUE (tenant_id, code, effective_from)
      );
    `,
    `
      CREATE TABLE IF NOT EXISTS deduction_components (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES payroll_tenants(id) ON DELETE CASCADE,
        code VARCHAR(60) NOT NULL,
        name VARCHAR(120) NOT NULL,
        display_name VARCHAR(120),
        description TEXT,
        category VARCHAR(30) NOT NULL DEFAULT 'deduction'
          CHECK (category IN ('deduction', 'tax', 'loan', 'recovery')),
        is_statutory BOOLEAN NOT NULL DEFAULT FALSE,
        taxable BOOLEAN NOT NULL DEFAULT FALSE,
        employee_share_only BOOLEAN NOT NULL DEFAULT TRUE,
        calculation_mode VARCHAR(20) NOT NULL DEFAULT 'fixed'
          CHECK (calculation_mode IN ('fixed', 'percentage', 'formula', 'slab')),
        rounding_policy VARCHAR(20) NOT NULL DEFAULT 'nearest_rupee'
          CHECK (rounding_policy IN ('nearest_rupee', 'floor_rupee', 'exact')),
        cap_amount NUMERIC(14,2),
        priority SMALLINT NOT NULL DEFAULT 100,
        effective_from DATE NOT NULL,
        effective_to DATE,
        version_no INTEGER NOT NULL DEFAULT 1 CHECK (version_no > 0),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by VARCHAR(64),
        updated_by VARCHAR(64),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        CONSTRAINT chk_deduction_cap_amount CHECK (cap_amount IS NULL OR cap_amount >= 0),
        CONSTRAINT chk_deduction_effective_range CHECK (
          effective_to IS NULL OR effective_to >= effective_from
        ),
        CONSTRAINT uq_deduction_component_version UNIQUE (tenant_id, code, version_no),
        CONSTRAINT uq_deduction_component_effective_start UNIQUE (tenant_id, code, effective_from)
      );
    `,
    `
      CREATE TABLE IF NOT EXISTS employer_contribution_components (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES payroll_tenants(id) ON DELETE CASCADE,
        code VARCHAR(60) NOT NULL,
        name VARCHAR(120) NOT NULL,
        display_name VARCHAR(120),
        description TEXT,
        category VARCHAR(30) NOT NULL DEFAULT 'employer_contribution'
          CHECK (category IN ('employer_contribution', 'benefit', 'insurance')),
        linked_deduction_code VARCHAR(60),
        contributes_to_ctc BOOLEAN NOT NULL DEFAULT TRUE,
        calculation_mode VARCHAR(20) NOT NULL DEFAULT 'percentage'
          CHECK (calculation_mode IN ('fixed', 'percentage', 'formula', 'slab')),
        rounding_policy VARCHAR(20) NOT NULL DEFAULT 'nearest_rupee'
          CHECK (rounding_policy IN ('nearest_rupee', 'floor_rupee', 'exact')),
        priority SMALLINT NOT NULL DEFAULT 100,
        effective_from DATE NOT NULL,
        effective_to DATE,
        version_no INTEGER NOT NULL DEFAULT 1 CHECK (version_no > 0),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by VARCHAR(64),
        updated_by VARCHAR(64),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        CONSTRAINT chk_employer_effective_range CHECK (
          effective_to IS NULL OR effective_to >= effective_from
        ),
        CONSTRAINT uq_employer_component_version UNIQUE (tenant_id, code, version_no),
        CONSTRAINT uq_employer_component_effective_start UNIQUE (tenant_id, code, effective_from)
      );
    `,
    `
      CREATE TABLE IF NOT EXISTS component_formulas (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES payroll_tenants(id) ON DELETE CASCADE,
        component_scope VARCHAR(30) NOT NULL
          CHECK (component_scope IN ('earning', 'deduction', 'employer_contribution')),
        earning_component_id UUID REFERENCES earning_components(id) ON DELETE CASCADE,
        deduction_component_id UUID REFERENCES deduction_components(id) ON DELETE CASCADE,
        employer_contribution_component_id UUID REFERENCES employer_contribution_components(id) ON DELETE CASCADE,
        formula_code VARCHAR(60) NOT NULL,
        formula_name VARCHAR(120) NOT NULL,
        formula_expression TEXT NOT NULL,
        formula_variables JSONB NOT NULL DEFAULT '{}'::jsonb,
        execution_order SMALLINT NOT NULL DEFAULT 100,
        is_fallback_formula BOOLEAN NOT NULL DEFAULT FALSE,
        effective_from DATE NOT NULL,
        effective_to DATE,
        version_no INTEGER NOT NULL DEFAULT 1 CHECK (version_no > 0),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by VARCHAR(64),
        updated_by VARCHAR(64),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        CONSTRAINT chk_formula_effective_range CHECK (
          effective_to IS NULL OR effective_to >= effective_from
        ),
        CONSTRAINT chk_formula_single_component_ref CHECK (
          (CASE WHEN earning_component_id IS NOT NULL THEN 1 ELSE 0 END) +
          (CASE WHEN deduction_component_id IS NOT NULL THEN 1 ELSE 0 END) +
          (CASE WHEN employer_contribution_component_id IS NOT NULL THEN 1 ELSE 0 END) = 1
        ),
        CONSTRAINT chk_formula_scope_match CHECK (
          (component_scope = 'earning' AND earning_component_id IS NOT NULL) OR
          (component_scope = 'deduction' AND deduction_component_id IS NOT NULL) OR
          (component_scope = 'employer_contribution' AND employer_contribution_component_id IS NOT NULL)
        ),
        CONSTRAINT uq_component_formula_version UNIQUE (
          tenant_id,
          component_scope,
          formula_code,
          version_no
        )
      );
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_earning_components_tenant_code_active
        ON earning_components (tenant_id, code, is_active);
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_earning_components_tenant_effective
        ON earning_components (tenant_id, effective_from, COALESCE(effective_to, '9999-12-31'::date));
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_deduction_components_tenant_code_active
        ON deduction_components (tenant_id, code, is_active);
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_deduction_components_tenant_effective
        ON deduction_components (tenant_id, effective_from, COALESCE(effective_to, '9999-12-31'::date));
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_employer_components_tenant_code_active
        ON employer_contribution_components (tenant_id, code, is_active);
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_employer_components_tenant_effective
        ON employer_contribution_components (tenant_id, effective_from, COALESCE(effective_to, '9999-12-31'::date));
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_component_formulas_tenant_scope_active
        ON component_formulas (tenant_id, component_scope, is_active);
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_component_formulas_execution
        ON component_formulas (tenant_id, execution_order, effective_from);
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_component_formulas_earning_ref
        ON component_formulas (earning_component_id)
        WHERE earning_component_id IS NOT NULL;
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_component_formulas_deduction_ref
        ON component_formulas (deduction_component_id)
        WHERE deduction_component_id IS NOT NULL;
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_component_formulas_employer_ref
        ON component_formulas (employer_contribution_component_id)
        WHERE employer_contribution_component_id IS NOT NULL;
    `,
    `
      ALTER TABLE earning_components
      ADD CONSTRAINT ex_earning_component_no_overlap
      EXCLUDE USING gist (
        tenant_id WITH =,
        code WITH =,
        daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]') WITH &&
      );
    `,
    `
      ALTER TABLE deduction_components
      ADD CONSTRAINT ex_deduction_component_no_overlap
      EXCLUDE USING gist (
        tenant_id WITH =,
        code WITH =,
        daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]') WITH &&
      );
    `,
    `
      ALTER TABLE employer_contribution_components
      ADD CONSTRAINT ex_employer_component_no_overlap
      EXCLUDE USING gist (
        tenant_id WITH =,
        code WITH =,
        daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]') WITH &&
      );
    `,
    `
      CREATE TRIGGER trg_earning_components_updated_at
      BEFORE UPDATE ON earning_components
      FOR EACH ROW
      EXECUTE FUNCTION set_row_updated_at();
    `,
    `
      CREATE TRIGGER trg_deduction_components_updated_at
      BEFORE UPDATE ON deduction_components
      FOR EACH ROW
      EXECUTE FUNCTION set_row_updated_at();
    `,
    `
      CREATE TRIGGER trg_employer_contribution_components_updated_at
      BEFORE UPDATE ON employer_contribution_components
      FOR EACH ROW
      EXECUTE FUNCTION set_row_updated_at();
    `,
    `
      CREATE TRIGGER trg_component_formulas_updated_at
      BEFORE UPDATE ON component_formulas
      FOR EACH ROW
      EXECUTE FUNCTION set_row_updated_at();
    `
  ],
  down: [
    `
      DROP TRIGGER IF EXISTS trg_component_formulas_updated_at ON component_formulas;
    `,
    `
      DROP TRIGGER IF EXISTS trg_employer_contribution_components_updated_at ON employer_contribution_components;
    `,
    `
      DROP TRIGGER IF EXISTS trg_deduction_components_updated_at ON deduction_components;
    `,
    `
      DROP TRIGGER IF EXISTS trg_earning_components_updated_at ON earning_components;
    `,
    `
      DROP TABLE IF EXISTS component_formulas;
    `,
    `
      DROP TABLE IF EXISTS employer_contribution_components;
    `,
    `
      DROP TABLE IF EXISTS deduction_components;
    `,
    `
      DROP TABLE IF EXISTS earning_components;
    `
  ]
};
