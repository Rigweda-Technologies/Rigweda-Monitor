BEGIN;

INSERT INTO permissions(key,module,name,description) VALUES
  ('attendance.self.manage','attendance','Manage own attendance','Clock in, take breaks, clock out, and request attendance corrections'),
  ('attendance.regularization.approve','attendance','Approve attendance corrections','Approve or reject employee attendance regularization requests'),
  ('attendance.export','attendance','Export attendance','Export authorized attendance registers as CSV')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,p.key FROM roles r JOIN permissions p ON p.key IN ('attendance.self.manage','attendance.regularization.approve','attendance.export')
WHERE r.key IN ('system_admin','organization_admin') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,p.key FROM roles r JOIN permissions p ON p.key='attendance.self.manage'
WHERE r.key='employee' ON CONFLICT DO NOTHING;

CREATE TABLE attendance_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL DEFAULT 'Standard Attendance Policy',
  full_day_minutes SMALLINT NOT NULL DEFAULT 480 CHECK(full_day_minutes BETWEEN 1 AND 1440),
  half_day_minutes SMALLINT NOT NULL DEFAULT 240 CHECK(half_day_minutes BETWEEN 1 AND 1439),
  grace_minutes SMALLINT NOT NULL DEFAULT 10 CHECK(grace_minutes BETWEEN 0 AND 180),
  overtime_after_minutes SMALLINT NOT NULL DEFAULT 480 CHECK(overtime_after_minutes BETWEEN 1 AND 1440),
  maximum_shift_minutes SMALLINT NOT NULL DEFAULT 960 CHECK(maximum_shift_minutes BETWEEN 60 AND 1440),
  weekend_days SMALLINT[] NOT NULL DEFAULT ARRAY[0,6] CHECK(weekend_days <@ ARRAY[0,1,2,3,4,5,6]::SMALLINT[]),
  allow_web_punch BOOLEAN NOT NULL DEFAULT TRUE,
  require_geolocation BOOLEAN NOT NULL DEFAULT FALSE,
  allow_regularization BOOLEAN NOT NULL DEFAULT TRUE,
  regularization_window_days SMALLINT NOT NULL DEFAULT 30 CHECK(regularization_window_days BETWEEN 1 AND 365),
  version INTEGER NOT NULL DEFAULT 1,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(half_day_minutes < full_day_minutes)
);

CREATE TABLE shift_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(500),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  unpaid_break_minutes SMALLINT NOT NULL DEFAULT 0 CHECK(unpaid_break_minutes BETWEEN 0 AND 360),
  working_days SMALLINT[] NOT NULL DEFAULT ARRAY[1,2,3,4,5] CHECK(working_days <@ ARRAY[0,1,2,3,4,5,6]::SMALLINT[]),
  color VARCHAR(7) NOT NULL DEFAULT '#2f8f74' CHECK(color ~ '^#[0-9A-Fa-f]{6}$'),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id,code),
  UNIQUE(organization_id,name),
  CHECK(start_time <> end_time)
);
CREATE UNIQUE INDEX shift_templates_one_default_idx ON shift_templates(organization_id) WHERE is_default;

CREATE TABLE shift_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  shift_template_id UUID NOT NULL REFERENCES shift_templates(id) ON DELETE RESTRICT,
  effective_from DATE NOT NULL,
  effective_to DATE,
  reason VARCHAR(300),
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX shift_assignments_lookup_idx ON shift_assignments(organization_id,employee_id,effective_from DESC);

CREATE TABLE attendance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  attendance_date DATE NOT NULL,
  shift_template_id UUID REFERENCES shift_templates(id) ON DELETE SET NULL,
  scheduled_start TIMESTAMPTZ,
  scheduled_end TIMESTAMPTZ,
  clock_in_at TIMESTAMPTZ,
  clock_out_at TIMESTAMPTZ,
  break_minutes INTEGER NOT NULL DEFAULT 0 CHECK(break_minutes >= 0),
  worked_minutes INTEGER NOT NULL DEFAULT 0 CHECK(worked_minutes >= 0),
  late_minutes INTEGER NOT NULL DEFAULT 0 CHECK(late_minutes >= 0),
  early_departure_minutes INTEGER NOT NULL DEFAULT 0 CHECK(early_departure_minutes >= 0),
  overtime_minutes INTEGER NOT NULL DEFAULT 0 CHECK(overtime_minutes >= 0),
  status VARCHAR(24) NOT NULL DEFAULT 'not_marked' CHECK(status IN ('not_marked','present','absent','half_day','on_leave','holiday','weekly_off','missing_punch')),
  last_action VARCHAR(20) CHECK(last_action IS NULL OR last_action IN ('clock_in','break_start','break_end','clock_out')),
  source VARCHAR(20) NOT NULL DEFAULT 'web' CHECK(source IN ('web','mobile','manual','import','system')),
  notes VARCHAR(500),
  version INTEGER NOT NULL DEFAULT 1,
  corrected_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id,employee_id,attendance_date),
  CHECK(clock_out_at IS NULL OR clock_in_at IS NULL OR clock_out_at >= clock_in_at)
);
CREATE INDEX attendance_records_date_idx ON attendance_records(organization_id,attendance_date,status);
CREATE INDEX attendance_records_employee_idx ON attendance_records(employee_id,attendance_date DESC);

CREATE TABLE attendance_punches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_record_id UUID NOT NULL REFERENCES attendance_records(id) ON DELETE CASCADE,
  action VARCHAR(20) NOT NULL CHECK(action IN ('clock_in','break_start','break_end','clock_out')),
  punched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source VARCHAR(20) NOT NULL DEFAULT 'web' CHECK(source IN ('web','mobile','manual','import')),
  latitude NUMERIC(9,6),
  longitude NUMERIC(9,6),
  device_info VARCHAR(300),
  ip_address INET,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK((latitude IS NULL AND longitude IS NULL) OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180))
);
CREATE INDEX attendance_punches_record_idx ON attendance_punches(attendance_record_id,punched_at);

CREATE TABLE attendance_regularizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  attendance_record_id UUID REFERENCES attendance_records(id) ON DELETE SET NULL,
  attendance_date DATE NOT NULL,
  requested_clock_in TIMESTAMPTZ,
  requested_clock_out TIMESTAMPTZ,
  requested_status VARCHAR(24) CHECK(requested_status IS NULL OR requested_status IN ('present','absent','half_day','on_leave','holiday','weekly_off','missing_punch')),
  reason VARCHAR(500) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
  reviewer_comment VARCHAR(500),
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(requested_clock_out IS NULL OR requested_clock_in IS NULL OR requested_clock_out >= requested_clock_in)
);
CREATE INDEX attendance_regularizations_queue_idx ON attendance_regularizations(organization_id,status,created_at);
CREATE UNIQUE INDEX attendance_regularizations_one_pending_idx ON attendance_regularizations(employee_id,attendance_date) WHERE status='pending';

CREATE TABLE attendance_change_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  attendance_record_id UUID NOT NULL REFERENCES attendance_records(id) ON DELETE CASCADE,
  event_type VARCHAR(30) NOT NULL,
  before_snapshot JSONB,
  after_snapshot JSONB NOT NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX attendance_change_history_record_idx ON attendance_change_history(attendance_record_id,occurred_at DESC);

CREATE TRIGGER attendance_policies_set_updated_at BEFORE UPDATE ON attendance_policies FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER shift_templates_set_updated_at BEFORE UPDATE ON shift_templates FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER shift_assignments_set_updated_at BEFORE UPDATE ON shift_assignments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER attendance_records_set_updated_at BEFORE UPDATE ON attendance_records FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER attendance_regularizations_set_updated_at BEFORE UPDATE ON attendance_regularizations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO attendance_policies(organization_id)
SELECT id FROM organizations ON CONFLICT(organization_id) DO NOTHING;
INSERT INTO shift_templates(organization_id,code,name,description,start_time,end_time,unpaid_break_minutes,is_default)
SELECT id,'GENERAL','General Shift','Default weekday shift','09:00','18:00',60,TRUE FROM organizations
ON CONFLICT(organization_id,code) DO NOTHING;

CREATE OR REPLACE FUNCTION seed_organization_attendance_defaults()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO attendance_policies(organization_id) VALUES(NEW.id);
  INSERT INTO shift_templates(organization_id,code,name,description,start_time,end_time,unpaid_break_minutes,is_default)
    VALUES(NEW.id,'GENERAL','General Shift','Default weekday shift','09:00','18:00',60,TRUE);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER organizations_seed_attendance_defaults AFTER INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION seed_organization_attendance_defaults();

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
    WHERE key IN ('organizations.read','organizations.manage','users.read','users.manage','roles.read','roles.manage','employees.read','employees.manage','employees.sensitive.read','employees.lifecycle.manage','employees.export','employees.self.read','employees.self.edit','employees.bulk.manage','employees.documents.manage','structure.read','structure.manage','attendance.read','attendance.manage','attendance.self.manage','attendance.regularization.approve','attendance.export','leave.read','leave.manage','payroll.read');
  INSERT INTO role_permissions SELECT employee_role,key,NOW() FROM permissions
    WHERE key IN ('employees.read','employees.self.read','employees.self.edit','structure.read','attendance.read','attendance.self.manage','leave.read');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
