require("dotenv").config();

const {
  getPayrollPgPool,
  validatePayrollDbConfig
} = require("../config/payrollDb");
const { MIGRATION_TABLE } = require("../modules/payroll/payrollSchema.service");

if (!process.env.PAYROLL_DB_ENABLED) {
  process.env.PAYROLL_DB_ENABLED = "true";
}

const args = new Set(process.argv.slice(2));
const getArgValue = (name) => {
  const prefix = `${name}=`;
  const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : "";
};

const modeArg = getArgValue("--mode");
const mode = args.has("--all") ? "all" : args.has("--generated") ? "generated" : modeArg || "generated";
const includeTenants = args.has("--include-tenants");
const confirmed = args.has("--yes") || args.has("-y");
const verifyOnly = args.has("--verify");

const GENERATED_TABLES = [
  "payroll_action_idempotency",
  "payroll_run_audit_entries",
  "payroll_run_components",
  "payroll_run_employees",
  "payroll_runs",
  "payroll_adjustments",
  "payroll_arrears",
  "payroll_loans",
  "payroll_reimbursements",
  "payroll_attendance_snapshot_days",
  "payroll_attendance_snapshots"
];

const SETUP_TABLES = [
  "employee_payroll_revision_history",
  "employee_bank_details",
  "employee_statutory_details",
  "employee_salary_structures",
  "employee_payroll_profiles",
  "component_formulas",
  "earning_components",
  "deduction_components",
  "employer_contribution_components",
  "payroll_settings",
  "pay_periods",
  "pay_groups"
];

const printUsage = () => {
  console.log(`
Usage:
  npm run clear:payroll:data -- --verify
  npm run clear:payroll:data -- --yes
  npm run clear:payroll:data -- --all --yes
  npm run clear:payroll:data -- --all --include-tenants --yes

Modes:
  generated       Clears payroll runs, run rows, attendance snapshots, approvals, idempotency,
                  adjustments, arrears, loans, and reimbursements. Keeps pay groups, components,
                  employee payroll profiles, salary, bank, statutory setup, tenants, and migrations.

  all             Clears generated data plus payroll setup data. Keeps payroll tenants and
                  migration history unless --include-tenants is also passed.

Safety:
  --yes / -y      Required. This command deletes payroll Postgres rows.
  --verify        Prints payroll table row counts without deleting anything.
`);
};

const assertValidOptions = () => {
  if (args.has("--help") || args.has("-h")) {
    printUsage();
    process.exit(0);
  }

  if (!["generated", "all"].includes(mode)) {
    throw new Error("Invalid payroll clear mode. Use --generated, --all, or --mode=generated|all.");
  }

  if (includeTenants && mode !== "all") {
    throw new Error("--include-tenants can only be used with --all.");
  }

  if (!confirmed && !verifyOnly) {
    printUsage();
    throw new Error("Refusing to clear payroll data without --yes.");
  }
};

const quoteIdent = (value) => `"${String(value).replace(/"/g, "\"\"")}"`;

const getExistingTables = async (client, tableNames) => {
  const result = await client.query(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
    `,
    [tableNames]
  );

  return new Set(result.rows.map((row) => row.table_name));
};

const discoverPayrollTables = async (client) => {
  const result = await client.query(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND (
          table_name LIKE 'payroll\\_%' ESCAPE '\\'
          OR table_name LIKE 'pay\\_%' ESCAPE '\\'
          OR table_name LIKE 'employee\\_payroll\\_%' ESCAPE '\\'
          OR table_name LIKE 'employee\\_salary\\_%' ESCAPE '\\'
          OR table_name LIKE 'employee\\_bank\\_%' ESCAPE '\\'
          OR table_name LIKE 'employee\\_statutory\\_%' ESCAPE '\\'
          OR table_name IN (
            'earning_components',
            'deduction_components',
            'employer_contribution_components',
            'component_formulas'
          )
        )
      ORDER BY table_name ASC
    `
  );

  return result.rows.map((row) => row.table_name);
};

const buildTableList = () => {
  const tables = mode === "all"
    ? [...GENERATED_TABLES, ...SETUP_TABLES]
    : GENERATED_TABLES;

  if (includeTenants) {
    tables.push("payroll_tenants");
  }

  return [...new Set(tables)];
};

const getRowCounts = async (client, tableNames) => {
  const counts = [];
  for (const table of tableNames) {
    const result = await client.query(`SELECT COUNT(*)::bigint AS count FROM ${quoteIdent(table)}`);
    counts.push({
      table,
      count: Number(result.rows[0]?.count || 0)
    });
  }
  return counts;
};

const printCounts = (title, counts) => {
  console.log(title);
  if (!counts.length) {
    console.log("  (no payroll tables found)");
    return;
  }

  for (const row of counts) {
    console.log(`  ${row.table}: ${row.count}`);
  }
};

(async () => {
  let client;
  try {
    assertValidOptions();
    validatePayrollDbConfig();

    const pool = await getPayrollPgPool();
    if (!pool) {
      throw new Error("Payroll Postgres pool unavailable");
    }

    client = await pool.connect();
    const requestedTables = buildTableList();
    const discoveredTables = await discoverPayrollTables(client);
    const allKnownTables = [...new Set([...requestedTables, ...discoveredTables])]
      .filter((table) => table !== MIGRATION_TABLE);
    const existingTables = await getExistingTables(client, allKnownTables);
    const allExistingPayrollTables = allKnownTables.filter((table) => existingTables.has(table));
    const tablesToClear = mode === "all"
      ? allExistingPayrollTables
      : requestedTables.filter((table) => existingTables.has(table));

    if (verifyOnly) {
      const counts = await getRowCounts(client, allExistingPayrollTables);
      printCounts("Payroll table row counts:", counts);
      console.log(`ℹ Migration table kept out of clear operations: ${MIGRATION_TABLE}`);
      process.exit(0);
    }

    if (!tablesToClear.length) {
      console.log("ℹ No payroll tables found to clear.");
      process.exit(0);
    }

    const beforeCounts = await getRowCounts(client, tablesToClear);
    await client.query("BEGIN");
    await client.query(
      `TRUNCATE TABLE ${tablesToClear.map(quoteIdent).join(", ")} RESTART IDENTITY CASCADE`
    );
    await client.query("COMMIT");
    const afterCounts = await getRowCounts(client, tablesToClear);

    console.log(`✅ Cleared payroll ${mode} data from ${tablesToClear.length} table(s).`);
    printCounts("Before:", beforeCounts);
    printCounts("After:", afterCounts);
    console.log(`ℹ Migration table kept out of clear operations: ${MIGRATION_TABLE}`);
    if (includeTenants) {
      console.log("ℹ Payroll tenants were also cleared. Run `npm run seed:payroll:tenants` before using payroll.");
    } else if (mode === "all") {
      console.log("ℹ Payroll tenants and migration history were kept. Recreate pay groups/components before creating runs.");
    } else {
      console.log("ℹ Payroll setup was kept. You can now regenerate/import attendance snapshots and create fresh runs.");
    }

    process.exit(0);
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (_) {
        // Ignore rollback errors when no transaction is active.
      }
    }
    console.error("❌ Payroll clear command failed:", error?.message || error);
    process.exit(1);
  } finally {
    if (client) client.release();
  }
})();
