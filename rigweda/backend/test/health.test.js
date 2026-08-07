process.env.NODE_ENV = "test";
const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const pino = require("pino");
const { createApp } = require("../src/app");

const env = { CORS_ALLOWED_ORIGINS: "http://localhost:5173" };
const app = createApp({ env, logger: pino({ level: "silent" }) });

test("GET /api/v1/health returns a standard success envelope", async () => {
  const response = await request(app).get("/api/v1/health").expect(200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.status, "ok");
});

test("unknown routes return a standard error envelope", async () => {
  const response = await request(app).get("/missing").expect(404);
  assert.equal(response.body.error.code, "ROUTE_NOT_FOUND");
});

test("OpenAPI contract is published", async () => {
  const response = await request(app).get("/api/v1/openapi.json").expect(200);
  assert.equal(response.body.info.title, "Rigweda API");
});
