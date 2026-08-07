const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const {createEmployeeRouter} = require("../src/modules/employees/employee.routes");
const {errorHandler} = require("../src/middleware/error-handler");

const allow = (_req, _res, next) => next();
const service = {
  list: async (_organizationId, query) => ({items: [], total: 0, ...query}),
  create: async (_organizationId, data) => ({id: "employee-1", ...data})
};
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.auth = {organizationId: "org-1", userId: "user-1"}; req.id = "test"; next(); });
app.use("/employees", createEmployeeRouter(service, {
  manageEmployees: allow, sensitiveEmployees: allow, lifecycleEmployees: allow, exportEmployees: allow,
  bulkEmployees: allow, documentEmployees: allow, selfReadEmployees: allow, selfEditEmployees: allow
}));
app.use(errorHandler);

test("employee listing validates and defaults filters", async () => {
  const response = await request(app).get("/employees").expect(200);
  assert.equal(response.body.data.page, 1);
  assert.equal(response.body.data.pageSize, 20);
  assert.equal(response.body.data.status, "all");
});

test("employee creation requires core employment data", async () => {
  const response = await request(app).post("/employees").send({firstName: "A"}).expect(422);
  assert.equal(response.body.error.code, "VALIDATION_ERROR");
  assert.ok(response.body.error.details.length >= 4);
});

test("employee creation normalizes identifiers and email", async () => {
  const response = await request(app).post("/employees").send({
    employeeNumber: " emp-001 ", firstName: " Asha ", lastName: " Rao ",
    workEmail: "ASHA@EXAMPLE.COM", employmentType: "full_time", joinDate: "2026-08-07"
  }).expect(201);
  assert.equal(response.body.data.employeeNumber, "EMP-001");
  assert.equal(response.body.data.workEmail, "asha@example.com");
});
