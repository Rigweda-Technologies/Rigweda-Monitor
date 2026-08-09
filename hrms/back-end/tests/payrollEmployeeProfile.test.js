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

test("createEmployeeProfile does not require salary effectiveFrom", async () => {
  const restores = [];
  const servicePath = require.resolve("../src/modules/payroll/payrollApi.service");
  const queryOrder = [];
  let insertParams = null;

  const client = {
    async query(sql, params = []) {
      if (sql === "BEGIN" || sql === "COMMIT") {
        queryOrder.push(sql);
        return { rows: [] };
      }

      if (sql.includes("INSERT INTO employee_payroll_profiles")) {
        queryOrder.push("INSERT_PROFILE");
        insertParams = params;
        return {
          rows: [
            {
              id: "profile-1",
              employee_external_id: params[1],
              date_of_joining: params[7]
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
    const result = await service.createEmployeeProfile({
      user: { organizationId: "org-1", userId: "user-1" },
      body: {
        employeeExternalId: "69e5cbefe8f982364560542a",
        employeeCode: "PV-0034",
        payGroupId: "cf4bebd2-6dcc-4701-8d1c-c207b9d71de1",
        payrollStatus: "active",
        defaultPaymentMode: "bank_transfer",
        taxRegime: "new",
        dateOfJoining: "2026-04-20"
      }
    });

    assert.equal(result.id, "profile-1");
    assert.deepEqual(queryOrder, ["BEGIN", "INSERT_PROFILE", "COMMIT"]);
    assert.equal(insertParams[7], "2026-04-20");
  } finally {
    delete require.cache[servicePath];
    for (const restore of restores.reverse()) restore();
  }
});

test("createSalaryStructure starts transaction before writing salary package", async () => {
  const restores = [];
  const servicePath = require.resolve("../src/modules/payroll/payrollApi.service");
  const queryOrder = [];

  const client = {
    async query(sql, params = []) {
      if (sql === "BEGIN" || sql === "COMMIT") {
        queryOrder.push(sql);
        return { rows: [] };
      }

      if (sql.includes("SELECT id") && sql.includes("effective_from = $3::date")) {
        queryOrder.push("CHECK_EFFECTIVE_DATE");
        return { rows: [] };
      }

      if (sql.includes("SELECT COALESCE(MAX(version_no), 0) + 1 AS next_version")) {
        queryOrder.push("NEXT_VERSION");
        return { rows: [{ next_version: 1 }] };
      }

      if (sql.includes("UPDATE employee_salary_structures")) {
        queryOrder.push("CLEAR_CURRENT");
        return { rows: [] };
      }

      if (sql.includes("INSERT INTO employee_salary_structures")) {
        queryOrder.push("INSERT_SALARY");
        return {
          rows: [
            {
              id: "salary-1",
              employee_payroll_profile_id: params[1],
              annual_ctc: params[4]
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
    const result = await service.createSalaryStructure({
      user: { organizationId: "org-1", userId: "user-1" },
      params: { profileId: "profile-1" },
      body: {
        structureCode: "SAL-20260514",
        structureName: "Standard Structure",
        annualCtc: 1200000,
        monthlyGross: 95000,
        basicPay: 47500,
        variablePay: 0,
        isCurrent: true,
        effectiveFrom: "2026-05-14",
        metadata: {
          salaryRules: {
            componentOverrides: {
              BONUS: { enabled: false }
            }
          }
        }
      }
    });

    assert.equal(result.id, "salary-1");
    assert.deepEqual(queryOrder, [
      "BEGIN",
      "CHECK_EFFECTIVE_DATE",
      "NEXT_VERSION",
      "CLEAR_CURRENT",
      "INSERT_SALARY",
      "COMMIT"
    ]);
  } finally {
    delete require.cache[servicePath];
    for (const restore of restores.reverse()) restore();
  }
});

test("upsertBankDetail updates the current row when effective dates match", async () => {
  const restores = [];
  const servicePath = require.resolve("../src/modules/payroll/payrollApi.service");
  const queryOrder = [];

  const currentRow = {
    id: "bank-1",
    tenant_id: "tenant-1",
    employee_payroll_profile_id: "profile-1",
    account_holder_name: "Old Holder",
    bank_name: "Old Bank",
    branch_name: "Old Branch",
    account_number: "1234567890",
    ifsc_code: "SBIN0005882",
    account_type: "salary",
    payment_mode: "bank_transfer",
    upi_id: null,
    is_primary: true,
    is_verified: false,
    effective_from: new Date("2026-01-17T00:00:00.000Z"),
    effective_to: null,
    version_no: 1
  };

  const client = {
    async query(sql, params = []) {
      if (sql === "BEGIN" || sql === "COMMIT") {
        queryOrder.push(sql);
        return { rows: [] };
      }

      if (sql.includes("SELECT *") && sql.includes("FROM employee_bank_details")) {
        queryOrder.push("SELECT_CURRENT");
        return { rows: [currentRow] };
      }

      if (sql.includes("UPDATE employee_bank_details")) {
        queryOrder.push("UPDATE_BANK");
        return {
          rows: [
            {
              ...currentRow,
              account_holder_name: params[2],
              bank_name: params[3],
              branch_name: params[4],
              account_number: params[5],
              ifsc_code: params[6],
              account_type: params[7],
              payment_mode: params[8],
              upi_id: params[9],
              is_primary: params[10],
              is_verified: params[11],
              effective_to: params[12],
              updated_by: params[14]
            }
          ]
        };
      }

      if (sql.includes("INSERT INTO employee_bank_details")) {
        throw new Error("Insert path should not be used when effectiveFrom matches the current row");
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

  delete require.cache[servicePath];
  const service = require("../src/modules/payroll/payrollApi.service");

  try {
    const result = await service.upsertBankDetail({
      user: { organizationId: "org-1", userId: "user-1" },
      params: { profileId: "profile-1" },
      body: {
        accountHolderName: "New Holder",
        bankName: "New Bank",
        branchName: "New Branch",
        accountNumber: "9999999999",
        ifscCode: "HDFC0001234",
        accountType: "current",
        paymentMode: "bank_transfer",
        upiId: null,
        isPrimary: true,
        isVerified: true,
        effectiveFrom: "2026-01-17"
      }
    });

    assert.equal(result.saveAction, "updated_current");
    assert.deepEqual(queryOrder, ["BEGIN", "SELECT_CURRENT", "UPDATE_BANK", "COMMIT"]);
    assert.equal(result.account_holder_name, "New Holder");
    assert.equal(result.bank_name, "New Bank");
  } finally {
    delete require.cache[servicePath];
    for (const restore of restores.reverse()) restore();
  }
});

test("createSalaryStructure rejects duplicate effective date to preserve revision history", async () => {
  const restores = [];
  const servicePath = require.resolve("../src/modules/payroll/payrollApi.service");
  let rolledBack = false;

  const client = {
    async query(sql) {
      if (sql === "BEGIN") return { rows: [] };

      if (sql.includes("SELECT id") && sql.includes("effective_from = $3::date")) {
        return { rows: [{ id: "salary-existing" }] };
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
      safeRollback: async () => {
        rolledBack = true;
      }
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
    await assert.rejects(
      () =>
        service.createSalaryStructure({
          user: { organizationId: "org-1", userId: "user-1" },
          params: { profileId: "profile-1" },
          body: {
            structureCode: "SAL-20260514",
            structureName: "Hike Structure",
            annualCtc: 1400000,
            effectiveFrom: "2026-05-14"
          }
        }),
      (error) => {
        assert.equal(error.code, 409);
        assert.match(error.message, /salary revision already exists/);
        return true;
      }
    );
    assert.equal(rolledBack, true);
  } finally {
    delete require.cache[servicePath];
    for (const restore of restores.reverse()) restore();
  }
});

test("updateSalaryStructure is scoped to payroll tenant", async () => {
  const restores = [];
  const servicePath = require.resolve("../src/modules/payroll/payrollApi.service");
  let updateParams = null;

  const client = {
    async query(sql, params = []) {
      if (sql === "BEGIN" || sql === "COMMIT") {
        return { rows: [] };
      }

      if (sql.includes("SELECT employee_payroll_profile_id, effective_from, effective_to")) {
        return {
          rows: [
            {
              employee_payroll_profile_id: "profile-1",
              effective_from: "2026-05-14",
              effective_to: null
            }
          ]
        };
      }

      if (sql.includes("AND effective_from > $4::date")) {
        return { rows: [] };
      }

      if (sql.includes("UPDATE employee_salary_structures")) {
        updateParams = params;
        assert.match(sql, /AND tenant_id = \$12/);
        return {
          rows: [
            {
              id: params[0],
              annual_ctc: params[2],
              tenant_id: params[11]
            }
          ]
        };
      }

      if (sql.includes("AND effective_from > $4::date")) {
        return { rows: [{ id: "salary-newer" }] };
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
    const result = await service.updateSalaryStructure({
      user: { organizationId: "org-1", userId: "user-1" },
      params: { salaryStructureId: "salary-1" },
      body: {
        annualCtc: 1300000,
        metadata: {
          salaryRules: {
            basicPercentSource: "employee"
          }
        }
      }
    });

    assert.equal(result.tenant_id, "tenant-1");
    assert.equal(updateParams[11], "tenant-1");
  } finally {
    delete require.cache[servicePath];
    for (const restore of restores.reverse()) restore();
  }
});

test("updateSalaryStructure rejects closed historical revision updates", async () => {
  const restores = [];
  const servicePath = require.resolve("../src/modules/payroll/payrollApi.service");
  let rolledBack = false;

  const client = {
    async query(sql) {
      if (sql === "BEGIN") return { rows: [] };
      if (sql === "ROLLBACK") {
        rolledBack = true;
        return { rows: [] };
      }

      if (sql.includes("SELECT employee_payroll_profile_id, effective_from, effective_to")) {
        return {
          rows: [
            {
              employee_payroll_profile_id: "profile-1",
              effective_from: "2026-05-14",
              effective_to: "2026-07-30"
            }
          ]
        };
      }

      if (sql.includes("AND effective_from > $4::date")) {
        return { rows: [{ id: "salary-newer" }] };
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
    await assert.rejects(
      () =>
        service.updateSalaryStructure({
          user: { organizationId: "org-1", userId: "user-1" },
          params: { salaryStructureId: "salary-old" },
          body: { annualCtc: 1200000 }
        }),
      (error) => {
        assert.equal(error.code, 409);
        assert.match(error.message, /Can't switch to older revision/);
        return true;
      }
    );
    assert.equal(rolledBack, true);
  } finally {
    delete require.cache[servicePath];
    for (const restore of restores.reverse()) restore();
  }
});
