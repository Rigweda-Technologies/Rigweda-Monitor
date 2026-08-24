import { getPool } from "../../database/pool.js";

export const screenshotModel = {
  async findAll() {
    const { rows } = await getPool().query(
      `SELECT * FROM monitor_screenshots ORDER BY captured_at DESC LIMIT 500`
    );
    return rows;
  },

  async create(record) {
    const { rows } = await getPool().query(
      `INSERT INTO monitor_screenshots (
        id, organization_id, employee_id, device_id, client_screenshot_id,
        captured_at, original_file_name, mime_type, sha256, size_bytes,
        cloudinary_folder, cloudinary_public_id, cloudinary_asset_id,
        cloudinary_url, upload_status, processing_status, uploaded_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, 'uploaded', 'pending', NOW()
      )
      ON CONFLICT (device_id, client_screenshot_id) DO UPDATE SET
        cloudinary_folder = EXCLUDED.cloudinary_folder,
        cloudinary_public_id = EXCLUDED.cloudinary_public_id,
        cloudinary_asset_id = EXCLUDED.cloudinary_asset_id,
        cloudinary_url = EXCLUDED.cloudinary_url,
        upload_status = 'uploaded',
        uploaded_at = NOW()
      RETURNING *`,
      [
        record.id,
        record.organizationId || null,
        record.employeeId,
        record.deviceId || "unknown",
        record.clientScreenshotId || record.id,
        record.capturedAt,
        record.originalFileName,
        record.mimeType,
        record.sha256 || "legacy-upload",
        record.sizeBytes || 0,
        record.cloudinaryFolder,
        record.cloudinaryPublicId,
        record.cloudinaryAssetId,
        record.cloudinaryUrl,
      ]
    );
    return rows[0];
  },

  async upsertBatch(batch) {
    const { rows } = await getPool().query(
      `INSERT INTO monitor_screenshot_batches (
        id, organization_id, employee_id, device_id, status, expected_count,
        expected_bytes, first_captured_at, last_captured_at
      ) VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8)
      ON CONFLICT (device_id, id) DO UPDATE SET
        expected_count = EXCLUDED.expected_count,
        expected_bytes = EXCLUDED.expected_bytes,
        first_captured_at = EXCLUDED.first_captured_at,
        last_captured_at = EXCLUDED.last_captured_at
      RETURNING *`,
      [
        batch.batchId,
        batch.organizationId || null,
        batch.employeeId,
        batch.deviceId,
        batch.expectedCount,
        batch.expectedBytes,
        batch.firstCapturedAt,
        batch.lastCapturedAt,
      ]
    );
    return rows[0];
  },

  async upsertPendingScreenshot(record) {
    const { rows } = await getPool().query(
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
        cloudinary_public_id = EXCLUDED.cloudinary_public_id
      RETURNING *`,
      [
        record.id,
        record.batchId,
        record.organizationId || null,
        record.employeeId,
        record.deviceId,
        record.clientScreenshotId,
        record.capturedAt,
        record.originalFileName,
        record.mimeType,
        record.width || null,
        record.height || null,
        record.sha256,
        record.sizeBytes,
        record.cloudinaryFolder,
        record.cloudinaryPublicId,
      ]
    );
    return rows[0];
  },

  async findUploadedByHash({ organizationId, employeeId, sha256 }) {
    const { rows } = await getPool().query(
      `SELECT * FROM monitor_screenshots
       WHERE ($1::text IS NULL OR organization_id = $1)
         AND employee_id = $2
         AND sha256 = $3
         AND upload_status = 'uploaded'
         AND cloudinary_public_id IS NOT NULL
       ORDER BY captured_at DESC
       LIMIT 1`,
      [organizationId || null, employeeId, sha256]
    );
    return rows[0] || null;
  },

  async markUploaded({ deviceId, clientScreenshotId, upload }) {
    const { rows } = await getPool().query(
      `UPDATE monitor_screenshots SET
        cloudinary_asset_id = $3,
        cloudinary_version = $4,
        cloudinary_format = $5,
        cloudinary_url = $6,
        size_bytes = COALESCE($7, size_bytes),
        upload_status = 'uploaded',
        error_message = NULL,
        uploaded_at = NOW()
      WHERE device_id = $1 AND client_screenshot_id = $2
      RETURNING *`,
      [
        deviceId,
        clientScreenshotId,
        upload.cloudinaryAssetId || null,
        upload.cloudinaryVersion || null,
        upload.cloudinaryFormat || null,
        upload.cloudinaryUrl,
        upload.sizeBytes || null,
      ]
    );
    return rows[0];
  },

  async markDuplicate({ deviceId, clientScreenshotId, duplicateOf }) {
    const { rows } = await getPool().query(
      `UPDATE monitor_screenshots SET
        duplicate_of = $3,
        upload_status = 'duplicate',
        processing_status = 'complete',
        uploaded_at = NOW()
      WHERE device_id = $1 AND client_screenshot_id = $2
      RETURNING *`,
      [deviceId, clientScreenshotId, duplicateOf]
    );
    return rows[0];
  },

  async completeBatch({ batchId, deviceId }) {
    const { rows } = await getPool().query(
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
      [batchId, deviceId]
    );
    return rows[0];
  },
};
