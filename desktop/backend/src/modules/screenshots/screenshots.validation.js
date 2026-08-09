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
