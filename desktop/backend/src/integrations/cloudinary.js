import crypto from "node:crypto";
import { v2 as cloudinary } from "cloudinary";
import { getEnv } from "../config/env.js";
import { getPool } from "../database/pool.js";
import { getMonitorCloudinarySettingsFromRigweda } from "./rigweda-api.js";

let configuredKey = null;

const TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS monitor_cloudinary_settings (
    organization_id TEXT PRIMARY KEY,
    cloud_name TEXT NOT NULL,
    api_key TEXT NOT NULL,
    api_secret_ciphertext TEXT NOT NULL,
    api_secret_iv TEXT NOT NULL,
    api_secret_auth_tag TEXT NOT NULL,
    upload_folder_root TEXT NOT NULL DEFAULT 'rigweda-monitor',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

const getPoolOrThrow = async () => {
  const pool = getPool();
  await pool.query(TABLE_SQL);
  return pool;
};

const encryptSecret = (value) => {
  const iv = crypto.randomBytes(12);
  const key = crypto.createHash("sha256").update(String(process.env.MONITOR_SETTINGS_SECRET || process.env.JWT_SECRET || "monitor-settings-dev-key")).digest();
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64")
  };
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

const normalizeFolderRoot = (value) =>
  String(value || "rigweda-monitor")
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/+/g, "/") || "rigweda-monitor";

const toPublicSettings = (row, apiSecret) => row ? ({
  cloudName: row.cloud_name,
  apiKey: row.api_key,
  apiSecret,
  uploadFolderRoot: row.upload_folder_root || "rigweda-monitor",
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
  return toPublicSettings(row, decryptSecret(row));
};

const saveLocalSettings = async (organizationId, settings) => {
  if (!organizationId || !settings?.apiSecret) return settings;
  const pool = await getPoolOrThrow();
  const encrypted = encryptSecret(settings.apiSecret);
  await pool.query(
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
    `,
    [
      String(organizationId),
      String(settings.cloudName || "").trim(),
      String(settings.apiKey || "").trim(),
      encrypted.ciphertext,
      encrypted.iv,
      encrypted.authTag,
      normalizeFolderRoot(settings.uploadFolderRoot)
    ]
  );
  return settings;
};

const envCredentials = () => {
  const env = getEnv();
  if (!env.cloudinaryCloudName || !env.cloudinaryApiKey || !env.cloudinaryApiSecret) {
    return null;
  }
  return {
    cloudName: env.cloudinaryCloudName,
    apiKey: env.cloudinaryApiKey,
    apiSecret: env.cloudinaryApiSecret,
    uploadFolderRoot: "rigweda-monitor",
  };
};

const configure = (settings) => {
  const key = `${settings.cloudName}:${settings.apiKey}`;
  if (configuredKey === key) {
    return;
  }

  cloudinary.config({
    cloud_name: settings.cloudName,
    api_key: settings.apiKey,
    api_secret: settings.apiSecret,
    secure: true,
  });
  configuredKey = key;
};

export const resolveCloudinarySettings = async ({ token, organizationId, refresh = true, allowMissing = false } = {}) => {
  const localSettings = await getLocalSettings(organizationId);

  if (token && refresh) {
    try {
      const settings = await getMonitorCloudinarySettingsFromRigweda({ token });
      await saveLocalSettings(organizationId, settings);
      configure(settings);
      return settings;
    } catch (error) {
      if (localSettings) {
        configure(localSettings);
        return localSettings;
      }
    }
  }

  if (localSettings) {
    configure(localSettings);
    return localSettings;
  }

  const settings = envCredentials();
  if (settings) {
    configure(settings);
    return settings;
  }

  if (allowMissing) {
    return null;
  }

  throw new Error("Cloudinary settings are missing. Configure Employee Monitor > Settings in HRMS.");
};

export const uploadBufferToCloudinary = async ({ token, organizationId, buffer, folder, publicId, resourceType }) => {
  await resolveCloudinarySettings({ token, organizationId });

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
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
