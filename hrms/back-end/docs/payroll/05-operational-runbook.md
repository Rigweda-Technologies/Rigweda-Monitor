# 05. Operational Runbook

## Production Deployment Checklist

1. Configure env
- Mongo: `MONGO_URI`, `JWT_SECRET`
- Payroll Postgres: `PAYROLL_DB_ENABLED=true`, `PAYROLL_DATABASE_URL`
- Redis/BullMQ: `REDIS_URL`

2. Apply migrations

```bash
cd back-end
npm run migrate:payroll:up
```

3. Start services

```bash
npm run start
npm run jobs:worker   # required for async compute
```

4. Verify readiness
- `GET /health`
- `GET /ready`
- `GET /metrics`

## Recommended Payroll Env

```env
PAYROLL_DB_ENABLED=true
PAYROLL_COUNTRY=IN
PAYROLL_STATE_CODE=TS
PAYROLL_DEFAULT_TIMEZONE=Asia/Kolkata
PAYROLL_IDEMPOTENCY_REQUIRED=true
PAYROLL_IDEMPOTENCY_IN_PROGRESS_TIMEOUT_SEC=600
PAYROLL_COMPUTE_ASYNC_DEFAULT=false
PAYROLL_COMPUTE_JOB_ATTEMPTS=5
PAYROLL_COMPUTE_JOB_BACKOFF_MS=5000
```

## Observability

### Logs

- Logger outputs structured JSON in production mode.
- Key event names:
  - `payroll.compute.started`
  - `payroll.compute.completed`
  - `payroll.compute.failed`
  - `payroll.compute.job.enqueued`
  - `payroll.compute.job.started`
  - `payroll.compute.job.completed`
  - `payroll.compute.job.failed`
  - `payroll.idempotency.replay`

### Metrics (`/metrics`)

API metrics prefix:
- `upanaya_api_*`

Payroll metrics prefix:
- `upanaya_payroll_compute_total`
- `upanaya_payroll_compute_failed_total`
- `upanaya_payroll_compute_by_mode_total{mode,outcome}`
- `upanaya_payroll_compute_duration_bucket{mode,outcome,le}`
- `upanaya_payroll_idempotency_replay_total{action}`

## Incident Handling

### Symptom: duplicate run action triggered

- Check headers for `Idempotency-Key` usage.
- Query `payroll_action_idempotency` by `tenant_id + action_key + idempotency_key`.
- If same key used with different payload, API intentionally rejects with conflict.

### Symptom: compute stuck/repeated failures

- Check worker logs for `payroll.compute.job.failed`.
- Inspect run status and employee error rows:
  - `payroll_runs`
  - `payroll_run_employees.error_message`
- Re-run with corrected data and new idempotency key.

### Symptom: no async processing

- Verify `jobs:worker` process is running.
- Verify Redis availability.
- Check BullMQ connection logs.

## Backup and Recovery

- Postgres: daily logical backup + WAL/point-in-time strategy.
- Mongo: existing HRMS backup policy continues unchanged.
- Restore order:
  1. Restore Postgres payroll DB.
  2. Restore Mongo HRMS DB.
  3. Validate tenant/org mappings and readiness.

## Change Management

- Schema changes only via new migration files in `src/payroll/migrations`.
- Never mutate applied migration files.
- Use `migrate:payroll:status` in CI/CD pre-deploy checks.

