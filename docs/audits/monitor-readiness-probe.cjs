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
      getRawSettings: async () => ({ apiSecret: "SYNTHETIC_TEST_SECRET" })
    },
    "../../utils/responseBuilder": { buildSuccessResponse: value => value },
    "../../realtime/socket": {}
  });
  await controller.getCloudinaryUploadConfig({ user: { organizationId: "org-a" } }, {
    status() { return this; }, json(value) { response = value; return this; }
  });
  assert.equal(response.data.apiSecret, "SYNTHETIC_TEST_SECRET");
  console.log("CONFIRMED: upload-config controller returns raw secret.");

  const queries = [];
  const service = load("hrms/back-end/src/modules/agent/agent.monitorUploads.service.js", {
    crypto: require("node:crypto"),
    cloudinary: { v2: {} },
    "../employees/employee.model": {},
    "../../config/monitorDb": {
      getMonitorPgPool: async () => ({
        query: async (sql, values) => { queries.push({ sql, values }); return { rows: [] }; }
      })
    },
    "./agent.monitorSettings.service": {}
  });
  const result = await service.completeUploadSession({
    batchId: "nonexistent-batch",
    payload: { deviceId: "another-device", uploaded: [{
      clientScreenshotId: "another-screenshot",
      cloudinaryUrl: "https://example.invalid/not-uploaded.png"
    }] }
  });
  const update = queries.find(q => q.sql.includes("UPDATE monitor_screenshots"));
  assert.ok(update);
  assert.ok(!update.sql.split("WHERE")[1].includes("organization_id"));
  assert.ok(!update.sql.split("WHERE")[1].includes("batch_id"));
  assert.equal(update.values[5], "https://example.invalid/not-uploaded.png");
  assert.equal(result, null);
  console.log("CONFIRMED: completion writes unverified URL without tenant or batch predicate.");
  console.log("CONFIRMED: zero matching rows returns null without rejecting completion.");
})().catch(error => { console.error(error); process.exitCode = 1; });
