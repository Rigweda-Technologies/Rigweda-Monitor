const mongoose = require("mongoose");

const STAGES = [
  "applied",
  "screening",
  "interview",
  "offer",
  "hired",
  "rejected"
];

const hiringCandidateSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "organizations",
      required: true,
      index: true
    },
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "hiring_jobs",
      required: true,
      index: true
    },
    firstName: {
      type: String,
      required: true,
      trim: true
    },
    lastName: {
      type: String,
      default: "",
      trim: true
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true
    },
    phone: {
      type: String,
      default: "",
      trim: true
    },
    source: {
      type: String,
      default: "direct",
      trim: true
    },
    resumeUrl: {
      type: String,
      default: "",
      trim: true
    },
    yearsExperience: {
      type: Number,
      min: 0,
      default: 0
    },
    currentLocation: {
      type: String,
      default: "",
      trim: true
    },
    preferredLocation: {
      type: String,
      default: "",
      trim: true
    },
    highestQualification: {
      type: String,
      default: "",
      trim: true
    },
    specialization: {
      type: String,
      default: "",
      trim: true
    },
    collegeName: {
      type: String,
      default: "",
      trim: true
    },
    graduationYear: {
      type: Number,
      min: 1900,
      max: 2100,
      default: null
    },
    keySkills: {
      type: [String],
      default: []
    },
    linkedInUrl: {
      type: String,
      default: "",
      trim: true
    },
    portfolioUrl: {
      type: String,
      default: "",
      trim: true
    },
    currentCompany: {
      type: String,
      default: "",
      trim: true
    },
    currentCTC: {
      type: Number,
      min: 0,
      default: 0
    },
    expectedCTC: {
      type: Number,
      min: 0,
      default: 0
    },
    noticePeriodDays: {
      type: Number,
      min: 0,
      default: 0
    },
    stage: {
      type: String,
      enum: STAGES,
      default: "applied",
      index: true
    },
    stageTimeline: [
      {
        stage: {
          type: String,
          enum: STAGES,
          required: true
        },
        changedAt: {
          type: Date,
          default: Date.now
        },
        changedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "users",
          default: null
        },
        note: {
          type: String,
          default: ""
        }
      }
    ],
    status: {
      type: String,
      enum: ["active", "hired", "rejected", "talent_pool", "withdrawn"],
      default: "active"
    },
    futureConsideration: {
      type: Boolean,
      default: true
    },
    lastRejectedAt: {
      type: Date,
      default: null
    },
    nextFollowUpAt: {
      type: Date,
      default: null
    },
    offerLetterReleasedAt: {
      type: Date,
      default: null
    },
    offerLetterReleasedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      default: null
    },
    rejectionEmailSentAt: {
      type: Date,
      default: null
    },
    rejectionEmailSentBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      default: null
    },
    convertedToEmployeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "employees",
      default: null
    },
    convertedAt: {
      type: Date,
      default: null
    },
    convertedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      default: null
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "employees",
      default: null
    },
    rating: {
      type: Number,
      min: 0,
      max: 5,
      default: 0
    },
    remarks: {
      type: String,
      default: "",
      trim: true
    },
    interviewNotes: {
      type: String,
      default: "",
      trim: true
    },
    interviews: [
      {
        roundName: {
          type: String,
          default: "L1"
        },
        interviewerEmployeeId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "employees",
          default: null
        },
        scheduledAt: {
          type: Date,
          required: true
        },
        mode: {
          type: String,
          enum: ["virtual", "onsite", "phone"],
          default: "virtual"
        },
        meetingLink: {
          type: String,
          default: "",
          trim: true
        },
        status: {
          type: String,
          enum: ["scheduled", "completed", "cancelled"],
          default: "scheduled"
        },
        feedback: {
          type: String,
          default: "",
          trim: true
        },
        scorecard: {
          communication: { type: Number, min: 1, max: 5, default: null },
          technical: { type: Number, min: 1, max: 5, default: null },
          problemSolving: { type: Number, min: 1, max: 5, default: null },
          cultureFit: { type: Number, min: 1, max: 5, default: null },
          overall: { type: Number, min: 1, max: 5, default: null }
        },
        recommendation: {
          type: String,
          enum: ["strong_hire", "hire", "hold", "reject"],
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
      }
    ],
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

hiringCandidateSchema.index(
  { organizationId: 1, jobId: 1, email: 1 },
  { unique: true }
);
hiringCandidateSchema.pre(/^find/, function () {
  this.where({ isDeleted: false });
});

module.exports = mongoose.model("hiring_candidates", hiringCandidateSchema);
