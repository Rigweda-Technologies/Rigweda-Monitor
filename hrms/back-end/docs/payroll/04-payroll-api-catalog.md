# 04. Payroll API Catalog

Base path: `/api/payroll`

All routes require `auth.middleware` and permission authorization.

## Settings and Master Data

- `GET /settings` - `PAYROLL_CONFIG_MANAGE`
- `PUT /settings` - `PAYROLL_CONFIG_MANAGE`
- `POST /salary-components` - `PAYROLL_CONFIG_MANAGE`
- `GET /salary-components` - `PAYROLL_CONFIG_MANAGE`
- `GET /salary-components/:id` - `PAYROLL_CONFIG_MANAGE`
- `PUT /salary-components/:id` - `PAYROLL_CONFIG_MANAGE`
- `DELETE /salary-components/:id` - `PAYROLL_CONFIG_MANAGE`

## Employee Payroll Profiles

- `POST /employee-profiles` - `PAYROLL_CONFIG_MANAGE`
- `GET /employee-profiles` - `PAYROLL_CONFIG_MANAGE`
- `GET /employee-profiles/:profileId` - `PAYROLL_CONFIG_MANAGE`
- `PUT /employee-profiles/:profileId` - `PAYROLL_CONFIG_MANAGE`
- `DELETE /employee-profiles/:profileId` - `PAYROLL_CONFIG_MANAGE`
- `POST /employee-profiles/:profileId/bank-details` - `PAYROLL_CONFIG_MANAGE`
- `POST /employee-profiles/:profileId/statutory-details` - `PAYROLL_CONFIG_MANAGE`
- `POST /employee-profiles/:profileId/salary-structures` - `PAYROLL_CONFIG_MANAGE`
- `PUT /salary-structures/:salaryStructureId` - `PAYROLL_CONFIG_MANAGE`
- `DELETE /salary-structures/:salaryStructureId` - `PAYROLL_CONFIG_MANAGE`

## Payroll Runs

- `POST /runs` - `PAYROLL_RUN_CREATE`
- `GET /runs` - `PAYROLL_RUN_CREATE|PAYROLL_RUN_APPROVE|PAYROLL_RUN_LOCK|PAYROLL_REPORT_VIEW|PAYROLL_RUN_VIEW`
- `GET /runs/:runId` - same as above
- `POST /runs/:runId/preview` - same as above
- `POST /runs/:runId/compute` - `PAYROLL_RUN_CREATE`
- `POST /runs/:runId/recompute` - `PAYROLL_RUN_CREATE`
- `POST /runs/:runId/validate` - `PAYROLL_RUN_CREATE`

## Attendance Snapshots

- `POST /attendance-snapshots/generate` - `PAYROLL_RUN_CREATE`
- `GET /attendance-snapshots` - `PAYROLL_RUN_CREATE|PAYROLL_REPORT_VIEW`

## Approval Workflow

- `POST /runs/:runId/submit` - `PAYROLL_RUN_CREATE|PAYROLL_RUN_SUBMIT`
- `POST /runs/:runId/approve` - `PAYROLL_RUN_APPROVE`
- `POST /runs/:runId/reject` - `PAYROLL_RUN_APPROVE`
- `POST /runs/:runId/lock` - `PAYROLL_RUN_LOCK`
- `POST /runs/:runId/reopen` - `PAYROLL_RUN_REOPEN`
- `GET /runs/:runId/audit` - `PAYROLL_REPORT_VIEW|PAYROLL_RUN_VIEW`

## Payslips and Reports

- `GET /runs/:runId/payslips/:employeeExternalId` - `PAYROLL_PAYSLIP_VIEW`
- `GET /payslips/monthly` - `PAYROLL_PAYSLIP_VIEW`
- `GET /reports/payroll-register` - `PAYROLL_REPORT_VIEW`
- `GET /reports/bank-transfer-export` - `PAYROLL_REPORT_VIEW`
- `GET /reports/deduction-summary` - `PAYROLL_REPORT_VIEW`
- `GET /reports/employer-contribution-summary` - `PAYROLL_REPORT_VIEW`
- `GET /reports/cost-center-totals` - `PAYROLL_REPORT_VIEW`

## Idempotency-Sensitive Endpoints

Use header `Idempotency-Key` (or `X-Idempotency-Key`) for these routes:

- `POST /runs`
- `POST /runs/:runId/compute`
- `POST /runs/:runId/recompute`
- `POST /runs/:runId/submit`
- `POST /runs/:runId/approve`
- `POST /runs/:runId/reject`
- `POST /runs/:runId/lock`
- `POST /runs/:runId/reopen`

If `PAYROLL_IDEMPOTENCY_REQUIRED=true`, key is mandatory.

## Async Compute

For compute/recompute payload, optional field:

```json
{
  "async": true
}
```

- `async=true` queues background job and returns `202`.
- Worker (`npm run jobs:worker`) processes compute with retry/backoff.

