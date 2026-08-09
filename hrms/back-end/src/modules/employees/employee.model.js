const mongoose = require("mongoose");

const emergencyContactSchema = new mongoose.Schema(
  {
    name: {
      type: String,
    },
    relation: {
      type: String,
    },
    phone: {
      type: String,
    }
  },
  { _id: false }
);

const documentSchema = new mongoose.Schema(
  {
    fileName: String,
    fileUrl: String,
    mimeType: String,
    uploadedAt: Date
  },
  { _id: false }
);

const employeeSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "organizations",
      required: true,
      index: true
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
      unique: true
    },

    // 👤 Mandatory personal info
    firstName: {
      type: String,
      required: true,
      trim: true
    },

    lastName: {
      type: String,
      required: true,
      trim: true
    },

    phone: {
      type: String,
    },

    // 🏢 Mandatory work info
    employeeCode: {
      type: String,
      required: true
    },

    departmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "departments"
    },

    // ✅ CHANGED: dynamic designation
    designationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "designations"
    },

    dateOfJoining: {
      type: Date,
      required: true
    },

    employmentType: {
      type: String,
      enum: ["full_time", "part_time", "contract"],
      required: true
    },

    profileCompleted: {
      type: Boolean,
      default: false
    },
    // 👤 Optional personal details
    dob: Date,
    gender: String,
    bloodGroup: String,

    address: {
      line1: String,
      line2: String,
      city: String,
      state: String,
      country: String,
      zip: String
    },

    emergencyContacts: {
      type: [emergencyContactSchema],
      default: []
    },
    profileImage: {
      type: String,
      default: null
    },
    addressProof: {
      type: documentSchema,
      default: null
    },
    aadhaarNumber: {
      type: String,
      default: null
    },
    panNumber: {
      type: String,
      default: null
    },
    aadhaarProof: {
      type: documentSchema,
      default: null
    },
    panProof: {
      type: documentSchema,
      default: null
    },

    managerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "employees"
    },
    leaveApprovalFlowId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "approval_flows",
      default: null
    },
    attendanceApprovalFlowId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "approval_flows",
      default: null
    },
    shiftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "shifts",
      default: null
    },

    status: {
      type: String,
      enum: ["active", "on_leave", "resigned"],
      default: "active"
    },
    employmentLifecycleStatus: {
      type: String,
      enum: ["probation", "confirmed", "notice", "terminated"],
      default: "probation"
    },
    probationPeriodDays: {
      type: Number,
      default: 90
    },
    probationStartDate: {
      type: Date
    },
    probationEndDate: {
      type: Date
    },
    probationCompletedAt: {
      type: Date,
      default: null
    },
    confirmedDate: {
      type: Date,
      default: null
    },
    probationCompletionNotifiedAt: {
      type: Date,
      default: null
    },
    noticePeriodDays: {
      type: Number,
      default: 30
    },
    noticeStartDate: {
      type: Date,
      default: null
    },
    noticeEndDate: {
      type: Date,
      default: null
    },
    lastWorkingDay: {
      type: Date,
      default: null
    },
    benefitsEligible: {
      type: Boolean,
      default: false
    },

    // 🗑 Soft delete fields
    isDeleted: {
      type: Boolean,
      default: false
    },

    deletedAt: {
      type: Date
    },

    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users"
    }
  },
  { timestamps: true }
);

// 🔒 Unique employee code per org
employeeSchema.index(
  { organizationId: 1, employeeCode: 1 },
  { unique: true }
);

// 🔍 Automatically ignore deleted employees unless a query explicitly opts in.
employeeSchema.pre(/^find/, async function () {
  if (this.getOptions()?.includeDeleted) return;
  if (Object.prototype.hasOwnProperty.call(this.getQuery(), "isDeleted")) return;
  this.where({ isDeleted: false });
});

module.exports = mongoose.model("employees", employeeSchema);
