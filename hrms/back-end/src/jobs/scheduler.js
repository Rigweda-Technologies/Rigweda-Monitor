const { getJobQueue } = require("./queue");
const { JOBS } = require("./queue.constants");

const repeatableJobs = [
  {
    name: JOBS.LEAVE_CREDIT_DAILY,
    cron: process.env.JOB_CRON_LEAVE_CREDIT || "0 0 * * *"
  },
  {
    name: JOBS.LEAVE_CARRY_FORWARD_DAILY,
    cron: process.env.JOB_CRON_LEAVE_CARRY_FORWARD || "0 0 * * *"
  },
  {
    name: JOBS.PROBATION_COMPLETION_DAILY,
    cron: process.env.JOB_CRON_PROBATION_COMPLETION || "0 0 * * *"
  },
  {
    name: JOBS.ORGANIZATION_DOCUMENT_EXPIRY_DAILY,
    cron: process.env.JOB_CRON_ORGANIZATION_DOCUMENT_EXPIRY || "30 8 * * *"
  }
];

const startJobScheduler = async () => {
  const queue = getJobQueue();

  for (const jobDef of repeatableJobs) {
    await queue.add(
      jobDef.name,
      {},
      {
        jobId: `repeat:${jobDef.name}`,
        repeat: { pattern: jobDef.cron }
      }
    );
  }

  console.log("✅ BullMQ job scheduler started");
};

if (require.main === module) {
  startJobScheduler().catch((error) => {
    console.error("❌ Failed to start job scheduler:", error?.message || error);
    process.exit(1);
  });
}

module.exports = {
  startJobScheduler
};
