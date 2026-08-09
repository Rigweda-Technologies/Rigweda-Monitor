const mongoose = require("mongoose");

const leaveTypeSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "organizations",
      required: true,
      index: true
    },
    name: {
      type: String, // e.g., "Sick Leave", "Vacation"
      required: true,
      trim: true
    },
    code: {
      type: String, // e.g., "SL", "AL"
      required: true,
      uppercase: true
    },
    description: String,
    daysPerYear: {
      type: Number,
      default: 0
    },
    isCarryForward: {
      type: Boolean,
      default: false
    },
    includeInPayroll: {
      type: Boolean,
      default: true
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active"
    },

    maxCarryForward: {
      type: Number,
      default: null   // null = no limit (or ignored if isCarryForward = false)
    }
  },
  { timestamps: true }
);

// Ensure code is unique per organization
leaveTypeSchema.index({ organizationId: 1, code: 1 }, { unique: true });

module.exports = mongoose.model("leave_types", leaveTypeSchema);
