const service = require("./agent.monitorSettings.service");
const { buildSuccessResponse } = require("../../utils/responseBuilder");
const { emitMonitorSettingsUpdate } = require("../../realtime/socket");

const parseBoolean = (value, fallback = true) => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const validatePayload = (body) => {
  const cloudName = String(body.cloudName || "").trim();
  const apiKey = String(body.apiKey || "").trim();
  const apiSecret = String(body.apiSecret || "").trim();
  const uploadFolderRoot = String(body.uploadFolderRoot || "rigweda-monitor").trim();
  const screenshotsEnabled = parseBoolean(body.screenshotsEnabled, true);
  const mouseEnabled = parseBoolean(body.mouseEnabled, true);
  const keyboardEnabled = parseBoolean(body.keyboardEnabled, true);
  const appUsageEnabled = parseBoolean(body.appUsageEnabled, true);
  const browserHistoryEnabled = parseBoolean(body.browserHistoryEnabled, false);
  const usbEnabled = parseBoolean(body.usbEnabled, true);
  const screenshotIntervalMinutes = Math.max(Math.trunc(Number(body.screenshotIntervalMinutes) || 1), 1);
  const mouseHeartbeatMinutes = Math.max(Math.trunc(Number(body.mouseHeartbeatMinutes) || 1), 1);
  const mouseIdleThresholdMinutes = Math.max(Math.trunc(Number(body.mouseIdleThresholdMinutes) || 1), 1);
  const keyboardHeartbeatMinutes = Math.max(Math.trunc(Number(body.keyboardHeartbeatMinutes) || 1), 1);
  const appUsageHeartbeatMinutes = Math.max(Math.trunc(Number(body.appUsageHeartbeatMinutes) || 1), 1);
  const browserHistorySyncMinutes = Math.max(Math.trunc(Number(body.browserHistorySyncMinutes) || 1), 1);

  if (!cloudName || !apiKey) {
    throw { code: 400, message: "Cloud name and API key are required." };
  }

  return {
    cloudName,
    apiKey,
    apiSecret,
    uploadFolderRoot,
    screenshotsEnabled,
    mouseEnabled,
    keyboardEnabled,
    appUsageEnabled,
    browserHistoryEnabled,
    usbEnabled,
    screenshotIntervalMinutes,
    mouseHeartbeatMinutes,
    mouseIdleThresholdMinutes,
    keyboardHeartbeatMinutes,
    appUsageHeartbeatMinutes,
    browserHistorySyncMinutes
  };
};

const validateTestPayload = (body) => {
  const payload = validatePayload(body);
  if (!payload.apiSecret) {
    throw { code: 400, message: "API secret is required to test Cloudinary settings." };
  }
  return payload;
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
  emitMonitorSettingsUpdate({ organizationId: req.user.organizationId }, {
    settings: data,
    updatedAt: data.updatedAt,
    source: "cloudinary-settings-save"
  });
  return res.status(200).json(buildSuccessResponse({
    code: 200,
    message: "Cloudinary settings saved successfully",
    data
  }));
};

exports.testCloudinarySettings = async (req, res) => {
  const payload = validateTestPayload(req.body || {});
  await service.testSettings(payload);
  return res.status(200).json(buildSuccessResponse({
    code: 200,
    message: "Cloudinary connection verified",
    data: { ok: true }
  }));
};

exports.getCloudinaryUploadConfig = async (req, res) => {
  const settings = await service.getPublicSettings(req.user.organizationId);
  if (!settings) {
    throw { code: 404, message: "Cloudinary monitor settings are not configured for this organization." };
  }
  const { apiSecretMasked, ...data } = settings;
  return res.status(200).json(buildSuccessResponse({
    code: 200,
    message: "Cloudinary upload config fetched successfully",
    data
  }));
};

exports.getUsbControlConfig = async (req, res) => {
  const data = await service.getUsbControlConfig(req.user.organizationId);
  if (!data) {
    throw { code: 404, message: "USB monitor settings are not configured for this organization." };
  }
  return res.status(200).json(buildSuccessResponse({
    code: 200,
    message: "USB control config fetched successfully",
    data
  }));
};
