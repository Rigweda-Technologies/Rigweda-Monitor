# HRMS Backend

Express API for the multi-tenant HRMS and monitor administration app.

## Main Responsibilities

- Authentication, JWT sessions, role switching, permissions, and active-login limits
- Organization, role, permission, employee, department, designation, shift, week-off, holiday, leave, attendance, timesheet, document, notification, expense, project, hiring, and dashboard APIs
- Organization settings, tenant theme, and logo storage
- Agent APIs under `/api/agents`
- Monitor read APIs under `/api/activity`
- Monitor update distribution under `/api/monitor`
- Optional payroll APIs under `/api/payroll`
- Realtime notifications through Socket.IO

## Data Stores

- MongoDB: core HRMS data
- Redis: optional cache/rate-limit/realtime/job support
- Monitor PostgreSQL: desktop monitoring activity, app usage, browser history, screenshots, device health
- Payroll PostgreSQL: optional India payroll data
- Cloudinary: organization screenshot/logo/media storage
- Cloudflare R2: monitor update binaries, when configured

## Environment

Start from:

```sh
cp .env.example .env
```

Recommended local minimum:

```env
PORT=8000
APP_ENV=local
NODE_ENV=development
MONGO_URI=mongodb://127.0.0.1:27017/workforce_hrms
JWT_SECRET=replace_with_long_random_secret
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001,http://localhost:3002
MONITOR_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/workforce_monitor
MONITOR_PG_SSL_MODE=disable
```

Optional Redis:

```env
REDIS_URL=redis://127.0.0.1:6379
ENABLE_REDIS=true
ENABLE_REDIS_RATE_LIMIT=true
```

Optional payroll PostgreSQL:

```env
PAYROLL_DB_ENABLED=true
PAYROLL_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/workforce_payroll
PAYROLL_PG_SSL_MODE=disable
PAYROLL_COUNTRY=IN
PAYROLL_STATE_CODE=TS
```

Optional Cloudinary fallback credentials:

```env
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
```

For SaaS deployments, store Cloudinary monitor credentials through organization Monitor Settings whenever possible so each tenant can use its own provider account.

Optional Cloudflare R2 monitor update settings:

```env
R2_BUCKET_NAME=...
CLOUDFLARE_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
MONITOR_UPDATE_URL_EXPIRES_SECONDS=900
```

Other useful settings:

```env
ENABLE_RATE_LIMIT=true
ENABLE_SWAGGER_UI=false
ENABLE_HTTP_METRICS=false
ENABLE_JOB_SCHEDULER=false
SOCKET_IO_PATH=/api/socket.io
FRONTEND_LOGIN_URL=http://localhost:3000/login
MAX_ACTIVE_LOGINS_PER_USER_DEFAULT=1
```

## Run

```sh
npm install
npm run local
```

Default local API:

```text
http://localhost:8000/api
```

Health endpoints:

```text
GET /health
GET /ready
GET /metrics
```

Swagger is available at `/swagger-ui` unless disabled by production settings.

## Local Bootstrap

On startup the backend:

1. Connects MongoDB.
2. Ensures critical Mongo indexes.
3. Validates payroll configuration.
4. Connects optional payroll PostgreSQL when enabled.
5. Initializes realtime Socket.IO.
6. Bootstraps the `SYSTEM` organization and superadmin if missing.
7. Seeds organization roles and permissions.

The startup log prints local superadmin credentials when bootstrap runs.

## Organization Settings

Settings route:

```text
GET  /api/org-settings
POST /api/org-settings
GET  /api/org-settings/theme
POST /api/org-settings/theme
```

Important fields:

- `logoUrl`
- `themeMode`, `themePreset`, `themeConfig`
- `timezone`
- `leaveCreditFrequency`
- `leaveTypeCreditMode`
- `sandwichRuleEnabled`
- `attendanceLockEnabled`
- `attendanceLockMode`
- `attendanceLockDay`
- `payrollCutoffDay`
- `payrollSalaryPayDay`
- `payrollEnabled`
- `minWorkHoursPerDay`
- `minHalfDayHours`
- `attendanceHoursSource`
- `attendanceIpEnabled`
- `attendanceAllowedIp`
- `attendanceSelfieRequired`
- `attendanceMultiPunchEnabled`
- `attendanceGeoFenceEnabled`
- `attendanceGeoLatitude`
- `attendanceGeoLongitude`
- `attendanceGeoRadiusMeters`
- `probationPeriodDays`
- `noticePeriodDays`
- `employeeIdPrefix`
- `maxActiveLoginsPerUser`

When `attendanceHoursSource=monitor_agent`, timesheet hours are derived from monitor activity totals where supported.

## Monitor Database

Set `MONITOR_DATABASE_URL` or the discrete `MONITOR_PG*` variables:

```env
MONITOR_DATABASE_URL=postgresql://user:pass@host:5432/workforce_monitor
MONITOR_PG_SSL_MODE=require
```

HRMS uses this database for monitor reads and screenshots. Desktop backend must point to the same monitor database.

## Tests

```sh
npm test
```

Focused monitor/security tests:

```sh
node --test tests/monitorUploadSecrets.test.js
node --test tests/screenshotSignedDelivery.test.js
node --test tests/screenshotAssetVerification.test.js
```
