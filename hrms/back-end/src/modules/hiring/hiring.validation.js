const Joi = require("joi");
const { buildNameSchema, buildEmailSchema, buildPhoneSchema } = require("../../utils/joiValidators");

const objectId = Joi.string().hex().length(24);
const rating = Joi.number().integer().min(1).max(5).allow(null);

exports.createJobSchema = Joi.object({
  title: Joi.string().trim().min(2).max(120).required(),
  department: Joi.string().trim().max(120).allow("").optional(),
  employmentType: Joi.string()
    .valid("full_time", "part_time", "contract", "internship")
    .default("full_time"),
  location: Joi.string().trim().max(120).allow("").optional(),
  openings: Joi.number().integer().min(1).default(1),
  description: Joi.string().trim().max(5000).allow("").optional(),
  status: Joi.string().valid("draft", "open", "on_hold", "closed").default("open")
});

exports.updateJobSchema = Joi.object({
  title: Joi.string().trim().min(2).max(120).optional(),
  department: Joi.string().trim().max(120).allow("").optional(),
  employmentType: Joi.string().valid("full_time", "part_time", "contract", "internship").optional(),
  location: Joi.string().trim().max(120).allow("").optional(),
  openings: Joi.number().integer().min(1).optional(),
  description: Joi.string().trim().max(5000).allow("").optional(),
  status: Joi.string().valid("draft", "open", "on_hold", "closed").optional()
});

exports.listJobsQuerySchema = Joi.object({
  status: Joi.string().valid("draft", "open", "on_hold", "closed", "all").optional(),
  search: Joi.string().trim().allow("").optional()
});

exports.createCandidateSchema = Joi.object({
  jobId: objectId.required(),
  firstName: buildNameSchema({ min: 1, max: 120, required: true }),
  lastName: buildNameSchema({ max: 120, allowEmpty: true }),
  email: buildEmailSchema({ required: true }),
  phone: buildPhoneSchema({ allowEmpty: true }),
  source: Joi.string().trim().max(80).allow("").optional(),
  resumeUrl: Joi.string().uri().allow("").optional(),
  yearsExperience: Joi.number().min(0).optional(),
  currentLocation: Joi.string().trim().max(120).allow("").optional(),
  preferredLocation: Joi.string().trim().max(120).allow("").optional(),
  highestQualification: Joi.string().trim().max(120).allow("").optional(),
  specialization: Joi.string().trim().max(120).allow("").optional(),
  collegeName: Joi.string().trim().max(160).allow("").optional(),
  graduationYear: Joi.number().integer().min(1900).max(2100).allow(null).optional(),
  keySkills: Joi.array().items(Joi.string().trim().max(50)).optional(),
  linkedInUrl: Joi.string().uri().allow("").optional(),
  portfolioUrl: Joi.string().uri().allow("").optional(),
  currentCompany: Joi.string().trim().max(120).allow("").optional(),
  currentCTC: Joi.number().min(0).optional(),
  expectedCTC: Joi.number().min(0).optional(),
  noticePeriodDays: Joi.number().integer().min(0).optional(),
  futureConsideration: Joi.boolean().optional(),
  nextFollowUpAt: Joi.date().allow(null).optional(),
  stage: Joi.string().valid("applied", "screening", "interview", "offer", "hired", "rejected").optional(),
  status: Joi.string().valid("active", "hired", "rejected", "talent_pool", "withdrawn").optional(),
  assignedTo: objectId.allow(null, "").optional(),
  rating: Joi.number().min(0).max(5).optional(),
  remarks: Joi.string().trim().max(2000).allow("").optional(),
  interviewNotes: Joi.string().trim().max(4000).allow("").optional()
});

exports.updateCandidateSchema = Joi.object({
  jobId: objectId.optional(),
  firstName: buildNameSchema({ min: 1, max: 120 }),
  lastName: buildNameSchema({ max: 120, allowEmpty: true }),
  email: buildEmailSchema(),
  phone: buildPhoneSchema({ allowEmpty: true }),
  source: Joi.string().trim().max(80).allow("").optional(),
  resumeUrl: Joi.string().uri().allow("").optional(),
  yearsExperience: Joi.number().min(0).optional(),
  currentLocation: Joi.string().trim().max(120).allow("").optional(),
  preferredLocation: Joi.string().trim().max(120).allow("").optional(),
  highestQualification: Joi.string().trim().max(120).allow("").optional(),
  specialization: Joi.string().trim().max(120).allow("").optional(),
  collegeName: Joi.string().trim().max(160).allow("").optional(),
  graduationYear: Joi.number().integer().min(1900).max(2100).allow(null).optional(),
  keySkills: Joi.array().items(Joi.string().trim().max(50)).optional(),
  linkedInUrl: Joi.string().uri().allow("").optional(),
  portfolioUrl: Joi.string().uri().allow("").optional(),
  currentCompany: Joi.string().trim().max(120).allow("").optional(),
  currentCTC: Joi.number().min(0).optional(),
  expectedCTC: Joi.number().min(0).optional(),
  noticePeriodDays: Joi.number().integer().min(0).optional(),
  futureConsideration: Joi.boolean().optional(),
  nextFollowUpAt: Joi.date().allow(null).optional(),
  stage: Joi.string().valid("applied", "screening", "interview", "offer", "hired", "rejected").optional(),
  status: Joi.string().valid("active", "hired", "rejected", "talent_pool", "withdrawn").optional(),
  assignedTo: objectId.allow(null, "").optional(),
  rating: Joi.number().min(0).max(5).optional(),
  remarks: Joi.string().trim().max(2000).allow("").optional(),
  interviewNotes: Joi.string().trim().max(4000).allow("").optional()
});

exports.updateCandidateStageSchema = Joi.object({
  stage: Joi.string().valid("applied", "screening", "interview", "offer", "hired", "rejected").required(),
  note: Joi.string().trim().max(500).allow("").optional()
});

exports.releaseOfferLetterSchema = Joi.object({
  note: Joi.string().trim().max(500).allow("").optional()
});

exports.sendRejectionEmailSchema = Joi.object({
  note: Joi.string().trim().max(500).allow("").optional()
});

exports.convertCandidateToEmployeeSchema = Joi.object({
  password: Joi.string().min(6).required(),
  roleIds: Joi.array().items(objectId).min(1).required(),
  departmentId: objectId.required(),
  designationId: objectId.required(),
  employmentType: Joi.string().valid("full_time", "part_time", "contract").required(),
  dateOfJoining: Joi.date().required(),
  managerId: objectId.allow(null, "").optional(),
  shiftId: objectId.allow(null, "").optional()
});

exports.scheduleInterviewSchema = Joi.object({
  roundName: Joi.string().trim().max(50).default("L1"),
  interviewerEmployeeId: objectId.allow(null, "").optional(),
  scheduledAt: Joi.date().required(),
  mode: Joi.string().valid("virtual", "onsite", "phone").default("virtual"),
  meetingLink: Joi.string().uri().allow("").optional()
});

exports.submitInterviewFeedbackSchema = Joi.object({
  feedback: Joi.string().trim().max(4000).allow("").optional(),
  communication: rating.optional(),
  technical: rating.optional(),
  problemSolving: rating.optional(),
  cultureFit: rating.optional(),
  overall: rating.optional(),
  recommendation: Joi.string().valid("strong_hire", "hire", "hold", "reject").allow(null).optional(),
  status: Joi.string().valid("scheduled", "completed", "cancelled").default("completed")
});

exports.listCandidatesQuerySchema = Joi.object({
  jobId: objectId.optional(),
  stage: Joi.string().valid("applied", "screening", "interview", "offer", "hired", "rejected", "all").optional(),
  status: Joi.string().valid("active", "hired", "rejected", "talent_pool", "withdrawn", "all").optional(),
  search: Joi.string().trim().allow("").optional()
});
