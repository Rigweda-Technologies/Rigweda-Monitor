const mongoose = require("mongoose");

const projectSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "organizations",
      required: true,
      index: true
    },
    projectName: {
      type: String,
      required: true,
      trim: true
    },
    projectNameKey: {
      type: String,
      required: true,
      trim: true,
      lowercase: true
    },
    logoUrl: {
      type: String,
      default: "",
      trim: true
    },
    clientName: {
      type: String,
      required: true,
      trim: true
    },
    clientCompany: {
      type: String,
      default: "",
      trim: true
    },
    clientEmail: {
      type: String,
      default: "",
      trim: true,
      lowercase: true
    },
    clientPhone: {
      type: String,
      default: "",
      trim: true
    },
    clientAddress: {
      type: String,
      default: "",
      trim: true
    },
    actualAmount: {
      type: Number,
      required: true,
      min: 0
    },
    discountedAmount: {
      type: Number,
      required: true,
      min: 0
    },
    paidAmount: {
      type: Number,
      required: true,
      min: 0,
      default: 0
    },
    paidTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "employees",
      default: null
    },
    pendingAmount: {
      type: Number,
      required: true,
      min: 0
    },
    status: {
      type: String,
      enum: ["active", "on_hold", "completed", "cancelled"],
      default: "active",
      index: true
    },
    startDate: {
      type: Date,
      default: null
    },
    expectedEndDate: {
      type: Date,
      default: null
    },
    notes: {
      type: String,
      default: "",
      trim: true
    },
    mouFile: {
      fileName: String,
      fileUrl: String,
      mimeType: String,
      uploadedAt: Date
    },
    documentationFile: {
      fileName: String,
      fileUrl: String,
      mimeType: String,
      uploadedAt: Date
    },
    isDeleted: {
      type: Boolean,
      default: false
    },
    deletedAt: {
      type: Date,
      default: null
    },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      default: null
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      default: null
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      default: null
    }
  },
  { timestamps: true }
);

projectSchema.index(
  { organizationId: 1, projectNameKey: 1 },
  { unique: true }
);

projectSchema.pre(/^find/, function () {
  this.where({ isDeleted: false });
});

module.exports = mongoose.model("projects", projectSchema);
