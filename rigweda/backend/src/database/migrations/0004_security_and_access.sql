BEGIN;

CREATE TABLE permissions (
  key VARCHAR(100) PRIMARY KEY,
  module VARCHAR(60) NOT NULL,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(300) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO permissions(key,module,name,description) VALUES
 ('organizations.read','organizations','View organizations','View organization profiles and settings'),
 ('organizations.manage','organizations','Manage organizations','Create and update organization settings'),
 ('users.read','access','View users','View organization users and memberships'),
 ('users.manage','access','Manage users','Create, edit, suspend, and restore users'),
 ('roles.read','access','View roles','View roles and their permission assignments'),
 ('roles.manage','access','Manage roles','Create roles and assign permissions'),
 ('employees.read','people','View employees','View employee directory and profiles'),
 ('employees.manage','people','Manage employees','Create and update employee records'),
 ('attendance.read','attendance','View attendance','View attendance records and summaries'),
 ('attendance.manage','attendance','Manage attendance','Correct and administer attendance'),
 ('leave.read','leave','View leave','View leave requests and balances'),
 ('leave.manage','leave','Manage leave','Configure and administer leave'),
 ('payroll.read','payroll','View payroll','View payroll setup and results'),
 ('payroll.manage','payroll','Manage payroll','Configure, compute, approve, and finalize payroll')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key VARCHAR(64) NOT NULL,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(300),
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id,key),
  UNIQUE(organization_id,name)
);

CREATE TABLE role_permissions (
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key VARCHAR(100) NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(role_id,permission_key)
);

ALTER TABLE organization_memberships ADD COLUMN role_id UUID REFERENCES roles(id) ON DELETE RESTRICT;

INSERT INTO roles(organization_id,key,name,description,is_system)
SELECT id,'system_admin','System Administrator','Full access to the organization and platform configuration',TRUE FROM organizations
ON CONFLICT(organization_id,key) DO NOTHING;
INSERT INTO roles(organization_id,key,name,description,is_system)
SELECT id,'organization_admin','Organization Administrator','Manage people and organization configuration',TRUE FROM organizations
ON CONFLICT(organization_id,key) DO NOTHING;
INSERT INTO roles(organization_id,key,name,description,is_system)
SELECT id,'employee','Employee','Standard employee self-service access',TRUE FROM organizations
ON CONFLICT(organization_id,key) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,p.key FROM roles r CROSS JOIN permissions p WHERE r.key='system_admin'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,p.key FROM roles r JOIN permissions p ON p.key IN ('organizations.read','organizations.manage','users.read','users.manage','roles.read','roles.manage','employees.read','employees.manage','attendance.read','attendance.manage','leave.read','leave.manage','payroll.read') WHERE r.key='organization_admin'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,p.key FROM roles r JOIN permissions p ON p.key IN ('employees.read','attendance.read','leave.read') WHERE r.key='employee'
ON CONFLICT DO NOTHING;

UPDATE organization_memberships m SET role_id=r.id FROM roles r
WHERE r.organization_id=m.organization_id AND r.key=m.role_key AND m.role_id IS NULL;
ALTER TABLE organization_memberships ALTER COLUMN role_id SET NOT NULL;

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
  INSERT INTO role_permissions SELECT org_admin_role,key,NOW() FROM permissions WHERE key IN ('organizations.read','organizations.manage','users.read','users.manage','roles.read','roles.manage','employees.read','employees.manage','attendance.read','attendance.manage','leave.read','leave.manage','payroll.read');
  INSERT INTO role_permissions SELECT employee_role,key,NOW() FROM permissions WHERE key IN ('employees.read','attendance.read','leave.read');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER organizations_seed_roles AFTER INSERT ON organizations FOR EACH ROW EXECUTE FUNCTION seed_organization_roles();

CREATE TABLE user_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme JSONB,
  timezone VARCHAR(64),
  locale VARCHAR(16),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_preferences_theme_object_check CHECK(theme IS NULL OR jsonb_typeof(theme)='object')
);

CREATE TABLE password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  requested_ip INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX password_reset_tokens_user_idx ON password_reset_tokens(user_id,created_at DESC);

CREATE TRIGGER roles_set_updated_at BEFORE UPDATE ON roles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER user_preferences_set_updated_at BEFORE UPDATE ON user_preferences FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
