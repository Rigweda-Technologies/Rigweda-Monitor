import Joi from "joi";

export const createScreenshotSchema = Joi.object({
  employeeId: Joi.string().trim().required(),
  capturedAt: Joi.date().iso().required(),
  dateFolder: Joi.string().pattern(/^\d{4}_\d{2}_\d{2}$/).required(),
  screenshot: Joi.object({
    filename: Joi.string().trim().required(),
    mimetype: Joi.string().trim().required(),
    buffer: Joi.binary().required(),
    fileSize: Joi.number().integer().positive().required(),
  }).required(),
});

export const createUploadSessionSchema = Joi.object({
  batchId: Joi.string().trim().required(),
  deviceId: Joi.string().trim().required(),
  screenshots: Joi.array()
    .items(
      Joi.object({
        clientScreenshotId: Joi.string().trim().required(),
        capturedAt: Joi.date().iso().required(),
        originalFileName: Joi.string().trim().required(),
        mimeType: Joi.string().trim().valid("image/png", "image/jpeg", "image/webp").required(),
        sha256: Joi.string().hex().length(64).required(),
        sizeBytes: Joi.number().integer().positive().required(),
        width: Joi.number().integer().positive().optional(),
        height: Joi.number().integer().positive().optional(),
      })
    )
    .min(1)
    .max(100)
    .required(),
});

export const completeUploadSessionSchema = Joi.object({
  deviceId: Joi.string().trim().required(),
  uploaded: Joi.array()
    .items(
      Joi.object({
        clientScreenshotId: Joi.string().trim().required(),
        cloudinaryPublicId: Joi.string().trim().required(),
        cloudinaryAssetId: Joi.string().trim().allow(null, ""),
        cloudinaryVersion: Joi.number().integer().optional(),
        cloudinaryFormat: Joi.string().trim().allow(null, ""),
        cloudinaryUrl: Joi.string().uri().required(),
        sizeBytes: Joi.number().integer().positive().optional(),
      })
    )
    .default([]),
  duplicates: Joi.array()
    .items(
      Joi.object({
        clientScreenshotId: Joi.string().trim().required(),
        duplicateOf: Joi.string().trim().required(),
      })
    )
    .default([]),
});
