const mongoose = require("mongoose");

const designationSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "organizations",
      required: true,
      index: true
    },

    name: {
      type: String,
      required: true,
      trim: true
    },

    level: Number,
    departmentId:{
      type: mongoose.Schema.Types.ObjectId,
      ref: "departments",
      required: true
    },

    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active"
    },

    isDeleted: {
      type: Boolean,
      default: false
    },

    deletedAt: Date,
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users"
    }
  },
  { timestamps: true }
);

designationSchema.index(
  { organizationId: 1, name: 1 },
  { unique: true }
);

designationSchema.pre(/^find/, async function () {
  this.where({ isDeleted: false });
});

module.exports = mongoose.model("designations", designationSchema);
