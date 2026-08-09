const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "organizations",
      required: true,
      index: true
    },
    recipientUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
      index: true
    },
    recipientEmployeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "employees",
      default: null
    },
    actorEmployeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "employees",
      default: null
    },
    type: {
      type: String,
      enum: [
        "leave_applied",
        "leave_pending_approval",
        "leave_action",
        "attendance_request_pending_approval",
        "attendance_request_action",
        "attendance_override",
        "probation_completed",
        "employee_lifecycle",
        "organization_document_expiry",
        "general"
      ],
      default: "general"
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500
    },
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true
    },
    readAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
);

notificationSchema.index({ organizationId: 1, recipientUserId: 1, createdAt: -1 });
notificationSchema.index({ recipientUserId: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.model("notifications", notificationSchema);
