const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const { createOrganizationRouter } = require("../src/modules/organizations/organization.routes");
const { errorHandler } = require("../src/middleware/error-handler");

const service = {
  list: async (query) => ({ items: [], total: 0, totalPages: 0, ...query }),
  create: async (body) => ({ id: "bb5f587f-5f45-424e-b863-e6fd06586377", version: 1, ...body }),
  get: async (id) => ({ id, code: "RIG", name: "Rigweda", version: 1 }),
  update: async (id, body) => ({ id, ...body, version: body.version + 1 })
};
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.id = "test-request"; next(); });
app.use("/organizations", createOrganizationRouter(service));
app.use(errorHandler);

test("organization create normalizes validated fields", async () => {
  const response = await request(app).post("/organizations").send({ code: " rig_01 ", name: " Rigweda Labs ", currency: "inr" }).expect(201);
  assert.equal(response.body.data.code, "RIG_01");
  assert.equal(response.body.data.currency, "INR");
});

test("organization create rejects malformed data", async () => {
  const response = await request(app).post("/organizations").send({ code: "!", name: "X" }).expect(422);
  assert.equal(response.body.error.code, "VALIDATION_ERROR");
  assert.ok(response.body.error.details.length >= 2);
});

test("organization update requires a record version", async () => {
  const response = await request(app).patch("/organizations/bb5f587f-5f45-424e-b863-e6fd06586377").send({ name: "Changed" }).expect(422);
  assert.equal(response.body.error.code, "VALIDATION_ERROR");
});
