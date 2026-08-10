# Rigweda Monitor Backend

Fastify backend scaffold for an employee monitoring app.

## Structure

- `src/server.js` boots the app
- `src/routes.js` registers modules and URL prefixes
- `src/modules/<module>/...routes.js` defines API routes
- `src/modules/<module>/...validation.js` stores Joi schemas
- `src/modules/<module>/...controller.js` handles request/response
- `src/modules/<module>/...service.js` contains business logic
- `src/modules/<module>/...model.js` contains database access

## Sample Module

`screenshots`

This module demonstrates how to build a Cloudinary-ready screenshot record.
It generates a folder path like:

`2026_06_01/screenshots/screenshot_2026_06_01_18_24_20_123.jpeg`

Use the same date-based folder for `jpeg`, `jpg`, `png`, and `webp`.

## Endpoints

- `GET /api/screenshots`
- `POST /api/screenshots`
- `POST /api/screenshot-batches/uploads`
- `POST /api/screenshot-batches/:batchId/complete`
- `POST /api/activity-events/batch`
- `GET /api/activity/employees?date=YYYY-MM-DD`

## Scalable Screenshot Upload Flow

The desktop monitor now uses the backend as a metadata/control plane:

1. The desktop agent captures WebP screenshots into `C:\Rigweda_monitor\screenshots`.
2. It records a durable local SQLite queue at `C:\Rigweda_monitor\data\screenshot_queue.db`.
3. It asks the backend for a signed Cloudinary batch upload session.
4. It uploads screenshots directly to Cloudinary.
5. It commits uploaded/duplicate metadata back to Postgres.

The backend creates these tables automatically on startup:

- `monitor_screenshot_batches`
- `monitor_screenshots`
- `monitor_activity_events`
- `monitor_device_presence`

Required backend env:

```bash
JWT_ACCESS_SECRET=...
RIGWEDA_API_BASE_URL=...
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/rigweda
DATABASE_SSL=false
```

The backend loads `rigweda/backend/.env` first, then overrides with `desktop/backend/.env` when present.

Required desktop agent env:

```bash
SCREENSHOT_INTERVAL_MS=60000
SCREENSHOT_UPLOAD_BATCH_SIZE=30
SCREENSHOT_UPLOAD_CONCURRENCY=4
DESKTOP_BACKEND_URL=http://127.0.0.1:3000/api
MONITOR_ACCESS_TOKEN=<rigweda access token>
```

## Run

```bash
npm install
npm run dev
```

## Example

```bash
curl http://localhost:3000/api/screenshots
curl -X POST http://localhost:3000/api/screenshots \
  -H "content-type: application/json" \
  -d '{
    "employeeId":"emp_001",
    "capturedAt":"2026-06-01T18:24:20.123Z",
    "originalFileName":"screenshot_2026_06_01_18_24_20_123.jpeg",
    "mimeType":"image/jpeg",
    "dateFolder":"2026_06_01"
  }'
```
