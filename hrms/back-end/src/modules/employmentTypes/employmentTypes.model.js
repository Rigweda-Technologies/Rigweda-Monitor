const mongoose = require("mongoose");

const employmentTypeSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "organizations",
      required: true
    },

    name: {
      type: String,
      required: true // Full-Time, Contract
    },

    code: {
      type: String,
      required: true // FULL_TIME
    },

    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active"
    }
  },
  { timestamps: true }
);

employmentTypeSchema.index(
  { organizationId: 1, code: 1 },
  { unique: true }
);

module.exports = mongoose.model(
  "employment_types",
  employmentTypeSchema
);
