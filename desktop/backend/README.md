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

- `POST /api/screenshots`
- `POST /api/screenshot-batches/uploads`
- `POST /api/screenshot-batches/:batchId/complete`
- `POST /api/activity-events/batch`

Admin/read APIs live in `hrms/back-end` and read the monitor Postgres database directly.

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
HRMS_BACKEND_URL=...
MONITOR_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/rigweda_monitor
DATABASE_SSL=false
```

Cloudinary credentials are configured in HRMS under Employee Monitor > Settings. The backend fetches them from HRMS to create signed upload payloads, so the desktop agent never receives the API secret.

The backend loads `rigweda/backend/.env` first, then overrides with `desktop/backend/.env` when present.

Required desktop agent env:

```bash
SCREENSHOT_INTERVAL_MS=60000
SCREENSHOT_UPLOAD_BATCH_SIZE=30
SCREENSHOT_UPLOAD_CONCURRENCY=4
HRMS_BACKEND_URL=http://127.0.0.1:8000/api
DESKTOP_BACKEND_URL=http://127.0.0.1:3000/api
MONITOR_ACCESS_TOKEN=<rigweda access token>
```

`HRMS_BACKEND_URL` should point to the HRMS backend `/api`; the agent code derives `/api/agents` for monitor uploads and settings. Activity events still post to the desktop backend.

## Run

```bash
npm install
npm run dev
```

## Example

```bash
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

## Cloudinary credential isolation

HRMS and Desktop must connect to the same monitoring PostgreSQL database using
`MONITOR_DATABASE_URL` and use the same `MONITOR_SETTINGS_SECRET` for the encrypted
settings saved by HRMS. Preserve the existing encryption key when deploying this
change: changing it without re-encrypting stored settings prevents decryption.

Employee upload-config endpoints return public configuration only. Desktop reads
its organization's encrypted credentials from the database; it no longer fetches
raw secrets using an employee token or falls back to global cloud credentials.
Missing organization credentials leave batch uploads deferred so files stay queued.
The Python agent continues to use signed upload parameters without a code change.

Deploy/restart both HRMS and Desktop backends together. After closing the exposed
endpoints, rotate any Cloudinary API secret that was accessible in a deployed
version and save the replacement through HRMS Monitor Settings. Do not paste
secrets into tickets or logs. Confirm both backends have the new code before rotation.

Security regression tests (from repository root):

```sh
node --test desktop/backend/tests/cloudinarySecrets.test.js hrms/back-end/tests/monitorUploadSecrets.test.js
```

## Screenshot ownership checks

Both completion APIs resolve the employee from authentication and check organization,
employee, device and batch on every write. Completion runs in one transaction;
foreign IDs, missing batches and invalid duplicate references reject the request.
Session creation also rejects attempts to reuse another owner's identifiers.
The completion implementations are copied into each independent deployment and
checked for equality by the regression suite. Deploy both backends for this fix.

Run ownership tests against a disposable/local PostgreSQL database (they create
connection-private temporary tables and a uniquely named schema, then clean up):

```sh
MONITOR_OWNERSHIP_TEST_URL=postgresql://localhost/postgres node --test hrms/back-end/tests/screenshotOwnership.test.js hrms/back-end/tests/screenshotSessionOwnership.test.js
```

## Screenshot provider verification

Completion verifies the expected Cloudinary asset with the organization's server
credentials before marking a screenshot uploaded. The backend writes the asset
metadata returned by Cloudinary and rejects the whole completion transaction if
the provider lookup fails or resolves to another asset.

The Python agent deletes local screenshots only after the completion response
acknowledges the same batch, same device and exact submitted screenshot IDs.

```sh
MONITOR_OWNERSHIP_TEST_URL=postgresql://localhost/postgres node --test hrms/back-end/tests/screenshotAssetVerification.test.js hrms/back-end/tests/screenshotOwnership.test.js hrms/back-end/tests/screenshotSessionOwnership.test.js
python3 -m unittest desktop/frontend/tests/test_screenshot_commit.py desktop/frontend/tests/test_screenshot_recovery.py
```

## Screenshot delivery privacy

New direct-to-Cloudinary screenshot uploads use Cloudinary `type=authenticated`.
HRMS does not return the stored provider URL to the monitor screenshots page; it
generates a signed authenticated URL with a short expiry from the organization's
server-side Cloudinary credentials.

Screenshots uploaded before this change may still be public Cloudinary `upload`
assets. Migrate or delete those older assets according to the organization's
retention policy after deploying the new upload flow.

```sh
node --test hrms/back-end/tests/screenshotSignedDelivery.test.js hrms/back-end/tests/screenshotAssetVerification.test.js desktop/backend/tests/cloudinarySecrets.test.js
```
