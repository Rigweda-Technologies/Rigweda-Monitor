require("dotenv").config();

const { getPayrollPgPool, validatePayrollDbConfig } = require("../config/payrollDb");
const {
  MIGRATIONS_DIR,
  MIGRATION_TABLE,
  ensureMigrationTable,
  getAppliedMigrations,
  loadMigrations,
  migrateUp,
  runStatements,
  withAdvisoryLock
} = require("../modules/payroll/payrollSchema.service");

const command = (process.argv[2] || "").toLowerCase();
const stepsArg = process.argv.find((arg) => arg.startsWith("--steps="));
const downSteps = stepsArg ? Number(stepsArg.split("=")[1]) : 1;

if (!process.env.PAYROLL_DB_ENABLED) {
  process.env.PAYROLL_DB_ENABLED = "true";
}

const assertValidCommand = () => {
  if (!["up", "down", "status"].includes(command)) {
    throw new Error("Invalid command. Use: up | down | status");
  }
};

const migrateDown = async (client, migrations, steps) => {
  const appliedRows = await getAppliedMigrations(client);
  if (appliedRows.length === 0) {
    console.log("ℹ No applied payroll migrations to roll back");
    return;
  }

  const byId = new Map(migrations.map((migration) => [migration.id, migration]));
  const rollbackRows = [...appliedRows].sort((a, b) =>
    String(b.migration_id).localeCompare(String(a.migration_id))
  ).slice(0, steps);

  for (const row of rollbackRows) {
    const migration = byId.get(row.migration_id);
    if (!migration) {
      throw new Error(
        `Cannot rollback migration ${row.migration_id}; file missing in ${MIGRATIONS_DIR}`
      );
    }

    await client.query("BEGIN");
    try {
      await runStatements(client, migration.down);
      await client.query(`DELETE FROM ${MIGRATION_TABLE} WHERE migration_id = $1`, [
        row.migration_id
      ]);
      await client.query("COMMIT");
      console.log(`↩ Rolled back migration ${migration.id} - ${migration.name}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(
        `Failed rollback ${migration.id} - ${migration.name}: ${error?.message || error}`
      );
    }
  }
};

const printStatus = async (client, migrations) => {
  const appliedRows = await getAppliedMigrations(client);
  const appliedMap = new Map(appliedRows.map((row) => [row.migration_id, row]));

  console.log("Payroll migration status:");
  for (const migration of migrations) {
    const row = appliedMap.get(migration.id);
    if (row) {
      console.log(
        `  [APPLIED] ${migration.id} ${migration.name} at ${new Date(row.applied_at).toISOString()}`
      );
    } else {
      console.log(`  [PENDING] ${migration.id} ${migration.name}`);
    }
  }
};

(async () => {
  let client;
  try {
    assertValidCommand();
    validatePayrollDbConfig();

    const migrations = loadMigrations();
    const pool = await getPayrollPgPool();
    if (!pool) {
      throw new Error("Payroll Postgres pool unavailable");
    }

    client = await pool.connect();
    await ensureMigrationTable(client);

    await withAdvisoryLock(client, async () => {
      if (command === "up") {
        const result = await migrateUp(client, migrations);
        if (result.applied.length === 0) {
          console.log("ℹ No pending payroll migrations");
          return;
        }
        for (const migration of result.applied) {
          console.log(`✅ Applied migration ${migration.id} - ${migration.name}`);
        }
        return;
      }

      if (command === "down") {
        if (!Number.isInteger(downSteps) || downSteps <= 0) {
          throw new Error("--steps must be a positive integer");
        }
        await migrateDown(client, migrations, downSteps);
        return;
      }

      await printStatus(client, migrations);
    });

    process.exit(0);
  } catch (error) {
    console.error("❌ Payroll migration command failed:", error?.message || error);
    process.exit(1);
  } finally {
    if (client) {
      client.release();
    }
  }
})();
