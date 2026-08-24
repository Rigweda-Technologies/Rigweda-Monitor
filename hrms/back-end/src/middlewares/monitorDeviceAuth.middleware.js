const crypto = require("crypto");

const timingSafeEqual = (left, right) => {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

module.exports = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const configuredToken = String(process.env.MONITOR_DEVICE_ACCESS_TOKEN || "").trim();

    if (!token || !configuredToken || !timingSafeEqual(token, configuredToken)) {
      return res.status(401).json({
        success: false,
        code: 401,
        message: "Monitor device authorization failed",
        data: null,
        error: null
      });
    }

    const deviceId = String(req.headers["x-device-id"] || "").trim();
    if (!deviceId) {
      return res.status(400).json({
        success: false,
        code: 400,
        message: "X-Device-ID header is required",
        data: null,
        error: null
      });
    }

    req.device = {
      deviceId,
      appVersion: String(req.headers["x-app-version"] || "").trim() || null
    };

    return next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      code: 401,
      message: "Monitor device authorization failed",
      data: null,
      error: error?.message || "Invalid device token"
    });
  }
};
