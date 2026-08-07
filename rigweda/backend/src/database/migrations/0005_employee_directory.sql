BEGIN;

INSERT INTO permissions(key,module,name,description) VALUES
  ('employees.sensitive.read','people','View sensitive employee data','View private employee contact, identity, and emergency information'),
  ('employees.lifecycle.manage','people','Manage employee lifecycle','Change employment status and review lifecycle history'),
  ('employees.export','people','Export employees','Export the employee directory for authorized business use')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,p.key
FROM roles r
JOIN permissions p ON p.key IN ('employees.sensitive.read','employees.lifecycle.manage','employees.export')
WHERE r.key IN ('system_admin','organization_admin')
ON CONFLICT DO NOTHING;

CREATE TABLE departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(500),
  parent_department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id,code),
  UNIQUE(organization_id,name),
  CHECK(parent_department_id IS NULL OR parent_department_id <> id)
);

CREATE TABLE job_titles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(500),
  job_level VARCHAR(60),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id,code),
  UNIQUE(organization_id,name)
);

CREATE TABLE work_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(120) NOT NULL,
  location_type VARCHAR(24) NOT NULL DEFAULT 'office' CHECK (location_type IN ('office','branch','client_site','remote','other')),
  timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
  address JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(address)='object'),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id,code),
  UNIQUE(organization_id,name)
);

CREATE TABLE employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  employee_number VARCHAR(40) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  middle_name VARCHAR(100),
  last_name VARCHAR(100) NOT NULL,
  preferred_name VARCHAR(100),
  work_email VARCHAR(254),
  personal_email VARCHAR(254),
  work_phone VARCHAR(32),
  personal_phone VARCHAR(32),
  date_of_birth DATE,
  gender VARCHAR(32) CHECK (gender IS NULL OR gender IN ('female','male','non_binary','self_described','prefer_not_to_say')),
  pronouns VARCHAR(60),
  marital_status VARCHAR(32) CHECK (marital_status IS NULL OR marital_status IN ('single','married','domestic_partnership','separated','divorced','widowed','prefer_not_to_say')),
  blood_group VARCHAR(8),
  nationality CHAR(2),
  profile_photo_url VARCHAR(1000),
  biography VARCHAR(1000),
  employment_status VARCHAR(24) NOT NULL DEFAULT 'preboarding' CHECK (employment_status IN ('preboarding','probation','active','on_leave','notice_period','suspended','terminated')),
  employment_type VARCHAR(24) NOT NULL CHECK (employment_type IN ('full_time','part_time','contract','intern','temporary','apprentice')),
  work_mode VARCHAR(16) NOT NULL DEFAULT 'onsite' CHECK (work_mode IN ('onsite','hybrid','remote')),
  join_date DATE NOT NULL,
  probation_end_date DATE,
  confirmation_date DATE,
  notice_start_date DATE,
  last_working_date DATE,
  termination_date DATE,
  termination_reason VARCHAR(500),
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  job_title_id UUID REFERENCES job_titles(id) ON DELETE SET NULL,
  work_location_id UUID REFERENCES work_locations(id) ON DELETE SET NULL,
  manager_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  cost_center VARCHAR(80),
  timezone VARCHAR(64),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata)='object'),
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id,employee_number),
  UNIQUE(organization_id,user_id),
  CHECK(manager_employee_id IS NULL OR manager_employee_id <> id),
  CHECK(probation_end_date IS NULL OR probation_end_date >= join_date),
  CHECK(confirmation_date IS NULL OR confirmation_date >= join_date),
  CHECK(last_working_date IS NULL OR last_working_date >= join_date),
  CHECK(termination_date IS NULL OR termination_date >= join_date),
  CHECK(work_email IS NULL OR work_email=LOWER(work_email)),
  CHECK(personal_email IS NULL OR personal_email=LOWER(personal_email))
);

CREATE UNIQUE INDEX employees_work_email_unique_idx
  ON employees(organization_id,work_email) WHERE work_email IS NOT NULL;
CREATE INDEX employees_directory_search_idx
  ON employees(organization_id,LOWER(first_name),LOWER(last_name));
CREATE INDEX employees_status_idx ON employees(organization_id,employment_status);
CREATE INDEX employees_department_idx ON employees(organization_id,department_id);
CREATE INDEX employees_manager_idx ON employees(organization_id,manager_employee_id);

ALTER TABLE departments
  ADD COLUMN head_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL;

CREATE TABLE employee_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  address_type VARCHAR(20) NOT NULL CHECK (address_type IN ('current','permanent','mailing')),
  line1 VARCHAR(200) NOT NULL,
  line2 VARCHAR(200),
  city VARCHAR(100) NOT NULL,
  state VARCHAR(100),
  postal_code VARCHAR(20),
  country CHAR(2) NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(employee_id,address_type)
);

CREATE TABLE employee_emergency_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL,
  relationship VARCHAR(80) NOT NULL,
  phone VARCHAR(32) NOT NULL,
  alternate_phone VARCHAR(32),
  email VARCHAR(254),
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX employee_emergency_contacts_employee_idx ON employee_emergency_contacts(employee_id);

CREATE TABLE employee_job_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  job_title_id UUID REFERENCES job_titles(id) ON DELETE SET NULL,
  work_location_id UUID REFERENCES work_locations(id) ON DELETE SET NULL,
  manager_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  employment_type VARCHAR(24) NOT NULL,
  work_mode VARCHAR(16) NOT NULL,
  effective_from DATE NOT NULL,
  effective_to DATE,
  reason VARCHAR(300),
  recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX employee_job_history_employee_idx ON employee_job_history(employee_id,effective_from DESC);

CREATE TABLE employee_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  from_status VARCHAR(24),
  to_status VARCHAR(24) NOT NULL,
  effective_date DATE NOT NULL,
  reason VARCHAR(500),
  recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX employee_status_history_employee_idx ON employee_status_history(employee_id,effective_date DESC,created_at DESC);

CREATE TABLE employee_change_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  event_type VARCHAR(40) NOT NULL,
  changes JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(changes)='object'),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX employee_change_history_employee_idx ON employee_change_history(employee_id,occurred_at DESC);

CREATE TRIGGER departments_set_updated_at BEFORE UPDATE ON departments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER job_titles_set_updated_at BEFORE UPDATE ON job_titles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER work_locations_set_updated_at BEFORE UPDATE ON work_locations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER employees_set_updated_at BEFORE UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER employee_addresses_set_updated_at BEFORE UPDATE ON employee_addresses FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER employee_emergency_contacts_set_updated_at BEFORE UPDATE ON employee_emergency_contacts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION seed_organization_people_defaults()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO departments(organization_id,code,name,description)
    VALUES(NEW.id,'GENERAL','General','Default department');
  INSERT INTO job_titles(organization_id,code,name,description)
    VALUES(NEW.id,'TEAM_MEMBER','Team Member','Default job title');
  INSERT INTO work_locations(organization_id,code,name,location_type,timezone)
    VALUES(NEW.id,'MAIN','Main Office','office',NEW.timezone);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS organizations_seed_people_defaults ON organizations;
CREATE TRIGGER organizations_seed_people_defaults
  AFTER INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION seed_organization_people_defaults();

INSERT INTO departments(organization_id,code,name,description)
SELECT id,'GENERAL','General','Default department' FROM organizations
ON CONFLICT(organization_id,code) DO NOTHING;
INSERT INTO job_titles(organization_id,code,name,description)
SELECT id,'TEAM_MEMBER','Team Member','Default job title' FROM organizations
ON CONFLICT(organization_id,code) DO NOTHING;
INSERT INTO work_locations(organization_id,code,name,location_type,timezone)
SELECT id,'MAIN','Main Office','office',timezone FROM organizations
ON CONFLICT(organization_id,code) DO NOTHING;

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
    WHERE key IN ('organizations.read','organizations.manage','users.read','users.manage','roles.read','roles.manage','employees.read','employees.manage','employees.sensitive.read','employees.lifecycle.manage','employees.export','attendance.read','attendance.manage','leave.read','leave.manage','payroll.read');
  INSERT INTO role_permissions SELECT employee_role,key,NOW() FROM permissions
    WHERE key IN ('employees.read','attendance.read','leave.read');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
