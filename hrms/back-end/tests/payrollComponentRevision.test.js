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

test("updateSalaryComponent creates a new revision for a later effective month", async () => {
  const restores = [];
  const servicePath = require.resolve("../src/modules/payroll/payrollApi.service");
  const queries = [];

  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });

      if (sql === "BEGIN" || sql === "COMMIT") {
        return { rows: [] };
      }

      if (sql.includes("FROM earning_components WHERE id = $1 AND tenant_id = $2 FOR UPDATE")) {
        return {
          rows: [
            {
              id: "cmp-basic-1",
              tenant_id: "tenant-1",
              code: "BASIC",
              name: "Basic Pay",
              display_name: "Basic Pay",
              description: null,
              calculation_mode: "percentage",
              taxable: true,
              priority: 100,
              pf_applicable: true,
              esi_applicable: false,
              prorate_with_attendance: true,
              rounding_policy: "nearest_rupee",
              effective_from: "2026-06-01",
              effective_to: null,
              version_no: 1,
              is_active: true,
              metadata: { payGroupIds: ["pg-1"], applicability: { payGroupIds: ["pg-1"] } }
            }
          ]
        };
      }

      if (sql.includes("AND code = $2") && sql.includes("AND effective_from = $3::date")) {
        return { rows: [] };
      }

      if (sql.includes("SELECT COALESCE(MAX(version_no), 0) + 1 AS next_version")) {
        return { rows: [{ next_version: 2 }] };
      }

      if (sql.includes("UPDATE earning_components") && sql.includes("SET") && sql.includes("effective_to = $3")) {
        return {
          rows: [
            {
              id: "cmp-basic-1",
              effective_to: "2026-06-30"
            }
          ]
        };
      }

      if (sql.includes("INSERT INTO earning_components")) {
        return {
          rows: [
            {
              id: "cmp-basic-2",
              code: "BASIC",
              name: "Basic Pay",
              effective_from: "2026-07-01",
              effective_to: null,
              version_no: 2,
              metadata: {
                payGroupIds: ["pg-1"],
                applicability: { payGroupIds: ["pg-1"] }
              }
            }
          ]
        };
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
    mockModule("../src/modules/payroll/payrollProvisioning.service", {
      getTenantIdForOrganization: async () => "tenant-1"
    })
  );
  restores.push(
    mockModule("../src/modules/payroll/payrollTx", {
      safeRollback: async () => {}
    })
  );
  restores.push(
    mockModule("../src/modules/orgSettings/orgSettings.model", {
      findOne: () => ({ select: () => ({ lean: async () => null }) })
    })
  );
  restores.push(mockModule("../src/modules/employees/employee.model", {}));

  delete require.cache[servicePath];
  const service = require("../src/modules/payroll/payrollApi.service");

  try {
    const result = await service.updateSalaryComponent({
      user: { organizationId: "org-1", userId: "user-1" },
      params: { id: "cmp-basic-1" },
      query: { scope: "earning" },
      body: {
        name: "Basic Pay",
        calculationMode: "percentage",
        effectiveFrom: "2026-07-01",
        taxable: true,
        metadata: {
          base: "MONTHLY_GROSS",
          percentage: 50,
          payGroupIds: ["pg-1"],
          applicability: { payGroupIds: ["pg-1"] }
        }
      }
    });

    assert.equal(result.saveAction, "created_revision");
    assert.equal(result.id, "cmp-basic-2");
    assert.equal(result.effective_from, "2026-07-01");
    assert(queries.some((entry) => entry.sql.includes("effective_to = $3")));
  } finally {
    delete require.cache[servicePath];
    for (const restore of restores.reverse()) restore();
  }
});

test("listSalaryComponents returns the latest applicable revision per code", async () => {
  const restores = [];
  const servicePath = require.resolve("../src/modules/payroll/payrollApi.service");

  const client = {
    async query(sql, params = []) {
      if (sql.includes("FROM earning_components")) {
        return {
          rows: [
            {
              id: "cmp-basic-2",
              tenant_id: params[0],
              code: "BASIC",
              effective_from: "2026-07-01",
              version_no: 2,
              is_active: true,
              metadata: { payGroupIds: ["pg-1"] }
            },
            {
              id: "cmp-basic-1",
              tenant_id: params[0],
              code: "BASIC",
              effective_from: "2026-06-01",
              version_no: 1,
              is_active: true,
              metadata: { payGroupIds: ["pg-1"] }
            },
            {
              id: "cmp-hra-1",
              tenant_id: params[0],
              code: "HRA",
              effective_from: "2026-06-01",
              version_no: 1,
              is_active: true,
              metadata: { payGroupIds: ["pg-2"] }
            }
          ]
        };
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
    mockModule("../src/modules/payroll/payrollProvisioning.service", {
      getTenantIdForOrganization: async () => "tenant-1"
    })
  );
  restores.push(
    mockModule("../src/modules/payroll/payrollTx", {
      safeRollback: async () => {}
    })
  );
  restores.push(
    mockModule("../src/modules/orgSettings/orgSettings.model", {
      findOne: () => ({ select: () => ({ lean: async () => null }) })
    })
  );
  restores.push(mockModule("../src/modules/employees/employee.model", {}));

  delete require.cache[servicePath];
  const service = require("../src/modules/payroll/payrollApi.service");

  try {
    const result = await service.listSalaryComponents({
      user: { organizationId: "org-1", userId: "user-1" },
      query: { scope: "earning", payGroupId: "pg-1" }
    });

    assert.equal(result.length, 1);
    assert.equal(result[0].id, "cmp-basic-2");
  } finally {
    delete require.cache[servicePath];
    for (const restore of restores.reverse()) restore();
  }
});

test("updateSalaryComponent reopens existing same-date revision safely", async () => {
  const restores = [];
  const servicePath = require.resolve("../src/modules/payroll/payrollApi.service");
  const updateQueries = [];

  const client = {
    async query(sql, params = []) {
      if (sql === "BEGIN" || sql === "COMMIT") {
        return { rows: [] };
      }

      if (sql.includes("FROM earning_components WHERE id = $1 AND tenant_id = $2 FOR UPDATE")) {
        return {
          rows: [
            {
              id: "cmp-basic-old",
              tenant_id: "tenant-1",
              code: "BASIC",
              name: "Basic Pay",
              effective_from: "2026-06-01",
              effective_to: "2026-06-30",
              version_no: 1,
              is_active: true,
              metadata: { payGroupIds: ["pg-1"] }
            }
          ]
        };
      }

      if (sql.includes("AND code = $2") && sql.includes("AND effective_from = $3::date")) {
        return {
          rows: [
            {
              id: "cmp-basic-current",
              tenant_id: "tenant-1",
              code: "BASIC",
              name: "Basic Pay",
              effective_from: "2026-07-01",
              effective_to: "2026-06-30",
              version_no: 2,
              is_active: false,
              metadata: { payGroupIds: ["pg-1"] }
            }
          ]
        };
      }

      if (sql.includes("UPDATE earning_components")) {
        updateQueries.push({ sql, params });
        return {
          rows: [
            {
              id: "cmp-basic-current",
              code: "BASIC",
              name: "Basic Pay",
              effective_from: "2026-07-01",
              effective_to: null,
              is_active: true,
              metadata: { payGroupIds: ["pg-1"] }
            }
          ]
        };
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
    mockModule("../src/modules/payroll/payrollProvisioning.service", {
      getTenantIdForOrganization: async () => "tenant-1"
    })
  );
  restores.push(
    mockModule("../src/modules/payroll/payrollTx", {
      safeRollback: async () => {}
    })
  );
  restores.push(
    mockModule("../src/modules/orgSettings/orgSettings.model", {
      findOne: () => ({ select: () => ({ lean: async () => null }) })
    })
  );
  restores.push(mockModule("../src/modules/employees/employee.model", {}));

  delete require.cache[servicePath];
  const service = require("../src/modules/payroll/payrollApi.service");

  try {
    const result = await service.updateSalaryComponent({
      user: { organizationId: "org-1", userId: "user-1" },
      params: { id: "cmp-basic-old" },
      query: { scope: "earning" },
      body: {
        name: "Basic Pay",
        calculationMode: "percentage",
        effectiveFrom: "2026-07-01",
        isActive: true,
        metadata: {
          wizardVersion: "v1",
          base: "MONTHLY_GROSS",
          percentage: 50,
          payGroupIds: ["pg-1"]
        }
      }
    });

    assert.equal(result.saveAction, "updated_existing_revision");
    assert.equal(result.effective_to, null);
    assert.equal(updateQueries.length, 2);
    assert.match(updateQueries[0].sql, /effective_to = \$3/);
    assert.match(updateQueries[1].sql, /WHEN \$16::boolean = true AND \$15::date IS NULL THEN NULL/);
    assert.equal(updateQueries[1].params[13], "2026-07-01");
    assert.equal(updateQueries[1].params[14], null);
    assert.equal(updateQueries[1].params[15], true);
  } finally {
    delete require.cache[servicePath];
    for (const restore of restores.reverse()) restore();
  }
});

test("savePayrollSetup creates a new component when paygroup-scoped lookup misses", async () => {
  const servicePath = require.resolve("../src/modules/payroll/payrollApi.service");
  delete require.cache[servicePath];
  const service = require(servicePath);

  const originalMethods = {
    updatePayGroup: service.updatePayGroup,
    upsertSettings: service.upsertSettings,
    deleteSalaryComponent: service.deleteSalaryComponent,
    listSalaryComponents: service.listSalaryComponents,
    updateSalaryComponent: service.updateSalaryComponent,
    createSalaryComponent: service.createSalaryComponent
  };

  const updateCalls = [];
  let createCalls = 0;

  service.updatePayGroup = async () => ({ id: "pg-1" });
  service.upsertSettings = async () => ({ id: "settings-1" });
  service.deleteSalaryComponent = async () => ({ id: "removed-1" });
  service.listSalaryComponents = async (req) => {
    const { scope, payGroupId, includeInactive } = req.query || {};
    if (scope === "earning" && payGroupId && !includeInactive) return [];
    return [];
  };
  service.updateSalaryComponent = async (req) => {
    updateCalls.push(req);
    return { id: req.params.id, saveAction: "updated_current" };
  };
  service.createSalaryComponent = async () => {
    createCalls += 1;
    return { id: "new-component" };
  };

  try {
    const result = await service.savePayrollSetup({
      user: { organizationId: "org-1", userId: "user-1" },
      body: {
        payGroupId: "pg-1",
        payGroup: { code: "PG-1", name: "Payroll Group 1", payFrequency: "monthly" },
        settings: { stateCode: "TS" },
        components: [
          {
            scope: "earning",
            code: "HRA",
            name: "House Rent Allowance",
            displayName: "House Rent Allowance",
            calculationMode: "percentage",
            taxable: true,
            effectiveFrom: "2026-07-01",
            metadata: {
              wizardVersion: "v1",
              base: "BASIC",
              percentage: 50,
              payGroupIds: ["pg-1"]
            }
          }
        ]
      }
    });

    assert.equal(result.summary.createdCount, 1);
    assert.equal(result.summary.updatedCount, 0);
    assert.equal(createCalls, 1);
    assert.equal(updateCalls.length, 0);
  } finally {
    service.updatePayGroup = originalMethods.updatePayGroup;
    service.upsertSettings = originalMethods.upsertSettings;
    service.deleteSalaryComponent = originalMethods.deleteSalaryComponent;
    service.listSalaryComponents = originalMethods.listSalaryComponents;
    service.updateSalaryComponent = originalMethods.updateSalaryComponent;
    service.createSalaryComponent = originalMethods.createSalaryComponent;
  }
});

test("listSalaryComponents prefers direct pay_group_id over metadata fallback", async () => {
  const restores = [];
  const servicePath = require.resolve("../src/modules/payroll/payrollApi.service");

  const client = {
    async query(sql, params = []) {
      if (sql.includes("FROM earning_components")) {
        return {
          rows: [
            {
              id: "cmp-direct",
              tenant_id: params[0],
              code: "BASIC",
              pay_group_id: "pg-1",
              effective_from: "2026-06-01",
              version_no: 1,
              is_active: true,
              metadata: {}
            },
            {
              id: "cmp-fallback",
              tenant_id: params[0],
              code: "HRA",
              pay_group_id: null,
              effective_from: "2026-06-01",
              version_no: 1,
              is_active: true,
              metadata: { payGroupIds: ["pg-2"] }
            }
          ]
        };
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
    mockModule("../src/modules/payroll/payrollProvisioning.service", {
      getTenantIdForOrganization: async () => "tenant-1"
    })
  );
  restores.push(
    mockModule("../src/modules/payroll/payrollTx", {
      safeRollback: async () => {}
    })
  );
  restores.push(
    mockModule("../src/modules/orgSettings/orgSettings.model", {
      findOne: () => ({ select: () => ({ lean: async () => null }) })
    })
  );
  restores.push(mockModule("../src/modules/employees/employee.model", {}));

  delete require.cache[servicePath];
  const service = require("../src/modules/payroll/payrollApi.service");

  try {
    const result = await service.listSalaryComponents({
      user: { organizationId: "org-1", userId: "user-1" },
      query: { scope: "earning", payGroupId: "pg-1" }
    });

    assert.equal(result.length, 1);
    assert.equal(result[0].id, "cmp-direct");
  } finally {
    delete require.cache[servicePath];
    for (const restore of restores.reverse()) restore();
  }
});

test("savePayrollSetup passes payGroupId through to component updates", async () => {
  const servicePath = require.resolve("../src/modules/payroll/payrollApi.service");
  delete require.cache[servicePath];
  const service = require(servicePath);

  const originalMethods = {
    updatePayGroup: service.updatePayGroup,
    upsertSettings: service.upsertSettings,
    deleteSalaryComponent: service.deleteSalaryComponent,
    listSalaryComponents: service.listSalaryComponents,
    updateSalaryComponent: service.updateSalaryComponent,
    createSalaryComponent: service.createSalaryComponent
  };

  let capturedUpdateReq = null;
  let capturedCreateReq = null;

  service.updatePayGroup = async () => ({ id: "pg-1" });
  service.upsertSettings = async () => ({ id: "settings-1" });
  service.deleteSalaryComponent = async () => ({ id: "removed-1" });
  service.listSalaryComponents = async (req) => {
    const { scope, payGroupId, includeInactive } = req.query || {};
    if (scope === "earning" && payGroupId && !includeInactive) {
      return [];
    }
    if (scope === "earning" && includeInactive) {
      return [
        {
          id: "cmp-hra-1",
          code: "HRA",
          metadata: {}
        }
      ];
    }
    return [];
  };
  service.updateSalaryComponent = async (req) => {
    capturedUpdateReq = req;
    return { id: req.params.id, saveAction: "updated_current" };
  };
  service.createSalaryComponent = async (req) => {
    capturedCreateReq = req;
    return { id: "new-component" };
  };

  try {
    const result = await service.savePayrollSetup({
      user: { organizationId: "org-1", userId: "user-1" },
      body: {
        payGroupId: "pg-1",
        payGroup: { code: "PG-1", name: "Payroll Group 1", payFrequency: "monthly" },
        settings: { stateCode: "TS" },
        components: [
          {
            scope: "earning",
            code: "HRA",
            name: "House Rent Allowance",
            displayName: "House Rent Allowance",
            calculationMode: "percentage",
            taxable: true,
            effectiveFrom: "2026-07-01",
            metadata: {
              wizardVersion: "v1",
              base: "BASIC",
              percentage: 50
            }
          }
        ]
      }
    });

    assert.equal(result.summary.createdCount, 0);
    assert.equal(result.summary.updatedCount, 1);
    assert.equal(capturedCreateReq, null);
    assert.equal(capturedUpdateReq?.query?.preserveTimeline, "true");
    assert.equal(capturedUpdateReq?.body?.payGroupId, "pg-1");
    assert.equal(capturedUpdateReq?.body?.effectiveFrom, "2026-07-01");
  } finally {
    service.updatePayGroup = originalMethods.updatePayGroup;
    service.upsertSettings = originalMethods.upsertSettings;
    service.deleteSalaryComponent = originalMethods.deleteSalaryComponent;
    service.listSalaryComponents = originalMethods.listSalaryComponents;
    service.updateSalaryComponent = originalMethods.updateSalaryComponent;
    service.createSalaryComponent = originalMethods.createSalaryComponent;
  }
});
