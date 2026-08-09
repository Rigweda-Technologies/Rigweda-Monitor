const { Worker } = require("bullmq");
const connectDB = require("../config/db");
const Organization = require("../modules/organizations/organization.model");
const { applyLeaveCreditsForOrg } = require("../modules/leaveBalances/leaveCredit.service");
const { runCarryForwardForOrg } = require("../modules/leaveCarryForward/leaveCarryForward.service");
const { notifyProbationCompleted } = require("../modules/employees/employeeLifecycle.service");
const { notifyExpiringDocuments } = require("../modules/organizationDocuments/organizationDocuments.service");
const { getQueueConnection } = require("./queue");
const { JOB_QUEUE_NAME, JOBS } = require("./queue.constants");
const { processPayrollRunComputeJob } = require("../modules/payroll/payrollJob.service");
const logger = require("../logger/logger");

const processLeaveCredits = async () => {
  console.log("🟢 Worker: leave credit job started");
  const orgs = await Organization.find({}).select("_id");
  for (const org of orgs) {
    await applyLeaveCreditsForOrg(org._id);
  }
  console.log("✅ Worker: leave credit job completed");
};

const processCarryForward = async () => {
  console.log("🟢 Worker: carry forward job started");
  const orgs = await Organization.find({}).select("_id");
  for (const org of orgs) {
    await runCarryForwardForOrg(org._id);
  }
  console.log("✅ Worker: carry forward job completed");
};

const processProbationCompletion = async () => {
  console.log("🟢 Worker: probation completion job started");
  const count = await notifyProbationCompleted();
  console.log(`✅ Worker: probation completion job completed (${count} employee(s))`);
};

const processOrganizationDocumentExpiry = async () => {
  console.log("🟢 Worker: organization document expiry job started");
  const count = await notifyExpiringDocuments();
  console.log(`✅ Worker: organization document expiry job completed (${count} notification(s))`);
};

const processJob = async (job) => {
  switch (job.name) {
    case JOBS.LEAVE_CREDIT_DAILY:
      return processLeaveCredits();
    case JOBS.LEAVE_CARRY_FORWARD_DAILY:
      return processCarryForward();
    case JOBS.PROBATION_COMPLETION_DAILY:
      return processProbationCompletion();
    case JOBS.ORGANIZATION_DOCUMENT_EXPIRY_DAILY:
      return processOrganizationDocumentExpiry();
    case JOBS.PAYROLL_RUN_COMPUTE:
      return processPayrollRunComputeJob(job);
    default:
      throw new Error(`Unsupported job: ${job.name}`);
  }
};

const startJobWorker = async () => {
  await connectDB();

  const worker = new Worker(JOB_QUEUE_NAME, processJob, {
    connection: getQueueConnection(),
    concurrency: Number(process.env.JOB_WORKER_CONCURRENCY || 1)
  });

  worker.on("ready", () => {
    logger.info("jobs.worker.ready", { queue: JOB_QUEUE_NAME });
  });

  worker.on("completed", (job) => {
    logger.info("jobs.worker.completed", {
      queue: JOB_QUEUE_NAME,
      jobName: job.name,
      jobId: String(job.id),
      attemptsMade: job.attemptsMade
    });
  });

  worker.on("failed", (job, error) => {
    logger.error("jobs.worker.failed", {
      queue: JOB_QUEUE_NAME,
      jobName: job?.name || "unknown",
      jobId: job?.id ? String(job.id) : null,
      attemptsMade: job?.attemptsMade,
      message: error?.message || error
    });
  });

  return worker;
};

if (require.main === module) {
  startJobWorker().catch((error) => {
    logger.error("jobs.worker.start_failed", { message: error?.message || error });
    process.exit(1);
  });
}

module.exports = {
  startJobWorker
};
