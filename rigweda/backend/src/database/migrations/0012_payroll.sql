BEGIN;

INSERT INTO permissions(key,module,name,description) VALUES
  ('payroll.self.read','payroll','View own payslips','View personal payroll summaries and payslips'),
  ('payroll.approve','payroll','Approve payroll','Approve, finalize, and reopen payroll runs'),
  ('payroll.export','payroll','Export payroll','Export payroll run and payslip data')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,p.key FROM roles r JOIN permissions p ON p.key IN ('payroll.read','payroll.manage','payroll.approve','payroll.export','payroll.self.read')
WHERE r.key IN ('system_admin','organization_admin') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,p.key FROM roles r JOIN permissions p ON p.key IN ('payroll.read','payroll.self.read')
WHERE r.key='employee' ON CONFLICT DO NOTHING;

CREATE TABLE payroll_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(140) NOT NULL,
  pay_frequency VARCHAR(20) NOT NULL DEFAULT 'monthly' CHECK(pay_frequency IN ('monthly','semi_monthly','biweekly','weekly')),
  pay_day SMALLINT NOT NULL DEFAULT 28 CHECK(pay_day BETWEEN 1 AND 31),
  cutoff_day SMALLINT NOT NULL DEFAULT 25 CHECK(cutoff_day BETWEEN 1 AND 31),
  timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id,code),
  UNIQUE(organization_id,name)
);
CREATE UNIQUE INDEX payroll_schedules_one_default_idx ON payroll_schedules(organization_id) WHERE is_default;

CREATE TABLE payroll_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(140) NOT NULL,
  component_type VARCHAR(32) NOT NULL CHECK(component_type IN ('earning','deduction','employer_contribution','reimbursement')),
  calculation_method VARCHAR(32) NOT NULL DEFAULT 'manual' CHECK(calculation_method IN ('fixed','percent_of_basic','percent_of_gross','manual')),
  default_value NUMERIC(12,4) NOT NULL DEFAULT 0,
  taxable BOOLEAN NOT NULL DEFAULT TRUE,
  affects_gross BOOLEAN NOT NULL DEFAULT TRUE,
  affects_net BOOLEAN NOT NULL DEFAULT TRUE,
  display_order SMALLINT NOT NULL DEFAULT 100,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id,code),
  UNIQUE(organization_id,name)
);

CREATE TABLE employee_compensation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  payroll_schedule_id UUID REFERENCES payroll_schedules(id) ON DELETE SET NULL,
  effective_from DATE NOT NULL,
  effective_to DATE,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  annual_ctc NUMERIC(14,2) NOT NULL CHECK(annual_ctc >= 0),
  monthly_basic NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(monthly_basic >= 0),
  monthly_hra NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(monthly_hra >= 0),
  monthly_special NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(monthly_special >= 0),
  pf_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  esi_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  professional_tax_monthly NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK(professional_tax_monthly >= 0),
  income_tax_monthly NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK(income_tax_monthly >= 0),
  payment_mode VARCHAR(24) NOT NULL DEFAULT 'bank_transfer' CHECK(payment_mode IN ('bank_transfer','cheque','cash','upi')),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX employee_compensation_employee_idx ON employee_compensation(organization_id,employee_id,effective_from DESC,status);

CREATE TABLE payroll_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  component_id UUID REFERENCES payroll_components(id) ON DELETE SET NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  adjustment_type VARCHAR(20) NOT NULL CHECK(adjustment_type IN ('earning','deduction')),
  amount NUMERIC(14,2) NOT NULL CHECK(amount > 0),
  reason VARCHAR(600) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','applied','cancelled')),
  reviewer_comment VARCHAR(600),
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(period_end >= period_start)
);
CREATE INDEX payroll_adjustments_queue_idx ON payroll_adjustments(organization_id,status,period_start DESC);
CREATE INDEX payroll_adjustments_employee_idx ON payroll_adjustments(organization_id,employee_id,period_start DESC);

CREATE TABLE payroll_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payroll_schedule_id UUID REFERENCES payroll_schedules(id) ON DELETE SET NULL,
  name VARCHAR(160) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  pay_date DATE NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  status VARCHAR(24) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','computed','approved','finalized','reopened','voided')),
  employee_count INTEGER NOT NULL DEFAULT 0 CHECK(employee_count >= 0),
  gross_earnings NUMERIC(16,2) NOT NULL DEFAULT 0,
  total_deductions NUMERIC(16,2) NOT NULL DEFAULT 0,
  employer_contributions NUMERIC(16,2) NOT NULL DEFAULT 0,
  net_pay NUMERIC(16,2) NOT NULL DEFAULT 0,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  finalized_by UUID REFERENCES users(id) ON DELETE SET NULL,
  finalized_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(period_end >= period_start)
);
CREATE UNIQUE INDEX payroll_runs_open_period_idx ON payroll_runs(organization_id,payroll_schedule_id,period_start,period_end)
  WHERE status <> 'voided';
CREATE INDEX payroll_runs_status_idx ON payroll_runs(organization_id,status,period_start DESC);

CREATE TABLE payroll_run_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payroll_run_id UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  compensation_id UUID REFERENCES employee_compensation(id) ON DELETE SET NULL,
  payable_days NUMERIC(6,2) NOT NULL DEFAULT 0,
  lop_days NUMERIC(6,2) NOT NULL DEFAULT 0,
  gross_earnings NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_deductions NUMERIC(14,2) NOT NULL DEFAULT 0,
  employer_contributions NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_pay NUMERIC(14,2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'computed' CHECK(status IN ('computed','held','finalized')),
  hold_reason VARCHAR(500),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(payroll_run_id,employee_id)
);
CREATE INDEX payroll_run_items_employee_idx ON payroll_run_items(organization_id,employee_id,created_at DESC);

CREATE TABLE payroll_run_item_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_item_id UUID NOT NULL REFERENCES payroll_run_items(id) ON DELETE CASCADE,
  component_id UUID REFERENCES payroll_components(id) ON DELETE SET NULL,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(140) NOT NULL,
  component_type VARCHAR(32) NOT NULL,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  taxable BOOLEAN NOT NULL DEFAULT TRUE,
  display_order SMALLINT NOT NULL DEFAULT 100
);
CREATE INDEX payroll_item_components_item_idx ON payroll_run_item_components(payroll_run_item_id,display_order);

CREATE TABLE payroll_run_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payroll_run_id UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  event_type VARCHAR(40) NOT NULL,
  before_snapshot JSONB,
  after_snapshot JSONB NOT NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX payroll_run_history_run_idx ON payroll_run_history(payroll_run_id,occurred_at DESC,id DESC);

CREATE TRIGGER payroll_schedules_set_updated_at BEFORE UPDATE ON payroll_schedules FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER payroll_components_set_updated_at BEFORE UPDATE ON payroll_components FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER employee_compensation_set_updated_at BEFORE UPDATE ON employee_compensation FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER payroll_adjustments_set_updated_at BEFORE UPDATE ON payroll_adjustments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER payroll_runs_set_updated_at BEFORE UPDATE ON payroll_runs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER payroll_run_items_set_updated_at BEFORE UPDATE ON payroll_run_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO payroll_schedules(organization_id,code,name,timezone,is_default)
SELECT id,'MONTHLY','Monthly Payroll',timezone,TRUE FROM organizations
ON CONFLICT(organization_id,code) DO NOTHING;

INSERT INTO payroll_components(organization_id,code,name,component_type,calculation_method,default_value,taxable,affects_gross,affects_net,display_order)
SELECT id,'BASIC','Basic Salary','earning','manual',0,TRUE,TRUE,TRUE,10 FROM organizations ON CONFLICT(organization_id,code) DO NOTHING;
INSERT INTO payroll_components(organization_id,code,name,component_type,calculation_method,default_value,taxable,affects_gross,affects_net,display_order)
SELECT id,'HRA','House Rent Allowance','earning','manual',0,TRUE,TRUE,TRUE,20 FROM organizations ON CONFLICT(organization_id,code) DO NOTHING;
INSERT INTO payroll_components(organization_id,code,name,component_type,calculation_method,default_value,taxable,affects_gross,affects_net,display_order)
SELECT id,'SPECIAL','Special Allowance','earning','manual',0,TRUE,TRUE,TRUE,30 FROM organizations ON CONFLICT(organization_id,code) DO NOTHING;
INSERT INTO payroll_components(organization_id,code,name,component_type,calculation_method,default_value,taxable,affects_gross,affects_net,display_order)
SELECT id,'PF_EMP','Employee PF','deduction','percent_of_basic',12,FALSE,FALSE,TRUE,80 FROM organizations ON CONFLICT(organization_id,code) DO NOTHING;
INSERT INTO payroll_components(organization_id,code,name,component_type,calculation_method,default_value,taxable,affects_gross,affects_net,display_order)
SELECT id,'PT','Professional Tax','deduction','manual',0,FALSE,FALSE,TRUE,90 FROM organizations ON CONFLICT(organization_id,code) DO NOTHING;
INSERT INTO payroll_components(organization_id,code,name,component_type,calculation_method,default_value,taxable,affects_gross,affects_net,display_order)
SELECT id,'TDS','Income Tax','deduction','manual',0,FALSE,FALSE,TRUE,100 FROM organizations ON CONFLICT(organization_id,code) DO NOTHING;
INSERT INTO payroll_components(organization_id,code,name,component_type,calculation_method,default_value,taxable,affects_gross,affects_net,display_order)
SELECT id,'PF_ER','Employer PF','employer_contribution','percent_of_basic',12,FALSE,FALSE,FALSE,120 FROM organizations ON CONFLICT(organization_id,code) DO NOTHING;

CREATE OR REPLACE FUNCTION seed_organization_payroll_defaults()
RETURNS TRIGGER AS $$
DECLARE schedule_id UUID;
BEGIN
  INSERT INTO payroll_schedules(organization_id,code,name,timezone,is_default)
    VALUES(NEW.id,'MONTHLY','Monthly Payroll',NEW.timezone,TRUE) RETURNING id INTO schedule_id;
  INSERT INTO payroll_components(organization_id,code,name,component_type,calculation_method,default_value,taxable,affects_gross,affects_net,display_order) VALUES
    (NEW.id,'BASIC','Basic Salary','earning','manual',0,TRUE,TRUE,TRUE,10),
    (NEW.id,'HRA','House Rent Allowance','earning','manual',0,TRUE,TRUE,TRUE,20),
    (NEW.id,'SPECIAL','Special Allowance','earning','manual',0,TRUE,TRUE,TRUE,30),
    (NEW.id,'PF_EMP','Employee PF','deduction','percent_of_basic',12,FALSE,FALSE,TRUE,80),
    (NEW.id,'PT','Professional Tax','deduction','manual',0,FALSE,FALSE,TRUE,90),
    (NEW.id,'TDS','Income Tax','deduction','manual',0,FALSE,FALSE,TRUE,100),
    (NEW.id,'PF_ER','Employer PF','employer_contribution','percent_of_basic',12,FALSE,FALSE,FALSE,120);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER organizations_seed_payroll_defaults AFTER INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION seed_organization_payroll_defaults();

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
    ('organizations.read','organizations.manage','users.read','users.manage','roles.read','roles.manage','employees.read','employees.manage','employees.sensitive.read','employees.lifecycle.manage','employees.export','employees.self.read','employees.self.edit','employees.bulk.manage','employees.documents.manage','structure.read','structure.manage','attendance.read','attendance.manage','attendance.self.manage','attendance.regularization.approve','attendance.export','leave.read','leave.manage','leave.self.manage','leave.approve','leave.configure','leave.export','worklogs.read','worklogs.self.manage','worklogs.manage','worklogs.approve','worklogs.export','payroll.read','payroll.manage','payroll.self.read','payroll.approve','payroll.export');
  INSERT INTO role_permissions SELECT employee_role,key,NOW() FROM permissions WHERE key IN
    ('employees.read','employees.self.read','employees.self.edit','structure.read','attendance.read','attendance.self.manage','leave.read','leave.self.manage','worklogs.read','worklogs.self.manage','payroll.read','payroll.self.read');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
