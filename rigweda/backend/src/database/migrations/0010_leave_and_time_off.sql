BEGIN;

INSERT INTO permissions(key,module,name,description) VALUES
  ('leave.self.manage','leave','Manage own leave','Create, withdraw, and cancel personal leave requests'),
  ('leave.approve','leave','Approve leave','Approve, reject, and review cancellation requests'),
  ('leave.configure','leave','Configure leave','Manage leave types, calendars, holidays, and balances'),
  ('leave.export','leave','Export leave','Export authorized leave reports as CSV')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,p.key FROM roles r JOIN permissions p ON p.key IN ('leave.self.manage','leave.approve','leave.configure','leave.export')
WHERE r.key IN ('system_admin','organization_admin') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,p.key FROM roles r JOIN permissions p ON p.key='leave.self.manage'
WHERE r.key='employee' ON CONFLICT DO NOTHING;

CREATE TABLE leave_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(500),
  color VARCHAR(7) NOT NULL DEFAULT '#2f8f74' CHECK(color ~ '^#[0-9A-Fa-f]{6}$'),
  annual_entitlement_days NUMERIC(7,2) NOT NULL DEFAULT 0 CHECK(annual_entitlement_days >= 0),
  is_paid BOOLEAN NOT NULL DEFAULT TRUE,
  requires_approval BOOLEAN NOT NULL DEFAULT TRUE,
  allow_half_day BOOLEAN NOT NULL DEFAULT TRUE,
  allow_negative_balance BOOLEAN NOT NULL DEFAULT FALSE,
  maximum_negative_days NUMERIC(7,2) NOT NULL DEFAULT 0 CHECK(maximum_negative_days >= 0),
  minimum_notice_days SMALLINT NOT NULL DEFAULT 0 CHECK(minimum_notice_days BETWEEN 0 AND 365),
  maximum_consecutive_days SMALLINT CHECK(maximum_consecutive_days IS NULL OR maximum_consecutive_days BETWEEN 1 AND 366),
  attachment_required_after_days NUMERIC(7,2) CHECK(attachment_required_after_days IS NULL OR attachment_required_after_days > 0),
  carry_forward_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  maximum_carry_forward_days NUMERIC(7,2) NOT NULL DEFAULT 0 CHECK(maximum_carry_forward_days >= 0),
  encashment_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id,code),
  UNIQUE(organization_id,name)
);
CREATE INDEX leave_types_active_idx ON leave_types(organization_id,status,name);

CREATE TABLE holiday_calendars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(500),
  timezone VARCHAR(80) NOT NULL DEFAULT 'Asia/Kolkata',
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id,name)
);
CREATE UNIQUE INDEX holiday_calendars_one_default_idx ON holiday_calendars(organization_id) WHERE is_default;

CREATE TABLE holiday_calendar_locations (
  calendar_id UUID NOT NULL REFERENCES holiday_calendars(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  work_location_id UUID NOT NULL REFERENCES work_locations(id) ON DELETE CASCADE,
  PRIMARY KEY(calendar_id,work_location_id),
  UNIQUE(organization_id,work_location_id)
);

CREATE TABLE holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  calendar_id UUID NOT NULL REFERENCES holiday_calendars(id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL,
  holiday_date DATE NOT NULL,
  is_optional BOOLEAN NOT NULL DEFAULT FALSE,
  description VARCHAR(500),
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(calendar_id,holiday_date,name)
);
CREATE INDEX holidays_lookup_idx ON holidays(organization_id,calendar_id,holiday_date);

CREATE TABLE leave_balance_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id UUID NOT NULL REFERENCES leave_types(id) ON DELETE RESTRICT,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  opening_days NUMERIC(9,2) NOT NULL DEFAULT 0,
  accrued_days NUMERIC(9,2) NOT NULL DEFAULT 0,
  adjusted_days NUMERIC(9,2) NOT NULL DEFAULT 0,
  carried_forward_days NUMERIC(9,2) NOT NULL DEFAULT 0,
  used_days NUMERIC(9,2) NOT NULL DEFAULT 0 CHECK(used_days >= 0),
  pending_days NUMERIC(9,2) NOT NULL DEFAULT 0 CHECK(pending_days >= 0),
  encashed_days NUMERIC(9,2) NOT NULL DEFAULT 0 CHECK(encashed_days >= 0),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id,employee_id,leave_type_id,period_start),
  CHECK(period_end >= period_start)
);
CREATE INDEX leave_balance_employee_idx ON leave_balance_accounts(organization_id,employee_id,period_start DESC);
CREATE INDEX leave_balance_type_idx ON leave_balance_accounts(organization_id,leave_type_id,period_start DESC);

CREATE TABLE leave_balance_ledger (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES leave_balance_accounts(id) ON DELETE CASCADE,
  transaction_type VARCHAR(30) NOT NULL CHECK(transaction_type IN ('opening','accrual','adjustment','request_hold','request_release','usage','usage_reversal','carry_forward','encashment','expiry')),
  amount_days NUMERIC(9,2) NOT NULL,
  balance_after NUMERIC(9,2) NOT NULL,
  reference_type VARCHAR(30),
  reference_id UUID,
  notes VARCHAR(500),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX leave_ledger_account_idx ON leave_balance_ledger(account_id,occurred_at DESC,id DESC);
CREATE INDEX leave_ledger_tenant_idx ON leave_balance_ledger(organization_id,occurred_at DESC);

CREATE TABLE leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type_id UUID NOT NULL REFERENCES leave_types(id) ON DELETE RESTRICT,
  balance_account_id UUID REFERENCES leave_balance_accounts(id) ON DELETE SET NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  start_session VARCHAR(20) NOT NULL DEFAULT 'full_day' CHECK(start_session IN ('full_day','first_half','second_half')),
  end_session VARCHAR(20) NOT NULL DEFAULT 'full_day' CHECK(end_session IN ('full_day','first_half','second_half')),
  requested_days NUMERIC(7,2) NOT NULL CHECK(requested_days > 0),
  reason VARCHAR(1000) NOT NULL,
  emergency_contact VARCHAR(160),
  handover_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  attachment_name VARCHAR(255),
  attachment_url VARCHAR(1000),
  status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK(status IN ('draft','pending','approved','rejected','cancel_requested','cancelled','withdrawn')),
  submitted_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewer_comment VARCHAR(1000),
  reviewed_at TIMESTAMPTZ,
  cancellation_reason VARCHAR(1000),
  cancellation_reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  cancellation_comment VARCHAR(1000),
  cancellation_reviewed_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(end_date >= start_date)
);
CREATE INDEX leave_requests_queue_idx ON leave_requests(organization_id,status,submitted_at DESC,id);
CREATE INDEX leave_requests_employee_idx ON leave_requests(organization_id,employee_id,start_date DESC,id);
CREATE INDEX leave_requests_calendar_idx ON leave_requests(organization_id,start_date,end_date,status);

CREATE TABLE leave_request_days (
  request_id UUID NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_date DATE NOT NULL,
  fraction NUMERIC(3,2) NOT NULL CHECK(fraction IN (0.50,1.00)),
  session VARCHAR(20) NOT NULL CHECK(session IN ('full_day','first_half','second_half')),
  PRIMARY KEY(request_id,leave_date)
);
CREATE INDEX leave_request_days_employee_idx ON leave_request_days(organization_id,employee_id,leave_date,request_id);
CREATE INDEX leave_request_days_calendar_idx ON leave_request_days(organization_id,leave_date,request_id);

CREATE TABLE leave_request_allocations (
  request_id UUID NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES leave_balance_accounts(id) ON DELETE RESTRICT,
  allocated_days NUMERIC(7,2) NOT NULL CHECK(allocated_days > 0),
  PRIMARY KEY(request_id,account_id)
);
CREATE INDEX leave_request_allocations_account_idx ON leave_request_allocations(account_id,request_id);

CREATE TABLE leave_request_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id UUID NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type VARCHAR(40) NOT NULL,
  before_snapshot JSONB,
  after_snapshot JSONB NOT NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX leave_history_request_idx ON leave_request_history(request_id,occurred_at DESC,id DESC);

ALTER TABLE attendance_records ADD COLUMN leave_request_id UUID REFERENCES leave_requests(id) ON DELETE SET NULL;
CREATE INDEX attendance_records_leave_idx ON attendance_records(leave_request_id) WHERE leave_request_id IS NOT NULL;

CREATE TRIGGER leave_types_set_updated_at BEFORE UPDATE ON leave_types FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER holiday_calendars_set_updated_at BEFORE UPDATE ON holiday_calendars FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER holidays_set_updated_at BEFORE UPDATE ON holidays FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER leave_balance_accounts_set_updated_at BEFORE UPDATE ON leave_balance_accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER leave_requests_set_updated_at BEFORE UPDATE ON leave_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO leave_types(organization_id,code,name,description,annual_entitlement_days,is_paid,carry_forward_allowed,maximum_carry_forward_days)
SELECT id,'ANNUAL','Annual Leave','Paid planned time away from work',18,TRUE,TRUE,5 FROM organizations
ON CONFLICT(organization_id,code) DO NOTHING;
INSERT INTO leave_types(organization_id,code,name,description,annual_entitlement_days,is_paid,attachment_required_after_days)
SELECT id,'SICK','Sick Leave','Paid leave for illness or recovery',12,TRUE,3 FROM organizations
ON CONFLICT(organization_id,code) DO NOTHING;
INSERT INTO leave_types(organization_id,code,name,description,annual_entitlement_days,is_paid,allow_negative_balance,maximum_negative_days)
SELECT id,'UNPAID','Unpaid Leave','Approved unpaid time away from work',0,FALSE,TRUE,366 FROM organizations
ON CONFLICT(organization_id,code) DO NOTHING;
INSERT INTO holiday_calendars(organization_id,name,description,timezone,is_default)
SELECT id,'Default Calendar','Organization-wide holiday calendar',timezone,TRUE FROM organizations
ON CONFLICT(organization_id,name) DO NOTHING;

CREATE OR REPLACE FUNCTION seed_organization_leave_defaults()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO leave_types(organization_id,code,name,description,annual_entitlement_days,is_paid,carry_forward_allowed,maximum_carry_forward_days)
    VALUES(NEW.id,'ANNUAL','Annual Leave','Paid planned time away from work',18,TRUE,TRUE,5);
  INSERT INTO leave_types(organization_id,code,name,description,annual_entitlement_days,is_paid,attachment_required_after_days)
    VALUES(NEW.id,'SICK','Sick Leave','Paid leave for illness or recovery',12,TRUE,3);
  INSERT INTO leave_types(organization_id,code,name,description,annual_entitlement_days,is_paid,allow_negative_balance,maximum_negative_days)
    VALUES(NEW.id,'UNPAID','Unpaid Leave','Approved unpaid time away from work',0,FALSE,TRUE,366);
  INSERT INTO holiday_calendars(organization_id,name,description,timezone,is_default)
    VALUES(NEW.id,'Default Calendar','Organization-wide holiday calendar',NEW.timezone,TRUE);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER organizations_seed_leave_defaults AFTER INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION seed_organization_leave_defaults();

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
    WHERE key IN ('organizations.read','organizations.manage','users.read','users.manage','roles.read','roles.manage','employees.read','employees.manage','employees.sensitive.read','employees.lifecycle.manage','employees.export','employees.self.read','employees.self.edit','employees.bulk.manage','employees.documents.manage','structure.read','structure.manage','attendance.read','attendance.manage','attendance.self.manage','attendance.regularization.approve','attendance.export','leave.read','leave.manage','leave.self.manage','leave.approve','leave.configure','leave.export','payroll.read');
  INSERT INTO role_permissions SELECT employee_role,key,NOW() FROM permissions
    WHERE key IN ('employees.read','employees.self.read','employees.self.edit','structure.read','attendance.read','attendance.self.manage','leave.read','leave.self.manage');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
