# Workforce Monitoring HRMS

This repository contains a multi-tenant HRMS and employee monitoring platform that can be sold as a SaaS product. Each customer organization manages its own employees, roles, attendance rules, monitor settings, theme, and logo.

The product is split into three main applications:

- `hrms/back-end` - Express API for HRMS, organization settings, authentication, attendance, leaves, payroll, monitor read APIs, screenshots, and monitor update management.
- `hrms/front-end` - React/Vite web app for HRMS users, organization admins, managers, employees, and monitor administrators.
- `desktop/backend` and `desktop/frontend` - desktop monitor API plus the local desktop agent that captures activity, app usage, browser usage, health, and screenshots.

## How The App Works

1. A company signs in to the HRMS web app and configures organization settings.
2. The company uploads its logo in `Organization Settings`; the sidebar and tenant-facing surfaces use that logo/name instead of a hard-coded vendor brand.
3. Admins create departments, designations, roles, shifts, week offs, holidays, employees, and approval flows.
4. Attendance can be managed manually or derived from monitor-agent activity depending on `attendanceHoursSource`.
5. The desktop agent runs on employee machines and sends monitoring data to the desktop backend and HRMS agent APIs.
6. HRMS reads monitor PostgreSQL summaries for activity, apps, browser history, screenshots, laptop health, and reports.
7. Payroll is optional and uses a separate PostgreSQL connection when enabled.

## Local URLs

Default local services:

- HRMS frontend: `http://localhost:3000`
- HRMS backend: `http://localhost:8000`
- HRMS API prefix: `http://localhost:8000/api`
- Desktop monitor backend: `http://localhost:3001/api`

If a port is already in use, Vite may choose another frontend port.

## Prerequisites

- Node.js and npm
- MongoDB for core HRMS data
- Redis, optional but recommended for realtime/rate limit/job features
- PostgreSQL for monitor data
- PostgreSQL for payroll, only when payroll is enabled
- Python 3 for the desktop agent
- Cloudinary account for screenshot upload/delivery
- Cloudflare R2 credentials for monitor update binaries, if using update distribution

## Install

Install dependencies in each app that you use:

```sh
npm install --prefix hrms/back-end
npm install --prefix hrms/front-end
npm install --prefix desktop/backend
pip3 install -r desktop/frontend/requirements.txt
```

## Configure

Create environment files from examples:

```sh
cp hrms/back-end/.env.example hrms/back-end/.env
cp desktop/frontend/.env.example desktop/frontend/.env
```

The HRMS frontend already has local defaults in `hrms/front-end/.env`.

Minimum HRMS backend settings:

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

Optional but common:

```env
REDIS_URL=redis://127.0.0.1:6379
ENABLE_REDIS=true
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
PAYROLL_DB_ENABLED=true
PAYROLL_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/workforce_payroll
PAYROLL_PG_SSL_MODE=disable
```

Cloudinary credentials can also be saved per organization from Monitor Settings. For SaaS deployments, prefer organization-scoped settings over shared global credentials.

## Run

Run the HRMS frontend and backend together:

```sh
npm run hrms:local
```

Or run them separately:

```sh
npm run local --prefix hrms/back-end
npm run local --prefix hrms/front-end
```

Run desktop services:

```sh
npm run desktop:local
```

## First Login

On startup, the backend bootstraps a system organization and superadmin if needed. The local startup logs print the generated/seeded superadmin email and password.

Use that account to create customer organizations and configure tenant settings.

## SaaS Branding

The app is tenant-aware:

- Organization logo is uploaded in `Organization Settings`.
- Sidebar branding uses the uploaded logo and organization name.
- If no logo is configured, the sidebar shows a neutral icon.
- If no organization name is available, it falls back to `Monitor Suite`.

Avoid hard-coding vendor names in customer-facing pages. Use neutral labels such as `Monitor`, `Monitor agent`, `Workspace`, or the organization name from the logged-in profile/settings.

## Important Organization Settings

Key settings managed from the web app:

- Logo and theme preset/custom colors
- Timezone
- Leave credit frequency and leave type credit mode
- Sandwich leave rule
- Attendance lock mode and cutoff days
- Payroll cutoff/pay day and payroll enablement
- Minimum full-day and half-day work hours
- Attendance source: `manual`, `monitor_agent`, `biometric`, `access_card`
- IP restriction, selfie requirement, geofence, multi-punch, and dev bypass
- Probation and notice periods
- Employee ID prefix
- Maximum active logins per user

## Verification

Run the main checks:

```sh
npm test --prefix hrms/back-end
npm run lint --prefix hrms/front-end
npm run test --prefix hrms/front-end
npm run build --prefix hrms/front-end
git diff --check
```

Known build warnings:

- Vite may warn about old Browserslist data.
- Some third-party packages include ignored `"use client"` directives.
- Some chunks are larger than Vite's default warning limit.

These warnings do not block a successful build.

## Documentation

More focused docs:

- [HRMS backend setup](hrms/back-end/README.md)
- [HRMS frontend setup](hrms/front-end/README.md)
- [Desktop backend notes](desktop/backend/README.md)
- [Desktop agent notes](desktop/frontend/README.md)
