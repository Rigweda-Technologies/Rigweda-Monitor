let monitorPool = null;

const getMonitorDbConfig = () => {
  const connectionString =
    process.env.MONITOR_DATABASE_URL ||
    process.env.MONITOR_TOOL_DATABASE_URL ||
    process.env.DESKTOP_MONITOR_DATABASE_URL;
  let sanitizedConnectionString = connectionString;
  const normalizedConnectionString = String(connectionString || "").toLowerCase();

  const config = {
    max: Number(process.env.MONITOR_PG_POOL_MAX || 20),
    idleTimeoutMillis: Number(process.env.MONITOR_PG_IDLE_TIMEOUT_MS || 30000),
    connectionTimeoutMillis: Number(process.env.MONITOR_PG_CONNECTION_TIMEOUT_MS || 10000),
    application_name: process.env.MONITOR_PG_APP_NAME || "upanaya-hrms-monitor-read"
  };

  if (connectionString) {
    try {
      const parsed = new URL(connectionString);
      parsed.searchParams.delete("sslmode");
      parsed.searchParams.delete("ssl");
      sanitizedConnectionString = parsed.toString();
    } catch {
      sanitizedConnectionString = connectionString;
    }

    config.connectionString = sanitizedConnectionString;
  } else {
    config.host = process.env.MONITOR_PGHOST;
    config.port = Number(process.env.MONITOR_PGPORT || 5432);
    config.database = process.env.MONITOR_PGDATABASE;
    config.user = process.env.MONITOR_PGUSER;
    config.password = process.env.MONITOR_PGPASSWORD;
  }

  const sslMode = String(process.env.MONITOR_PG_SSL_MODE || "").toLowerCase();
  if (sslMode === "require" || normalizedConnectionString.includes("sslmode=require") || normalizedConnectionString.includes("ssl=true")) {
    config.ssl = { rejectUnauthorized: false };
  }

  return config;
};

const hasMonitorDbConfig = () =>
  Boolean(
    process.env.MONITOR_DATABASE_URL ||
    process.env.MONITOR_TOOL_DATABASE_URL ||
    process.env.DESKTOP_MONITOR_DATABASE_URL ||
    (
      process.env.MONITOR_PGHOST &&
      process.env.MONITOR_PGDATABASE &&
      process.env.MONITOR_PGUSER &&
      process.env.MONITOR_PGPASSWORD
    )
  );

const getMonitorPgPool = async () => {
  if (!hasMonitorDbConfig()) {
    throw { code: 503, message: "Monitor database is not configured. Set MONITOR_DATABASE_URL in HRMS backend .env." };
  }

  if (monitorPool) return monitorPool;

  let Pool;
  try {
    Pool = require("pg").Pool;
  } catch {
    throw new Error("pg package not found. Install `pg` dependency to enable monitor database reads.");
  }

  monitorPool = new Pool(getMonitorDbConfig());
  monitorPool.on("error", (error) => {
    if (process.env.NODE_ENV !== "test") {
      console.error("Monitor Postgres pool error:", error?.message || error);
    }
  });

  return monitorPool;
};

module.exports = {
  getMonitorPgPool
};
