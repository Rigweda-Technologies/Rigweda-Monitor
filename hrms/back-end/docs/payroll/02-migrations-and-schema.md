# 02. Migrations and Schema

## Migration Runner

Script: `src/script/payroll.migrate.js`

Safety characteristics:

- Advisory lock (`pg_advisory_lock`) to prevent concurrent execution.
- Migration tracking table (`payroll_schema_migrations`).
- Per-migration transaction.
- Checksum tracking for traceability.

## Commands

Run from `back-end/`:

```bash
npm run migrate:payroll:status
npm run migrate:payroll:up
npm run migrate:payroll:down
```

Rollback multiple steps:

```bash
node src/script/payroll.migrate.js down --steps=2
```

## Required Environment

```env
PAYROLL_DB_ENABLED=true
PAYROLL_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/upanaya_payroll
PAYROLL_MIGRATIONS_TABLE=payroll_schema_migrations
PAYROLL_MIGRATION_LOCK_KEY=9011001
```

## Migration Sequence

- `0001_payroll_base`
  - `payroll_tenants`, `pay_groups`, `pay_periods`, `payroll_settings`
- `0002_salary_components`
  - earning/deduction/employer component masters + formulas
- `0003_employee_payroll_profiles`
  - employee payroll profile, bank/statutory details, salary structures, revisions
- `0004_attendance_snapshots`
  - monthly and day-level normalized attendance snapshots
- `0005_payroll_run_lifecycle`
  - payroll runs, run employees, run components, adjustments, arrears, loans, reimbursements
- `0006_payroll_approvals_audit`
  - run action audit trail
- `0007_payroll_idempotency_and_jobs`
  - idempotency ledger for critical payroll actions

## Core Table Groups

### Configuration

- `payroll_tenants`
- `pay_groups`
- `pay_periods`
- `payroll_settings`

### Salary Modeling

- `earning_components`
- `deduction_components`
- `employer_contribution_components`
- `component_formulas`

### Employee Payroll Master

- `employee_payroll_profiles`
- `employee_salary_structures`
- `employee_bank_details`
- `employee_statutory_details`
- `employee_salary_structure_revisions`

### Attendance Normalization

- `payroll_attendance_snapshots`
- `payroll_attendance_snapshot_days`

### Payroll Execution

- `payroll_runs`
- `payroll_run_employees`
- `payroll_run_components`
- `payroll_adjustments`
- `payroll_arrears`
- `payroll_loans`
- `payroll_reimbursements`

### Governance

- `payroll_run_audit_entries`
- `payroll_action_idempotency`

## Notes

- Payroll tables are tenant-scoped and indexed for run-heavy queries.
- Update triggers maintain `updated_at` consistency.
- `idempotency_key` exists on `payroll_runs` for traceability; full replay state is in `payroll_action_idempotency`.

