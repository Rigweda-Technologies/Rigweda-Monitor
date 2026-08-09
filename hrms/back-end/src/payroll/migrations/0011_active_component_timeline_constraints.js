"use strict";

const scopes = [
  {
    table: "earning_components",
    overlap: "ex_earning_component_no_overlap"
  },
  {
    table: "deduction_components",
    overlap: "ex_deduction_component_no_overlap"
  },
  {
    table: "employer_contribution_components",
    overlap: "ex_employer_component_no_overlap"
  }
];

const payGroupKey = "COALESCE(pay_group_id, '00000000-0000-0000-0000-000000000000'::uuid)";

module.exports = {
  id: "0011",
  name: "active_component_timeline_constraints",
  up: scopes.flatMap(({ table, overlap }) => [
    `ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${overlap};`,
    `
      ALTER TABLE ${table}
      ADD CONSTRAINT ${overlap}
      EXCLUDE USING gist (
        tenant_id WITH =,
        ${payGroupKey} WITH =,
        code WITH =,
        daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]') WITH &&
      )
      WHERE (is_active);
    `
  ]),
  down: scopes.flatMap(({ table, overlap }) => [
    `ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${overlap};`,
    `
      ALTER TABLE ${table}
      ADD CONSTRAINT ${overlap}
      EXCLUDE USING gist (
        tenant_id WITH =,
        ${payGroupKey} WITH =,
        code WITH =,
        daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]') WITH &&
      );
    `
  ])
};
