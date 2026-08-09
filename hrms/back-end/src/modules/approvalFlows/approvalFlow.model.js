const mongoose = require("mongoose");

const approvalStepSchema = new mongoose.Schema(
  {
    stepNumber: {
      type: Number,
      required: true,
      min: 1
    },
    approverType: {
      type: String,
      enum: ["manager", "role", "employee"],
      required: true
    },
    roleSlug: {
      type: String,
      default: null
    },
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "employees",
      default: null
    }
  },
  { _id: false }
);

const approvalFlowSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "organizations",
      required: true,
      index: true
    },
    moduleKey: {
      type: String,
      enum: ["leave", "attendance_request"],
      required: true,
      index: true
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120
    },
    isActive: {
      type: Boolean,
      default: true
    },
    minDays: {
      type: Number,
      default: null
    },
    maxDays: {
      type: Number,
      default: null
    },
    steps: {
      type: [approvalStepSchema],
      default: []
    }
  },
  { timestamps: true }
);

approvalFlowSchema.index({ organizationId: 1, moduleKey: 1, isActive: 1 });

module.exports = mongoose.model("approval_flows", approvalFlowSchema);

