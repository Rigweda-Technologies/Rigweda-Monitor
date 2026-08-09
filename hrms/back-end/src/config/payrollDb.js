let pgPool = null;
let didLogDisabled = false;
let lastConnectionError = null;

const isPayrollDbEnabled = () => {
  if (process.env.PAYROLL_DB_ENABLED === "true") return true;
  if (process.env.PAYROLL_DB_ENABLED === "false") return false;
  return Boolean(process.env.PAYROLL_DATABASE_URL || process.env.PGHOST);
};

const getSslConfig = () => {
  const sslMode = (process.env.PAYROLL_PG_SSL_MODE || "").toLowerCase();
  if (!sslMode || sslMode === "disable") {
    return undefined;
  }

  if (sslMode === "require") {
    return { rejectUnauthorized: false };
  }

  return undefined;
};

const getPoolConfig = () => {
  const connectionString = process.env.PAYROLL_DATABASE_URL;
  const config = {
    max: Number(process.env.PAYROLL_PG_POOL_MAX || 20),
    min: Number(process.env.PAYROLL_PG_POOL_MIN || 2),
    idleTimeoutMillis: Number(process.env.PAYROLL_PG_IDLE_TIMEOUT_MS || 30000),
    connectionTimeoutMillis: Number(
      process.env.PAYROLL_PG_CONNECTION_TIMEOUT_MS || 10000
    ),
    application_name: process.env.PAYROLL_PG_APP_NAME || "upanaya-payroll"
  };

  const ssl = getSslConfig();
  if (ssl) {
    config.ssl = ssl;
  }

  if (connectionString) {
    config.connectionString = connectionString;
    return config;
  }

  config.host = process.env.PGHOST;
  config.port = Number(process.env.PGPORT || 5432);
  config.database = process.env.PGDATABASE;
  config.user = process.env.PGUSER;
  config.password = process.env.PGPASSWORD;

  return config;
};

const validatePayrollDbConfig = () => {
  if (!isPayrollDbEnabled()) return;

  const hasConnectionString = Boolean(process.env.PAYROLL_DATABASE_URL);
  const hasDiscreteConfig =
    Boolean(process.env.PGHOST) &&
    Boolean(process.env.PGDATABASE) &&
    Boolean(process.env.PGUSER) &&
    Boolean(process.env.PGPASSWORD);

  if (!hasConnectionString && !hasDiscreteConfig) {
    throw new Error(
      "PAYROLL DB is enabled but Postgres config is missing. Set PAYROLL_DATABASE_URL or PGHOST/PGDATABASE/PGUSER/PGPASSWORD."
    );
  }
};

const getPayrollPgPool = async () => {
  if (!isPayrollDbEnabled()) {
    if (!didLogDisabled && process.env.NODE_ENV !== "test") {
      didLogDisabled = true;
      console.log(
        "ℹ Payroll Postgres disabled (set PAYROLL_DB_ENABLED=true and PAYROLL_DATABASE_URL for India payroll)"
      );
    }
    return null;
  }

  validatePayrollDbConfig();

  if (pgPool) {
    return pgPool;
  }

  let Pool;
  try {
    const pg = require("pg");
    Pool = pg.Pool;
    // PostgreSQL DATE has no timezone. Keep it as YYYY-MM-DD instead of
    // converting it to a local-midnight JavaScript Date and shifting the day.
    pg.types.setTypeParser(1082, (value) => value);
  } catch (error) {
    throw new Error(
      "pg package not found. Install `pg` dependency to enable payroll Postgres."
    );
  }

  pgPool = new Pool(getPoolConfig());
  pgPool.on("error", (error) => {
    lastConnectionError = error;
    if (process.env.NODE_ENV !== "test") {
      console.error("❌ Payroll Postgres pool error:", error?.message || error);
    }
  });

  return pgPool;
};

const connectPayrollDb = async () => {
  if (!isPayrollDbEnabled()) return null;

  const pool = await getPayrollPgPool();
  const client = await pool.connect();
  try {
    await client.query("SELECT 1");
    lastConnectionError = null;
    if (process.env.NODE_ENV !== "test") {
      console.log("✅ Payroll Postgres connected");
    }
  } catch (error) {
    lastConnectionError = error;
    throw error;
  } finally {
    client.release();
  }
  return pool;
};

const closePayrollDb = async () => {
  if (!pgPool) return;
  await pgPool.end();
  pgPool = null;
};

const isPayrollDbReady = () =>
  Boolean(pgPool) && !lastConnectionError && isPayrollDbEnabled();

module.exports = {
  isPayrollDbEnabled,
  isPayrollDbReady,
  validatePayrollDbConfig,
  getPayrollPgPool,
  connectPayrollDb,
  closePayrollDb
};
