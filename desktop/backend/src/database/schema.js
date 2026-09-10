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
      daily_key TEXT UNIQUE,
      organization_id TEXT,
      employee_id TEXT NOT NULL,
      employee_name TEXT,
      employee_code TEXT,
      device_id TEXT NOT NULL,
      activity_date DATE,
      observed_at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'idle', 'offline')),
      active_seconds INTEGER NOT NULL DEFAULT 0 CHECK (active_seconds >= 0),
      idle_seconds INTEGER NOT NULL DEFAULT 0 CHECK (idle_seconds >= 0),
      event_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (device_id, id)
    )
  `);

  await pool.query(`
    ALTER TABLE monitor_activity_events
    ADD COLUMN IF NOT EXISTS activity_date DATE
  `);

  await pool.query(`
    ALTER TABLE monitor_activity_events
    ADD COLUMN IF NOT EXISTS daily_key TEXT
  `);

  await pool.query(`
    ALTER TABLE monitor_activity_events
    ADD COLUMN IF NOT EXISTS event_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]
  `);

  await pool.query(`
    UPDATE monitor_activity_events
    SET activity_date = (observed_at AT TIME ZONE 'Asia/Kolkata')::date
    WHERE activity_date IS NULL
  `);

  await pool.query(`
    UPDATE monitor_activity_events
    SET daily_key = COALESCE(organization_id, '') || ':' || employee_id || ':' || activity_date::text
    WHERE daily_key IS NULL
      AND activity_date IS NOT NULL
  `);

  await pool.query(`
    WITH missing_event_ids AS (
      SELECT id
      FROM monitor_activity_events
      WHERE daily_key IS NOT NULL
        AND NOT (event_ids @> ARRAY[id])
    )
    UPDATE monitor_activity_events
    SET event_ids = array_append(event_ids, id)
    WHERE id IN (SELECT id FROM missing_event_ids)
  `);

  await pool.query(`
    WITH grouped AS (
      SELECT
        daily_key,
        ARRAY(
          SELECT DISTINCT event_id
          FROM unnest(ARRAY_AGG(id)) AS event_id
          WHERE event_id IS NOT NULL
        ) AS merged_event_ids
      FROM monitor_activity_events
      WHERE daily_key IS NOT NULL
      GROUP BY daily_key
      HAVING COUNT(*) > 1
    )
    UPDATE monitor_activity_events events
    SET event_ids = grouped.merged_event_ids
    FROM grouped
    WHERE events.daily_key = grouped.daily_key
  `);

  await pool.query(`
    WITH grouped AS (
      SELECT
        daily_key,
        (ARRAY_AGG(id ORDER BY observed_at DESC, created_at DESC, id DESC))[1] AS keeper_id,
        (ARRAY_AGG(status ORDER BY observed_at DESC, created_at DESC, id DESC))[1] AS latest_status,
        (ARRAY_AGG(device_id ORDER BY observed_at DESC, created_at DESC, id DESC))[1] AS latest_device_id,
        (ARRAY_AGG(employee_name ORDER BY (employee_name IS NULL), observed_at DESC, created_at DESC, id DESC))[1] AS latest_employee_name,
        MAX(observed_at) AS latest_observed_at,
        SUM(active_seconds)::integer AS total_active_seconds,
        SUM(idle_seconds)::integer AS total_idle_seconds
      FROM monitor_activity_events
      WHERE daily_key IS NOT NULL
      GROUP BY daily_key
      HAVING COUNT(*) > 1
    )
    UPDATE monitor_activity_events events
    SET
      device_id = grouped.latest_device_id,
      employee_name = grouped.latest_employee_name,
      observed_at = grouped.latest_observed_at,
      status = grouped.latest_status,
      active_seconds = grouped.total_active_seconds,
      idle_seconds = grouped.total_idle_seconds
    FROM grouped
    WHERE events.id = grouped.keeper_id
  `);

  await pool.query(`
    WITH grouped AS (
      SELECT
        daily_key,
        (ARRAY_AGG(id ORDER BY observed_at DESC, created_at DESC, id DESC))[1] AS keeper_id
      FROM monitor_activity_events
      WHERE daily_key IS NOT NULL
      GROUP BY daily_key
      HAVING COUNT(*) > 1
    )
    DELETE FROM monitor_activity_events events
    USING grouped
    WHERE events.daily_key = grouped.daily_key
      AND events.id <> grouped.keeper_id
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_monitor_activity_events_daily_key
    ON monitor_activity_events (daily_key)
    WHERE daily_key IS NOT NULL
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
      employee_code TEXT,
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS monitor_device_health (
      id BIGSERIAL PRIMARY KEY,
      organization_id TEXT,
      employee_id TEXT NOT NULL,
      employee_name TEXT,
      device_id TEXT NOT NULL,
      hostname TEXT,
      platform TEXT,
      platform_version TEXT,
      agent_version TEXT,
      cpu_model TEXT,
      cpu_core_count INTEGER,
      cpu_percent NUMERIC,
      memory_total_bytes BIGINT,
      memory_used_bytes BIGINT,
      memory_percent NUMERIC,
      disks JSONB NOT NULL DEFAULT '[]'::jsonb,
      temperature_c NUMERIC,
      battery_percent NUMERIC,
      battery_charging BOOLEAN,
      uptime_seconds BIGINT,
      last_seen_at TIMESTAMPTZ NOT NULL,
      reported_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (organization_id, device_id)
    )
  `);

  await pool.query(`
    ALTER TABLE monitor_device_health
    ADD COLUMN IF NOT EXISTS employee_code TEXT
  `);

  await pool.query(`
    ALTER TABLE monitor_device_health
    ADD COLUMN IF NOT EXISTS cpu_core_count INTEGER
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_monitor_device_health_org_seen
    ON monitor_device_health (organization_id, last_seen_at DESC)
  `);
};
