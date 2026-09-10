const mongoose = require("mongoose");

const timesheetAttendanceSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "organizations",
      required: true,
      index: true
    },

    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "employees",
      required: true,
      index: true
    },

    date: {
      type: Date,
      required: true,
      index: true
    },
    dateKey: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
      index: true
    },

    checkInAt: Date,
    checkInIp: {
      type: String,
      default: null
    },
    checkInLatitude: {
      type: Number,
      default: null
    },
    checkInLongitude: {
      type: Number,
      default: null
    },
    checkInSelfieProvided: {
      type: Boolean,
      default: false
    },
    checkInSelfieImage: {
      type: String,
      default: null
    },
    checkInDeviceId: {
      type: String,
      default: null
    },

    checkOutAt: Date,
    checkOutIp: {
      type: String,
      default: null
    },
    checkOutSelfieProvided: {
      type: Boolean,
      default: false
    },
    checkOutSelfieImage: {
      type: String,
      default: null
    },
    checkOutDeviceId: {
      type: String,
      default: null
    },
    dayHistory: {
      type: [
        {
          action: {
            type: String,
            enum: ["check_in", "check_out"],
            required: true
          },
          at: {
            type: Date,
            required: true
          },
          ip: {
            type: String,
            default: null
          },
          latitude: {
            type: Number,
            default: null
          },
          longitude: {
            type: Number,
            default: null
          },
          selfieProvided: {
            type: Boolean,
            default: false
          },
          selfieImage: {
            type: String,
            default: null
          },
          deviceId: {
            type: String,
            default: null
          },
          source: {
            type: String,
            default: "web"
          }
        }
      ],
      default: []
    },

    totalMinutes: {
      type: Number,
      default: 0
    },
    attendanceSource: {
      type: String,
      enum: ["manual", "monitor_agent", "biometric", "access_card"],
      default: "manual",
      index: true
    },
    workFromHomePortion: {
      type: String,
      enum: ["full_day", "first_half", "second_half"],
      default: null
    },

    status: {
      type: String,
      enum: ["checked_in", "checked_out"],
      default: "checked_in"
    },
    overriddenBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "employees",
      default: null
    },
    overriddenAt: {
      type: Date,
      default: null
    },
    shiftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "shifts",
      default: null
    },
    shiftName: {
      type: String,
      default: null
    },
    shiftCode: {
      type: String,
      default: null
    },
    shiftStartTime: {
      type: String,
      default: null
    },
    shiftEndTime: {
      type: String,
      default: null
    },
    scheduledStartAt: {
      type: Date,
      default: null
    },
    scheduledEndAt: {
      type: Date,
      default: null
    },
    lateByMinutes: {
      type: Number,
      default: 0
    },
    earlyLoginByMinutes: {
      type: Number,
      default: 0
    },
    earlyCheckoutByMinutes: {
      type: Number,
      default: 0
    },
    overtimeMinutes: {
      type: Number,
      default: 0
    },
    missedCheckout: {
      type: Boolean,
      default: false
    },
    missedCheckoutMarkedAt: {
      type: Date,
      default: null
    },
    missedCheckoutResolvedRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "attendance_requests",
      default: null
    }
  },
  { timestamps: true }
);

timesheetAttendanceSchema.index(
  { organizationId: 1, employeeId: 1, dateKey: 1 },
  {
    unique: true,
    name: "uniq_org_employee_dateKey_non_null",
    partialFilterExpression: {
      dateKey: { $type: "string" }
    }
  }
);
timesheetAttendanceSchema.index({ organizationId: 1, dateKey: 1 });
timesheetAttendanceSchema.index({ organizationId: 1, dateKey: 1, checkInAt: -1 });

module.exports = mongoose.model("timesheet_attendance", timesheetAttendanceSchema);
