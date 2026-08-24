const mongoose = require("mongoose");

const monitorDeviceUpdateSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true, trim: true, index: true },
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null },
    hostname: { type: String, default: null, trim: true },
    currentVersion: { type: String, default: null, trim: true },
    targetVersion: { type: String, default: null, trim: true },
    releaseId: { type: mongoose.Schema.Types.ObjectId, ref: "MonitorRelease", default: null },
    updateStatus: { type: String, default: "UP_TO_DATE", trim: true },
    lastUpdateCheckAt: { type: Date, default: null },
    updateStartedAt: { type: Date, default: null },
    lastUpdatedAt: { type: Date, default: null },
    failureCount: { type: Number, default: 0 },
    lastErrorCode: { type: String, default: null, trim: true },
    lastErrorMessage: { type: String, default: null, trim: true }
  },
  { timestamps: true }
);

monitorDeviceUpdateSchema.index({ deviceId: 1, releaseId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.models.MonitorDeviceUpdate || mongoose.model("MonitorDeviceUpdate", monitorDeviceUpdateSchema);
