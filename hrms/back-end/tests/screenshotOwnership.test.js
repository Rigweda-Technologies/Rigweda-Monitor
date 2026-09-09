const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const hrmsPath = path.resolve(__dirname, '../src/modules/agent/screenshotCompletion.cjs');
const desktopPath = path.resolve(__dirname, '../../../desktop/backend/src/modules/screenshots/screenshotCompletion.cjs');

test('independent deployment completion implementations stay identical', () => {
  assert.equal(fs.readFileSync(hrmsPath, 'utf8'), fs.readFileSync(desktopPath, 'utf8'));
});

for (const [name, modulePath] of [['HRMS', hrmsPath], ['Desktop', desktopPath]]) {
  test(`${name}: PostgreSQL ownership, rollback and legitimate retries`, { skip: !process.env.MONITOR_OWNERSHIP_TEST_URL }, async (t) => {
    const db = new Client({ connectionString: process.env.MONITOR_OWNERSHIP_TEST_URL });
    await db.connect();
    // Connection-private temporary tables: no application tables or data touched.
    await db.query(`CREATE TEMP TABLE monitor_screenshot_batches (
      id text PRIMARY KEY, organization_id text, employee_id text, device_id text,
      expected_count integer, uploaded_count integer, duplicate_count integer, uploaded_bytes bigint,
      status text, completed_at timestamptz);
      CREATE TEMP TABLE monitor_screenshots (
      id text PRIMARY KEY, organization_id text, employee_id text, device_id text, batch_id text,
      client_screenshot_id text, sha256 text, cloudinary_public_id text,
      cloudinary_asset_id text, cloudinary_version bigint, cloudinary_format text, cloudinary_url text,
      size_bytes bigint, upload_status text, processing_status text, error_message text,
      uploaded_at timestamptz, duplicate_of text);`);
    const pool = { connect: async () => ({ query: (...args) => db.query(...args), release() {} }) };
    const complete = payload => require(modulePath)(pool, {
      verifyAsset: async () => ({ cloudinaryAssetId: 'verified', cloudinaryVersion: 1, cloudinaryFormat: 'png', cloudinaryUrl: 'https://verified.invalid/a.png', sizeBytes: 10 }), ...payload
    });
    const scope = { organizationId: 'org-a', employeeId: 'employee-a', deviceId: 'device-a', batchId: 'batch-a' };
    const upload = { clientScreenshotId: 'shot-a', cloudinaryUrl: 'https://example.invalid/a.png' };
    async function reset() {
      await db.query(`TRUNCATE monitor_screenshots, monitor_screenshot_batches;
        INSERT INTO monitor_screenshot_batches(id,organization_id,employee_id,device_id,expected_count,status)
        VALUES ('batch-a','org-a','employee-a','device-a',1,'pending'), ('batch-b','org-b','employee-b','device-b',1,'pending');
        INSERT INTO monitor_screenshots(id,organization_id,employee_id,device_id,batch_id,client_screenshot_id,sha256,cloudinary_public_id,upload_status)
        VALUES ('id-a','org-a','employee-a','device-a','batch-a','shot-a','hash','public-a','pending'),
        ('id-b','org-b','employee-b','device-b','batch-b','shot-b','hash','public-b','uploaded');`);
    }
    try {
      for (const [label, override] of [
        ['other organization', { organizationId: 'org-b' }],
        ['other employee in same organization', { employeeId: 'employee-b' }],
        ['other device', { deviceId: 'device-b' }],
        ['other batch', { batchId: 'batch-b' }],
        ['missing batch', { batchId: 'missing' }],
        ['missing organization', { organizationId: null }],
        ['foreign screenshot in owned batch request', { uploaded: [{ ...upload, clientScreenshotId: 'shot-b' }] }],
        ['mixed owned and foreign screenshots', { uploaded: [upload, { ...upload, clientScreenshotId: 'shot-b' }] }],
      ]) await t.test(label, async () => {
        await reset();
        await assert.rejects(complete({ ...scope, uploaded: [upload], ...override }), { statusCode: 404 });
        const rows = (await db.query('SELECT cloudinary_url FROM monitor_screenshots')).rows;
        assert.ok(rows.every(row => row.cloudinary_url === null));
      });
      await t.test('foreign duplicate rolls back earlier uploads', async () => {
        await reset();
        await db.query("INSERT INTO monitor_screenshots SELECT 'id-c',organization_id,employee_id,device_id,batch_id,'shot-c',sha256,cloudinary_public_id,cloudinary_asset_id,cloudinary_version,cloudinary_format,cloudinary_url,size_bytes,upload_status,processing_status,error_message,uploaded_at,duplicate_of FROM monitor_screenshots WHERE id='id-a'");
        await assert.rejects(complete({ ...scope, uploaded: [upload], duplicates: [{ clientScreenshotId: 'shot-c', duplicateOf: 'id-b' }] }), { statusCode: 404 });
        assert.equal((await db.query("SELECT upload_status FROM monitor_screenshots WHERE id='id-a'")).rows[0].upload_status, 'pending');
      });
      await t.test('provider failure keeps batch pending', async () => {
        await reset();
        await assert.rejects(complete({ ...scope, uploaded: [upload], verifyAsset: async () => { throw new Error('provider unavailable'); } }));
        assert.equal((await db.query("SELECT upload_status FROM monitor_screenshots WHERE id='id-a'")).rows[0].upload_status, 'pending');
      });
      await t.test('own upload and repeated completion succeed' , async () => {
        await reset();
        for (let i=0;i<2;i++) {
          const result = await complete({ ...scope, uploaded: [upload] });
          assert.equal(result.status, 'complete');
          assert.deepEqual(result.acknowledgedScreenshotIds, ['shot-a']);
        }
        assert.equal((await db.query("SELECT cloudinary_url FROM monitor_screenshots WHERE id='id-a'")).rows[0].cloudinary_url, 'https://verified.invalid/a.png');
      });
      await t.test('own same-hash duplicate succeeds', async () => {
        await reset();
        await db.query("UPDATE monitor_screenshots SET organization_id='org-a', employee_id='employee-a' WHERE id='id-b'");
        assert.equal((await complete({ ...scope, duplicates: [{ clientScreenshotId: 'shot-a', duplicateOf: 'id-b' }] })).status, 'complete');
      });
    } finally { await db.end(); }
  });
}
