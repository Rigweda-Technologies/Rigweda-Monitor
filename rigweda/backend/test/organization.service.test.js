const test = require("node:test");
const assert = require("node:assert/strict");
const { OrganizationService } = require("../src/modules/organizations/organization.service");

test("organization list includes stable pagination metadata", async () => {
  const repository = { list: async () => ({ items: [{ id: "1", name: "Acme" }], total: 21 }) };
  const result = await new OrganizationService(repository).list({ page: 2, pageSize: 10 });
  assert.equal(result.totalPages, 3);
  assert.equal(result.page, 2);
});

test("organization update detects optimistic concurrency conflicts", async () => {
  const repository = { update: async () => null, findById: async () => ({ id: "1", version: 3 }) };
  await assert.rejects(
    () => new OrganizationService(repository).update("1", { name: "New", version: 2 }),
    (error) => error.code === "VERSION_CONFLICT" && error.statusCode === 409
  );
});

test("organization create translates unique constraint failures", async () => {
  const repository = { create: async () => { const error = new Error("duplicate"); error.code = "23505"; throw error; } };
  await assert.rejects(
    () => new OrganizationService(repository).create({ code: "ACME", name: "Acme" }),
    (error) => error.code === "ORGANIZATION_CONFLICT"
  );
});
