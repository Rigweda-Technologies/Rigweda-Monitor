const mongoose = require("mongoose");

const departmentSchema = new mongoose.Schema(
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

    code: {
      type: String,
      required: true,
      uppercase: true,
      trim: true
    },

    managerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "employees"
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

departmentSchema.index(
  { organizationId: 1, code: 1 },
  { unique: true }
);

departmentSchema.pre(/^find/, async function () {
  this.where({ isDeleted: false });
});


module.exports = mongoose.model("departments", departmentSchema);