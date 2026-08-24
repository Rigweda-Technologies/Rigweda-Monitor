import { browserHistoryService } from "./browserHistory.service.js";

const validationError = (reply, message) =>
  reply.code(400).send({
    success: false,
    message,
    errorCode: "VALIDATION_ERROR",
  });

export const postBrowserHistoryBatchHandler = async (request, reply) => {
  const body = request.body ?? {};
  const entries = Array.isArray(body.entries) ? body.entries : [];
  const deviceId = String(body.deviceId || "").trim();

  if (!deviceId) {
    return validationError(reply, "deviceId is required.");
  }
  if (entries.length === 0) {
    return validationError(reply, "At least one browser history entry is required.");
  }
  if (entries.length > 200) {
    return validationError(reply, "Send at most 200 browser history entries per request.");
  }

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      return validationError(reply, "Each browser history entry must be an object.");
    }
    if (!String(entry.observedAt || "").trim()) {
      return validationError(reply, "Each browser history entry must include observedAt.");
    }
    if (!String(entry.browser || "").trim()) {
      return validationError(reply, "Each browser history entry must include browser.");
    }
    if (!String(entry.url || "").trim()) {
      return validationError(reply, "Each browser history entry must include url.");
    }
  }

  const result = await browserHistoryService.saveEntries({
    auth: request.auth,
    entries,
    deviceId,
  });

  return reply.code(202).send({ success: true, data: result });
};
