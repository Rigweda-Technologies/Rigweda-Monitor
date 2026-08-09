import Joi from "joi";

export const createScreenshotSchema = Joi.object({
  employeeId: Joi.string().trim().required(),
  capturedAt: Joi.date().iso().required(),
  screenshot: Joi.object({
    filename: Joi.string().trim().required(),
    mimetype: Joi.string().valid("image/jpeg", "image/png", "image/webp").required(),
    buffer: Joi.binary().required(),
    fileSize: Joi.number().integer().positive().required(),
  }).required(),
});
