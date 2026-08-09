const mongoose = require("mongoose");

const weekOffSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "organizations",
      required: true
    },
    shiftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "shifts",
      default: null
    },

    weekOffDays: {
      type: [Number],
      required: true
      /*
        0 = Sunday
        1 = Monday
        2 = Tuesday
        3 = Wednesday
        4 = Thursday
        5 = Friday
        6 = Saturday
      */
    }
  },
  { timestamps: true }
);

weekOffSchema.index({ organizationId: 1, shiftId: 1 }, { unique: true });

// 👇 model name = weekOff, collection name = week_off
module.exports = mongoose.model(
  "weekOff",
  weekOffSchema,
  "week_off"
);
