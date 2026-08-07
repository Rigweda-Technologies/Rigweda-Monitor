require("dotenv").config();
const fs = require("node:fs/promises");
const path = require("node:path");
const { loadEnv } = require("../config/env");
const { createPool } = require("./pool");

const run = async () => {
  const env = loadEnv();
  const pool = createPool(env);
  const directory = path.join(__dirname, "migrations");
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    const files = (await fs.readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
    for (const file of files) {
      const exists = await pool.query("SELECT 1 FROM schema_migrations WHERE version = $1", [file]);
      if (exists.rowCount) continue;
      const sql = await fs.readFile(path.join(directory, file), "utf8");
      await pool.query(sql);
      await pool.query("INSERT INTO schema_migrations(version) VALUES ($1)", [file]);
      process.stdout.write(`Applied ${file}\n`);
    }
  } finally {
    await pool.end();
  }
};

run().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
