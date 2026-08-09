const mongoose = require("mongoose");

const leaveBalanceSchema = new mongoose.Schema(
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

    leaveTypeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "leave_types",
      required: true
    },

    cycleStartYear: {
      type: Number,
      required: true
    },

    total: {
      type: Number,
      required: true
    },

    used: {
      type: Number,
      default: 0
    },
    pending: {
      type: Number,
      default: 0
    },

    remaining: {
      type: Number,
      required: true
    },

    lastCreditedAt: {
      type: Date
    }
  },
  { timestamps: true }
);

// 🔒 one balance per employee + leaveType + leave cycle
leaveBalanceSchema.index(
  {
    organizationId: 1,
    employeeId: 1,
    leaveTypeId: 1,
    cycleStartYear: 1
  },
  { unique: true }
);

module.exports = mongoose.model(
  "leaveBalance",      // model name
  leaveBalanceSchema,
  "leave_balance"      // collection name
);
