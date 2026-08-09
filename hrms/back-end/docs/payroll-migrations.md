# Payroll Postgres Migrations

Primary payroll technical documentation has moved to:

- `docs/payroll/README.md`
- `docs/payroll/02-migrations-and-schema.md`

## Quick Commands

From `back-end/`:

```bash
npm run migrate:payroll:status
npm run migrate:payroll:up
npm run migrate:payroll:down
```

Optional rollback steps:

```bash
node src/script/payroll.migrate.js down --steps=2
```

