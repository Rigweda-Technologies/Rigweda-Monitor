const Joi = require("joi");
const service = require("./agent.health.service");
const { buildSuccessResponse } = require("../../utils/responseBuilder");

const healthSchema = Joi.object({
  deviceId: Joi.string().trim().max(200).required(),
  hostname: Joi.string().trim().max(255).allow("", null),
  platform: Joi.string().trim().max(100).allow("", null),
  platformVersion: Joi.string().trim().max(255).allow("", null),
  agentVersion: Joi.string().trim().max(100).allow("", null),
  cpuModel: Joi.string().trim().max(255).allow("", null),
  cpuPercent: Joi.number().min(0).max(100).allow(null),
  memoryTotalBytes: Joi.number().integer().min(0).allow(null),
  memoryUsedBytes: Joi.number().integer().min(0).allow(null),
  memoryPercent: Joi.number().min(0).max(100).allow(null),
  disks: Joi.array().items(Joi.object({
    mount: Joi.string().trim().max(255).required(),
    filesystem: Joi.string().trim().max(100).allow("", null),
    totalBytes: Joi.number().integer().min(0).allow(null),
    usedBytes: Joi.number().integer().min(0).allow(null),
    freeBytes: Joi.number().integer().min(0).allow(null),
    usedPercent: Joi.number().min(0).max(100).allow(null)
  }).unknown(false)).max(20),
  temperatureC: Joi.number().min(-50).max(150).allow(null),
  batteryPercent: Joi.number().min(0).max(100).allow(null),
  batteryCharging: Joi.boolean().allow(null),
  uptimeSeconds: Joi.number().integer().min(0).allow(null),
  reportedAt: Joi.date().iso().allow(null)
}).unknown(false);

exports.postHealth = async (req, res) => {
  const { error, value } = healthSchema.validate(req.body || {}, { abortEarly: false, stripUnknown: true });
  if (error) {
    return res.status(400).json(buildSuccessResponse({
      code: 400,
      message: "Invalid laptop health payload",
      data: { fields: error.details.map((detail) => detail.path.join(".")) }
    }));
  }

  const data = await service.saveHealth({ req, payload: value });
  return res.status(200).json(buildSuccessResponse({ code: 200, message: "Laptop health saved", data }));
};
