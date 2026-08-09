const mongoose = require("mongoose");
const { getDefaultMaxActiveLoginsPerUser } = require("../../utils/orgSettingsDefaults");

const orgSettingsSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "organizations",
      required: true,
      unique: true,
      index: true
    },

    leaveCreditFrequency: {
      type: String,
      enum: ["monthly", "quarterly", "yearly"],
      default: "monthly"
    },
    leaveTypeCreditMode: {
      type: String,
      enum: ["current_month_onwards", "full_year"],
      default: "current_month_onwards"
    },
    sandwichRuleEnabled: {
      type: Boolean,
      default: false
    },
    attendanceLockEnabled: {
      type: Boolean,
      default: true
    },
    attendanceLockAfterDays: {
      type: Number,
      default: 7
    },
    attendanceLockMode: {
      type: String,
      enum: ["days_window", "payroll_cutoff"],
      default: "payroll_cutoff"
    },
    attendanceLockDay: {
      type: Number,
      default: 25
    },
    timezone: {
      type: String,
      default: "Asia/Kolkata"
    },
    logoUrl: {
      type: String,
      default: ""
    },
    payrollCutoffDay: {
      type: Number,
      default: 25
    },
    payrollSalaryPayDay: {
      type: Number,
      default: 30
    },
    payrollEnabled: {
      type: Boolean,
      default: false
    },

    minWorkHoursPerDay: {
      type: Number,
      default: 8
    },

    minHalfDayHours: {
      type: Number,
      default: 4
    },
    attendanceIpEnabled: {
      type: Boolean,
      default: false
    },
    attendanceAllowedIp: {
      type: String,
      default: ""
    },
    attendanceSelfieRequired: {
      type: Boolean,
      default: false
    },
    attendanceMultiPunchEnabled: {
      type: Boolean,
      default: false
    },
    attendanceGeoFenceEnabled: {
      type: Boolean,
      default: false
    },
    attendanceGeoLatitude: {
      type: Number,
      default: null
    },
    attendanceGeoLongitude: {
      type: Number,
      default: null
    },
    attendanceGeoRadiusMeters: {
      type: Number,
      default: 200
    },
    attendanceDevBypassEnabled: {
      type: Boolean,
      default: false
    },
    probationPeriodDays: {
      type: Number,
      default: 90,
      min: 0
    },
    noticePeriodDays: {
      type: Number,
      default: 30,
      min: 0
    },
    employeeIdPrefix: {
      type: String,
      default: ""
    },
    maxActiveLoginsPerUser: {
      type: Number,
      default: getDefaultMaxActiveLoginsPerUser,
      min: 1,
      max: 20
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("orgSettings", orgSettingsSchema, "org_settings");
