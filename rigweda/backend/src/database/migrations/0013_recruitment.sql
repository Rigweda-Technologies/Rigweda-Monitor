BEGIN;

INSERT INTO permissions(key,module,name,description) VALUES
  ('recruitment.read','recruitment','View recruitment','View job openings, candidates, applications, interviews, and offers'),
  ('recruitment.manage','recruitment','Manage recruitment','Create and update recruitment records'),
  ('recruitment.approve','recruitment','Approve offers','Approve, release, and withdraw candidate offers'),
  ('recruitment.export','recruitment','Export recruitment','Export recruitment pipeline data')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,p.key FROM roles r JOIN permissions p ON p.key IN ('recruitment.read','recruitment.manage','recruitment.approve','recruitment.export')
WHERE r.key IN ('system_admin','organization_admin') ON CONFLICT DO NOTHING;

CREATE TABLE recruitment_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  source_type VARCHAR(24) NOT NULL DEFAULT 'other' CHECK(source_type IN ('referral','job_board','agency','career_site','social','campus','other')),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id,name)
);

CREATE TABLE recruitment_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(120) NOT NULL,
  stage_order SMALLINT NOT NULL,
  is_terminal BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id,code),
  UNIQUE(organization_id,stage_order)
);

CREATE TABLE job_openings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code VARCHAR(40) NOT NULL,
  title VARCHAR(180) NOT NULL,
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  job_title_id UUID REFERENCES job_titles(id) ON DELETE SET NULL,
  work_location_id UUID REFERENCES work_locations(id) ON DELETE SET NULL,
  hiring_manager_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  employment_type VARCHAR(24) NOT NULL DEFAULT 'full_time' CHECK(employment_type IN ('full_time','part_time','contract','intern','temporary','apprentice')),
  work_mode VARCHAR(16) NOT NULL DEFAULT 'onsite' CHECK(work_mode IN ('onsite','hybrid','remote')),
  openings SMALLINT NOT NULL DEFAULT 1 CHECK(openings BETWEEN 1 AND 500),
  min_experience_years NUMERIC(4,1) NOT NULL DEFAULT 0,
  max_experience_years NUMERIC(4,1),
  salary_min NUMERIC(14,2),
  salary_max NUMERIC(14,2),
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  description VARCHAR(4000),
  status VARCHAR(24) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','open','on_hold','closed','cancelled')),
  opened_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id,code),
  CHECK(max_experience_years IS NULL OR max_experience_years >= min_experience_years),
  CHECK(salary_max IS NULL OR salary_min IS NULL OR salary_max >= salary_min)
);
CREATE INDEX job_openings_status_idx ON job_openings(organization_id,status,created_at DESC);

CREATE TABLE candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(254) NOT NULL,
  phone VARCHAR(32),
  current_company VARCHAR(160),
  current_title VARCHAR(160),
  total_experience_years NUMERIC(4,1) NOT NULL DEFAULT 0,
  current_salary NUMERIC(14,2),
  expected_salary NUMERIC(14,2),
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  notice_period_days SMALLINT CHECK(notice_period_days IS NULL OR notice_period_days BETWEEN 0 AND 365),
  source_id UUID REFERENCES recruitment_sources(id) ON DELETE SET NULL,
  resume_url VARCHAR(1000),
  portfolio_url VARCHAR(1000),
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  status VARCHAR(24) NOT NULL DEFAULT 'active' CHECK(status IN ('active','hired','rejected','archived')),
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id,email),
  CHECK(email=LOWER(email))
);
CREATE INDEX candidates_search_idx ON candidates(organization_id,LOWER(first_name),LOWER(last_name),status);

CREATE TABLE job_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_opening_id UUID NOT NULL REFERENCES job_openings(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  stage_id UUID REFERENCES recruitment_stages(id) ON DELETE SET NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'active' CHECK(status IN ('active','offer','hired','rejected','withdrawn','archived')),
  rating SMALLINT CHECK(rating IS NULL OR rating BETWEEN 1 AND 5),
  owner_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rejected_reason VARCHAR(600),
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(job_opening_id,candidate_id)
);
CREATE INDEX applications_pipeline_idx ON job_applications(organization_id,status,stage_id,applied_at DESC);
CREATE INDEX applications_candidate_idx ON job_applications(organization_id,candidate_id);

CREATE TABLE recruitment_interviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  application_id UUID NOT NULL REFERENCES job_applications(id) ON DELETE CASCADE,
  interview_type VARCHAR(24) NOT NULL DEFAULT 'technical' CHECK(interview_type IN ('screening','technical','managerial','hr','culture','other')),
  scheduled_start TIMESTAMPTZ NOT NULL,
  scheduled_end TIMESTAMPTZ NOT NULL,
  location VARCHAR(300),
  meeting_url VARCHAR(1000),
  interviewers JSONB NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(interviewers)='array'),
  status VARCHAR(24) NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','completed','cancelled','no_show')),
  score SMALLINT CHECK(score IS NULL OR score BETWEEN 1 AND 5),
  feedback VARCHAR(2000),
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(scheduled_end > scheduled_start)
);
CREATE INDEX interviews_schedule_idx ON recruitment_interviews(organization_id,scheduled_start,status);

CREATE TABLE recruitment_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  application_id UUID NOT NULL UNIQUE REFERENCES job_applications(id) ON DELETE CASCADE,
  offered_title VARCHAR(180) NOT NULL,
  offered_salary NUMERIC(14,2) NOT NULL CHECK(offered_salary >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  joining_date DATE,
  expires_at DATE,
  status VARCHAR(24) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pending_approval','approved','released','accepted','declined','withdrawn')),
  approver_comment VARCHAR(1000),
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX recruitment_offers_status_idx ON recruitment_offers(organization_id,status,created_at DESC);

CREATE TABLE recruitment_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  application_id UUID REFERENCES job_applications(id) ON DELETE CASCADE,
  job_opening_id UUID REFERENCES job_openings(id) ON DELETE CASCADE,
  candidate_id UUID REFERENCES candidates(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  before_snapshot JSONB,
  after_snapshot JSONB NOT NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX recruitment_history_application_idx ON recruitment_history(application_id,occurred_at DESC,id DESC);

CREATE TRIGGER recruitment_sources_set_updated_at BEFORE UPDATE ON recruitment_sources FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER recruitment_stages_set_updated_at BEFORE UPDATE ON recruitment_stages FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER job_openings_set_updated_at BEFORE UPDATE ON job_openings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER candidates_set_updated_at BEFORE UPDATE ON candidates FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER job_applications_set_updated_at BEFORE UPDATE ON job_applications FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER recruitment_interviews_set_updated_at BEFORE UPDATE ON recruitment_interviews FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER recruitment_offers_set_updated_at BEFORE UPDATE ON recruitment_offers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO recruitment_sources(organization_id,name,source_type)
SELECT id,'Direct Application','career_site' FROM organizations ON CONFLICT(organization_id,name) DO NOTHING;
INSERT INTO recruitment_sources(organization_id,name,source_type)
SELECT id,'Employee Referral','referral' FROM organizations ON CONFLICT(organization_id,name) DO NOTHING;
INSERT INTO recruitment_stages(organization_id,code,name,stage_order,is_terminal)
SELECT id,'APPLIED','Applied',10,FALSE FROM organizations ON CONFLICT(organization_id,code) DO NOTHING;
INSERT INTO recruitment_stages(organization_id,code,name,stage_order,is_terminal)
SELECT id,'SCREEN','Screening',20,FALSE FROM organizations ON CONFLICT(organization_id,code) DO NOTHING;
INSERT INTO recruitment_stages(organization_id,code,name,stage_order,is_terminal)
SELECT id,'INTERVIEW','Interview',30,FALSE FROM organizations ON CONFLICT(organization_id,code) DO NOTHING;
INSERT INTO recruitment_stages(organization_id,code,name,stage_order,is_terminal)
SELECT id,'OFFER','Offer',40,FALSE FROM organizations ON CONFLICT(organization_id,code) DO NOTHING;
INSERT INTO recruitment_stages(organization_id,code,name,stage_order,is_terminal)
SELECT id,'HIRED','Hired',50,TRUE FROM organizations ON CONFLICT(organization_id,code) DO NOTHING;
INSERT INTO recruitment_stages(organization_id,code,name,stage_order,is_terminal)
SELECT id,'REJECTED','Rejected',60,TRUE FROM organizations ON CONFLICT(organization_id,code) DO NOTHING;

CREATE OR REPLACE FUNCTION seed_organization_recruitment_defaults()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO recruitment_sources(organization_id,name,source_type) VALUES
    (NEW.id,'Direct Application','career_site'),
    (NEW.id,'Employee Referral','referral');
  INSERT INTO recruitment_stages(organization_id,code,name,stage_order,is_terminal) VALUES
    (NEW.id,'APPLIED','Applied',10,FALSE),
    (NEW.id,'SCREEN','Screening',20,FALSE),
    (NEW.id,'INTERVIEW','Interview',30,FALSE),
    (NEW.id,'OFFER','Offer',40,FALSE),
    (NEW.id,'HIRED','Hired',50,TRUE),
    (NEW.id,'REJECTED','Rejected',60,TRUE);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER organizations_seed_recruitment_defaults AFTER INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION seed_organization_recruitment_defaults();

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
    ('organizations.read','organizations.manage','users.read','users.manage','roles.read','roles.manage','employees.read','employees.manage','employees.sensitive.read','employees.lifecycle.manage','employees.export','employees.self.read','employees.self.edit','employees.bulk.manage','employees.documents.manage','structure.read','structure.manage','attendance.read','attendance.manage','attendance.self.manage','attendance.regularization.approve','attendance.export','leave.read','leave.manage','leave.self.manage','leave.approve','leave.configure','leave.export','worklogs.read','worklogs.self.manage','worklogs.manage','worklogs.approve','worklogs.export','payroll.read','payroll.manage','payroll.self.read','payroll.approve','payroll.export','recruitment.read','recruitment.manage','recruitment.approve','recruitment.export');
  INSERT INTO role_permissions SELECT employee_role,key,NOW() FROM permissions WHERE key IN
    ('employees.read','employees.self.read','employees.self.edit','structure.read','attendance.read','attendance.self.manage','leave.read','leave.self.manage','worklogs.read','worklogs.self.manage','payroll.read','payroll.self.read');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
