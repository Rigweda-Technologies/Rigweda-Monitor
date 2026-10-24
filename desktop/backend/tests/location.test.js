import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerRoutes } from '../src/routes.js';

const LOCATION_ENDPOINT = '/api/agents/location';
const AUTH_TOKEN = 'location-test-token';

const validPayload = () => ({
  device_id: 'dev_location_test_001',
  timestamp: '2026-09-28T12:34:56Z',
  latitude: 17.385,
  longitude: 78.4867,
  source: 'windows_native',
  metadata: {
    city: 'Hyderabad',
    region: 'Telangana',
  },
});

const createApp = async ({ requireAuth = false } = {}) => {
  const app = Fastify({ logger: false });

  app.decorate('authenticateRequest', async (request, reply) => {
    if (!requireAuth) {
      request.auth = {
        userId: 'employee-test',
        organizationId: 'organization-test',
      };
      return;
    }

    const authorization = request.headers.authorization || '';
    if (authorization !== `Bearer ${AUTH_TOKEN}`) {
      return reply.code(401).send({
        success: false,
        message: 'Unauthorized',
        errorCode: 'UNAUTHORIZED',
      });
    }

    request.auth = {
      userId: 'employee-test',
      organizationId: 'organization-test',
    };
  });

  app.setErrorHandler((error, request, reply) => {
    if (error.validation) {
      return reply.code(400).send({
        success: false,
        message: 'Validation failed',
        errorCode: 'VALIDATION_ERROR',
        errors: error.validation.map((item) => ({
          field: item.instancePath ? item.instancePath.replace(/^\//, '').replaceAll('/', '.') : 'body',
          message: item.message,
          keyword: item.keyword,
        })),
      });
    }

    return reply.code(error.statusCode || 500).send({
      success: false,
      message: error.message || 'Internal Server Error',
      errorCode: error.code || 'INTERNAL_SERVER_ERROR',
    });
  });

  await registerRoutes(app);
  await app.ready();
  return app;
};

test('POST /agents/location accepts a complete employee location report', async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: LOCATION_ENDPOINT,
    payload: validPayload(),
  });

  assert.strictEqual(response.statusCode, 200);

  const body = response.json();
  assert.strictEqual(body.success, true);
  assert.ok(typeof body.message === 'string');
  assert.ok(body.message.length > 0);
});

test('POST /agents/location rejects missing mandatory properties with 400', async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  for (const [description, payload] of [
    ['missing device_id', (() => {
      const value = validPayload();
      delete value.device_id;
      return value;
    })()],
    ['missing source', (() => {
      const value = validPayload();
      delete value.source;
      return value;
    })()],
  ]) {
    await t.test(description, async () => {
      const response = await app.inject({
        method: 'POST',
        url: LOCATION_ENDPOINT,
        payload,
      });

      assert.strictEqual(response.statusCode, 400);
      const body = response.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.errorCode, 'VALIDATION_ERROR');
      assert.ok(Array.isArray(body.errors));
      assert.ok(body.errors.length > 0);
    });
  }
});

test('POST /agents/location rejects invalid location parameter values with 400', async (t) => {
  const app = await createApp();
  t.after(() => app.close());

  for (const [description, patch] of [
    ['latitude above 90', { latitude: 120.0 }],
    ['latitude as non-numeric string', { latitude: 'north' }],
    ['longitude below -180', { longitude: -181.0 }],
    ['invalid source enum', { source: 'gps' }],
    ['metadata city as number', { metadata: { city: 123, region: null } }],
  ]) {
    await t.test(description, async () => {
      const response = await app.inject({
        method: 'POST',
        url: LOCATION_ENDPOINT,
        payload: {
          ...validPayload(),
          ...patch,
        },
      });

      assert.strictEqual(response.statusCode, 400);
      const body = response.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.errorCode, 'VALIDATION_ERROR');
    });
  }
});

test('POST /agents/location validates payloads when authorization middleware is active', async (t) => {
  const app = await createApp({ requireAuth: true });
  t.after(() => app.close());

  const unauthorized = await app.inject({
    method: 'POST',
    url: LOCATION_ENDPOINT,
    payload: validPayload(),
  });

  assert.strictEqual(unauthorized.statusCode, 401);
  assert.strictEqual(unauthorized.json().success, false);

  const authorizedSuccess = await app.inject({
    method: 'POST',
    url: LOCATION_ENDPOINT,
    headers: {
      authorization: `Bearer ${AUTH_TOKEN}`,
    },
    payload: validPayload(),
  });

  assert.strictEqual(authorizedSuccess.statusCode, 200);
  assert.strictEqual(authorizedSuccess.json().success, true);

  const invalidAuthorized = await app.inject({
    method: 'POST',
    url: LOCATION_ENDPOINT,
    headers: {
      authorization: `Bearer ${AUTH_TOKEN}`,
    },
    payload: {
      ...validPayload(),
      latitude: 'not-a-number',
    },
  });

  assert.strictEqual(invalidAuthorized.statusCode, 400);
  assert.strictEqual(invalidAuthorized.json().errorCode, 'VALIDATION_ERROR');
});
