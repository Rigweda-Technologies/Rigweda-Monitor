const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../src/modules/agent/agent.monitorSettings.service');
const controller = require('../src/modules/agent/agent.monitorSettings.controller');

test('employee upload config uses public settings and omits even masked credentials', async (t) => {
  t.mock.method(service, 'getRawSettings', () => { throw new Error('Raw credentials must stay server-side'); });
  t.mock.method(service, 'getPublicSettings', async (organizationId) => {
    assert.equal(organizationId, 'tenant-a');
    return { cloudName: 'tenant-cloud', apiKey: 'public-key', apiSecretMasked: 'abc******xyz', screenshotsEnabled: true, screenshotIntervalMinutes: 2 };
  });
  let response;
  await controller.getCloudinaryUploadConfig({ user: { organizationId: 'tenant-a' } }, {
    status(code) { assert.equal(code, 200); return this; }, json(data) { response = data; }
  });
  assert.equal(response.data.cloudName, 'tenant-cloud');
  assert.equal(response.data.screenshotIntervalMinutes, 2);
  assert.equal('apiSecret' in response.data, false);
  assert.equal('apiSecretMasked' in response.data, false);
});

test('unconfigured employee upload config remains a 404', async (t) => {
  t.mock.method(service, 'getPublicSettings', async () => null);
  await assert.rejects(controller.getCloudinaryUploadConfig({ user: { organizationId: 'missing' } }, {}), { code: 404 });
});
