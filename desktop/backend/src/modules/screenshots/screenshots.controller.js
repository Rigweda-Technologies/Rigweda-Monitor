import { screenshotService } from "./screenshots.service.js";
import {
  completeUploadSessionSchema,
  createScreenshotSchema,
  createUploadSessionSchema,
} from "./screenshots.validation.js";

const formatJoiErrors = (error) =>
  error.details.map((item) => ({
    field: item.path.join(".") || "body",
    message: item.message,
    type: item.type,
  }));

export const listScreenshotsHandler = async () => {
  const screenshots = await screenshotService.listScreenshots();
  return { success: true, data: screenshots };
};

export const createScreenshotHandler = async (request, reply) => {
  const body = request.body ?? {};
  const screenshotValue = body.screenshot;

  if (!screenshotValue) {
    return reply.code(400).send({
      success: false,
      message: "Screenshot file is required",
    });
  }

  const screenshotPart = {
    filename: screenshotValue.filename || "screenshot",
    mimetype: screenshotValue.mimetype || "application/octet-stream",
    buffer: Buffer.isBuffer(screenshotValue) ? screenshotValue : Buffer.from(screenshotValue),
    fileSize: Buffer.isBuffer(screenshotValue) ? screenshotValue.length : Buffer.byteLength(String(screenshotValue)),
  };

  const employeeProfile = await screenshotService.resolveEmployeeProfile(request.auth.token);
  const employeeId = employeeProfile?.employeeId || employeeProfile?.userId;

  if (!employeeId) {
    return reply.code(404).send({
      success: false,
      message: "Employee profile not found for the authenticated user.",
    });
  }

  const dateFolder = new Date(body.capturedAt)
    .toISOString()
    .slice(0, 10)
    .replaceAll("-", "_");

  const payloadForValidation = {
    employeeId,
    capturedAt: body.capturedAt,
    dateFolder,
    screenshot: screenshotPart,
  };

  const { error, value } = createScreenshotSchema.validate(payloadForValidation, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    return reply.code(400).send({
      success: false,
      message: "Validation failed",
      errorCode: "VALIDATION_ERROR",
      errors: formatJoiErrors(error),
    });
  }

  const payload = {
    ...value,
    auth: request.auth,
  };
  console.log("Validated payload for screenshot creation:", payload);
  const result = await screenshotService.createScreenshot(payload);

  return reply.code(201).send({
    success: true,
    data: result,
  });
};

export const createUploadSessionHandler = async (request, reply) => {
  const { error, value } = createUploadSessionSchema.validate(request.body ?? {}, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    return reply.code(400).send({
      success: false,
      message: "Validation failed",
      errorCode: "VALIDATION_ERROR",
      errors: formatJoiErrors(error),
    });
  }

  const result = await screenshotService.createUploadSession({
    auth: request.auth,
    ...value,
  });

  return reply.code(201).send({
    success: true,
    data: result,
  });
};

export const completeUploadSessionHandler = async (request, reply) => {
  const { error, value } = completeUploadSessionSchema.validate(request.body ?? {}, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    return reply.code(400).send({
      success: false,
      message: "Validation failed",
      errorCode: "VALIDATION_ERROR",
      errors: formatJoiErrors(error),
    });
  }

  const result = await screenshotService.completeUploadSession({
    batchId: request.params.batchId,
    ...value,
  });

  return reply.send({
    success: true,
    data: result,
  });
};
