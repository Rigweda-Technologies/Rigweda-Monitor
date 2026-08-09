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

const buildRes = () => {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
  return res;
};

const runMiddleware = async (mw, req, res) => {
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    try {
      mw(req, res, (err) => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve();
      });
      setImmediate(() => {
        if (res.body !== null) finish();
      });
    } catch (error) {
      reject(error);
    }
  });
};

test("settings API integration: validate + controller success response", async () => {
  const restores = [];
  const controllerPath = require.resolve("../src/modules/payroll/payrollApi.controller");

  restores.push(
    mockModule("../src/modules/payroll/payrollApi.service", {
      upsertSettings: async (req) => ({
        state_code: req.body.stateCode,
        attendance_lock_after_days: req.body.attendanceLockAfterDays
      })
    })
  );
  restores.push(
    mockModule("../src/modules/payroll/payrollRun.service", {
      computePayrollRun: async () => ({ runId: "run-1", status: "processed" })
    })
  );

  delete require.cache[controllerPath];
  const controller = require("../src/modules/payroll/payrollApi.controller");
  const validate = require("../src/middlewares/validate.middleware");
  const { updateSettingsSchema } = require("../src/modules/payroll/payrollApi.validation");

  const req = {
    body: { stateCode: "TS", attendanceLockAfterDays: 7 },
    user: { organizationId: "org-1", userId: "user-1" }
  };
  const res = buildRes();

  try {
    await runMiddleware(validate(updateSettingsSchema), req, res);
    await controller.upsertSettings(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.state_code, "TS");
    assert.equal(res.body.data.attendance_lock_after_days, 7);
  } finally {
    delete require.cache[controllerPath];
    for (const restore of restores.reverse()) restore();
  }
});

test("create run API integration: validation rejects missing required fields", async () => {
  const validate = require("../src/middlewares/validate.middleware");
  const { createPayrollRunSchema } = require("../src/modules/payroll/payrollApi.validation");

  const req = { body: {} };
  const res = buildRes();

  await runMiddleware(validate(createPayrollRunSchema), req, res);

  assert.equal(res.statusCode, 406);
  assert.match(String(res.body.message || ""), /required/);
});

test("compute run API integration: params/body validation + controller response", async () => {
  const restores = [];
  const controllerPath = require.resolve("../src/modules/payroll/payrollRun.controller");

  restores.push(
    mockModule("../src/modules/payroll/payrollRun.service", {
      computePayrollRun: async () => ({ runId: "run-1", status: "processed" })
    })
  );

  delete require.cache[controllerPath];
  const controller = require("../src/modules/payroll/payrollRun.controller");
  const validate = require("../src/middlewares/validate.middleware");
  const {
    computePayrollRunParamsSchema,
    computePayrollRunBodySchema
  } = require("../src/modules/payroll/payrollRun.validation");

  const req = {
    params: { runId: "11111111-1111-4111-8111-111111111111" },
    body: { forceRecompute: false },
    user: { organizationId: "org-1", userId: "user-1" }
  };
  const res = buildRes();

  try {
    await runMiddleware(validate(computePayrollRunParamsSchema, "params"), req, res);
    await runMiddleware(validate(computePayrollRunBodySchema), req, res);
    await controller.computeRun(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.status, "processed");
  } finally {
    delete require.cache[controllerPath];
    for (const restore of restores.reverse()) restore();
  }
});
