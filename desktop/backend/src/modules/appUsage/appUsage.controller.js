import { appUsageBatchSchema } from "./appUsage.validation.js";
import { appUsageService } from "./appUsage.service.js";

const formatJoiErrors = (error) =>
  error.details.map((item) => ({
    field: item.path.join(".") || "body",
    message: item.message,
    type: item.type,
  }));

export const postAppUsageBatchHandler = async (request, reply) => {
  const { error, value } = appUsageBatchSchema.validate(request.body ?? {}, {
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

  const result = await appUsageService.recordSessions({
    auth: request.auth,
    events: value.events,
  });

  return reply.code(202).send({
    success: true,
    data: result,
  });
};
