const router = require("express").Router();

const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const asyncHandler = require("../../middlewares/asyncHandler");

const monitorApiBaseUrl = () =>
  String(process.env.MONITOR_API_BASE_URL || "https://rigweda-monitor-backend.vercel.app/api").replace(/\/+$/, "");

/**
 * Web-app API facade for activity data.
 * Activity events remain stored by desktop/backend; this route forwards the
 * signed-in HRMS user's token rather than exposing a second browser API host.
 */
router.get(
  "/employees",
  auth,
  authorize("EMP_VIEW"),
  asyncHandler(async (req, res) => {
    const date = typeof req.query.date === "string" ? req.query.date : "";
    const query = date ? `?date=${encodeURIComponent(date)}` : "";
    const response = await fetch(`${monitorApiBaseUrl()}/activity/employees${query}`, {
      headers: {
        Authorization: req.headers.authorization,
        Accept: "application/json"
      },
      signal: AbortSignal.timeout(15_000)
    });

    const body = await response.json().catch(() => ({
      success: false,
      message: "Monitor API returned an invalid response."
    }));

    return res.status(response.status).json(body);
  })
);

module.exports = router;
