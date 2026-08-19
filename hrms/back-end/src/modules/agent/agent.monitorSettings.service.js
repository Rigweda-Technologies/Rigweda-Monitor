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
    screenshots_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    mouse_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    keyboard_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    app_usage_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    browser_history_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    screenshot_interval_minutes INTEGER NOT NULL DEFAULT 1,
    mouse_heartbeat_minutes INTEGER NOT NULL DEFAULT 1,
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

const normalizeBoolean = (value, fallback = true) => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
};

const getPoolOrThrow = async () => {
  const pool = await getMonitorPgPool();
  await pool.query(TABLE_SQL);

  const columnsResult = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'monitor_cloudinary_settings'"
  );
  const columns = new Set(columnsResult.rows.map((row) => row.column_name));
  const alterStatements = [];
  if (!columns.has("screenshots_enabled")) {
    alterStatements.push("ADD COLUMN screenshots_enabled BOOLEAN NOT NULL DEFAULT TRUE");
  }
  if (!columns.has("mouse_enabled")) {
    alterStatements.push("ADD COLUMN mouse_enabled BOOLEAN NOT NULL DEFAULT TRUE");
  }
  if (!columns.has("keyboard_enabled")) {
    alterStatements.push("ADD COLUMN keyboard_enabled BOOLEAN NOT NULL DEFAULT TRUE");
  }
  if (!columns.has("app_usage_enabled")) {
    alterStatements.push("ADD COLUMN app_usage_enabled BOOLEAN NOT NULL DEFAULT TRUE");
  }
  if (!columns.has("browser_history_enabled")) {
    alterStatements.push("ADD COLUMN browser_history_enabled BOOLEAN NOT NULL DEFAULT FALSE");
  }
  if (!columns.has("screenshot_interval_minutes")) {
    alterStatements.push("ADD COLUMN screenshot_interval_minutes INTEGER NOT NULL DEFAULT 1");
  }
  if (!columns.has("mouse_heartbeat_minutes")) {
    alterStatements.push("ADD COLUMN mouse_heartbeat_minutes INTEGER NOT NULL DEFAULT 1");
  }
  if (alterStatements.length > 0) {
    await pool.query(`ALTER TABLE monitor_cloudinary_settings ${alterStatements.join(", ")}`);
  }

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

const normalizeMinutes = (value, fallback = 1, min = 1, max = 240) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
};

const toPublicSettings = (row, secret) => row && ({
  cloudName: row.cloud_name,
  apiKey: row.api_key,
  apiSecretMasked: maskSecret(secret),
  uploadFolderRoot: row.upload_folder_root || "rigweda-monitor",
  screenshotsEnabled: row.screenshots_enabled ?? true,
  mouseEnabled: row.mouse_enabled ?? true,
  keyboardEnabled: row.keyboard_enabled ?? true,
  appUsageEnabled: row.app_usage_enabled ?? true,
  browserHistoryEnabled: row.browser_history_enabled ?? false,
  screenshotIntervalMinutes: normalizeMinutes(row.screenshot_interval_minutes, 1),
  mouseHeartbeatMinutes: normalizeMinutes(row.mouse_heartbeat_minutes, 1),
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
    screenshotsEnabled: row.screenshots_enabled ?? true,
    mouseEnabled: row.mouse_enabled ?? true,
    keyboardEnabled: row.keyboard_enabled ?? true,
    appUsageEnabled: row.app_usage_enabled ?? true,
    browserHistoryEnabled: row.browser_history_enabled ?? false,
    screenshotIntervalMinutes: normalizeMinutes(row.screenshot_interval_minutes, 1),
    mouseHeartbeatMinutes: normalizeMinutes(row.mouse_heartbeat_minutes, 1),
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
  const existingResult = await pool.query(
    "SELECT * FROM monitor_cloudinary_settings WHERE organization_id = $1",
    [String(organizationId)]
  );
  const existing = existingResult.rows[0] || null;
  const resolvedSecret = String(payload.apiSecret || "").trim() || (existing ? decryptSecret(existing) : "");
  if (!resolvedSecret) {
    throw { code: 400, message: "API secret is required when creating monitor settings." };
  }
  const encrypted = encryptSecret(resolvedSecret);
  const result = await pool.query(
    `
      INSERT INTO monitor_cloudinary_settings (
        organization_id, cloud_name, api_key, api_secret_ciphertext,
        api_secret_iv, api_secret_auth_tag, upload_folder_root,
        screenshots_enabled, mouse_enabled, keyboard_enabled, app_usage_enabled, browser_history_enabled,
        screenshot_interval_minutes, mouse_heartbeat_minutes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (organization_id)
      DO UPDATE SET
        cloud_name = EXCLUDED.cloud_name,
        api_key = EXCLUDED.api_key,
        api_secret_ciphertext = EXCLUDED.api_secret_ciphertext,
        api_secret_iv = EXCLUDED.api_secret_iv,
        api_secret_auth_tag = EXCLUDED.api_secret_auth_tag,
        upload_folder_root = EXCLUDED.upload_folder_root,
        screenshots_enabled = EXCLUDED.screenshots_enabled,
        mouse_enabled = EXCLUDED.mouse_enabled,
        keyboard_enabled = EXCLUDED.keyboard_enabled,
        app_usage_enabled = EXCLUDED.app_usage_enabled,
        browser_history_enabled = EXCLUDED.browser_history_enabled,
        screenshot_interval_minutes = EXCLUDED.screenshot_interval_minutes,
        mouse_heartbeat_minutes = EXCLUDED.mouse_heartbeat_minutes,
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
      normalizeFolderRoot(payload.uploadFolderRoot),
      normalizeBoolean(payload.screenshotsEnabled, true),
      normalizeBoolean(payload.mouseEnabled, true),
      normalizeBoolean(payload.keyboardEnabled, true),
      normalizeBoolean(payload.appUsageEnabled, true),
      normalizeBoolean(payload.browserHistoryEnabled, false),
      normalizeMinutes(payload.screenshotIntervalMinutes, 1),
      normalizeMinutes(payload.mouseHeartbeatMinutes, 1)
    ]
  );
  return toPublicSettings(result.rows[0], resolvedSecret);
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
