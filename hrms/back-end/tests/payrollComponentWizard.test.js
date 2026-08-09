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

test("createSalaryComponent reuses starter component for setup wizard duplicate", async () => {
  const restores = [];
  const servicePath = require.resolve("../src/modules/payroll/payrollApi.service");
  let insertSql = "";
  let insertParams = [];

  const client = {
    async query(sql, params = []) {
      if (sql.includes("INSERT INTO earning_components")) {
        insertSql = sql;
        insertParams = params;
        const error = new Error("duplicate key");
        error.code = "23505";
        error.constraint = "uq_earning_component_version";
        throw error;
      }

      if (sql.includes("FROM earning_components")) {
        return {
          rows: [
            {
              id: "cmp-basic-1",
              tenant_id: params[0],
              code: params[1],
              name: "Basic Pay",
              metadata: { autoProvisioned: true, starterPack: true }
            }
          ]
        };
      }

      if (sql.includes("UPDATE earning_components")) {
        return {
          rows: [
            {
              id: "cmp-basic-1",
              code: "BASIC",
              name: "Basic Pay",
              metadata: { autoProvisioned: true, starterPack: true }
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
  restores.push(
    mockModule("../src/modules/employees/employee.model", {})
  );

  delete require.cache[servicePath];
  const service = require("../src/modules/payroll/payrollApi.service");

  try {
    const result = await service.createSalaryComponent({
      user: { organizationId: "org-1", userId: "user-1" },
      body: {
        scope: "earning",
        code: "BASIC",
        name: "Basic",
        calculationMode: "formula",
        effectiveFrom: "2026-04-22",
        metadata: {
          wizardVersion: "v1",
          expression: "BASIC_PAY"
        }
      }
    });

    assert.equal(result.id, "cmp-basic-1");
    assert.equal(result.code, "BASIC");
    assert.match(insertSql, /\$14,\$15,1,true,\$16::jsonb,\$17,\$17/);
    assert.equal(insertParams.length, 17);
    assert.equal(insertParams[14], null);
  } finally {
    delete require.cache[servicePath];
    for (const restore of restores.reverse()) restore();
  }
});

test("createSalaryComponent upserts existing custom component for setup wizard duplicate", async () => {
  const restores = [];
  const servicePath = require.resolve("../src/modules/payroll/payrollApi.service");

  const client = {
    async query(sql, params = []) {
      if (sql.includes("INSERT INTO earning_components")) {
        const error = new Error("duplicate key");
        error.code = "23505";
        error.constraint = "uq_earning_component_version";
        throw error;
      }

      if (sql.includes("FROM earning_components")) {
        return {
          rows: [
            {
              id: "cmp-conveyance-1",
              tenant_id: params[0],
              code: params[1],
              name: "Conveyance",
              metadata: { custom: true }
            }
          ]
        };
      }

      if (sql.includes("UPDATE earning_components")) {
        return {
          rows: [
            {
              id: "cmp-conveyance-1",
              code: "CONVEYANCE",
              name: "Conveyance",
              metadata: { custom: true }
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
    const result = await service.createSalaryComponent({
      user: { organizationId: "org-1", userId: "user-1" },
      body: {
        scope: "earning",
        code: "CONVEYANCE",
        name: "Conveyance",
        calculationMode: "formula",
        effectiveFrom: "2026-04-01",
        metadata: {
          wizardVersion: "v1",
          expression: "max((BASIC - HRA - VARIABLE) * 0.20, 0)"
        }
      }
    });

    assert.equal(result.id, "cmp-conveyance-1");
    assert.equal(result.code, "CONVEYANCE");
  } finally {
    delete require.cache[servicePath];
    for (const restore of restores.reverse()) restore();
  }
});

test("createSalaryComponent still throws duplicate for non-wizard request", async () => {
  const restores = [];
  const servicePath = require.resolve("../src/modules/payroll/payrollApi.service");

  const duplicateError = new Error("duplicate key");
  duplicateError.code = "23505";
  duplicateError.constraint = "uq_earning_component_version";

  const client = {
    async query(sql) {
      if (sql.includes("SELECT DISTINCT UPPER(code) AS code")) {
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO earning_components")) {
        throw duplicateError;
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
  restores.push(
    mockModule("../src/modules/employees/employee.model", {})
  );

  delete require.cache[servicePath];
  const service = require("../src/modules/payroll/payrollApi.service");

  try {
    await assert.rejects(
      () =>
        service.createSalaryComponent({
          user: { organizationId: "org-1", userId: "user-1" },
          body: {
            scope: "earning",
            code: "BASIC",
            name: "Basic",
            calculationMode: "formula",
            effectiveFrom: "2026-04-22",
            metadata: {
              expression: "BASIC_PAY"
            }
          }
        }),
      duplicateError
    );
  } finally {
    delete require.cache[servicePath];
    for (const restore of restores.reverse()) restore();
  }
});

test("createSalaryComponent resolves canonical code when code is blank", async () => {
  const restores = [];
  const servicePath = require.resolve("../src/modules/payroll/payrollApi.service");

  let insertParams = null;
  const client = {
    async query(sql, params = []) {
      if (sql.includes("SELECT DISTINCT UPPER(code) AS code")) {
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO employer_contribution_components")) {
        insertParams = params;
        return {
          rows: [
            {
              id: "cmp-employer-1",
              code: params[2],
              name: "Employer Provident Fund"
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
    const result = await service.createSalaryComponent({
      user: { organizationId: "org-1", userId: "user-1" },
      body: {
        scope: "employer_contribution",
        code: "",
        name: "Employer Provident Fund",
        calculationMode: "formula",
        effectiveFrom: "2026-04-01",
        metadata: {
          wizardVersion: "v1",
          expression: "round(EMPLOYER_EPF)"
        }
      }
    });

    assert.equal(insertParams[2], "EMPLOYER_EPF");
    assert.equal(result.code, "EMPLOYER_EPF");
  } finally {
    delete require.cache[servicePath];
    for (const restore of restores.reverse()) restore();
  }
});

test("savePayrollSetup reuses stored paygroup code when payload code is blank", async () => {
  const restores = [];
  const servicePath = require.resolve("../src/modules/payroll/payrollApi.service");

  const client = {
    async query(sql, params = []) {
      if (sql.includes("FROM pay_groups")) {
        return {
          rows: [
            {
              id: "pg-1",
              code: "TS-MONTHLY",
              name: "TS Monthly"
            }
          ]
        };
      }
      if (sql.includes("FROM earning_components")) return { rows: [] };
      if (sql.includes("FROM deduction_components")) return { rows: [] };
      if (sql.includes("FROM employer_contribution_components")) return { rows: [] };
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

  const calls = [];
  service.updatePayGroup = async (req) => {
    calls.push({ type: "payGroup", code: req.body.code });
    return { id: req.params.payGroupId, code: req.body.code };
  };
  service.upsertSettings = async () => ({ id: "settings-1" });
  service.listSalaryComponents = async () => [];
  service.deleteSalaryComponent = async () => ({});
  service.createSalaryComponent = async (req) => {
    calls.push({ type: "component", code: req.body.code });
    return { id: "cmp-1", code: req.body.code };
  };
  service.updateSalaryComponent = async (req) => {
    calls.push({ type: "updateComponent", code: req.body.code });
    return { id: req.params.id, code: req.body.code };
  };

  try {
    await service.savePayrollSetup({
      user: { organizationId: "org-1", userId: "user-1" },
      body: {
        payGroupId: "pg-1",
        payGroup: {
          code: "",
          name: "TS Monthly",
          payFrequency: "monthly",
          salaryPayDay: 5,
          workWeekDays: 6,
          metadata: {}
        },
        settings: {
          countryCode: "IN",
          stateCode: "TS",
          attendanceLockMode: "payroll_cutoff",
          attendanceLockAfterDays: 7,
          lopCalculationMethod: "working_days",
          defaultWorkingDays: 30,
          enableProration: true,
          metadata: {}
        },
        components: [
          {
            scope: "employer_contribution",
            code: "",
            name: "Employer Provident Fund",
            calculationMode: "formula",
            taxable: false,
            effectiveFrom: "2026-04-01",
            metadata: { wizardVersion: "v1", expression: "round(EMPLOYER_EPF)" }
          }
        ]
      }
    });

    assert.equal(calls[0].type, "payGroup");
    assert.equal(calls[0].code, "TS-MONTHLY");
    assert.equal(calls[1].type, "component");
    assert.equal(calls[1].code, "EMPLOYER_EPF");
  } finally {
    delete require.cache[servicePath];
    for (const restore of restores.reverse()) restore();
  }
});
