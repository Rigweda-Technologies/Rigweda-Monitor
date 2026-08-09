const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createDesignationSchema,
  updateDesignationSchema
} = require("../src/modules/designations/designation.validation");

test("createDesignationSchema accepts ampersand in designation name", () => {
  const { error } = createDesignationSchema.validate({
    name: "R&D Manager",
    departmentId: "dept-1",
    status: "active"
  });
  assert.equal(error, undefined);
});

test("updateDesignationSchema accepts ampersand in designation name", () => {
  const { error } = updateDesignationSchema.validate({
    name: "Sales & Marketing",
    departmentId: "dept-1",
    status: "active"
  });
  assert.equal(error, undefined);
});

test("createDesignationSchema accepts hyphen in designation name", () => {
  const { error } = createDesignationSchema.validate({
    name: "Vice-President",
    departmentId: "dept-1",
    status: "active"
  });
  assert.equal(error, undefined);
});

test("createDesignationSchema rejects unsupported symbols in designation name", () => {
  const { error } = createDesignationSchema.validate({
    name: "QA/Dev",
    departmentId: "dept-1",
    status: "active"
  });
  assert.ok(error);
});
