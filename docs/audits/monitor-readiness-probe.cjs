// Offline probes only: no credentials, network calls, or real database writes.
const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const path = require("node:path");
const root = path.resolve(__dirname, "../..");
function load(relative, dependencies) {
  const exports = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, relative), "utf8"), {
    exports, require(name) {
      if (name in dependencies) return dependencies[name];
      throw new Error("Unexpected dependency: " + name);
    }
  });
  return exports;
}
(async () => {
  let response;
  const controller = load("hrms/back-end/src/modules/agent/agent.monitorSettings.controller.js", {
    "./agent.monitorSettings.service": {
      getRawSettings: async () => { throw new Error("Raw settings must not be exposed"); },
      getPublicSettings: async () => ({ cloudName: "test", apiSecretMasked: "masked" })
    },
    "../../utils/responseBuilder": { buildSuccessResponse: value => value },
    "../../realtime/socket": {}
  });
  await controller.getCloudinaryUploadConfig({ user: { organizationId: "org-a" } }, {
    status() { return this; }, json(value) { response = value; return this; }
  });
  assert.equal(response.data.apiSecret, undefined);
  assert.equal(response.data.apiSecretMasked, undefined);
  console.log("FIXED: upload-config controller returns no secret.");

  const complete = require(path.join(root, "hrms/back-end/src/modules/agent/screenshotCompletion.cjs"));
  await assert.rejects(complete({ connect() { throw new Error("Must reject before database access"); } }, {
    batchId: "unknown", deviceId: "unknown"
  }), { statusCode: 404 });
  console.log("FIXED: completion rejects missing ownership context. Run screenshotOwnership.test.js for PostgreSQL isolation coverage.");
})().catch(error => { console.error(error); process.exitCode = 1; });
