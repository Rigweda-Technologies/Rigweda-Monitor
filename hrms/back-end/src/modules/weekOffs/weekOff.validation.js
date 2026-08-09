const Joi = require("joi");
const objectId = Joi.string().hex().length(24);

exports.upsertWeekOffSchema = Joi.object({
  shiftId: objectId.allow(null, "").optional(),
  weekOffDays: Joi.array()
    .items(Joi.number().integer().min(0).max(6))
    .min(1)
    .required()
});
