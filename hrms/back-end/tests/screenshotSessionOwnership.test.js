const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

test('HRMS session creation cannot overwrite foreign batch or screenshot IDs', { skip: !process.env.MONITOR_OWNERSHIP_TEST_URL }, async () => {
  const db = new Client({ connectionString: process.env.MONITOR_OWNERSHIP_TEST_URL });
  await db.connect();
  const schema = `theme_ownership_test_${Date.now()}`;
  try {
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET search_path TO ${schema}`);
    const exports = {};
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../src/modules/agent/agent.monitorUploads.service.js'), 'utf8'), {
      exports, require(name) {
        if (name === 'crypto') return require('node:crypto');
        if (name === 'cloudinary') return { v2: { config() {}, utils: { api_sign_request: () => 'signature' } } };
        if (name === '../employees/employee.model') return {};
        if (name === '../../config/monitorDb') return { getMonitorPgPool: async () => db };
        if (name === './agent.monitorSettings.service') return { getRawSettings: async () => ({ cloudName: 'test', apiKey: 'test', apiSecret: 'fake' }) };
        throw new Error(name);
      }
    });
    const payload = { batchId: 'batch-a', deviceId: 'device', screenshots: [{ clientScreenshotId: 'shot', capturedAt: '2026-09-09T00:00:00Z', originalFileName: 'shot.png', mimeType: 'image/png', sha256: 'a'.repeat(64), sizeBytes: 10 }] };
    const req = { user: { organizationId: 'org-a', employeeId: 'employee-a' } };
    const first = await exports.createUploadSession({ req, payload });
    assert.equal(first.uploads.length, 1);
    for (const user of [{ organizationId: 'org-b', employeeId: 'employee-b' }, { organizationId: 'org-a', employeeId: 'employee-b' }]) {
      await assert.rejects(exports.createUploadSession({ req: { user }, payload }), { statusCode: 409 });
      await assert.rejects(exports.createUploadSession({ req: { user }, payload: { ...payload, batchId: `other-${user.organizationId}` } }), { statusCode: 409 });
    }
    const row = (await db.query('SELECT organization_id,employee_id,batch_id FROM monitor_screenshots')).rows[0];
    assert.deepEqual(row, { organization_id: 'org-a', employee_id: 'employee-a', batch_id: 'batch-a' });
    // Execute Desktop's actual model against the same isolated schema.
    const { getPool } = await import('../../../desktop/backend/src/database/pool.js');
    const { screenshotModel } = await import('../../../desktop/backend/src/modules/screenshots/screenshots.model.js');
    const pool = getPool();
    const oldQuery = pool.query;
    pool.query = (...args) => db.query(...args);
    try {
      await assert.rejects(screenshotModel.upsertBatch({ batchId: 'batch-a', organizationId: 'org-b', employeeId: 'employee-b', deviceId: 'device', expectedCount: 1, expectedBytes: 10 }), { statusCode: 409 });
      await assert.rejects(screenshotModel.upsertPendingScreenshot({ id: 'foreign', batchId: 'batch-a', organizationId: 'org-b', employeeId: 'employee-b', deviceId: 'device', clientScreenshotId: 'shot', capturedAt: '2026-09-09T00:00:00Z', originalFileName: 'shot.png', mimeType: 'image/png', sha256: 'a'.repeat(64), sizeBytes: 10 }), { statusCode: 409 });
      assert.equal((await db.query('SELECT organization_id FROM monitor_screenshots')).rows[0].organization_id, 'org-a');
    } finally { pool.query = oldQuery; }
  } finally {
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db.end();
  }
});
