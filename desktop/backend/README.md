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
