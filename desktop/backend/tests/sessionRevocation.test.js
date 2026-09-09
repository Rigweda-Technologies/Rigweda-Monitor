import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { authenticateRequest } from '../src/middleware/auth.js';

const token = jwt.sign({ userId: 'employee', organizationId: 'org' }, 'synthetic-secret', { expiresIn: '1h' });
for (const [label, fetchResult, expected] of [
  ['active session', { ok: true, json: async () => ({ success: true, data: {} }) }, null],
  ['revoked session', { ok: false, status: 401 }, 401],
  ['disabled account', { ok: false, status: 403 }, 401],
  ['password change required', { ok: true, json: async () => ({ success: true, data: { mustChangePassword: true } }) }, 401],
]) test(label, async t => {
  t.mock.method(globalThis, 'fetch', async () => fetchResult);
  const req = { headers: { authorization: `Bearer ${token}` } };
  let status;
  await authenticateRequest(req, { code(value) { status = value; return this; }, send() {} });
  if (expected) { assert.equal(status, expected); assert.equal(req.auth, undefined); }
  else assert.equal(req.auth.organizationId, 'org');
});
test('HRMS outage fails closed', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('network failure'); });
  let status;
  const req = { headers: { authorization: `Bearer ${token}` } };
  await authenticateRequest(req, { code(value) { status = value; return this; }, send() {} });
  assert.equal(status, 503);
  assert.equal(req.auth, undefined);
});
