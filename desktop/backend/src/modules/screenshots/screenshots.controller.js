import { screenshotService } from "./screenshots.service.js";
import { createScreenshotSchema } from "./screenshots.validation.js";

export const listScreenshotsHandler = async () => {
  const screenshots = await screenshotService.listScreenshots();
  return { success: true, data: screenshots };
};

export const createScreenshotHandler = async (request, reply) => {
  const body = request.body ?? {};

  const screenshotPart = await request.file();

  if (!screenshotPart) {
    return reply.code(400).send({
      success: false,
      message: "Screenshot file is required",
    });
  }

  const screenshotFile = {
    filename: screenshotPart.filename || "screenshot",
    mimetype: screenshotPart.mimetype || "application/octet-stream",
    buffer: await screenshotPart.toBuffer(),
    fileSize: screenshotPart.file?.bytesRead || 0,
  };

  const employeeProfile = await screenshotService.resolveEmployeeProfile(request.auth.token);
  const employeeId = employeeProfile?.id;

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
    screenshot: screenshotFile,
  };

  const { error, value } = createScreenshotSchema.validate(payloadForValidation, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    return reply.code(400).send({
      success: false,
      message: "Validation failed",
      errors: error.details.map((item) => item.message),
    });
  }

  const payload = value;
  const result = await screenshotService.createScreenshot(payload);

  return reply.code(201).send({
    success: true,
    data: result,
  });
};
