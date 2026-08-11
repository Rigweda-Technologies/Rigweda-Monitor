const crypto = require("crypto");
const { v2: cloudinary } = require("cloudinary");
const { getMonitorPgPool } = require("../../config/monitorDb");

const TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS monitor_cloudinary_settings (
    organization_id TEXT PRIMARY KEY,
    cloud_name TEXT NOT NULL,
    api_key TEXT NOT NULL,
    api_secret_ciphertext TEXT NOT NULL,
    api_secret_iv TEXT NOT NULL,
    api_secret_auth_tag TEXT NOT NULL,
    upload_folder_root TEXT NOT NULL DEFAULT 'rigweda-monitor',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

const getEncryptionKey = () =>
  crypto
    .createHash("sha256")
    .update(String(process.env.MONITOR_SETTINGS_SECRET || process.env.JWT_SECRET || "monitor-settings-dev-key"))
    .digest();

const encryptSecret = (value) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64")
  };
};

const decryptSecret = (row) => {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(row.api_secret_iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(row.api_secret_auth_tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(row.api_secret_ciphertext, "base64")),
    decipher.final()
  ]).toString("utf8");
};

const getPoolOrThrow = async () => {
  const pool = await getMonitorPgPool();
  await pool.query(TABLE_SQL);
  return pool;
};

const maskSecret = (value) => {
  if (!value) return "";
  if (value.length <= 6) return "******";
  return `${value.slice(0, 3)}******${value.slice(-3)}`;
};

const normalizeFolderRoot = (value) =>
  String(value || "rigweda-monitor")
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/+/g, "/") || "rigweda-monitor";

const toPublicSettings = (row, secret) => row && ({
  cloudName: row.cloud_name,
  apiKey: row.api_key,
  apiSecretMasked: maskSecret(secret),
  uploadFolderRoot: row.upload_folder_root || "rigweda-monitor",
  updatedAt: row.updated_at
});

const getRawSettings = async (organizationId) => {
  const pool = await getPoolOrThrow();
  const result = await pool.query(
    "SELECT * FROM monitor_cloudinary_settings WHERE organization_id = $1",
    [String(organizationId)]
  );
  const row = result.rows[0] || null;
  if (!row) return null;
  return {
    cloudName: row.cloud_name,
    apiKey: row.api_key,
    apiSecret: decryptSecret(row),
    uploadFolderRoot: row.upload_folder_root || "rigweda-monitor",
    updatedAt: row.updated_at
  };
};

const getPublicSettings = async (organizationId) => {
  const pool = await getPoolOrThrow();
  const result = await pool.query(
    "SELECT * FROM monitor_cloudinary_settings WHERE organization_id = $1",
    [String(organizationId)]
  );
  const row = result.rows[0] || null;
  if (!row) return null;
  return toPublicSettings(row, decryptSecret(row));
};

const saveSettings = async (organizationId, payload) => {
  const pool = await getPoolOrThrow();
  const encrypted = encryptSecret(payload.apiSecret);
  const result = await pool.query(
    `
      INSERT INTO monitor_cloudinary_settings (
        organization_id, cloud_name, api_key, api_secret_ciphertext,
        api_secret_iv, api_secret_auth_tag, upload_folder_root
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (organization_id)
      DO UPDATE SET
        cloud_name = EXCLUDED.cloud_name,
        api_key = EXCLUDED.api_key,
        api_secret_ciphertext = EXCLUDED.api_secret_ciphertext,
        api_secret_iv = EXCLUDED.api_secret_iv,
        api_secret_auth_tag = EXCLUDED.api_secret_auth_tag,
        upload_folder_root = EXCLUDED.upload_folder_root,
        updated_at = NOW()
      RETURNING *
    `,
    [
      String(organizationId),
      String(payload.cloudName || "").trim(),
      String(payload.apiKey || "").trim(),
      encrypted.ciphertext,
      encrypted.iv,
      encrypted.authTag,
      normalizeFolderRoot(payload.uploadFolderRoot)
    ]
  );
  return toPublicSettings(result.rows[0], payload.apiSecret);
};

const testSettings = async (settings) => {
  cloudinary.config({
    cloud_name: settings.cloudName,
    api_key: settings.apiKey,
    api_secret: settings.apiSecret,
    secure: true
  });

  await cloudinary.api.ping();
  return { ok: true };
};

module.exports = {
  getRawSettings,
  getPublicSettings,
  saveSettings,
  testSettings
};
