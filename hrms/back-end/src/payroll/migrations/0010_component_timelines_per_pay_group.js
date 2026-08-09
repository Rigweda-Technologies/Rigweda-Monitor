"use strict";

const scopes = [
  {
    table: "earning_components",
    version: "uq_earning_component_version",
    effective: "uq_earning_component_effective_start",
    overlap: "ex_earning_component_no_overlap"
  },
  {
    table: "deduction_components",
    version: "uq_deduction_component_version",
    effective: "uq_deduction_component_effective_start",
    overlap: "ex_deduction_component_no_overlap"
  },
  {
    table: "employer_contribution_components",
    version: "uq_employer_component_version",
    effective: "uq_employer_component_effective_start",
    overlap: "ex_employer_component_no_overlap"
  }
];

const payGroupKey = "COALESCE(pay_group_id, '00000000-0000-0000-0000-000000000000'::uuid)";

module.exports = {
  id: "0010",
  name: "component_timelines_per_pay_group",
  up: scopes.flatMap(({ table, version, effective, overlap }) => [
    `ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${overlap};`,
    `ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${version};`,
    `ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${effective};`,
    `DROP INDEX IF EXISTS ${version};`,
    `DROP INDEX IF EXISTS ${effective};`,
    `
      CREATE UNIQUE INDEX ${version}
      ON ${table} (tenant_id, ${payGroupKey}, code, version_no);
    `,
    `
      CREATE UNIQUE INDEX ${effective}
      ON ${table} (tenant_id, ${payGroupKey}, code, effective_from);
    `,
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
  ]),
  down: scopes.flatMap(({ table, version, effective, overlap }) => [
    `ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${overlap};`,
    `DROP INDEX IF EXISTS ${version};`,
    `DROP INDEX IF EXISTS ${effective};`,
    `
      ALTER TABLE ${table}
      ADD CONSTRAINT ${version}
      UNIQUE (tenant_id, code, version_no);
    `,
    `
      ALTER TABLE ${table}
      ADD CONSTRAINT ${effective}
      UNIQUE (tenant_id, code, effective_from);
    `,
    `
      ALTER TABLE ${table}
      ADD CONSTRAINT ${overlap}
      EXCLUDE USING gist (
        tenant_id WITH =,
        code WITH =,
        daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]') WITH &&
      );
    `
  ])
};
