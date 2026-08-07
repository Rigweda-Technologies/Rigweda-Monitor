const test = require("node:test");
const assert = require("node:assert/strict");
const {EmployeeService} = require("../src/modules/employees/employee.service");

const employee = {id: "employee-1", employmentStatus: "active", version: 1};

test("employee listing returns stable pagination", async () => {
  const repository = {list: async () => ({items: [employee], total: 41})};
  const result = await new EmployeeService(repository).list("org-1", {page: 2, pageSize: 20});
  assert.equal(result.page, 2);
  assert.equal(result.totalPages, 3);
});

test("employee creation rejects future dates of birth", async () => {
  const service = new EmployeeService({});
  await assert.rejects(
    () => service.create("org-1", {dateOfBirth: "2999-01-01"}, "user-1"),
    (error) => error.code === "DATE_INVALID" && error.statusCode === 422
  );
});

test("employee creation rejects multiple primary emergency contacts", async () => {
  const service = new EmployeeService({});
  await assert.rejects(
    () => service.create("org-1", {emergencyContacts: [{isPrimary: true},{isPrimary: true}]}, "user-1"),
    (error) => error.code === "PRIMARY_CONTACT_CONFLICT"
  );
});

test("employee references are organization scoped", async () => {
  const repository = {create: async () => ({error: "reference", field: "departmentId"})};
  const service = new EmployeeService(repository);
  await assert.rejects(
    () => service.create("org-1", {}, "user-1"),
    (error) => error.code === "REFERENCE_INVALID" && error.details[0].field === "departmentId"
  );
});

test("reporting cycles are rejected", async () => {
  const repository = {update: async () => ({error: "manager_cycle"})};
  const service = new EmployeeService(repository);
  await assert.rejects(
    () => service.update("org-1", "employee-1", {}, "user-1"),
    (error) => error.code === "REPORTING_CYCLE"
  );
});

test("invalid employee lifecycle transitions are rejected", async () => {
  const repository = {findById: async () => employee};
  const service = new EmployeeService(repository);
  await assert.rejects(
    () => service.changeStatus("org-1", employee.id, {status: "preboarding"}, "user-1"),
    (error) => error.code === "STATUS_TRANSITION_INVALID"
  );
});

test("termination requires a reason", async () => {
  const repository = {findById: async () => employee};
  const service = new EmployeeService(repository);
  await assert.rejects(
    () => service.changeStatus("org-1", employee.id, {status: "terminated"}, "user-1"),
    (error) => error.code === "TERMINATION_REASON_REQUIRED"
  );
});

test("CSV exports neutralize spreadsheet formulas", async () => {
  const repository = {exportRows: async () => [{employeeNumber: "=1+1", name: "Person"}]};
  const csv = await new EmployeeService(repository).exportCsv("org-1", {});
  assert.match(csv, /"'=1\+1"/);
});

test("organization tree nests direct reports under their manager",async()=>{
  const repository={treeRows:async()=>[{id:"manager",managerEmployeeId:null},{id:"report",managerEmployeeId:"manager"}]};
  const tree=await new EmployeeService(repository).organizationTree("org-1");
  assert.equal(tree.length,1);assert.equal(tree[0].reports[0].id,"report");
});

test("sensitive identifier values are protected before persistence",async()=>{
  let persisted;const repository={create:async(_org,data)=>{persisted=data;return employee;}};
  const encryption={protect:()=>({ciphertext:Buffer.from("cipher"),iv:Buffer.from("iv"),authTag:Buffer.from("tag"),maskedValue:"••••1234"})};
  await new EmployeeService(repository,encryption).create("org-1",{identifiers:[{identifierType:"tax",identifierValue:"ABCD1234",country:"IN"}]},"user-1");
  assert.equal(persisted.identifiers[0].identifierValue,undefined);assert.equal(persisted.identifiers[0].maskedValue,"••••1234");
});
