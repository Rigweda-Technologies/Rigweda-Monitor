# Rigweda

An independently implemented, multi-tenant HR and payroll platform.

## Local development

1. Copy `backend/.env.example` to `backend/.env`.
2. Copy `frontend/.env.example` to `frontend/.env`.
3. Create a PostgreSQL database and set `DATABASE_URL`.
4. Run `npm run install:all` from this directory.
5. Run backend migrations with `npm run db:migrate --prefix backend`.
6. Run both applications with `npm run dev`.

The frontend is available at http://localhost:5173 and the API at
http://localhost:4100/api/v1.

Only one process can listen on a port. If `npm start` reports that port 4100 is
already in use, the Rigweda API is already running; verify it at
http://localhost:4100/api/v1/ready instead of starting a duplicate process.
Port 5000 is intentionally not used because macOS commonly reserves it for
Control Center/AirPlay Receiver.

## Implementation status

- 00 Foundation and application shell — complete
- 01 Theme system and organization/personal palettes — complete
- 02 Organization administration — complete
- 03 Authentication and session security — complete
- 04 Users, roles, and permissions — complete
- 05 Employee directory and employee self-service — complete
- 06 Organization structure — complete
  - Departments: hierarchy, heads, cost centers, employee/child counts, lifecycle, audit history
  - Designations: levels, grades, career tracks, employee counts, lifecycle, audit history
  - Work locations: type, timezone, contact/address, capacity, employee counts, lifecycle, audit history
- 07 Attendance and shift management — complete
  - Immutable clock, break, and clock-out punches with policy and optional geolocation enforcement
  - Daily register, historical records, anomaly filters, worked-time calculations, and safe CSV export
  - Reusable and overnight shifts, date-effective employee assignments, default shifts, and weekend rules
  - Manual corrections, audit history, self-service regularization, cancellation, approval, and rejection
  - PostgreSQL-backed attendance policies with grace, full/half-day, overtime, and maximum-shift thresholds
- 08 Leave and time-off management — complete
  - Leave types, policy rules, annual entitlements, notice, attachments, negative balance, and carry-forward controls
  - Lazy employee/year balance accounts with immutable ledgers and auditable manual adjustments
  - Full-day and half-day requests, working-day calculation, overlap prevention, approval, withdrawal, and cancellation review
  - Default and regional holiday calendars, optional holidays, work-location assignments, and team availability
  - Approved-leave attendance synchronization, reporting, bounded pagination, and safe CSV export
- 09 Work logs and timesheets — complete
  - Work clients, projects, project assignments, billable tracking, daily work entries, soft voids, and audit history
  - Employee timesheet submission, approval, rejection, reopen workflow, project reports, bounded pagination, and safe CSV export
- 10 Payroll — complete
  - Payroll schedules, components, effective-dated employee compensation, approved one-time adjustments, and employee payslips
  - Payroll run compute, approve, finalize, reopen, audit history, attendance loss-of-pay, adjustment application, and safe CSV export
- 11 Recruitment — complete
  - Job openings, candidate profiles, application pipeline stages, interviews, offers, offer approvals, reports, audit history, and safe CSV export

Structure records use activation/deactivation instead of destructive deletion so
employee assignments and historical records remain valid.

The production topology and load-test requirements for the 10,000-employee per
organization and 1,000,000-request/minute platform targets are documented in
[`docs/SCALABILITY.md`](docs/SCALABILITY.md). These are distributed deployment
targets and require horizontal API capacity, a distributed cache/rate limiter,
PgBouncer, PostgreSQL replicas, queues, telemetry, and production-like load
testing before a capacity claim is made.

During local UI development, `VITE_DEMO_MODE=true` uses a browser-local
organization adapter so screens can be reviewed without PostgreSQL. Production
builds always use the API regardless of that setting. Remove the
`rigweda.demo.organizations` local-storage entry to restore the sample records.
