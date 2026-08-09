"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "payroll", "migrations");
const rawMigrationTable = process.env.PAYROLL_MIGRATIONS_TABLE || "payroll_schema_migrations";
const MIGRATION_TABLE = String(rawMigrationTable).trim();
const MIGRATION_LOCK_KEY = Number(process.env.PAYROLL_MIGRATION_LOCK_KEY || 9011001);

const assertMigrationsDirExists = () => {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    throw new Error(`Migrations directory not found: ${MIGRATIONS_DIR}`);
  }
};

const assertSafeIdentifiers = () => {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(MIGRATION_TABLE)) {
    throw new Error(
      "PAYROLL_MIGRATIONS_TABLE must be a valid SQL identifier (letters, numbers, underscore)"
    );
  }
};

const getMigrationChecksum = (migrationPath) => {
  const fileBuffer = fs.readFileSync(migrationPath);
  return crypto.createHash("sha256").update(fileBuffer).digest("hex");
};

const loadMigrations = () => {
  assertMigrationsDirExists();
  assertSafeIdentifiers();

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".js"))
    .sort();

  const migrations = files.map((file) => {
    const migrationPath = path.join(MIGRATIONS_DIR, file);
    const migration = require(migrationPath);

    if (!migration?.id || !migration?.name) {
      throw new Error(`Migration ${file} must export id and name`);
    }
    if (!Array.isArray(migration.up) || migration.up.length === 0) {
      throw new Error(`Migration ${file} must include non-empty up[]`);
    }
    if (!Array.isArray(migration.down) || migration.down.length === 0) {
      throw new Error(`Migration ${file} must include non-empty down[]`);
    }

    return {
      id: String(migration.id),
      name: String(migration.name),
      up: migration.up,
      down: migration.down,
      checksum: getMigrationChecksum(migrationPath)
    };
  });

  const duplicateIds = migrations.filter(
    (item, idx) => migrations.findIndex((migration) => migration.id === item.id) !== idx
  );
  if (duplicateIds.length > 0) {
    throw new Error(
      `Duplicate migration ids found: ${duplicateIds.map((item) => item.id).join(", ")}`
    );
  }

  return migrations;
};

const ensureMigrationTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
      id BIGSERIAL PRIMARY KEY,
      migration_id VARCHAR(64) NOT NULL UNIQUE,
      migration_name VARCHAR(255) NOT NULL,
      checksum VARCHAR(128) NOT NULL,
      execution_ms INTEGER NOT NULL DEFAULT 0,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      applied_by VARCHAR(128) NOT NULL DEFAULT CURRENT_USER
    );
  `);
};

const getAppliedMigrations = async (client) => {
  const result = await client.query(
    `SELECT migration_id, migration_name, checksum, applied_at FROM ${MIGRATION_TABLE} ORDER BY migration_id ASC`
  );
  return result.rows;
};

const runStatements = async (client, statements) => {
  for (const sql of statements) {
    await client.query(sql);
  }
};

const withAdvisoryLock = async (client, callback) => {
  await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
  try {
    return await callback();
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
  }
};

const migrateUp = async (client, migrations) => {
  const appliedRows = await getAppliedMigrations(client);
  const appliedMap = new Map(appliedRows.map((row) => [row.migration_id, row]));
  const pending = migrations.filter((migration) => !appliedMap.has(migration.id));

  const applied = [];
  for (const migration of pending) {
    const startedAt = Date.now();
    await client.query("BEGIN");
    try {
      await runStatements(client, migration.up);
      const executionMs = Date.now() - startedAt;
      await client.query(
        `INSERT INTO ${MIGRATION_TABLE} (migration_id, migration_name, checksum, execution_ms) VALUES ($1, $2, $3, $4)`,
        [migration.id, migration.name, migration.checksum, executionMs]
      );
      await client.query("COMMIT");
      applied.push(migration);
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(
        `Failed migration ${migration.id} - ${migration.name}: ${error?.message || error}`
      );
    }
  }

  return {
    applied,
    pendingCount: pending.length
  };
};

const ensurePayrollSchema = async (client) => {
  const migrations = loadMigrations();
  await ensureMigrationTable(client);
  return withAdvisoryLock(client, async () => migrateUp(client, migrations));
};

module.exports = {
  MIGRATIONS_DIR,
  MIGRATION_TABLE,
  ensureMigrationTable,
  getAppliedMigrations,
  loadMigrations,
  migrateUp,
  ensurePayrollSchema,
  runStatements,
  withAdvisoryLock
};
