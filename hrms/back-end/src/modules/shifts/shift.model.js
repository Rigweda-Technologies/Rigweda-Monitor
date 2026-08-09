const mongoose = require("mongoose");

const shiftSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "organizations",
      required: true,
      index: true
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80
    },
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 20
    },
    startTime: {
      type: String,
      required: true
    },
    endTime: {
      type: String,
      required: true
    },
    graceMinutes: {
      type: Number,
      default: 0,
      min: 0,
      max: 180
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active"
    }
  },
  { timestamps: true }
);

shiftSchema.index({ organizationId: 1, code: 1 }, { unique: true });

module.exports = mongoose.model("shifts", shiftSchema);

