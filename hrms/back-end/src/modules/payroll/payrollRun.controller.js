const service = require("./payrollRun.service");
const { buildSuccessResponse } = require("../../utils/responseBuilder");
const { enqueuePayrollRunComputeJob } = require("./payrollJob.service");
const { executeIdempotentPayrollAction } = require("./payrollIdempotency.service");

exports.computeRun = async (req, res) => {
  const runId = String(req.params.runId);
  const asyncRequested =
    req.body?.async === true || process.env.PAYROLL_COMPUTE_ASYNC_DEFAULT === "true";

  const data = await executeIdempotentPayrollAction({
    req,
    actionKey: "payroll_run_compute",
    runId,
    resolver: async () => {
      if (asyncRequested) {
        return enqueuePayrollRunComputeJob(req);
      }

      req.body = {
        ...(req.body || {}),
        _executionMode: "sync"
      };
      return service.computePayrollRun(req);
    }
  });

  const statusCode = asyncRequested ? 202 : 200;
  return res.status(statusCode).json(
    buildSuccessResponse({
      message: asyncRequested
        ? "Payroll run queued for async compute"
        : "Payroll run computed successfully",
      data
    })
  );
};
