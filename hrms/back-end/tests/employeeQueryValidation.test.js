const test = require("node:test");
const assert = require("node:assert/strict");

const { listEmployeesQuerySchema } = require("../src/modules/employees/employee.validation");

test("listEmployeesQuerySchema accepts supported filters", () => {
  const { error, value } = listEmployeesQuerySchema.validate({
    page: "1",
    limit: "25",
    sortBy: "firstName",
    sortOrder: "DESC",
    status: "active",
    employeeState: "inactive",
    employmentType: "full_time",
    managerId: "507f1f77bcf86cd799439011",
    departmentId: "507f1f77bcf86cd799439012",
    designationId: "507f1f77bcf86cd799439013",
    organizationId: "507f1f77bcf86cd799439014"
  });

  assert.equal(error, undefined);
  assert.equal(value.sortOrder, "desc");
  assert.equal(value.employeeState, "inactive");
  assert.equal(value.page, 1);
  assert.equal(value.limit, 25);
});

test("listEmployeesQuerySchema rejects unsupported employeeState", () => {
  const { error } = listEmployeesQuerySchema.validate({
    employeeState: "deleted"
  });

  assert.ok(error);
});

test("listEmployeesQuerySchema rejects invalid managerId", () => {
  const { error } = listEmployeesQuerySchema.validate({
    managerId: "not-an-object-id"
  });

  assert.ok(error);
});

test("listEmployeesQuerySchema rejects unsupported sortBy", () => {
  const { error } = listEmployeesQuerySchema.validate({
    sortBy: "roleIds"
  });

  assert.ok(error);
});
