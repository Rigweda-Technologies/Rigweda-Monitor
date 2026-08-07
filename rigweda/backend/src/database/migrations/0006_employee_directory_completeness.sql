BEGIN;

INSERT INTO permissions(key,module,name,description) VALUES
  ('employees.self.read','people','View own employee profile','View the employee profile linked to the signed-in account'),
  ('employees.self.edit','people','Complete own employee profile','Complete approved personal and emergency profile fields'),
  ('employees.bulk.manage','people','Bulk update employees','Apply organization assignments to multiple employees'),
  ('employees.documents.manage','people','Manage employee documents','Manage protected employee identity and document metadata')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,p.key FROM roles r JOIN permissions p ON p.key IN
  ('employees.self.read','employees.self.edit','employees.bulk.manage','employees.documents.manage')
WHERE r.key IN ('system_admin','organization_admin')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,p.key FROM roles r JOIN permissions p ON p.key IN ('employees.self.read','employees.self.edit')
WHERE r.key='employee'
ON CONFLICT DO NOTHING;

ALTER TABLE employees
  ADD COLUMN profile_completed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN probation_period_days SMALLINT NOT NULL DEFAULT 90 CHECK(probation_period_days BETWEEN 0 AND 730),
  ADD COLUMN notice_period_days SMALLINT NOT NULL DEFAULT 30 CHECK(notice_period_days BETWEEN 0 AND 730),
  ADD COLUMN notice_end_date DATE,
  ADD COLUMN benefits_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN archived_at TIMESTAMPTZ,
  ADD COLUMN archived_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX employees_active_directory_idx ON employees(organization_id,employment_status)
  WHERE archived_at IS NULL;

CREATE TABLE employee_identifiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  identifier_type VARCHAR(40) NOT NULL,
  country CHAR(2) NOT NULL,
  masked_value VARCHAR(80) NOT NULL,
  value_ciphertext BYTEA NOT NULL,
  value_iv BYTEA NOT NULL,
  value_auth_tag BYTEA NOT NULL,
  expires_on DATE,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(employee_id,identifier_type,country)
);

CREATE TABLE employee_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  document_type VARCHAR(50) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_url VARCHAR(1000) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  size_bytes BIGINT CHECK(size_bytes IS NULL OR size_bytes >= 0),
  expires_on DATE,
  verified_at TIMESTAMPTZ,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX employee_documents_employee_idx ON employee_documents(employee_id,document_type);

CREATE TRIGGER employee_identifiers_set_updated_at BEFORE UPDATE ON employee_identifiers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER employee_documents_set_updated_at BEFORE UPDATE ON employee_documents FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION seed_organization_roles()
RETURNS TRIGGER AS $$
DECLARE admin_role UUID; org_admin_role UUID; employee_role UUID;
BEGIN
  INSERT INTO roles(organization_id,key,name,description,is_system) VALUES
    (NEW.id,'system_admin','System Administrator','Full access to the organization and platform configuration',TRUE) RETURNING id INTO admin_role;
  INSERT INTO roles(organization_id,key,name,description,is_system) VALUES
    (NEW.id,'organization_admin','Organization Administrator','Manage people and organization configuration',TRUE) RETURNING id INTO org_admin_role;
  INSERT INTO roles(organization_id,key,name,description,is_system) VALUES
    (NEW.id,'employee','Employee','Standard employee self-service access',TRUE) RETURNING id INTO employee_role;
  INSERT INTO role_permissions SELECT admin_role,key,NOW() FROM permissions;
  INSERT INTO role_permissions SELECT org_admin_role,key,NOW() FROM permissions
    WHERE key IN ('organizations.read','organizations.manage','users.read','users.manage','roles.read','roles.manage','employees.read','employees.manage','employees.sensitive.read','employees.lifecycle.manage','employees.export','employees.self.read','employees.self.edit','employees.bulk.manage','employees.documents.manage','attendance.read','attendance.manage','leave.read','leave.manage','payroll.read');
  INSERT INTO role_permissions SELECT employee_role,key,NOW() FROM permissions
    WHERE key IN ('employees.read','employees.self.read','employees.self.edit','attendance.read','leave.read');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
