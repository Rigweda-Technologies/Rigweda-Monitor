import pg from "pg";
import { getEnv } from "../config/env.js";

const { Pool } = pg;

let pool;

export const getPool = () => {
  if (pool) {
    return pool;
  }

  const env = getEnv();
  pool = new Pool({
    connectionString: env.databaseUrl,
    max: env.databasePoolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: env.databaseStatementTimeoutMs,
    query_timeout: env.databaseQueryTimeoutMs,
    ssl: env.databaseSsl ? { rejectUnauthorized: false } : undefined,
    application_name: "rigweda-monitor-desktop",
  });

  return pool;
};

