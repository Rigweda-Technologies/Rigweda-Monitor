const mongoose = require("mongoose");

const roleSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "organizations",
      required: true
    },

    name: {
      type: String,
      required: true
    },

    slug: {
      type: String,
      required: true
    },

    permissionIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "permissions",
        required: true
      }
    ],

    isSystemRole: {
      type: Boolean,
      default: false
    },

    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active"
    }
  },
  { timestamps: true }
);

roleSchema.index(
  { organizationId: 1, slug: 1 },
  { unique: true }
);

module.exports = mongoose.model("roles", roleSchema);
