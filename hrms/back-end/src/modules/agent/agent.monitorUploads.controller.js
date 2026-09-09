const Joi = require("joi");
const service = require("./agent.monitorUploads.service");
const { buildSuccessResponse } = require("../../utils/responseBuilder");

const uploadSessionSchema = Joi.object({
  batchId: Joi.string().trim().required(),
  deviceId: Joi.string().trim().required(),
  screenshots: Joi.array().items(
    Joi.object({
      clientScreenshotId: Joi.string().trim().required(),
      capturedAt: Joi.date().iso().required(),
      originalFileName: Joi.string().trim().required(),
      mimeType: Joi.string().trim().valid("image/png", "image/jpeg", "image/webp").required(),
      sha256: Joi.string().hex().length(64).required(),
      sizeBytes: Joi.number().integer().positive().required(),
      width: Joi.number().integer().positive().optional(),
      height: Joi.number().integer().positive().optional()
    })
  ).min(1).max(100).required()
});

const completeSessionSchema = Joi.object({
  deviceId: Joi.string().trim().required(),
  uploaded: Joi.array().items(
    Joi.object({
      clientScreenshotId: Joi.string().trim().required(),
      cloudinaryPublicId: Joi.string().trim().required(),
      cloudinaryAssetId: Joi.string().trim().allow(null, ""),
      cloudinaryVersion: Joi.number().integer().optional(),
      cloudinaryFormat: Joi.string().trim().allow(null, ""),
      cloudinaryUrl: Joi.string().uri().required(),
      sizeBytes: Joi.number().integer().positive().optional()
    })
  ).default([]),
  duplicates: Joi.array().items(
    Joi.object({
      clientScreenshotId: Joi.string().trim().required(),
      duplicateOf: Joi.string().trim().required()
    })
  ).default([])
});

const validate = (schema, payload) => {
  const { error, value } = schema.validate(payload || {}, {
    abortEarly: false,
    stripUnknown: true
  });
  if (error) {
    throw {
      code: 400,
      message: "Validation failed",
      error: error.details.map((item) => ({
        field: item.path.join(".") || "body",
        message: item.message,
        type: item.type
      }))
    };
  }
  return value;
};

exports.createUploadSession = async (req, res) => {
  const payload = validate(uploadSessionSchema, req.body);
  const data = await service.createUploadSession({ req, payload });
  return res.status(201).json(buildSuccessResponse({
    code: 201,
    message: "Cloudinary upload session created successfully",
    data
  }));
};

exports.completeUploadSession = async (req, res) => {
  const payload = validate(completeSessionSchema, req.body);
  const data = await service.completeUploadSession({
    req,
    batchId: req.params.batchId,
    payload
  });
  return res.status(200).json(buildSuccessResponse({
    code: 200,
    message: "Cloudinary upload session completed successfully",
    data
  }));
};
