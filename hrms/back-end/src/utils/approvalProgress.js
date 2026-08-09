const toPlainStep = (step) => {
  if (!step) return {};
  if (typeof step.toObject === "function") {
    return step.toObject();
  }
  if (step._doc && typeof step._doc === "object") {
    return { ...step._doc };
  }
  return { ...step };
};

const cloneSteps = (steps = []) =>
  (steps || []).map((step) => {
    const s = toPlainStep(step);
    return {
      ...s,
      approverEmployeeId: s.approverEmployeeId || null,
      approverRoleSlug: s.approverRoleSlug || null,
      actionBy: s.actionBy || null,
      actionByName: s.actionByName || null,
      actionAt: s.actionAt || null,
      remarks: s.remarks || null
    };
  });

const sortByStep = (steps = []) =>
  [...steps].sort((a, b) => Number(a.stepNumber || 0) - Number(b.stepNumber || 0));

const getCurrentPendingStep = (steps = []) =>
  (steps || []).find((s) => s.status === "pending") || null;

exports.getCurrentPendingStep = getCurrentPendingStep;

exports.resolveCurrentPendingStep = ({
  steps = [],
  currentApprovalStep = null
}) => {
  const nextSteps = sortByStep(cloneSteps(steps));
  const existingPending = getCurrentPendingStep(nextSteps);
  if (existingPending) {
    return {
      steps: nextSteps,
      currentStep: existingPending,
      currentApprovalStep: existingPending.stepNumber || currentApprovalStep || null,
      repaired: false
    };
  }

  if (currentApprovalStep != null) {
    const indexedStep = nextSteps.find(
      (step) => Number(step.stepNumber || 0) === Number(currentApprovalStep)
    );
    if (indexedStep && indexedStep.status !== "approved" && indexedStep.status !== "rejected") {
      indexedStep.status = "pending";
      return {
        steps: nextSteps,
        currentStep: indexedStep,
        currentApprovalStep: indexedStep.stepNumber || null,
        repaired: true
      };
    }
  }

  const fallbackStep = nextSteps.find(
    (step) => step.status !== "approved" && step.status !== "rejected"
  );
  if (!fallbackStep) {
    return {
      steps: nextSteps,
      currentStep: null,
      currentApprovalStep: null,
      repaired: false
    };
  }

  fallbackStep.status = "pending";
  return {
    steps: nextSteps,
    currentStep: fallbackStep,
    currentApprovalStep: fallbackStep.stepNumber || null,
    repaired: true
  };
};

exports.advanceApprovalSteps = ({
  steps = [],
  action,
  actionBy = null,
  actionByName = null,
  remarks = null
}) => {
  const normalizedAction = String(action || "").toLowerCase();
  if (!["approved", "rejected"].includes(normalizedAction)) {
    throw new Error("Invalid approval action");
  }

  const nextSteps = sortByStep(cloneSteps(steps));
  if (!nextSteps.length) {
    return {
      steps: [],
      finalStatus: normalizedAction,
      isIntermediateApproval: false,
      currentApprovalStep: null
    };
  }

  const pendingIndex = nextSteps.findIndex((s) => s.status === "pending");
  if (pendingIndex === -1) {
    throw new Error("No pending approval step found");
  }

  const pendingStep = nextSteps[pendingIndex];
  pendingStep.actionBy = actionBy || null;
  pendingStep.actionByName = actionByName || null;
  pendingStep.actionAt = new Date();
  pendingStep.remarks = remarks || null;

  if (normalizedAction === "rejected") {
    pendingStep.status = "rejected";
    return {
      steps: nextSteps,
      finalStatus: "rejected",
      isIntermediateApproval: false,
      currentApprovalStep: null
    };
  }

  pendingStep.status = "approved";
  const queuedIndex = nextSteps.findIndex((s) => s.status === "queued");
  if (queuedIndex === -1) {
    return {
      steps: nextSteps,
      finalStatus: "approved",
      isIntermediateApproval: false,
      currentApprovalStep: null
    };
  }

  nextSteps[queuedIndex].status = "pending";
  return {
    steps: nextSteps,
    finalStatus: "pending",
    isIntermediateApproval: true,
    currentApprovalStep: nextSteps[queuedIndex].stepNumber
  };
};
