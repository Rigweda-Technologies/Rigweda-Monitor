const { Pool } = require("pg");

const createPool = (env) => new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  statement_timeout: env.DATABASE_STATEMENT_TIMEOUT_MS,
  query_timeout: env.DATABASE_QUERY_TIMEOUT_MS,
  ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
  application_name: "rigweda-api"
});

module.exports = { createPool };
