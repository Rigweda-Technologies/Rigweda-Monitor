import { getPool } from "./pool.js";

export const initializeDatabase = async () => {
  const pool = getPool();

  await pool.query(`
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
    )
  `);

  await pool.query(`
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
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_monitor_screenshots_employee_time
    ON monitor_screenshots (employee_id, captured_at DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_monitor_screenshots_sha
    ON monitor_screenshots (organization_id, employee_id, sha256)
  `);
};

