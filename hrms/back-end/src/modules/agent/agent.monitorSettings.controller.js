const service = require("./agent.monitorSettings.service");
const { buildSuccessResponse } = require("../../utils/responseBuilder");

const validatePayload = (body) => {
  const cloudName = String(body.cloudName || "").trim();
  const apiKey = String(body.apiKey || "").trim();
  const apiSecret = String(body.apiSecret || "").trim();
  const uploadFolderRoot = String(body.uploadFolderRoot || "rigweda-monitor").trim();

  if (!cloudName || !apiKey || !apiSecret) {
    throw { code: 400, message: "Cloud name, API key, and API secret are required." };
  }

  return { cloudName, apiKey, apiSecret, uploadFolderRoot };
};

exports.getCloudinarySettings = async (req, res) => {
  const data = await service.getPublicSettings(req.user.organizationId);
  return res.status(200).json(buildSuccessResponse({
    code: 200,
    message: "Cloudinary settings fetched successfully",
    data
  }));
};

exports.saveCloudinarySettings = async (req, res) => {
  const payload = validatePayload(req.body || {});
  const data = await service.saveSettings(req.user.organizationId, payload);
  return res.status(200).json(buildSuccessResponse({
    code: 200,
    message: "Cloudinary settings saved successfully",
    data
  }));
};

exports.testCloudinarySettings = async (req, res) => {
  const payload = validatePayload(req.body || {});
  await service.testSettings(payload);
  return res.status(200).json(buildSuccessResponse({
    code: 200,
    message: "Cloudinary connection verified",
    data: { ok: true }
  }));
};

exports.getCloudinaryUploadConfig = async (req, res) => {
  const data = await service.getRawSettings(req.user.organizationId);
  if (!data) {
    throw { code: 404, message: "Cloudinary monitor settings are not configured for this organization." };
  }
  return res.status(200).json(buildSuccessResponse({
    code: 200,
    message: "Cloudinary upload config fetched successfully",
    data
  }));
};
