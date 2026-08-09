const crypto = require("crypto");
const logger = require("../../logger/logger");
const { getJobQueue } = require("../../jobs/queue");
const { JOBS } = require("../../jobs/queue.constants");
const payrollRunService = require("./payrollRun.service");

const buildComputeFingerprint = ({ runId, body }) => {
  const payload = {
    runId: String(runId),
    forceRecompute: Boolean(body?.forceRecompute),
    employeeIds: Array.isArray(body?.employeeIds) ? [...body.employeeIds].map(String).sort() : []
  };

  return crypto.createHash("sha1").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
};

exports.enqueuePayrollRunComputeJob = async (req) => {
  const queue = getJobQueue();
  const runId = String(req.params.runId);
  const fingerprint = buildComputeFingerprint({ runId, body: req.body || {} });
  const idempotencyKey = req.idempotencyKey || req.headers?.["idempotency-key"] || null;

  const jobId = `payroll:compute:${runId}:${fingerprint}`;

  const job = await queue.add(
    JOBS.PAYROLL_RUN_COMPUTE,
    {
      runId,
      body: req.body || {},
      user: {
        userId: String(req.user.userId),
        organizationId: String(req.user.organizationId),
        activeRoleId: req.user.activeRoleId ? String(req.user.activeRoleId) : null
      },
      idempotencyKey: idempotencyKey ? String(idempotencyKey) : null,
      requestMeta: {
        requestedAt: new Date().toISOString(),
        requestPath: req.originalUrl || req.path || ""
      }
    },
    {
      jobId,
      attempts: Number(process.env.PAYROLL_COMPUTE_JOB_ATTEMPTS || 5),
      backoff: {
        type: "exponential",
        delay: Number(process.env.PAYROLL_COMPUTE_JOB_BACKOFF_MS || 5000)
      },
      removeOnComplete: Number(process.env.PAYROLL_COMPUTE_JOB_KEEP_COMPLETED || 1000),
      removeOnFail: Number(process.env.PAYROLL_COMPUTE_JOB_KEEP_FAILED || 2000)
    }
  );

  logger.info("payroll.compute.job.enqueued", {
    runId,
    jobId: job.id,
    queueJobId: jobId,
    userId: String(req.user.userId),
    organizationId: String(req.user.organizationId)
  });

  return {
    jobId: String(job.id),
    queueJobId: jobId,
    runId,
    status: "queued"
  };
};

exports.processPayrollRunComputeJob = async (job) => {
  const startedAt = Date.now();
  const { runId, body = {}, user = {}, idempotencyKey = null } = job.data || {};

  const req = {
    params: { runId: String(runId) },
    body: {
      ...(body || {}),
      _executionMode: "async_job"
    },
    user: {
      userId: user.userId,
      organizationId: user.organizationId,
      activeRoleId: user.activeRoleId || null
    },
    headers: idempotencyKey ? { "idempotency-key": String(idempotencyKey) } : {}
  };

  logger.info("payroll.compute.job.started", {
    runId,
    jobId: String(job.id),
    attempt: Number(job.attemptsMade || 0) + 1
  });

  try {
    const result = await payrollRunService.computePayrollRun(req);
    logger.info("payroll.compute.job.completed", {
      runId,
      jobId: String(job.id),
      durationMs: Date.now() - startedAt,
      status: result?.status
    });

    return result;
  } catch (error) {
    logger.error("payroll.compute.job.failed", {
      runId,
      jobId: String(job.id),
      durationMs: Date.now() - startedAt,
      message: error?.message || error
    });

    throw error;
  }
};
