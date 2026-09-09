import crypto from "node:crypto";
import { v2 as cloudinary } from "cloudinary";
import { getPool } from "../database/pool.js";


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
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

const getPoolOrThrow = async () => {
  const pool = getPool();
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
  if (alterStatements.length > 0) {
    await pool.query(`ALTER TABLE monitor_cloudinary_settings ${alterStatements.join(", ")}`);
  }

  return pool;
};

const decryptSecret = (row) => {
  const key = crypto.createHash("sha256").update(String(process.env.MONITOR_SETTINGS_SECRET || process.env.JWT_SECRET || "monitor-settings-dev-key")).digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(row.api_secret_iv, "base64"));
  decipher.setAuthTag(Buffer.from(row.api_secret_auth_tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(row.api_secret_ciphertext, "base64")),
    decipher.final()
  ]).toString("utf8");
};

const toServerSettings = (row, apiSecret) => row ? ({
  cloudName: row.cloud_name,
  apiKey: row.api_key,
  apiSecret,
  uploadFolderRoot: row.upload_folder_root || "rigweda-monitor",
  screenshotsEnabled: row.screenshots_enabled ?? true,
  mouseEnabled: row.mouse_enabled ?? true,
  keyboardEnabled: row.keyboard_enabled ?? true,
  updatedAt: row.updated_at
}) : null;

const getLocalSettings = async (organizationId) => {
  if (!organizationId) return null;
  const pool = await getPoolOrThrow();
  const result = await pool.query(
    "SELECT * FROM monitor_cloudinary_settings WHERE organization_id = $1",
    [String(organizationId)]
  );
  const row = result.rows[0] || null;
  if (!row) return null;
  return toServerSettings(row, decryptSecret(row));
};

// Credentials stay on the servers. HRMS and Desktop use the same monitoring
// database and MONITOR_SETTINGS_SECRET; employee HTTP APIs never transport secrets.
export const resolveCloudinarySettings = async ({ organizationId, allowMissing = false } = {}) => {
  if (!organizationId) {
    const error = new Error("Organization is required for Cloudinary settings.");
    error.statusCode = 403;
    throw error;
  }
  const settings = await getLocalSettings(organizationId);
  if (settings) return settings;
  if (allowMissing) return null;
  throw new Error("Cloudinary settings are missing. Configure Employee Monitor > Settings in HRMS.");
};

export const publicUploadConfig = (settings) => ({
  cloudName: settings.cloudName,
  apiKey: settings.apiKey,
  uploadFolderRoot: settings.uploadFolderRoot,
  screenshotsEnabled: settings.screenshotsEnabled,
  mouseEnabled: settings.mouseEnabled,
  keyboardEnabled: settings.keyboardEnabled,
  updatedAt: settings.updatedAt,
});

export const uploadBufferToCloudinary = async ({ token, organizationId, buffer, folder, publicId, resourceType }) => {
  const settings = await resolveCloudinarySettings({ organizationId });

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        cloud_name: settings.cloudName,
        api_key: settings.apiKey,
        api_secret: settings.apiSecret,
        folder,
        public_id: publicId,
        resource_type: resourceType,
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(result);
      }
    );

    uploadStream.end(buffer);
  });
};

export const createSignedUploadPayload = async ({ token, organizationId, folder, publicId, context = {} }) => {
  const settings = await resolveCloudinarySettings({ token, organizationId });
  const timestamp = Math.floor(Date.now() / 1000);
  const params = {
    folder,
    public_id: publicId,
    timestamp,
    type: "authenticated",
  };

  if (Object.keys(context).length > 0) {
    params.context = Object.entries(context)
      .map(([key, value]) => `${key}=${String(value).replaceAll("|", " ")}`)
      .join("|");
  }

  return {
    cloudName: settings.cloudName,
    apiKey: settings.apiKey,
    uploadUrl: `https://api.cloudinary.com/v1_1/${settings.cloudName}/image/upload`,
    params: {
      ...params,
      signature: cloudinary.utils.api_sign_request(params, settings.apiSecret),
    },
  };
};
