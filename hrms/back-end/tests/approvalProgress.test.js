const test = require("node:test");
const assert = require("node:assert/strict");

const { advanceApprovalSteps, getCurrentPendingStep } = require("../src/utils/approvalProgress");
const { canActorApproveStep } = require("../src/utils/approvalFlowEngine");

const baseSteps = () => ([
  {
    stepNumber: 1,
    approverType: "manager",
    approverEmployeeId: "e1",
    approverRoleSlug: null,
    status: "pending"
  },
  {
    stepNumber: 2,
    approverType: "role",
    approverEmployeeId: null,
    approverRoleSlug: "hr",
    status: "queued"
  }
]);

test("advanceApprovalSteps: first approval moves to next queued step", () => {
  const result = advanceApprovalSteps({
    steps: baseSteps(),
    action: "approved",
    actionBy: "actor-1"
  });

  assert.equal(result.finalStatus, "pending");
  assert.equal(result.isIntermediateApproval, true);
  assert.equal(result.currentApprovalStep, 2);
  assert.equal(result.steps[0].status, "approved");
  assert.equal(result.steps[1].status, "pending");
  assert.equal(result.steps[0].actionBy, "actor-1");
});

test("advanceApprovalSteps: final approval marks completed", () => {
  const steps = baseSteps();
  steps[0].status = "approved";
  steps[1].status = "pending";

  const result = advanceApprovalSteps({
    steps,
    action: "approved",
    actionBy: "actor-2"
  });

  assert.equal(result.finalStatus, "approved");
  assert.equal(result.isIntermediateApproval, false);
  assert.equal(result.currentApprovalStep, null);
  assert.equal(result.steps[1].status, "approved");
});

test("advanceApprovalSteps: rejection immediately finalizes", () => {
  const result = advanceApprovalSteps({
    steps: baseSteps(),
    action: "rejected",
    actionBy: "actor-3",
    remarks: "Insufficient details"
  });

  assert.equal(result.finalStatus, "rejected");
  assert.equal(result.isIntermediateApproval, false);
  assert.equal(result.currentApprovalStep, null);
  assert.equal(result.steps[0].status, "rejected");
  assert.equal(result.steps[0].remarks, "Insufficient details");
});

test("canActorApproveStep: employee/manager step matches employee id", () => {
  const step = {
    approverType: "manager",
    approverEmployeeId: "emp-10"
  };
  assert.equal(canActorApproveStep(step, { actorEmployeeId: "emp-10", actorRoleSlug: null }), true);
  assert.equal(canActorApproveStep(step, { actorEmployeeId: "emp-11", actorRoleSlug: null }), false);
});

test("canActorApproveStep: role step matches active role slug", () => {
  const step = {
    approverType: "role",
    approverRoleSlug: "hr"
  };
  assert.equal(canActorApproveStep(step, { actorEmployeeId: null, actorRoleSlug: "hr" }), true);
  assert.equal(canActorApproveStep(step, { actorEmployeeId: null, actorRoleSlug: "manager" }), false);
});

test("getCurrentPendingStep returns the pending entry", () => {
  const step = getCurrentPendingStep(baseSteps());
  assert.equal(step.stepNumber, 1);
});
