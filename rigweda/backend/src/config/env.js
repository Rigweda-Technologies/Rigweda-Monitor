const Joi = require("joi");

const schema = Joi.object({
  NODE_ENV: Joi.string().valid("development", "test", "production").default("development"),
  PORT: Joi.number().port().default(4100),
  DATABASE_URL: Joi.string().uri({ scheme: ["postgres", "postgresql"] }).when("NODE_ENV", {
    is: "test",
    then: Joi.optional(),
    otherwise: Joi.required()
  }),
  DATABASE_SSL: Joi.boolean().truthy("true").falsy("false").default(false),
  DATABASE_POOL_MAX: Joi.number().integer().min(2).max(100).default(20),
  DATABASE_STATEMENT_TIMEOUT_MS: Joi.number().integer().min(1000).max(300000).default(30000),
  DATABASE_QUERY_TIMEOUT_MS: Joi.number().integer().min(1000).max(300000).default(35000),
  API_RATE_LIMIT_PER_MINUTE: Joi.number().integer().min(60).max(100000).default(1200),
  HTTP_REQUEST_TIMEOUT_MS: Joi.number().integer().min(1000).max(300000).default(30000),
  HTTP_KEEP_ALIVE_TIMEOUT_MS: Joi.number().integer().min(1000).max(120000).default(65000),
  CORS_ALLOWED_ORIGINS: Joi.string().default("http://localhost:5173"),
  LOG_LEVEL: Joi.string().valid("fatal", "error", "warn", "info", "debug", "trace", "silent").default("info"),
  PASSWORD_PEPPER: Joi.string().min(32).when("NODE_ENV", {
    is: "production",
    then: Joi.required(),
    otherwise: Joi.string().min(32).default("development-only-pepper-change-me-now")
  }),
  JWT_ACCESS_SECRET: Joi.string().min(32).when("NODE_ENV", {
    is: "production", then: Joi.required(), otherwise: Joi.string().min(32).default("development-jwt-secret-change-me-now")
  }),
  SESSION_TOKEN_PEPPER: Joi.string().min(32).when("NODE_ENV", {
    is: "production", then: Joi.required(), otherwise: Joi.string().min(32).default("development-session-pepper-change-now")
  }),
  DATA_ENCRYPTION_KEY: Joi.string().min(32).when("NODE_ENV", {
    is: "production", then: Joi.required(), otherwise: Joi.string().min(32).default("development-data-key-change-me-now")
  }),
  ACCESS_TOKEN_TTL_SECONDS: Joi.number().integer().min(300).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS: Joi.number().integer().min(1).max(90).default(30),
  AUTH_MAX_FAILED_ATTEMPTS: Joi.number().integer().min(3).max(20).default(5),
  AUTH_LOCK_MINUTES: Joi.number().integer().min(1).max(1440).default(15),
  BOOTSTRAP_ADMIN_EMAIL: Joi.string().email().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: Joi.string().min(12).optional()
}).unknown(true);

const loadEnv = (source = process.env) => {
  const { value, error } = schema.validate(source, { abortEarly: false, convert: true });
  if (error) throw new Error(`Invalid environment configuration: ${error.message}`);
  return value;
};

module.exports = { loadEnv };
