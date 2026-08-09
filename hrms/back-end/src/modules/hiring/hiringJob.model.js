const mongoose = require("mongoose");

const hiringJobSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "organizations",
      required: true,
      index: true
    },
    title: {
      type: String,
      required: true,
      trim: true
    },
    titleKey: {
      type: String,
      required: true,
      trim: true,
      lowercase: true
    },
    department: {
      type: String,
      default: "",
      trim: true
    },
    employmentType: {
      type: String,
      enum: ["full_time", "part_time", "contract", "internship"],
      default: "full_time"
    },
    location: {
      type: String,
      default: "",
      trim: true
    },
    openings: {
      type: Number,
      min: 1,
      default: 1
    },
    description: {
      type: String,
      default: "",
      trim: true
    },
    status: {
      type: String,
      enum: ["draft", "open", "on_hold", "closed"],
      default: "open",
      index: true
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
    }
  },
  { timestamps: true }
);

hiringJobSchema.index({ organizationId: 1, titleKey: 1 }, { unique: true });
hiringJobSchema.pre(/^find/, function () {
  this.where({ isDeleted: false });
});

module.exports = mongoose.model("hiring_jobs", hiringJobSchema);
