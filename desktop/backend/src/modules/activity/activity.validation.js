import Joi from "joi";

const activityEventSchema = Joi.object({
  eventId: Joi.string().trim().max(120).required(),
  deviceId: Joi.string().trim().max(120).required(),
  observedAt: Joi.date().iso().required(),
  status: Joi.string().valid("active", "idle", "offline").required(),
  activeSeconds: Joi.number().integer().min(0).max(3600).default(0),
  idleSeconds: Joi.number().integer().min(0).max(3600).default(0),
});

export const activityBatchSchema = Joi.object({
  events: Joi.array().items(activityEventSchema).min(1).max(100).required(),
});

export const activityEmployeesQuerySchema = Joi.object({
  date: Joi.date().iso().optional(),
});
