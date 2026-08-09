const mongoose = require("mongoose");

const permissionSchema = new mongoose.Schema(
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

    code: {
      type: String,
      required: true
    },

    module: {
      type: String,
      required: true
    },

    description: {
      type: String
    }
  },
  { timestamps: true }
);

permissionSchema.index(
  { organizationId: 1, code: 1 },
  { unique: true }
);

module.exports = mongoose.model("permissions", permissionSchema);
