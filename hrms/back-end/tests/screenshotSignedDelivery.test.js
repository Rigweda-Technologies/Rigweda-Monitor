const test = require('node:test');
const assert = require('node:assert/strict');
const { v2: cloudinary } = require('cloudinary');
const service = require('../src/modules/agent/agent.screenshots.service');

test('monitor screenshots use short-lived authenticated delivery URLs', (t) => {
  const row = {
    cloudinary_folder: 'rigweda-monitor/employee/2026_09_09',
    cloudinary_public_id: 'shot-1'
  };
  const settings = {
    cloudName: 'tenant-cloud',
    apiKey: 'tenant-key',
    apiSecret: 'tenant-secret'
  };

  t.mock.method(cloudinary, 'url', (publicId, options) => {
    assert.equal(publicId, 'rigweda-monitor/employee/2026_09_09/shot-1');
    assert.equal(options.cloud_name, 'tenant-cloud');
    assert.equal(options.api_key, 'tenant-key');
    assert.equal(options.api_secret, 'tenant-secret');
    assert.equal(options.resource_type, 'image');
    assert.equal(options.type, 'authenticated');
    assert.equal(options.secure, true);
    assert.equal(options.sign_url, true);
    assert.equal(Number.isInteger(options.expires_at), true);
    assert.ok(options.expires_at > Math.floor(Date.now() / 1000));
    return 'https://res.cloudinary.com/tenant-cloud/image/authenticated/signed/shot-1.png';
  });

  const url = service._private.buildSignedScreenshotUrl({ settings, row });
  assert.equal(url.includes('/authenticated/'), true);
  assert.notEqual(url, 'https://public.example.invalid/shot-1.png');
});
