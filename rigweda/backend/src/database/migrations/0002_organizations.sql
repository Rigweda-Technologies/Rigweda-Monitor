BEGIN;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS legal_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS registration_number VARCHAR(80),
  ADD COLUMN IF NOT EXISTS tax_identifier VARCHAR(80),
  ADD COLUMN IF NOT EXISTS email VARCHAR(254),
  ADD COLUMN IF NOT EXISTS phone VARCHAR(32),
  ADD COLUMN IF NOT EXISTS website VARCHAR(500),
  ADD COLUMN IF NOT EXISTS logo_url VARCHAR(1000),
  ADD COLUMN IF NOT EXISTS address JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS fiscal_year_start_month SMALLINT NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT organizations_fiscal_month_check
    CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  ADD CONSTRAINT organizations_address_object_check
    CHECK (jsonb_typeof(address) = 'object'),
  ADD CONSTRAINT organizations_theme_object_check
    CHECK (jsonb_typeof(theme) = 'object');

CREATE UNIQUE INDEX IF NOT EXISTS organizations_registration_number_unique_idx
  ON organizations (LOWER(registration_number)) WHERE registration_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS organizations_tax_identifier_unique_idx
  ON organizations (LOWER(tax_identifier)) WHERE tax_identifier IS NOT NULL;
CREATE INDEX IF NOT EXISTS organizations_name_search_idx ON organizations (LOWER(name));

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS organizations_set_updated_at ON organizations;
CREATE TRIGGER organizations_set_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
