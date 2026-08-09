const mongoose = require("mongoose");

const approvalStepSchema = new mongoose.Schema(
  {
    stepNumber: Number,
    approverType: {
      type: String,
      enum: ["manager", "role", "employee"]
    },
    approverEmployeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "employees",
      default: null
    },
    approverRoleSlug: {
      type: String,
      default: null
    },
    status: {
      type: String,
      enum: ["queued", "pending", "approved", "rejected"],
      default: "queued"
    },
    actionBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "employees",
      default: null
    },
    actionAt: {
      type: Date,
      default: null
    },
    remarks: {
      type: String,
      default: null
    }
  },
  { _id: false }
);

const attendanceRequestSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "organizations",
      required: true,
      index: true
    },
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "employees",
      required: true,
      index: true
    },
    date: {
      type: String,
      required: true,
      index: true,
      match: /^\d{4}-\d{2}-\d{2}$/
    },
    requestType: {
      type: String,
      enum: ["missed_checkout", "correction", "work_from_home"],
      required: true
    },
    dayPortion: {
      type: String,
      enum: ["full_day", "first_half", "second_half"],
      default: "full_day"
    },
    requestedCheckInTime: {
      type: String,
      default: null
    },
    requestedCheckOutTime: {
      type: String,
      default: null
    },
    reason: {
      type: String,
      required: true,
      trim: true
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true
    },
    actionBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "employees",
      default: null
    },
    actionAt: {
      type: Date,
      default: null
    },
    rejectionReason: {
      type: String,
      default: null
    },
    resolvedAttendanceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "timesheet_attendance",
      default: null
    },
    approvalFlowId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "approval_flows",
      default: null
    },
    approvalSteps: {
      type: [approvalStepSchema],
      default: []
    },
    currentApprovalStep: {
      type: Number,
      default: null
    }
  },
  { timestamps: true }
);

attendanceRequestSchema.index({ organizationId: 1, employeeId: 1, date: 1, status: 1 });

module.exports = mongoose.model("attendance_requests", attendanceRequestSchema);
