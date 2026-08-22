const router = require("express").Router();

const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const asyncHandler = require("../../middlewares/asyncHandler");
const activityService = require("./activity.service");

/**
 * Web-app read API for monitor activity data.
 * Desktop backend owns writes; HRMS reads directly from the monitor Postgres DB.
 */
router.get(
  "/employees",
  auth,
  authorize("EMP_VIEW"),
  asyncHandler(async (req, res) => {
    const date = typeof req.query.date === "string" ? req.query.date : "";
    const data = await activityService.listEmployees({
      organizationId: req.user.organizationId,
      date
    });

    return res.status(200).json({
      success: true,
      code: 200,
      message: "Activity fetched successfully",
      data,
      error: null
    });
  })
);

router.get(
  "/apps",
  auth,
  authorize("EMP_VIEW"),
  asyncHandler(async (req, res) => {
    const date = typeof req.query.date === "string" ? req.query.date : "";
    const limit = Number.isFinite(Number(req.query.limit)) ? Number(req.query.limit) : undefined;
    const offset = Number.isFinite(Number(req.query.offset)) ? Number(req.query.offset) : undefined;
    const appName = typeof req.query.appName === "string" ? req.query.appName : "";
    const processName = typeof req.query.processName === "string" ? req.query.processName : "";
    const employeeId = typeof req.query.employeeId === "string" ? req.query.employeeId : "";
    const data = await activityService.listAppUsage({
      organizationId: req.user.organizationId,
      date,
      limit,
      offset,
      appName,
      processName,
      employeeId
    });

    return res.status(200).json({
      success: true,
      code: 200,
      message: "App usage fetched successfully",
      data,
      error: null
    });
  })
);

router.get(
  "/app-key-usage",
  auth,
  authorize("EMP_VIEW"),
  asyncHandler(async (req, res) => {
    const date = typeof req.query.date === "string" ? req.query.date : "";
    const employeeId = typeof req.query.employeeId === "string" ? req.query.employeeId : "";
    const data = await activityService.listAppKeyUsage({
      organizationId: req.user.organizationId,
      date,
      employeeId
    });

    return res.status(200).json({
      success: true,
      code: 200,
      message: "App key usage fetched successfully",
      data,
      error: null
    });
  })
);

router.get(
  "/browser-history",
  auth,
  authorize("EMP_VIEW"),
  asyncHandler(async (req, res) => {
    const date = typeof req.query.date === "string" ? req.query.date : "";
    const limit = Number.isFinite(Number(req.query.limit)) ? Number(req.query.limit) : undefined;
    const offset = Number.isFinite(Number(req.query.offset)) ? Number(req.query.offset) : undefined;
    const employeeId = typeof req.query.employeeId === "string" ? req.query.employeeId : "";
    const browser = typeof req.query.browser === "string" ? req.query.browser : "";
    const data = await activityService.listBrowserHistory({
      organizationId: req.user.organizationId,
      date,
      limit,
      offset,
      employeeId,
      browser
    });

    return res.status(200).json({
      success: true,
      code: 200,
      message: "Browser history fetched successfully",
      data,
      error: null
    });
  })
);

module.exports = router;
