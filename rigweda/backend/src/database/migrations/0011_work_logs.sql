BEGIN;

INSERT INTO permissions(key,module,name,description) VALUES
  ('worklogs.read','worklogs','View work logs','View project work logs, timesheets, and operational summaries'),
  ('worklogs.self.manage','worklogs','Manage own work logs','Create, edit, submit, and void own work log entries'),
  ('worklogs.manage','worklogs','Manage work log setup','Configure work clients, projects, and assignments'),
  ('worklogs.approve','worklogs','Approve timesheets','Approve, reject, and reopen employee timesheets'),
  ('worklogs.export','worklogs','Export work logs','Export work log and timesheet data')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,p.key FROM roles r JOIN permissions p ON p.key IN ('worklogs.read','worklogs.self.manage','worklogs.manage','worklogs.approve','worklogs.export')
WHERE r.key IN ('system_admin','organization_admin') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,p.key FROM roles r JOIN permissions p ON p.key IN ('worklogs.read','worklogs.self.manage')
WHERE r.key='employee' ON CONFLICT DO NOTHING;

CREATE TABLE work_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(160) NOT NULL,
  description VARCHAR(600),
  contact_name VARCHAR(160),
  contact_email VARCHAR(254),
  billing_currency CHAR(3) NOT NULL DEFAULT 'INR',
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id,code),
  UNIQUE(organization_id,name),
  CHECK(contact_email IS NULL OR contact_email=LOWER(contact_email))
);
CREATE INDEX work_clients_search_idx ON work_clients(organization_id,LOWER(name),status);

CREATE TABLE work_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id UUID REFERENCES work_clients(id) ON DELETE SET NULL,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(180) NOT NULL,
  description VARCHAR(1000),
  project_type VARCHAR(24) NOT NULL DEFAULT 'internal' CHECK(project_type IN ('internal','client','support','research','operations')),
  is_billable BOOLEAN NOT NULL DEFAULT FALSE,
  default_bill_rate NUMERIC(12,2) CHECK(default_bill_rate IS NULL OR default_bill_rate >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  start_date DATE,
  end_date DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK(status IN ('active','on_hold','completed','inactive')),
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id,code),
  UNIQUE(organization_id,name),
  CHECK(end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);
CREATE INDEX work_projects_lookup_idx ON work_projects(organization_id,status,client_id);
CREATE INDEX work_projects_search_idx ON work_projects(organization_id,LOWER(name));

CREATE TABLE work_project_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES work_projects(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  project_role VARCHAR(120),
  allocation_percent SMALLINT NOT NULL DEFAULT 100 CHECK(allocation_percent BETWEEN 1 AND 100),
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id,employee_id,effective_from),
  CHECK(effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX work_project_assignments_employee_idx ON work_project_assignments(organization_id,employee_id,status,effective_from DESC);
CREATE INDEX work_project_assignments_project_idx ON work_project_assignments(organization_id,project_id,status);

CREATE TABLE work_timesheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','approved','rejected','reopened')),
  total_minutes INTEGER NOT NULL DEFAULT 0 CHECK(total_minutes >= 0),
  billable_minutes INTEGER NOT NULL DEFAULT 0 CHECK(billable_minutes >= 0),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewer_comment VARCHAR(1000),
  reviewed_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(period_end >= period_start)
);
CREATE INDEX work_timesheets_queue_idx ON work_timesheets(organization_id,status,submitted_at DESC,id);
CREATE INDEX work_timesheets_employee_idx ON work_timesheets(organization_id,employee_id,period_start DESC,id);
CREATE UNIQUE INDEX work_timesheets_open_period_idx ON work_timesheets(organization_id,employee_id,period_start,period_end)
  WHERE status IN ('submitted','approved');

CREATE TABLE work_log_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  project_id UUID REFERENCES work_projects(id) ON DELETE SET NULL,
  timesheet_id UUID REFERENCES work_timesheets(id) ON DELETE SET NULL,
  work_date DATE NOT NULL,
  task_title VARCHAR(180) NOT NULL,
  description VARCHAR(2000),
  minutes INTEGER NOT NULL CHECK(minutes BETWEEN 1 AND 1440),
  is_billable BOOLEAN NOT NULL DEFAULT FALSE,
  work_location VARCHAR(120),
  status VARCHAR(24) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','rejected','voided')),
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX work_log_entries_employee_idx ON work_log_entries(organization_id,employee_id,work_date DESC,id);
CREATE INDEX work_log_entries_project_idx ON work_log_entries(organization_id,project_id,work_date DESC);
CREATE INDEX work_log_entries_timesheet_idx ON work_log_entries(timesheet_id);

CREATE TABLE work_log_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  timesheet_id UUID REFERENCES work_timesheets(id) ON DELETE CASCADE,
  entry_id UUID REFERENCES work_log_entries(id) ON DELETE CASCADE,
  event_type VARCHAR(40) NOT NULL,
  before_snapshot JSONB,
  after_snapshot JSONB NOT NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(timesheet_id IS NOT NULL OR entry_id IS NOT NULL)
);
CREATE INDEX work_log_history_timesheet_idx ON work_log_history(timesheet_id,occurred_at DESC,id DESC);
CREATE INDEX work_log_history_entry_idx ON work_log_history(entry_id,occurred_at DESC,id DESC);

CREATE TRIGGER work_clients_set_updated_at BEFORE UPDATE ON work_clients FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER work_projects_set_updated_at BEFORE UPDATE ON work_projects FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER work_project_assignments_set_updated_at BEFORE UPDATE ON work_project_assignments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER work_timesheets_set_updated_at BEFORE UPDATE ON work_timesheets FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER work_log_entries_set_updated_at BEFORE UPDATE ON work_log_entries FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO work_clients(organization_id,code,name,description)
SELECT id,'INTERNAL','Internal Operations','Default internal work client' FROM organizations
ON CONFLICT(organization_id,code) DO NOTHING;
INSERT INTO work_projects(organization_id,client_id,code,name,description,project_type,is_billable)
SELECT o.id,c.id,'OPS','Operations','Internal operations, support, and enablement','operations',FALSE
FROM organizations o JOIN work_clients c ON c.organization_id=o.id AND c.code='INTERNAL'
ON CONFLICT(organization_id,code) DO NOTHING;

CREATE OR REPLACE FUNCTION seed_organization_worklog_defaults()
RETURNS TRIGGER AS $$
DECLARE internal_client UUID;
BEGIN
  INSERT INTO work_clients(organization_id,code,name,description)
    VALUES(NEW.id,'INTERNAL','Internal Operations','Default internal work client')
    RETURNING id INTO internal_client;
  INSERT INTO work_projects(organization_id,client_id,code,name,description,project_type,is_billable)
    VALUES(NEW.id,internal_client,'OPS','Operations','Internal operations, support, and enablement','operations',FALSE);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER organizations_seed_worklog_defaults AFTER INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION seed_organization_worklog_defaults();

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
  INSERT INTO role_permissions SELECT org_admin_role,key,NOW() FROM permissions WHERE key IN
    ('organizations.read','organizations.manage','users.read','users.manage','roles.read','roles.manage','employees.read','employees.manage','employees.sensitive.read','employees.lifecycle.manage','employees.export','employees.self.read','employees.self.edit','employees.bulk.manage','employees.documents.manage','structure.read','structure.manage','attendance.read','attendance.manage','attendance.self.manage','attendance.regularization.approve','attendance.export','leave.read','leave.manage','leave.self.manage','leave.approve','leave.configure','leave.export','worklogs.read','worklogs.self.manage','worklogs.manage','worklogs.approve','worklogs.export','payroll.read');
  INSERT INTO role_permissions SELECT employee_role,key,NOW() FROM permissions WHERE key IN
    ('employees.read','employees.self.read','employees.self.edit','structure.read','attendance.read','attendance.self.manage','leave.read','leave.self.manage','worklogs.read','worklogs.self.manage');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
