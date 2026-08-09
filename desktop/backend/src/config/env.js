import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");

export const loadEnvFiles = () => {
  dotenv.config({ path: path.join(repoRoot, "rigweda", "backend", ".env") });
  dotenv.config({ path: path.join(repoRoot, "desktop", "backend", ".env"), override: true });
};

const requiredEnv = [
  "JWT_ACCESS_SECRET",
  "RIGWEDA_API_BASE_URL",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
  "DATABASE_URL",
];

export const validateEnv = () => {
  const missing = requiredEnv.filter((key) => !String(process.env[key] || "").trim());

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
};

export const getEnv = () => ({
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET,
  rigwedaApiBaseUrl: String(process.env.RIGWEDA_API_BASE_URL || "").replace(/\/+$/, ""),
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME,
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY,
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET,
  databaseUrl: process.env.DATABASE_URL,
  databaseSsl: ["1", "true", "yes"].includes(String(process.env.DATABASE_SSL || "").toLowerCase()),
  databasePoolMax: Number(process.env.DATABASE_POOL_MAX || 10),
  databaseStatementTimeoutMs: Number(process.env.DATABASE_STATEMENT_TIMEOUT_MS || 30000),
  databaseQueryTimeoutMs: Number(process.env.DATABASE_QUERY_TIMEOUT_MS || 35000),
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || "0.0.0.0",
});
