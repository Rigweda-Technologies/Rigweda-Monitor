import { activityBatchSchema, activityEmployeesQuerySchema } from "./activity.validation.js";
import { activityService } from "./activity.service.js";

const validationError = (reply, error) => reply.code(400).send({
  success: false,
  message: "Validation failed",
  errorCode: "VALIDATION_ERROR",
  errors: error.details.map((item) => ({ field: item.path.join("."), message: item.message })),
});

export const postActivityEventsHandler = async (request, reply) => {
  const { error, value } = activityBatchSchema.validate(request.body ?? {}, { abortEarly: false, stripUnknown: true });
  if (error) return validationError(reply, error);
  const result = await activityService.recordEvents({ auth: request.auth, events: value.events });
  return reply.code(202).send({ success: true, data: result });
};

export const listActivityEmployeesHandler = async (request, reply) => {
  const { error, value } = activityEmployeesQuerySchema.validate(request.query ?? {}, { abortEarly: false, stripUnknown: true });
  if (error) return validationError(reply, error);
  const date = value.date ? new Date(value.date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  const employees = await activityService.listEmployees({ auth: request.auth, date });
  return reply.send({ success: true, data: { date, employees } });
};
