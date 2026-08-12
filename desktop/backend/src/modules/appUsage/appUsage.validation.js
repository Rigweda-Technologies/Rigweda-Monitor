import Joi from "joi";

const appUsageEventSchema = Joi.object({
  sessionId: Joi.string().trim().max(120).required(),
  deviceId: Joi.string().trim().max(120).required(),
  observedAt: Joi.date().iso().required(),
  appName: Joi.string().trim().max(255).required(),
  processName: Joi.string().trim().max(255).required(),
  startedAt: Joi.date().iso().required(),
  endedAt: Joi.date().iso().required(),
  activeSeconds: Joi.number().integer().min(0).max(86400).default(0),
  keyPressCount: Joi.number().integer().min(0).max(1000000).default(0),
  keyNames: Joi.array().items(Joi.string().trim().max(100)).default([]),
});

export const appUsageBatchSchema = Joi.object({
  events: Joi.array().items(appUsageEventSchema).min(1).max(100).required(),
});
