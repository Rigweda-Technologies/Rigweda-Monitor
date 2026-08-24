const mongoose = require("mongoose");

const monitorReleaseSchema = new mongoose.Schema(
  {
    version: { type: String, required: true, trim: true },
    build: { type: Number, required: true },
    channel: { type: String, default: "stable", trim: true },
    r2ObjectKey: { type: String, required: true, trim: true },
    sha256: { type: String, required: true, trim: true },
    fileSize: { type: Number, required: true },
    mandatory: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ["draft", "testing", "active", "disabled"],
      default: "draft"
    },
    rolloutPercentage: { type: Number, default: 100, min: 0, max: 100 },
    minimumSupportedVersion: { type: String, default: "0.0.0" },
    releasedAt: { type: Date, default: null },
    signedDownloadUrl: { type: String, default: null }
  },
  { timestamps: true }
);

monitorReleaseSchema.index({ channel: 1, status: 1, releasedAt: -1 });

module.exports = mongoose.models.MonitorRelease || mongoose.model("MonitorRelease", monitorReleaseSchema);
