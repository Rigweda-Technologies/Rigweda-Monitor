const JOB_QUEUE_NAME = process.env.JOB_QUEUE_NAME || "upanaya-system-jobs";

const JOBS = {
  LEAVE_CREDIT_DAILY: "leave-credit-daily",
  LEAVE_CARRY_FORWARD_DAILY: "leave-carry-forward-daily",
  PROBATION_COMPLETION_DAILY: "probation-completion-daily",
  ORGANIZATION_DOCUMENT_EXPIRY_DAILY: "organization-document-expiry-daily",
  PAYROLL_RUN_COMPUTE: "payroll-run-compute"
};

module.exports = {
  JOB_QUEUE_NAME,
  JOBS
};
