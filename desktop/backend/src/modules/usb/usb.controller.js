import { usbSettingsSchema } from "./usb.validation.js";
import { usbControlService } from "./usb.service.js";

const validationError = (reply, error) =>
  reply.code(400).send({
    success: false,
    message: "Validation failed",
    errorCode: "VALIDATION_ERROR",
    errors: error.details.map((item) => ({ field: item.path.join("."), message: item.message })),
  });

const resolveUsbMode = (body) => {
  if (body.usbMode) {
    return body.usbMode;
  }

  if (typeof body.usbEnabled === "boolean") {
    return body.usbEnabled ? "allow" : "block_all";
  }

  return "allow";
};

export const getUsbControlConfig = async (request, reply) => {
  const data = await usbControlService.getSettings({
    auth: request.auth,
    refresh: true,
  });

  return reply.send({
    success: true,
    data,
  });
};

export const updateUsbControlConfig = async (request, reply) => {
  const { error, value } = usbSettingsSchema.validate(request.body ?? {}, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    return validationError(reply, error);
  }

  const data = await usbControlService.saveSettings({
    auth: request.auth,
    usbMode: resolveUsbMode(value),
  });

  return reply.send({
    success: true,
    data,
  });
};
