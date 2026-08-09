const test = require("node:test");
const assert = require("node:assert/strict");

const mockModule = (modulePath, exportsValue) => {
  const resolved = require.resolve(modulePath);
  const original = require.cache[resolved];
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: exportsValue
  };

  return () => {
    if (original) require.cache[resolved] = original;
    else delete require.cache[resolved];
  };
};

test("ensurePayrollTenantAndDefaults bootstraps payroll schema before tenant provisioning", async () => {
  const restores = [];
  const servicePath = require.resolve("../src/modules/payroll/payrollProvisioning.service");
  const queryOrder = [];

  const client = {
    async query(sql, params = []) {
      if (sql.includes("SELECT COUNT(*)::int AS count FROM earning_components")) {
        return { rows: [{ count: 0 }] };
      }
      if (sql.includes("SELECT COUNT(*)::int AS count FROM deduction_components")) {
        return { rows: [{ count: 0 }] };
      }
      if (sql.includes("SELECT COUNT(*)::int AS count FROM employer_contribution_components")) {
        return { rows: [{ count: 0 }] };
      }
      if (sql.includes("SELECT COUNT(*)::int AS count FROM component_formulas")) {
        return { rows: [{ count: 0 }] };
      }
      if (sql.includes("INSERT INTO payroll_tenants")) {
        queryOrder.push("insertTenant");
        return { rows: [{ id: "tenant-1" }] };
      }
      if (sql.includes("FROM pay_groups")) {
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO pay_groups")) {
        return { rows: [{ id: "pay-group-1" }] };
      }
      if (sql.includes("INSERT INTO payroll_settings")) {
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO earning_components")) {
        const code = params[1] || "UNKNOWN";
        return { rows: [{ id: `earning-${code}`, code }] };
      }
      if (sql.includes("INSERT INTO deduction_components")) {
        const code = params[1] || "UNKNOWN";
        return { rows: [{ id: `deduction-${code}`, code }] };
      }
      if (sql.includes("INSERT INTO employer_contribution_components")) {
        const code = params[1] || "UNKNOWN";
        return { rows: [{ id: `employer-${code}`, code }] };
      }
      if (sql.includes("INSERT INTO component_formulas")) {
        queryOrder.push("insertFormula");
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() {}
  };

  restores.push(
    mockModule("../src/config/payrollDb", {
      getPayrollPgPool: async () => ({
        connect: async () => client
      })
    })
  );
  restores.push(
    mockModule("../src/modules/payroll/payrollSchema.service", {
      ensurePayrollSchema: async () => {
        queryOrder.push("ensureSchema");
      }
    })
  );
  restores.push(
    mockModule("../src/modules/orgSettings/orgSettings.model", {
      findOne: () => ({
        select() {
          return {
            lean: async () => ({
              payrollEnabled: true,
              payrollCutoffDay: 25,
              timezone: "Asia/Kolkata",
              attendanceLockMode: "payroll_cutoff",
              attendanceLockAfterDays: 7
            })
          };
        }
      })
    })
  );
  restores.push(
    mockModule("../src/modules/organizations/organization.model", {
      findById: () => ({
        select() {
          return {
            lean: async () => ({
              name: "Acme Corp",
              code: "ACME",
              timezone: "Asia/Kolkata"
            })
          };
        }
      })
    })
  );

  delete require.cache[servicePath];
  const service = require("../src/modules/payroll/payrollProvisioning.service");

  try {
    const result = await service.ensurePayrollTenantAndDefaults({
      organizationId: "org-1",
      actorId: "user-1"
    });

    assert.equal(result.tenantId, "tenant-1");
    assert.equal(queryOrder[0], "ensureSchema");
    assert.equal(queryOrder[1], "insertTenant");
    assert.equal(queryOrder.filter((item) => item === "insertFormula").length, 10);
  } finally {
    delete require.cache[servicePath];
    for (const restore of restores.reverse()) restore();
  }
});

test("getTenantIdForOrganization returns an existing tenant without schema bootstrap", async () => {
  const restores = [];
  const servicePath = require.resolve("../src/modules/payroll/payrollProvisioning.service");
  const queryOrder = [];

  const client = {
    async query(sql) {
      if (sql.includes("SELECT id FROM payroll_tenants")) {
        queryOrder.push("selectTenant");
        return { rows: [{ id: "tenant-lookup-1" }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  restores.push(
    mockModule("../src/config/payrollDb", {
      getPayrollPgPool: async () => null
    })
  );
  restores.push(
    mockModule("../src/modules/payroll/payrollSchema.service", {
      ensurePayrollSchema: async () => {
        queryOrder.push("ensureSchema");
      }
    })
  );
  restores.push(
    mockModule("../src/modules/orgSettings/orgSettings.model", {
      findOne: () => ({
        select() {
          return {
            lean: async () => ({
              payrollEnabled: true
            })
          };
        }
      })
    })
  );
  restores.push(
    mockModule("../src/modules/organizations/organization.model", {
      findById: () => ({
        select() {
          return {
            lean: async () => null
          };
        }
      })
    })
  );

  delete require.cache[servicePath];
  const service = require("../src/modules/payroll/payrollProvisioning.service");

  try {
    const tenantId = await service.getTenantIdForOrganization(client, "org-1");
    assert.equal(tenantId, "tenant-lookup-1");
    assert.deepEqual(queryOrder, ["selectTenant"]);
  } finally {
    delete require.cache[servicePath];
    for (const restore of restores.reverse()) restore();
  }
});

test("getTenantIdForOrganization returns a clear error when schema permissions are missing", async () => {
  const restores = [];
  const servicePath = require.resolve("../src/modules/payroll/payrollProvisioning.service");

  const client = {
    async query() {
      const error = new Error("permission denied for schema public");
      error.code = "42501";
      throw error;
    }
  };

  restores.push(
    mockModule("../src/config/payrollDb", {
      getPayrollPgPool: async () => null
    })
  );
  restores.push(
    mockModule("../src/modules/payroll/payrollSchema.service", {
      ensurePayrollSchema: async () => {}
    })
  );
  restores.push(
    mockModule("../src/modules/orgSettings/orgSettings.model", {
      findOne: () => ({
        select() {
          return {
            lean: async () => ({
              payrollEnabled: true
            })
          };
        }
      })
    })
  );
  restores.push(
    mockModule("../src/modules/organizations/organization.model", {
      findById: () => ({
        select() {
          return {
            lean: async () => null
          };
        }
      })
    })
  );

  delete require.cache[servicePath];
  const service = require("../src/modules/payroll/payrollProvisioning.service");

  try {
    await assert.rejects(
      () => service.getTenantIdForOrganization(client, "org-1"),
      (error) => {
        assert.equal(error.statusCode, 500);
        assert.match(String(error.message || ""), /cannot create payroll tables/i);
        return true;
      }
    );
  } finally {
    delete require.cache[servicePath];
    for (const restore of restores.reverse()) restore();
  }
});

test("getTenantIdForOrganization returns a clear error when schema is missing and auto provision is off", async () => {
  const restores = [];
  const servicePath = require.resolve("../src/modules/payroll/payrollProvisioning.service");

  const client = {
    async query() {
      const error = new Error('relation "payroll_tenants" does not exist');
      error.code = "42P01";
      throw error;
    }
  };

  restores.push(
    mockModule("../src/config/payrollDb", {
      getPayrollPgPool: async () => null
    })
  );
  restores.push(
    mockModule("../src/modules/payroll/payrollSchema.service", {
      ensurePayrollSchema: async () => {}
    })
  );
  restores.push(
    mockModule("../src/modules/orgSettings/orgSettings.model", {
      findOne: () => ({
        select() {
          return {
            lean: async () => ({
              payrollEnabled: true
            })
          };
        }
      })
    })
  );
  restores.push(
    mockModule("../src/modules/organizations/organization.model", {
      findById: () => ({
        select() {
          return {
            lean: async () => null
          };
        }
      })
    })
  );

  delete require.cache[servicePath];
  const service = require("../src/modules/payroll/payrollProvisioning.service");

  try {
    await assert.rejects(
      () => service.getTenantIdForOrganization(client, "org-1", { autoProvision: false }),
      (error) => {
        assert.equal(error.statusCode, 500);
        assert.match(String(error.message || ""), /schema is not initialized/i);
        return true;
      }
    );
  } finally {
    delete require.cache[servicePath];
    for (const restore of restores.reverse()) restore();
  }
});
