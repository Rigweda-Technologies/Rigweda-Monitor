const mongoose = require("mongoose");

const orgUserSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true
    },

    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "organizations",
      required: true
    },

    roleIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "roles",
        required: true
      }
    ]
  },
  { timestamps: true }
);

orgUserSchema.index(
  { userId: 1, organizationId: 1 },
  { unique: true }
);

module.exports = mongoose.model("org_users", orgUserSchema);