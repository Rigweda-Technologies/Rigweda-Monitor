const service = require("./monitorUpdates.service");
const { buildSuccessResponse, buildFailureResponse } = require("../../utils/responseBuilder");

exports.listReleases = async (req, res) => {
  try {
    const data = await service.listReleases();
    return res.status(200).json(buildSuccessResponse({ code: 200, message: "Release list fetched successfully", data }));
  } catch (error) {
    return res.status(error?.code || 500).json(
      buildFailureResponse({
        code: error?.code || 500,
        message: error?.message || "Failed to fetch releases",
        error: error?.message || error
      })
    );
  }
};

exports.createRelease = async (req, res) => {
  try {
    const data = await service.createRelease(req.body || {});
    return res.status(201).json(buildSuccessResponse({ code: 201, message: "Release created successfully", data }));
  } catch (error) {
    return res.status(error?.code || 500).json(
      buildFailureResponse({
        code: error?.code || 500,
        message: error?.message || "Failed to create release",
        error: error?.message || error
      })
    );
  }
};

exports.activateRelease = async (req, res) => {
  try {
    const data = await service.activateRelease({
      releaseId: req.params.releaseId,
      status: req.body?.status,
      rolloutPercentage: req.body?.rolloutPercentage
    });
    return res.status(200).json(buildSuccessResponse({ code: 200, message: "Release updated successfully", data }));
  } catch (error) {
    return res.status(error?.code || 500).json(
      buildFailureResponse({
        code: error?.code || 500,
        message: error?.message || "Failed to update release",
        error: error?.message || error
      })
    );
  }
};

exports.getLatest = async (req, res) => {
  try {
    const data = await service.getLatestRelease({
      deviceId: req.headers["x-device-id"] || req.body?.deviceId || "unknown-device",
      appVersion: req.headers["x-app-version"] || req.query.version || req.body?.appVersion
    });
    return res.status(200).json(buildSuccessResponse({ code: 200, message: "Update check completed", data }));
  } catch (error) {
    return res.status(error?.code || 500).json(
      buildFailureResponse({
        code: error?.code || 500,
        message: error?.message || "Failed to check for updates",
        error: error?.message || error
      })
    );
  }
};

exports.postStatus = async (req, res) => {
  try {
    const data = await service.recordUpdateStatus(req.body || {});
    return res.status(200).json(buildSuccessResponse({ code: 200, message: "Update status saved", data }));
  } catch (error) {
    return res.status(error?.code || 500).json(
      buildFailureResponse({
        code: error?.code || 500,
        message: error?.message || "Failed to save update status",
        error: error?.message || error
      })
    );
  }
};
