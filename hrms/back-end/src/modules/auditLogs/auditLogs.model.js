const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "organizations",
      required: true
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true
    },

    module: {
      type: String,
      required: true // employees, departments, payroll
    },

    action: {
      type: String,
      required: true // CREATE, UPDATE, DELETE
    },

    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
    },

    before: {
      type: Object
    },

    after: {
      type: Object
    },

    ipAddress: String,
    userAgent: String
  },
  { timestamps: true }
);

module.exports = mongoose.model("audit_logs", auditLogSchema);
