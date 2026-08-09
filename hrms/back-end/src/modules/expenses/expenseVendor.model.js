const mongoose = require("mongoose");

const expenseVendorSchema = new mongoose.Schema(
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
      trim: true,
      maxlength: 120
    },
    nameKey: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "employees",
      default: null
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "employees",
      default: null
    }
  },
  { timestamps: true }
);

expenseVendorSchema.index({ organizationId: 1, nameKey: 1 }, { unique: true });

module.exports = mongoose.model("expense_vendors", expenseVendorSchema);
