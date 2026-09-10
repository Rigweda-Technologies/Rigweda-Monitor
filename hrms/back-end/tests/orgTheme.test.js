const test = require("node:test");
const assert = require("node:assert/strict");
const OrgSettings = require("../src/modules/orgSettings/orgSettings.model");
const service = require("../src/modules/orgSettings/orgSettings.service");
const { updateThemeSchema } = require("../src/modules/orgSettings/orgSettings.validation");

test("theme reads use authenticated organization and expose only appearance branding", async (t) => {
  t.mock.method(OrgSettings, "findOne", (filter) => {
    assert.deepEqual(filter, { organizationId: "org-a" });
    return { select(projection) {
      assert.equal(projection, "logoUrl themeMode themePreset themeConfig -_id");
      return { lean: async () => ({ logoUrl: "https://cdn.example.com/logo.png", themePreset: "forest" }) };
    } };
  });
  assert.deepEqual(await service.getTheme({
    user: { organizationId: "org-a" }, query: { organizationId: "org-b" }
  }), { logoUrl: "https://cdn.example.com/logo.png", themePreset: "forest" });
});

test("theme requires an organization", async () => {
  await assert.rejects(service.getTheme({ user: {} }), { statusCode: 403 });
  await assert.rejects(service.updateTheme({ user: {}, body: {} }), { statusCode: 403 });
});

test("theme saves do not overwrite other organization settings", async (t) => {
  const body = { themeMode: "preset", themePreset: "forest", themeConfig: {} };
  t.mock.method(OrgSettings, "findOneAndUpdate", (filter, update, options) => {
    assert.deepEqual(filter, { organizationId: "org-a" });
    assert.deepEqual(update, { $set: body });
    assert.equal(options.runValidators, true);
    return { select: () => ({ lean: async () => body }) };
  });
  assert.deepEqual(await service.updateTheme({
    user: { organizationId: "org-a" }, body: { ...body, payrollEnabled: false }
  }), body);
});

test("theme payload rejects unrelated settings and invalid presets", () => {
  assert.ok(updateThemeSchema.validate({ payrollEnabled: true }).error);
  assert.ok(updateThemeSchema.validate({ themePreset: "invalid" }).error);
  assert.equal(updateThemeSchema.validate({
    themePreset: "forest", themeConfig: { sidebarGradientStart: "#123456" }
  }).error, undefined);
});
