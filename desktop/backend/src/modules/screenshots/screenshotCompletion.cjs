// Kept identical in both independently deployed backends; tested against PostgreSQL.
const denied = () => Object.assign(new Error('Screenshot batch or item not found for this account.'), { code: 404, statusCode: 404 });
module.exports = async function completeScreenshotBatch(pool, { organizationId, employeeId, deviceId, batchId, uploaded = [], duplicates = [], verifyAsset }) {
  if (!organizationId || !employeeId || !deviceId || !batchId) throw denied();
  const scope = [String(organizationId), String(employeeId), deviceId, batchId];
  const ids = [...uploaded, ...duplicates].map(item => item.clientScreenshotId);
  if (new Set(ids).size !== ids.length) throw Object.assign(new Error('Repeated screenshot IDs.'), { code: 400, statusCode: 400 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const batch = await client.query(`SELECT id FROM monitor_screenshot_batches
      WHERE organization_id = $1 AND employee_id = $2 AND device_id = $3 AND id = $4 FOR UPDATE`, scope);
    if (!batch.rows.length) throw denied();
    // Lock and validate every item before modifying any metadata.
    const items = await client.query(`SELECT * FROM monitor_screenshots
      WHERE organization_id = $1 AND employee_id = $2 AND device_id = $3 AND batch_id = $4
        AND client_screenshot_id = ANY($5::text[]) FOR UPDATE`, [...scope, ids]);
    if (items.rows.length !== ids.length) throw denied();
    const verified = new Map();
    const verify = async row => {
      if (typeof verifyAsset !== 'function') throw Object.assign(new Error('Upload verifier unavailable'), { code: 503, statusCode: 503 });
      if (!verified.has(row.id)) verified.set(row.id, await verifyAsset(row));
      return verified.get(row.id);
    };
    for (const claimed of uploaded) {
      const row = items.rows.find(item => item.client_screenshot_id === claimed.clientScreenshotId);
      const upload = { ...await verify(row), clientScreenshotId: claimed.clientScreenshotId };
      const result = await client.query(`UPDATE monitor_screenshots SET
        cloudinary_asset_id = $6, cloudinary_version = $7, cloudinary_format = $8,
        cloudinary_url = $9, size_bytes = COALESCE($10, size_bytes),
        upload_status = 'uploaded', error_message = NULL, uploaded_at = NOW()
        WHERE organization_id = $1 AND employee_id = $2 AND device_id = $3 AND batch_id = $4
          AND client_screenshot_id = $5`, [...scope, upload.clientScreenshotId,
        upload.cloudinaryAssetId || null, upload.cloudinaryVersion || null,
        upload.cloudinaryFormat || null, upload.cloudinaryUrl, upload.sizeBytes || null]);
      if (result.rowCount !== 1) throw denied();
    }
    for (const duplicate of duplicates) {
      const source = await client.query(`SELECT source.* FROM monitor_screenshots source
        JOIN monitor_screenshots target ON target.sha256 = source.sha256
        WHERE target.organization_id = $1 AND target.employee_id = $2 AND target.device_id = $3
          AND target.batch_id = $4 AND target.client_screenshot_id = $5
          AND source.id = $6 AND source.organization_id = $1 AND source.employee_id = $2
          AND source.upload_status = 'uploaded' AND source.id <> target.id`,
      [...scope, duplicate.clientScreenshotId, duplicate.duplicateOf]);
      if (source.rows.length !== 1) throw denied();
      await verify(source.rows[0]);
      const result = await client.query(`UPDATE monitor_screenshots target SET
        duplicate_of = source.id, upload_status = 'duplicate', processing_status = 'complete', uploaded_at = NOW()
        FROM monitor_screenshots source
        WHERE target.organization_id = $1 AND target.employee_id = $2 AND target.device_id = $3
          AND target.batch_id = $4 AND target.client_screenshot_id = $5
          AND source.id = $6 AND source.organization_id = $1 AND source.employee_id = $2
          AND source.sha256 = target.sha256 AND source.upload_status = 'uploaded'
          AND source.cloudinary_public_id IS NOT NULL AND source.id <> target.id`,
      [...scope, duplicate.clientScreenshotId, duplicate.duplicateOf]);
      if (result.rowCount !== 1) throw denied();
    }
    const result = await client.query(`WITH counts AS (
      SELECT COUNT(*) FILTER (WHERE upload_status = 'uploaded') AS uploaded_count,
        COUNT(*) FILTER (WHERE upload_status = 'duplicate') AS duplicate_count,
        COALESCE(SUM(size_bytes) FILTER (WHERE upload_status = 'uploaded'), 0) AS uploaded_bytes
      FROM monitor_screenshots
      WHERE organization_id = $1 AND employee_id = $2 AND device_id = $3 AND batch_id = $4
    ) UPDATE monitor_screenshot_batches b SET
      uploaded_count = counts.uploaded_count, duplicate_count = counts.duplicate_count,
      uploaded_bytes = counts.uploaded_bytes,
      status = CASE WHEN counts.uploaded_count + counts.duplicate_count >= b.expected_count THEN 'complete' ELSE 'partial' END,
      completed_at = CASE WHEN counts.uploaded_count + counts.duplicate_count >= b.expected_count THEN NOW() ELSE b.completed_at END
      FROM counts WHERE b.organization_id = $1 AND b.employee_id = $2 AND b.device_id = $3 AND b.id = $4
      RETURNING b.*`, scope);
    if (result.rowCount !== 1) throw denied();
    await client.query('COMMIT');
    return { ...result.rows[0], acknowledgedScreenshotIds: ids };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
