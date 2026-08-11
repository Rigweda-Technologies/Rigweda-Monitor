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

module.exports = router;
