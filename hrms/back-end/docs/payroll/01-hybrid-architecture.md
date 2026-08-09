# 01. Hybrid Mongo + PostgreSQL Architecture

## Objective

Provide enterprise-grade payroll (India/Telangana-first) while preserving existing HRMS modules and data model.

## Data Boundary

### MongoDB (existing modules)

- Users, roles, permissions
- Employees (master profile)
- Attendance/timesheets
- Leaves, leave types
- Holidays, week-offs, shifts
- Organizational settings and project context

### PostgreSQL (payroll domain)

- Tenant and payroll configuration
- Salary component masters + formulas
- Employee payroll profile and salary structures
- Attendance snapshots (monthly + day level)
- Payroll runs and employee payroll results
- Adjustments, arrears, loans, reimbursements
- Approval audit trail
- Idempotency ledger for safe retries

## Why Hybrid

- Keeps existing HRMS stable while introducing payroll correctness controls.
- PostgreSQL gives transactional integrity for payroll run lifecycle.
- Mongo remains flexible for operational HR data and existing feature velocity.

## Tenant Mapping

- `payroll_tenants.organization_id` stores Mongo org id as external reference.
- Every payroll table is keyed by `tenant_id`.
- API request context resolves tenant from authenticated user organization.

## Payroll Services

- `payrollAttendance.service.js`: Mongo -> Postgres normalized attendance snapshots.
- `payrollApi.service.js`: settings, components, profiles, run metadata CRUD.
- `payrollRun.service.js`: computation engine (earnings/deductions/contributions/net).
- `payrollValidation.service.js`: payroll run validation checks.
- `payrollApproval.service.js`: maker-checker transitions and audit entries.
- `payslip.service.js`: payslip payload generation.
- `payrollReports.service.js`: payroll registers and exports.

## Security and Access Control

- Authentication: JWT middleware.
- Authorization: role-based permission code checks.
- Key payroll permissions:
  - `PAYROLL_CONFIG_MANAGE`
  - `PAYROLL_RUN_CREATE`
  - `PAYROLL_RUN_APPROVE`
  - `PAYROLL_RUN_LOCK`
  - `PAYROLL_PAYSLIP_VIEW`
  - `PAYROLL_REPORT_VIEW`

## Audit and Compliance Controls

- `payroll_run_audit_entries` logs submit/approve/reject/lock/reopen actions.
- `created_by`, `updated_by`, `created_at`, `updated_at` audit columns across payroll tables.
- Idempotency tracking (`payroll_action_idempotency`) prevents duplicate side effects in critical state transitions.

## Production Hardening Controls

- Idempotency key middleware + request hash validation.
- Transaction boundaries with explicit `BEGIN/COMMIT` and safe rollback handling.
- Retry-safe async compute jobs via BullMQ (`PAYROLL_RUN_COMPUTE`).
- Structured logs via Winston (JSON in production).
- Metrics exposed via `/metrics` with payroll-specific counters/histograms.

