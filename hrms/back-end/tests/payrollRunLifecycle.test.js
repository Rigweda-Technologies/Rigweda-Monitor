const test = require("node:test");
const assert = require("node:assert/strict");

const payrollDb = require("../src/config/payrollDb");
const payrollProvisioningService = require("../src/modules/payroll/payrollProvisioning.service");
const Role = require("../src/modules/roles/role.model");
const servicePath = require.resolve("../src/modules/payroll/payrollApproval.service");

const loadServiceWithPool = (pool) => {
  const originalGetPool = payrollDb.getPayrollPgPool;
  const originalGetTenantIdForOrganization = payrollProvisioningService.getTenantIdForOrganization;
  payrollDb.getPayrollPgPool = async () => pool;
  payrollProvisioningService.getTenantIdForOrganization = async () => "tenant-1";
  delete require.cache[servicePath];
  const service = require(servicePath);

  return {
    service,
    restore: () => {
      payrollDb.getPayrollPgPool = originalGetPool;
      payrollProvisioningService.getTenantIdForOrganization = originalGetTenantIdForOrganization;
      delete require.cache[servicePath];
    }
  };
};

const mockRoleSlug = (slug) => {
  const originalFindOne = Role.findOne;
  Role.findOne = () => ({
    select: () => ({
      lean: async () => ({ slug })
    })
  });

  return () => {
    Role.findOne = originalFindOne;
  };
};

const baseReq = () => ({
  params: { runId: "11111111-1111-4111-8111-111111111111" },
  body: { remarks: "ok", reason: "needs correction" },
  user: {
    organizationId: "507f1f77bcf86cd799439011",
    userId: "507f1f77bcf86cd799439012",
    activeRoleId: "507f1f77bcf86cd799439013"
  },
  headers: { "user-agent": "node:test" },
  ip: "127.0.0.1"
});

test("submitForApproval transitions draft run to ready_for_approval and commits", async () => {
  const calls = [];
  const client = {
    query: async (sql) => {
      const query = String(sql);
      calls.push(query);

      if (query.includes("SELECT id FROM payroll_tenants")) {
        return { rows: [{ id: "tenant-1" }] };
      }
      if (query.includes("FROM payroll_runs") && query.includes("FOR UPDATE")) {
        return { rows: [{ id: "run-1", status: "draft" }] };
      }
      if (query.includes("UPDATE payroll_runs")) {
        return { rows: [{ id: "run-1", status: "ready_for_approval" }] };
      }
      return { rows: [] };
    },
    release: () => {}
  };

  const pool = { connect: async () => client };
  const { service, restore } = loadServiceWithPool(pool);

  try {
    const result = await service.submitForApproval(baseReq());
    assert.equal(result.status, "ready_for_approval");
    assert.equal(calls.some((q) => q.includes("BEGIN")), true);
    assert.equal(calls.some((q) => q.includes("COMMIT")), true);
  } finally {
    restore();
  }
});

test("approveRun blocks maker-checker violation for non-admin roles and rolls back", async () => {
  const calls = [];
  const actorUserId = "507f1f77bcf86cd799439012";
  const restoreRole = mockRoleSlug("employee");

  const client = {
    query: async (sql) => {
      const query = String(sql);
      calls.push(query);

      if (query.includes("SELECT id FROM payroll_tenants")) {
        return { rows: [{ id: "tenant-1" }] };
      }
      if (query.includes("FROM payroll_runs") && query.includes("FOR UPDATE")) {
        return { rows: [{ id: "run-1", status: "ready_for_approval" }] };
      }
      if (query.includes("FROM payroll_run_audit_entries") && query.includes("submit_for_approval")) {
        return { rows: [{ actor_user_id: actorUserId }] };
      }
      return { rows: [] };
    },
    release: () => {}
  };

  const pool = { connect: async () => client };
  const { service, restore } = loadServiceWithPool(pool);

  try {
    await assert.rejects(service.approveRun(baseReq()), (error) => {
      assert.equal(error?.code, 409);
      assert.match(
        String(error?.message || ""),
        /Maker-checker violation: submitter cannot approve the same payroll run/
      );
      return true;
    });
    assert.equal(calls.some((q) => q.includes("ROLLBACK")), true);
    assert.equal(calls.some((q) => q.includes("COMMIT")), false);
  } finally {
    restoreRole();
    restore();
  }
});

test("approveRun allows admin override for same submitter", async () => {
  const calls = [];
  const actorUserId = "507f1f77bcf86cd799439012";
  const restoreRole = mockRoleSlug("org-admin");

  const client = {
    query: async (sql) => {
      const query = String(sql);
      calls.push(query);

      if (query.includes("SELECT id FROM payroll_tenants")) {
        return { rows: [{ id: "tenant-1" }] };
      }
      if (query.includes("FROM payroll_runs") && query.includes("FOR UPDATE")) {
        return { rows: [{ id: "run-1", status: "ready_for_approval" }] };
      }
      if (query.includes("FROM payroll_run_audit_entries") && query.includes("submit_for_approval")) {
        return { rows: [{ actor_user_id: actorUserId }] };
      }
      if (query.includes("UPDATE payroll_runs")) {
        return { rows: [{ id: "run-1", status: "approved" }] };
      }
      return { rows: [] };
    },
    release: () => {}
  };

  const pool = { connect: async () => client };
  const { service, restore } = loadServiceWithPool(pool);

  try {
    const result = await service.approveRun(baseReq());
    assert.equal(result.status, "approved");
    assert.equal(calls.some((q) => q.includes("COMMIT")), true);
  } finally {
    restoreRole();
    restore();
  }
});
