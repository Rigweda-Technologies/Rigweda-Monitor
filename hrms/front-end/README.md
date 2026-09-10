# HRMS Frontend

React/Vite web app for the multi-tenant HRMS and workforce monitoring product.

## Main Responsibilities

- Login, role switching, permissions, and protected routes
- Organization, employee, department, designation, shift, week-off, holiday, leave, attendance, and approval screens
- Organization settings for tenant branding, attendance rules, payroll defaults, and check-in controls
- Monitor pages for employees, activity, app usage, keyboard activity, browser history, screenshots, laptop health, settings, and updates
- Optional payroll setup and payroll run screens

## SaaS Branding

The app should not show a fixed vendor name in tenant-facing navigation.

Current behavior:

- The sidebar loads `/org-settings/theme`.
- If `logoUrl` is configured, the uploaded organization logo appears in the sidebar.
- The sidebar title uses `profile.organization.name`.
- Fallback title is `Monitor Suite`.
- Monitor menu labels use neutral wording such as `Monitor` and `Monitor agent`.

Users upload the organization logo from:

```text
Organization > Settings > Organization Logo
```

## Environment

Local `.env` defaults:

```env
VITE_API_BASE_URL=http://localhost:8000/api
VITE_HRMS_API_BASE_URL=http://localhost:8000/api
VITE_DESKTOP_API_BASE_URL=http://localhost:3001/api
VITE_EMPLOYEE_CODE_PREFIX=RG
VITE_SOCKET_PATH=/api/socket.io
```

Use `VITE_HRMS_API_BASE_URL` for HRMS reads/writes and `VITE_DESKTOP_API_BASE_URL` only for desktop-backend-owned APIs.

Important ownership rule:

- Browser history write API belongs to `desktop/backend`.
- Browser history read API belongs to `hrms/back-end`.

## Run

```sh
npm install
npm run local
```

Default dev URL:

```text
http://localhost:3000
```

If port `3000` is busy, Vite may choose another port.

## Build And Test

```sh
npm run lint
npm run test
npm run build
```

The production build may show dependency/chunk warnings. Treat failures as blockers, but the existing Browserslist, `"use client"`, and chunk-size warnings are informational.

## Settings Screens

`src/pages/OrganizationSettings.tsx` controls organization-wide HRMS settings:

- Logo upload
- Leave credit mode
- Attendance lock policy
- Timezone
- Payroll defaults
- Work-hour thresholds
- Attendance source
- IP/selfie/geofence/multi-punch controls
- Probation and notice periods
- Employee ID prefix
- Active login limit

`src/pages/MonitorSettings.tsx` controls monitor integration settings such as provider credentials and monitor-specific configuration.

## Layout

Key layout files:

- `src/components/layout/Sidebar.tsx`
- `src/components/layout/TopNavbar.tsx`
- `src/components/layout/MainLayout.tsx`

When adding tenant-facing text, prefer organization-driven or neutral wording.
