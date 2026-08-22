import Joi from "joi";

export const usbSettingsSchema = Joi.object({
  usbMode: Joi.string().valid("allow", "block_storage", "block_all").optional(),
  usbEnabled: Joi.boolean().optional(),
}).min(1);
