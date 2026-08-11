const crypto = require("crypto");
const { v2: cloudinary } = require("cloudinary");
const Employee = require("../employees/employee.model");
const { getMonitorPgPool } = require("../../config/monitorDb");
const settingsService = require("./agent.monitorSettings.service");

const TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS monitor_screenshot_batches (
    id TEXT PRIMARY KEY,
    organization_id TEXT,
    employee_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    expected_count INTEGER NOT NULL DEFAULT 0,
    uploaded_count INTEGER NOT NULL DEFAULT 0,
    duplicate_count INTEGER NOT NULL DEFAULT 0,
    expected_bytes BIGINT NOT NULL DEFAULT 0,
    uploaded_bytes BIGINT NOT NULL DEFAULT 0,
    first_captured_at TIMESTAMPTZ,
    last_captured_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    UNIQUE (device_id, id)
  );

  CREATE TABLE IF NOT EXISTS monitor_screenshots (
    id TEXT PRIMARY KEY,
    batch_id TEXT REFERENCES monitor_screenshot_batches(id) ON DELETE SET NULL,
    organization_id TEXT,
    employee_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    client_screenshot_id TEXT NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL,
    original_file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    sha256 TEXT NOT NULL,
    size_bytes BIGINT NOT NULL DEFAULT 0,
    cloudinary_folder TEXT,
    cloudinary_public_id TEXT,
    cloudinary_asset_id TEXT,
    cloudinary_version BIGINT,
    cloudinary_format TEXT,
    cloudinary_url TEXT,
    duplicate_of TEXT,
    upload_status TEXT NOT NULL DEFAULT 'pending',
    processing_status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    uploaded_at TIMESTAMPTZ,
    UNIQUE (device_id, client_screenshot_id)
  );

  CREATE INDEX IF NOT EXISTS idx_monitor_screenshots_employee_time
  ON monitor_screenshots (employee_id, captured_at DESC);

  CREATE INDEX IF NOT EXISTS idx_monitor_screenshots_sha
  ON monitor_screenshots (organization_id, employee_id, sha256);
`;

const resolveDateFolder = (capturedAt) =>
  new Date(capturedAt).toISOString().slice(0, 10).replaceAll("-", "_");

const safePublicIdPart = (value) =>
  String(value)
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

const buildBatchFolder = ({ employeeId, capturedAt, folderRoot }) =>
  `${String(folderRoot || "rigweda-monitor").replace(/^\/+|\/+$/g, "")}/${employeeId}/${resolveDateFolder(capturedAt)}`;

const buildBatchPublicId = ({ capturedAt, clientScreenshotId, sha256 }) => {
  const timestamp = new Date(capturedAt)
    .toISOString()
    .replace(/[-:.]/g, "")
    .replace("T", "_")
    .replace("Z", "");
  return `${timestamp}_${safePublicIdPart(clientScreenshotId).slice(-12)}_${sha256.slice(0, 12)}`;
};

const ensureMonitorTables = async () => {
  const pool = await getMonitorPgPool();
  await pool.query(TABLE_SQL);
  return pool;
};

const resolveEmployee = async (req) => {
  if (req.user?.employeeId) {
    return {
      _id: req.user.employeeId,
      firstName: req.user.firstName || null,
      lastName: req.user.lastName || null,
      employeeCode: req.user.employeeCode || null
    };
  }

  const employee = await Employee.findOne({
    userId: req.user.userId,
    organizationId: req.user.organizationId
  }).select("_id firstName lastName employeeCode").lean();

  if (!employee) {
    throw { code: 404, message: "Employee profile not found for the authenticated user." };
  }
  return employee;
};

const createSignedUploadPayload = ({ settings, folder, publicId, context = {} }) => {
  cloudinary.config({
    cloud_name: settings.cloudName,
    api_key: settings.apiKey,
    api_secret: settings.apiSecret,
    secure: true
  });

  const timestamp = Math.floor(Date.now() / 1000);
  const params = { folder, public_id: publicId, timestamp };

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
      signature: cloudinary.utils.api_sign_request(params, settings.apiSecret)
    }
  };
};

exports.createUploadSession = async ({ req, payload }) => {
  const employee = await resolveEmployee(req);
  const employeeId = String(employee._id);
  const organizationId = String(req.user.organizationId);
  const settings = await settingsService.getRawSettings(organizationId);

  if (!settings) {
    throw { code: 400, message: "Cloudinary monitor settings are not configured for this organization." };
  }

  const pool = await ensureMonitorTables();
  const screenshots = payload.screenshots || [];
  const firstCapturedAt = screenshots[0]?.capturedAt;
  const lastCapturedAt = screenshots[screenshots.length - 1]?.capturedAt;

  await pool.query(
    `INSERT INTO monitor_screenshot_batches (
      id, organization_id, employee_id, device_id, status, expected_count,
      expected_bytes, first_captured_at, last_captured_at
    ) VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8)
    ON CONFLICT (device_id, id) DO UPDATE SET
      expected_count = EXCLUDED.expected_count,
      expected_bytes = EXCLUDED.expected_bytes,
      first_captured_at = EXCLUDED.first_captured_at,
      last_captured_at = EXCLUDED.last_captured_at`,
    [
      payload.batchId,
      organizationId,
      employeeId,
      payload.deviceId,
      screenshots.length,
      screenshots.reduce((sum, item) => sum + Number(item.sizeBytes || 0), 0),
      firstCapturedAt,
      lastCapturedAt
    ]
  );

  const uploads = [];

  for (const item of screenshots) {
    const existing = await pool.query(
      `SELECT * FROM monitor_screenshots
       WHERE organization_id = $1
         AND employee_id = $2
         AND sha256 = $3
         AND upload_status = 'uploaded'
         AND cloudinary_public_id IS NOT NULL
       ORDER BY captured_at DESC
       LIMIT 1`,
      [organizationId, employeeId, item.sha256]
    );

    const folder = buildBatchFolder({
      employeeId,
      capturedAt: item.capturedAt,
      folderRoot: settings.uploadFolderRoot
    });
    const publicId = buildBatchPublicId(item);

    await pool.query(
      `INSERT INTO monitor_screenshots (
        id, batch_id, organization_id, employee_id, device_id, client_screenshot_id,
        captured_at, original_file_name, mime_type, width, height, sha256,
        size_bytes, cloudinary_folder, cloudinary_public_id, upload_status
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, $15, 'pending'
      )
      ON CONFLICT (device_id, client_screenshot_id) DO UPDATE SET
        batch_id = EXCLUDED.batch_id,
        size_bytes = EXCLUDED.size_bytes,
        cloudinary_folder = EXCLUDED.cloudinary_folder,
        cloudinary_public_id = EXCLUDED.cloudinary_public_id`,
      [
        crypto.randomUUID(),
        payload.batchId,
        organizationId,
        employeeId,
        payload.deviceId,
        item.clientScreenshotId,
        item.capturedAt,
        item.originalFileName,
        item.mimeType,
        item.width || null,
        item.height || null,
        item.sha256,
        item.sizeBytes,
        folder,
        publicId
      ]
    );

    if (existing.rows[0]) {
      uploads.push({
        clientScreenshotId: item.clientScreenshotId,
        status: "duplicate",
        duplicateOf: existing.rows[0].id,
        cloudinaryUrl: existing.rows[0].cloudinary_url
      });
      continue;
    }

    uploads.push({
      clientScreenshotId: item.clientScreenshotId,
      status: "upload",
      cloudinaryPublicId: publicId,
      ...createSignedUploadPayload({
        settings,
        folder,
        publicId,
        context: {
          batch_id: payload.batchId,
          employee_id: employeeId,
          device_id: payload.deviceId,
          captured_at: item.capturedAt,
          sha256: item.sha256
        }
      })
    });
  }

  return {
    batchId: payload.batchId,
    employeeId,
    deviceId: payload.deviceId,
    expiresInSeconds: 300,
    uploads
  };
};

exports.completeUploadSession = async ({ batchId, payload }) => {
  const pool = await ensureMonitorTables();

  for (const upload of payload.uploaded || []) {
    await pool.query(
      `UPDATE monitor_screenshots SET
        cloudinary_asset_id = $3,
        cloudinary_version = $4,
        cloudinary_format = $5,
        cloudinary_url = $6,
        size_bytes = COALESCE($7, size_bytes),
        upload_status = 'uploaded',
        error_message = NULL,
        uploaded_at = NOW()
      WHERE device_id = $1 AND client_screenshot_id = $2`,
      [
        payload.deviceId,
        upload.clientScreenshotId,
        upload.cloudinaryAssetId || null,
        upload.cloudinaryVersion || null,
        upload.cloudinaryFormat || null,
        upload.cloudinaryUrl,
        upload.sizeBytes || null
      ]
    );
  }

  for (const duplicate of payload.duplicates || []) {
    await pool.query(
      `UPDATE monitor_screenshots SET
        duplicate_of = $3,
        upload_status = 'duplicate',
        processing_status = 'complete',
        uploaded_at = NOW()
      WHERE device_id = $1 AND client_screenshot_id = $2`,
      [payload.deviceId, duplicate.clientScreenshotId, duplicate.duplicateOf]
    );
  }

  const result = await pool.query(
    `WITH counts AS (
      SELECT
        COUNT(*) FILTER (WHERE upload_status = 'uploaded') AS uploaded_count,
        COUNT(*) FILTER (WHERE upload_status = 'duplicate') AS duplicate_count,
        COALESCE(SUM(size_bytes) FILTER (WHERE upload_status = 'uploaded'), 0) AS uploaded_bytes
      FROM monitor_screenshots
      WHERE batch_id = $1 AND device_id = $2
    )
    UPDATE monitor_screenshot_batches b SET
      uploaded_count = counts.uploaded_count,
      duplicate_count = counts.duplicate_count,
      uploaded_bytes = counts.uploaded_bytes,
      status = CASE
        WHEN counts.uploaded_count + counts.duplicate_count >= b.expected_count THEN 'complete'
        ELSE 'partial'
      END,
      completed_at = CASE
        WHEN counts.uploaded_count + counts.duplicate_count >= b.expected_count THEN NOW()
        ELSE b.completed_at
      END
    FROM counts
    WHERE b.id = $1 AND b.device_id = $2
    RETURNING b.*`,
    [batchId, payload.deviceId]
  );

  return result.rows[0] || null;
};
