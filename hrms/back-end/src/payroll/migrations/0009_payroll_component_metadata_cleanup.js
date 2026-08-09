"use strict";

module.exports = {
  id: "0009",
  name: "payroll_component_metadata_cleanup",
  up: [
    `
      CREATE OR REPLACE FUNCTION strip_component_pay_group_metadata(value JSONB)
      RETURNS JSONB AS $$
      DECLARE
        normalized JSONB;
        applicability JSONB;
      BEGIN
        IF value IS NULL THEN
          RETURN '{}'::jsonb;
        END IF;

        normalized := value - 'payGroupId' - 'pay_group_id' - 'payGroupIds';

        IF normalized ? 'applicability' AND jsonb_typeof(normalized->'applicability') = 'object' THEN
          applicability := (normalized->'applicability') - 'payGroupId' - 'pay_group_id' - 'payGroupIds';
          IF applicability = '{}'::jsonb THEN
            normalized := normalized - 'applicability';
          ELSE
            normalized := jsonb_set(normalized, '{applicability}', applicability, true);
          END IF;
        END IF;

        RETURN normalized;
      END;
      $$ LANGUAGE plpgsql IMMUTABLE;
    `,
    `
      UPDATE earning_components
      SET metadata = strip_component_pay_group_metadata(metadata)
      WHERE metadata IS NOT NULL;
    `,
    `
      UPDATE deduction_components
      SET metadata = strip_component_pay_group_metadata(metadata)
      WHERE metadata IS NOT NULL;
    `,
    `
      UPDATE employer_contribution_components
      SET metadata = strip_component_pay_group_metadata(metadata)
      WHERE metadata IS NOT NULL;
    `
  ],
  down: [
    `
      DROP FUNCTION IF EXISTS strip_component_pay_group_metadata(JSONB);
    `
  ]
};
