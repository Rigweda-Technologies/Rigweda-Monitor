# Payroll Technical Documentation (Upanaya)

This documentation set covers the production payroll stack for Upanaya using a hybrid MongoDB + PostgreSQL architecture for Indian companies (Telangana-first defaults).

## Documents

1. [01-hybrid-architecture.md](./01-hybrid-architecture.md)
   - System architecture, data boundaries, tenancy model, RBAC, and audit design.
2. [02-migrations-and-schema.md](./02-migrations-and-schema.md)
   - Migration commands, safety model, and schema map for payroll tables.
3. [03-payroll-module-flow.md](./03-payroll-module-flow.md)
   - End-to-end lifecycle from attendance snapshot to payslip/reports.
4. [04-payroll-api-catalog.md](./04-payroll-api-catalog.md)
   - Complete payroll API catalog with route groups and permissions.
5. [05-operational-runbook.md](./05-operational-runbook.md)
   - Deployment, scaling, observability, incident handling, and backup guidance.
6. [06-payroll-hr-guide.md](./06-payroll-hr-guide.md)
   - Fresher-HR-friendly step-by-step payroll execution guide with Telangana defaults.

## Scope

- Existing HRMS modules continue on MongoDB.
- Payroll engine/state is on PostgreSQL.
- Attendance source remains Mongo-based and is normalized into Postgres snapshots.
- APIs are exposed from `back-end/src/modules/payroll/payrollAttendance.routes.js`.

## Quick Start

From `back-end/`:

```bash
npm run migrate:payroll:up
npm run start
# if async compute enabled
npm run jobs:worker
```

Then verify:

- `GET /health`
- `GET /ready`
- `GET /metrics`
