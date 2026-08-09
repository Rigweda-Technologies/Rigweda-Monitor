import pg from "pg";
import { getEnv } from "../config/env.js";

const { Pool } = pg;

let pool;

const stripPgSslQueryParams = (connectionString) => {
  try {
    const url = new URL(connectionString);
    url.searchParams.delete("sslmode");
    url.searchParams.delete("sslcert");
    url.searchParams.delete("sslkey");
    url.searchParams.delete("sslrootcert");
    return url.toString();
  } catch {
    return connectionString;
  }
};

export const getPool = () => {
  if (pool) {
    return pool;
  }

  const env = getEnv();
  const databaseUrl = String(env.databaseUrl || "");
  const urlRequestsSsl = /[?&]sslmode=(prefer|require|verify-ca|verify-full)/i.test(databaseUrl);

  pool = new Pool({
    connectionString: stripPgSslQueryParams(databaseUrl),
    max: env.databasePoolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: env.databaseStatementTimeoutMs,
    query_timeout: env.databaseQueryTimeoutMs,
    ssl:
      env.databaseSsl || urlRequestsSsl
        ? { rejectUnauthorized: env.databaseSslRejectUnauthorized }
        : undefined,
    application_name: "rigweda-monitor-desktop",
  });

  return pool;
};
