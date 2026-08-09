"use strict";

module.exports = {
  id: "0008",
  name: "payroll_component_pay_group_columns",
  up: [
    `
      CREATE OR REPLACE FUNCTION component_safe_uuid(value TEXT)
      RETURNS UUID AS $$
      BEGIN
        IF value IS NULL OR BTRIM(value) = '' THEN
          RETURN NULL;
        END IF;
        RETURN value::uuid;
      EXCEPTION
        WHEN invalid_text_representation THEN
          RETURN NULL;
      END;
      $$ LANGUAGE plpgsql IMMUTABLE;
    `,
    `
      CREATE OR REPLACE FUNCTION component_first_jsonb_text(value JSONB)
      RETURNS TEXT AS $$
      DECLARE
        item TEXT;
      BEGIN
        IF value IS NULL THEN
          RETURN NULL;
        END IF;

        IF jsonb_typeof(value) = 'string' THEN
          RETURN BTRIM(value::text, '"');
        END IF;

        IF jsonb_typeof(value) = 'array' THEN
          FOR item IN SELECT jsonb_array_elements_text(value) LOOP
            IF item IS NOT NULL AND BTRIM(item) <> '' THEN
              RETURN item;
            END IF;
          END LOOP;
        END IF;

        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql IMMUTABLE;
    `,
    `
      CREATE OR REPLACE FUNCTION assert_component_pay_group_tenant_match()
      RETURNS TRIGGER AS $$
      DECLARE
        pay_group_tenant_id UUID;
      BEGIN
        IF NEW.pay_group_id IS NULL THEN
          RETURN NEW;
        END IF;

        SELECT tenant_id
          INTO pay_group_tenant_id
        FROM pay_groups
        WHERE id = NEW.pay_group_id;

        IF pay_group_tenant_id IS NULL THEN
          RAISE EXCEPTION 'pay_group_id % does not exist', NEW.pay_group_id
            USING ERRCODE = '23503';
        END IF;

        IF pay_group_tenant_id <> NEW.tenant_id THEN
          RAISE EXCEPTION 'pay_group_id % does not belong to tenant %', NEW.pay_group_id, NEW.tenant_id
            USING ERRCODE = '23514';
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `,
    `
      ALTER TABLE earning_components
      ADD COLUMN IF NOT EXISTS pay_group_id UUID REFERENCES pay_groups(id) ON DELETE SET NULL;
    `,
    `
      ALTER TABLE deduction_components
      ADD COLUMN IF NOT EXISTS pay_group_id UUID REFERENCES pay_groups(id) ON DELETE SET NULL;
    `,
    `
      ALTER TABLE employer_contribution_components
      ADD COLUMN IF NOT EXISTS pay_group_id UUID REFERENCES pay_groups(id) ON DELETE SET NULL;
    `,
    `
      UPDATE earning_components
      SET pay_group_id = COALESCE(
        pay_group_id,
        component_safe_uuid(metadata->>'payGroupId'),
        component_safe_uuid(metadata->>'pay_group_id'),
        component_safe_uuid(metadata->'applicability'->>'payGroupId'),
        component_safe_uuid(metadata->'applicability'->>'pay_group_id'),
        component_safe_uuid(component_first_jsonb_text(metadata->'payGroupIds')),
        component_safe_uuid(component_first_jsonb_text(metadata->'applicability'->'payGroupIds'))
      )
      WHERE pay_group_id IS NULL;
    `,
    `
      UPDATE deduction_components
      SET pay_group_id = COALESCE(
        pay_group_id,
        component_safe_uuid(metadata->>'payGroupId'),
        component_safe_uuid(metadata->>'pay_group_id'),
        component_safe_uuid(metadata->'applicability'->>'payGroupId'),
        component_safe_uuid(metadata->'applicability'->>'pay_group_id'),
        component_safe_uuid(component_first_jsonb_text(metadata->'payGroupIds')),
        component_safe_uuid(component_first_jsonb_text(metadata->'applicability'->'payGroupIds'))
      )
      WHERE pay_group_id IS NULL;
    `,
    `
      UPDATE employer_contribution_components
      SET pay_group_id = COALESCE(
        pay_group_id,
        component_safe_uuid(metadata->>'payGroupId'),
        component_safe_uuid(metadata->>'pay_group_id'),
        component_safe_uuid(metadata->'applicability'->>'payGroupId'),
        component_safe_uuid(metadata->'applicability'->>'pay_group_id'),
        component_safe_uuid(component_first_jsonb_text(metadata->'payGroupIds')),
        component_safe_uuid(component_first_jsonb_text(metadata->'applicability'->'payGroupIds'))
      )
      WHERE pay_group_id IS NULL;
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_earning_components_tenant_pay_group
        ON earning_components (tenant_id, pay_group_id);
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_deduction_components_tenant_pay_group
        ON deduction_components (tenant_id, pay_group_id);
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_employer_components_tenant_pay_group
        ON employer_contribution_components (tenant_id, pay_group_id);
    `,
    `
      DROP TRIGGER IF EXISTS trg_earning_components_pay_group_tenant_match ON earning_components;
      CREATE TRIGGER trg_earning_components_pay_group_tenant_match
      BEFORE INSERT OR UPDATE OF tenant_id, pay_group_id ON earning_components
      FOR EACH ROW
      EXECUTE FUNCTION assert_component_pay_group_tenant_match();
    `,
    `
      DROP TRIGGER IF EXISTS trg_deduction_components_pay_group_tenant_match ON deduction_components;
      CREATE TRIGGER trg_deduction_components_pay_group_tenant_match
      BEFORE INSERT OR UPDATE OF tenant_id, pay_group_id ON deduction_components
      FOR EACH ROW
      EXECUTE FUNCTION assert_component_pay_group_tenant_match();
    `,
    `
      DROP TRIGGER IF EXISTS trg_employer_components_pay_group_tenant_match ON employer_contribution_components;
      CREATE TRIGGER trg_employer_components_pay_group_tenant_match
      BEFORE INSERT OR UPDATE OF tenant_id, pay_group_id ON employer_contribution_components
      FOR EACH ROW
      EXECUTE FUNCTION assert_component_pay_group_tenant_match();
    `
  ],
  down: [
    `
      DROP TRIGGER IF EXISTS trg_earning_components_pay_group_tenant_match ON earning_components;
    `,
    `
      DROP TRIGGER IF EXISTS trg_deduction_components_pay_group_tenant_match ON deduction_components;
    `,
    `
      DROP TRIGGER IF EXISTS trg_employer_components_pay_group_tenant_match ON employer_contribution_components;
    `,
    `
      DROP INDEX IF EXISTS idx_earning_components_tenant_pay_group;
    `,
    `
      DROP INDEX IF EXISTS idx_deduction_components_tenant_pay_group;
    `,
    `
      DROP INDEX IF EXISTS idx_employer_components_tenant_pay_group;
    `,
    `
      ALTER TABLE earning_components
      DROP COLUMN IF EXISTS pay_group_id;
    `,
    `
      ALTER TABLE deduction_components
      DROP COLUMN IF EXISTS pay_group_id;
    `,
    `
      ALTER TABLE employer_contribution_components
      DROP COLUMN IF EXISTS pay_group_id;
    `,
    `
      DROP FUNCTION IF EXISTS assert_component_pay_group_tenant_match();
    `,
    `
      DROP FUNCTION IF EXISTS component_first_jsonb_text(JSONB);
    `,
    `
      DROP FUNCTION IF EXISTS component_safe_uuid(TEXT);
    `
  ]
};
