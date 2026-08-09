const mongoose = require("mongoose");

const timesheetEntrySchema = new mongoose.Schema(
  {
    date: {
      type: Date,
      required: true
    },
    hours: {
      type: Number,
      required: true,
      min: 0,
      max: 24
    },
    notes: {
      type: String,
      trim: true,
      default: ""
    }
  },
  { _id: false }
);

const timesheetSchema = new mongoose.Schema(
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

    weekStart: {
      type: Date,
      required: true,
      index: true
    },

    weekEnd: {
      type: Date,
      required: true
    },

    entries: {
      type: [timesheetEntrySchema],
      default: []
    },

    totalHours: {
      type: Number,
      default: 0
    },

    status: {
      type: String,
      enum: ["draft", "submitted", "approved", "rejected"],
      default: "draft"
    },

    submittedAt: Date,

    actionBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "employees"
    },

    actionAt: Date,

    rejectionReason: String
  },
  { timestamps: true }
);

timesheetSchema.index(
  { organizationId: 1, employeeId: 1, weekStart: 1 },
  { unique: true }
);

module.exports = mongoose.model("timesheets", timesheetSchema);
