const test = require("node:test");
const assert = require("node:assert/strict");
const { AccessService } = require("../src/modules/access/access.service");

test("user listing returns stable pagination metadata", async () => {
  const repository = { listUsers: async () => ({ items: [{ id: "user-1" }], total: 21 }) };
  const result = await new AccessService(repository, {}).listUsers("org-1", { page: 2, pageSize: 10 });
  assert.equal(result.page, 2);
  assert.equal(result.totalPages, 3);
});

test("user creation hashes the initial password before persistence", async () => {
  let persistedHash;
  const repository = {
    createUser: async (_organizationId, _data, passwordHash) => {
      persistedHash = passwordHash;
      return { userId: "user-1" };
    }
  };
  const passwords = { hash: async () => "argon2id-hash" };
  const result = await new AccessService(repository, passwords).createUser("org-1", {
    email: "person@example.com",
    displayName: "Person",
    initialPassword: "Strong.Password1!",
    roleId: "role-1"
  });
  assert.equal(result.userId, "user-1");
  assert.equal(persistedHash, "argon2id-hash");
});

test("user creation rejects roles from another organization", async () => {
  const repository = { createUser: async () => ({ error: "role" }) };
  const service = new AccessService(repository, { hash: async () => "hash" });
  await assert.rejects(
    () => service.createUser("org-1", { initialPassword: "Strong.Password1!" }),
    (error) => error.code === "ROLE_INVALID" && error.statusCode === 422
  );
});

test("duplicate memberships return a conflict", async () => {
  const repository = { createUser: async () => ({ error: "membership" }) };
  const service = new AccessService(repository, { hash: async () => "hash" });
  await assert.rejects(
    () => service.createUser("org-1", { initialPassword: "Strong.Password1!" }),
    (error) => error.code === "USER_ALREADY_MEMBER" && error.statusCode === 409
  );
});

test("system administrator permissions cannot be reduced", async () => {
  const repository = { updateRole: async () => ({ error: "protected" }) };
  const service = new AccessService(repository, {});
  await assert.rejects(
    () => service.updateRole("org-1", "role-1", { permissionKeys: [] }),
    (error) => error.code === "ROLE_PROTECTED" && error.statusCode === 422
  );
});
