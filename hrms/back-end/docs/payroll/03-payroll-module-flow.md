# 03. Payroll Module Flow

## End-to-End Lifecycle

1. Configure payroll
- Save payroll settings, pay groups, components, formulas.

2. Create employee payroll profile
- Link Mongo employee id with payroll profile and statutory/bank details.

3. Generate attendance snapshots
- Pull attendance/leave/weekoff/holiday from Mongo.
- Normalize monthly values into Postgres snapshot tables.

4. Create payroll run
- Seed run with employee rows from attendance snapshots.

5. Compute payroll
- Evaluate earning/deduction/employer components.
- Apply proration, LOP, OT, arrears, reimbursements, loans.
- Persist computed line items and totals.

6. Validate payroll
- Run compliance and data quality checks.

7. Approval workflow (maker-checker)
- Submit -> Approve/Reject -> Lock -> Reopen (controlled permissions).
- Capture all transition audits.

8. Output
- Payslip payload generation.
- Register/report exports.

## Compute Flow (Detailed)

Input sets:

- Payroll run (`payroll_runs`)
- Attendance snapshots (`payroll_attendance_snapshots`)
- Employee salary structure/profile data
- Active components and formulas
- Adjustments/arrears/loans/reimbursements

Execution:

- Lock run row (`FOR UPDATE`) for compute safety.
- Upsert `payroll_run_employees` rows.
- Resolve component amounts via formula/fixed/percentage/slab.
- Write merged component lines to `payroll_run_components`.
- Update run employee totals/status.
- Update run aggregate totals/status.

Output status:

- `ready_for_approval` when no compute errors.
- `validation_failed` when any employee compute errors exist.

## Idempotency Flow for Critical Actions

- Caller provides `Idempotency-Key` header.
- System writes/claims action in `payroll_action_idempotency`.
- Same key + same payload returns stored response.
- Same key + different payload returns conflict.
- In-progress duplicate request is rejected until timeout window expires.

## Sync vs Async Compute

- Sync: API computes in request lifecycle.
- Async: API enqueues BullMQ job (`PAYROLL_RUN_COMPUTE`), worker executes compute with retry/backoff.

