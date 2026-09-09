import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';
import { getPool } from '../src/database/pool.js';
import { createSignedUploadPayload, resolveCloudinarySettings } from '../src/integrations/cloudinary.js';
import { getCloudinaryUploadConfig } from '../src/modules/cloudinary/cloudinary.controller.js';

const secret = 'synthetic-cloudinary-secret';
function encryptedRow() {
  const key = crypto.createHash('sha256').update(String(process.env.MONITOR_SETTINGS_SECRET || process.env.JWT_SECRET || 'monitor-settings-dev-key')).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
  return { cloud_name: 'tenant-cloud', api_key: 'test-key', api_secret_ciphertext: ciphertext.toString('base64'), api_secret_iv: iv.toString('base64'), api_secret_auth_tag: cipher.getAuthTag().toString('base64') };
}

test('employee config hides secrets while tenant-scoped signing still works', async (t) => {
  const row = encryptedRow();
  t.mock.method(getPool(), 'query', async (sql, params) => {
    if (sql.startsWith('SELECT *')) {
      assert.deepEqual(params, ['tenant-a']);
      return { rows: [row] };
    }
    return { rows: ['screenshots_enabled', 'mouse_enabled', 'keyboard_enabled'].map(column_name => ({ column_name })) };
  });
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Employee HTTP must not fetch secrets'); });
  let response;
  await getCloudinaryUploadConfig({ auth: { organizationId: 'tenant-a', token: 'employee-token' } }, {
    send(data) { response = data; }, code() { return this; }
  });
  assert.equal(response.success, true);
  assert.equal(response.data.cloudName, 'tenant-cloud');
  assert.equal('apiSecret' in response.data, false);
  assert.equal(JSON.stringify(response).includes(secret), false);
  const upload = await createSignedUploadPayload({ organizationId: 'tenant-a', folder: 'employee/date', publicId: 'shot-1' });
  const { signature, ...params } = upload.params;
  assert.equal(params.type, 'authenticated');
  assert.equal(signature, cloudinary.utils.api_sign_request(params, secret));
  assert.equal(JSON.stringify(upload).includes(secret), false);
  assert.equal(upload.uploadUrl, 'https://api.cloudinary.com/v1_1/tenant-cloud/image/upload');
});

test('missing organization cannot fall back to global credentials', async () => {
  await assert.rejects(resolveCloudinarySettings({ allowMissing: true }), { statusCode: 403 });
});

test('unconfigured organization cannot reuse another tenant credentials', async (t) => {
  t.mock.method(getPool(), 'query', async () => ({ rows: [] }));
  assert.equal(await resolveCloudinarySettings({ organizationId: 'unconfigured', allowMissing: true }), null);
});
