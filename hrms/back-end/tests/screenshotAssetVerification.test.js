const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');
for (const modulePath of ['../src/modules/agent/verifyScreenshotAsset.cjs', '../../../desktop/backend/src/modules/screenshots/verifyScreenshotAsset.cjs']) {
  test(`provider verification: ${modulePath}`, async t => {
    const file = path.resolve(__dirname, modulePath);
    const verify = require(file);
    const cloudinary = createRequire(file)('cloudinary').v2;
    const settings = { cloudName: 'tenant', apiKey: 'key', apiSecret: 'synthetic-secret' };
    const row = { cloudinary_folder: 'employee/date', cloudinary_public_id: 'shot' };
    const lookup = t.mock.method(cloudinary.api, 'resource', async (id, options) => {
      assert.equal(id, 'employee/date/shot');
      assert.equal(options.api_secret, 'synthetic-secret');
      assert.equal(options.cloud_name, 'tenant');
      assert.equal(options.type, 'authenticated');
      return { public_id: id, asset_id: 'asset', version: 1, resource_type: 'image', bytes: 42, format: 'png', secure_url: 'https://trusted.invalid/image.png' };
    });
    assert.equal((await verify(settings, row)).sizeBytes, 42);
    lookup.mock.mockImplementation(async () => { throw new Error('404 or rate limited'); });
    await assert.rejects(verify(settings, row), { statusCode: 503 });
    lookup.mock.mockImplementation(async () => ({ public_id: 'another-asset' }));
    await assert.rejects(verify(settings, row), { statusCode: 503 });
  });
}
