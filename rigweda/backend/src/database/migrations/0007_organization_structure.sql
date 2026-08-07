BEGIN;

INSERT INTO permissions(key,module,name,description) VALUES
  ('structure.read','organization','View organization structure','View departments, designations, work locations, and reporting structure'),
  ('structure.manage','organization','Manage organization structure','Create and update departments, designations, and work locations')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,p.key FROM roles r JOIN permissions p ON p.key IN ('structure.read','structure.manage')
WHERE r.key IN ('system_admin','organization_admin')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,p.key FROM roles r JOIN permissions p ON p.key='structure.read'
WHERE r.key='employee'
ON CONFLICT DO NOTHING;

ALTER TABLE departments
  ADD COLUMN cost_center VARCHAR(80),
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE job_titles
  ADD COLUMN grade VARCHAR(40),
  ADD COLUMN career_track VARCHAR(24) CHECK(career_track IS NULL OR career_track IN ('individual','management','executive','support')),
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE work_locations
  ADD COLUMN email VARCHAR(254),
  ADD COLUMN phone VARCHAR(32),
  ADD COLUMN capacity INTEGER CHECK(capacity IS NULL OR capacity >= 0),
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

CREATE INDEX departments_parent_idx ON departments(organization_id,parent_department_id);
CREATE INDEX departments_head_idx ON departments(organization_id,head_employee_id);

CREATE TABLE organization_structure_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type VARCHAR(24) NOT NULL CHECK(entity_type IN ('department','job_title','work_location')),
  entity_id UUID NOT NULL,
  event_type VARCHAR(24) NOT NULL CHECK(event_type IN ('created','updated','activated','deactivated')),
  before_snapshot JSONB,
  after_snapshot JSONB NOT NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX organization_structure_history_entity_idx
  ON organization_structure_history(organization_id,entity_type,entity_id,occurred_at DESC);

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
    WHERE key IN ('organizations.read','organizations.manage','users.read','users.manage','roles.read','roles.manage','employees.read','employees.manage','employees.sensitive.read','employees.lifecycle.manage','employees.export','employees.self.read','employees.self.edit','employees.bulk.manage','employees.documents.manage','structure.read','structure.manage','attendance.read','attendance.manage','leave.read','leave.manage','payroll.read');
  INSERT INTO role_permissions SELECT employee_role,key,NOW() FROM permissions
    WHERE key IN ('employees.read','employees.self.read','employees.self.edit','structure.read','attendance.read','leave.read');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
