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

  await pool.query(`
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
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS monitor_activity_events (
      id TEXT PRIMARY KEY,
      organization_id TEXT,
      employee_id TEXT NOT NULL,
      employee_name TEXT,
      device_id TEXT NOT NULL,
      observed_at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'idle', 'offline')),
      active_seconds INTEGER NOT NULL DEFAULT 0 CHECK (active_seconds >= 0),
      idle_seconds INTEGER NOT NULL DEFAULT 0 CHECK (idle_seconds >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (device_id, id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS monitor_device_presence (
      device_id TEXT PRIMARY KEY,
      organization_id TEXT,
      employee_id TEXT NOT NULL,
      employee_name TEXT,
      status TEXT NOT NULL CHECK (status IN ('active', 'idle', 'offline')),
      last_seen_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_monitor_activity_events_employee_time
    ON monitor_activity_events (organization_id, employee_id, observed_at DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_monitor_device_presence_organization_seen
    ON monitor_device_presence (organization_id, last_seen_at DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS monitor_app_usage_sessions (
      session_id TEXT PRIMARY KEY,
      organization_id TEXT,
      employee_id TEXT NOT NULL,
      employee_name TEXT,
      device_id TEXT NOT NULL,
      observed_at TIMESTAMPTZ NOT NULL,
      app_name TEXT NOT NULL,
      process_name TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL,
      ended_at TIMESTAMPTZ NOT NULL,
      active_seconds INTEGER NOT NULL DEFAULT 0,
      key_press_count INTEGER NOT NULL DEFAULT 0,
      key_names JSONB NOT NULL DEFAULT '[]',
      typed_text TEXT NOT NULL DEFAULT '',
      key_stream_text TEXT NOT NULL DEFAULT '',
      upload_status TEXT NOT NULL DEFAULT 'uploaded',
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      uploaded_at TIMESTAMPTZ,
      UNIQUE (device_id, session_id)
    )
  `);

  await pool.query(`
    ALTER TABLE monitor_app_usage_sessions
    ADD COLUMN IF NOT EXISTS key_press_count INTEGER NOT NULL DEFAULT 0
  `);

  await pool.query(`
    ALTER TABLE monitor_app_usage_sessions
    ADD COLUMN IF NOT EXISTS key_names JSONB NOT NULL DEFAULT '[]'
  `);

  await pool.query(`
    ALTER TABLE monitor_app_usage_sessions
    ADD COLUMN IF NOT EXISTS typed_text TEXT NOT NULL DEFAULT ''
  `);

  await pool.query(`
    ALTER TABLE monitor_app_usage_sessions
    ADD COLUMN IF NOT EXISTS key_stream_text TEXT NOT NULL DEFAULT ''
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_monitor_app_usage_sessions_employee_time
    ON monitor_app_usage_sessions (organization_id, employee_id, started_at DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS monitor_browser_history (
      entry_id TEXT PRIMARY KEY,
      organization_id TEXT,
      employee_id TEXT NOT NULL,
      employee_name TEXT,
      device_id TEXT NOT NULL,
      observed_at TIMESTAMPTZ NOT NULL,
      browser TEXT NOT NULL,
      url TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      active_window_title TEXT,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (device_id, entry_id)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_monitor_browser_history_employee_time
    ON monitor_browser_history (organization_id, employee_id, observed_at DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_monitor_browser_history_browser_time
    ON monitor_browser_history (organization_id, browser, observed_at DESC)
  `);
};

