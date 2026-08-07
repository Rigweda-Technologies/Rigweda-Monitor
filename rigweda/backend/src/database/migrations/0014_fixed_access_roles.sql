BEGIN;

-- Normalize the four fixed roles to the names used in Rigweda.
UPDATE roles SET name='OrgAdmin', description='Organization administrators with full workspace control'
WHERE key='organization_admin';
UPDATE roles SET name='HR', description='Human resources operators with people and policy access'
WHERE key='hr';
UPDATE roles SET name='Manager', description='Team leads with approval and team visibility access'
WHERE key='manager';
UPDATE roles SET name='Employee', description='Standard employee self-service access'
WHERE key='employee';

-- If a database was seeded before this migration existed, create the missing fixed roles.
INSERT INTO roles(organization_id,key,name,description,is_system)
SELECT o.id,'hr','HR','Human resources operators with people and policy access',TRUE
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM roles r WHERE r.organization_id=o.id AND r.key='hr'
);

INSERT INTO roles(organization_id,key,name,description,is_system)
SELECT o.id,'manager','Manager','Team leads with approval and team visibility access',TRUE
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM roles r WHERE r.organization_id=o.id AND r.key='manager'
);

-- OrgAdmin, HR, Manager, and Employee should all exist and keep deterministic permissions.
DELETE FROM role_permissions rp
USING roles r
WHERE rp.role_id=r.id
  AND r.key IN ('organization_admin','hr','manager','employee');

-- OrgAdmin gets every permission.
INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,p.key
FROM roles r
CROSS JOIN permissions p
WHERE r.key='organization_admin'
ON CONFLICT DO NOTHING;

-- HR gets all operational permissions plus people, attendance, leave, payroll, recruitment, and structure.
INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,p.key
FROM roles r
JOIN permissions p ON p.key IN (
  'organizations.read','organizations.manage',
  'users.read','users.manage','roles.read','roles.manage',
  'employees.read','employees.manage','employees.sensitive.read','employees.lifecycle.manage','employees.export','employees.self.read','employees.self.edit','employees.bulk.manage','employees.documents.manage',
  'attendance.read','attendance.manage','attendance.self.manage','attendance.regularization.approve','attendance.export',
  'leave.read','leave.manage','leave.self.manage','leave.approve','leave.configure','leave.export',
  'payroll.read','payroll.manage','payroll.approve','payroll.export','payroll.self.read',
  'structure.read','structure.manage',
  'worklogs.read','worklogs.self.manage','worklogs.manage','worklogs.approve','worklogs.export',
  'recruitment.read','recruitment.manage','recruitment.approve','recruitment.export'
)
WHERE r.key='hr'
ON CONFLICT DO NOTHING;

-- Manager gets self-service plus team visibility and approvals.
INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,p.key
FROM roles r
JOIN permissions p ON p.key IN (
  'employees.read','employees.self.read',
  'attendance.read','attendance.self.manage',
  'leave.read','leave.self.manage','leave.approve',
  'worklogs.read','worklogs.self.manage','worklogs.approve',
  'payroll.read','payroll.self.read'
)
WHERE r.key='manager'
ON CONFLICT DO NOTHING;

-- Employee gets the same self-service experience as the source app baseline.
INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,p.key
FROM roles r
JOIN permissions p ON p.key IN (
  'employees.read','employees.self.read','employees.self.edit',
  'attendance.read','attendance.self.manage',
  'leave.read','leave.self.manage',
  'worklogs.read','worklogs.self.manage',
  'payroll.read','payroll.self.read'
)
WHERE r.key='employee'
ON CONFLICT DO NOTHING;

-- Keep memberships aligned to the renamed fixed roles.
UPDATE organization_memberships m
SET role_id = r.id,
    role_key = r.key
FROM roles r
WHERE r.organization_id = m.organization_id
  AND m.role_key = r.key
  AND r.key IN ('organization_admin','hr','manager','employee');

COMMIT;
