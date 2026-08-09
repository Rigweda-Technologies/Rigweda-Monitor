const HiringJob = require("./hiringJob.model");
const HiringCandidate = require("./hiringCandidate.model");
const Employee = require("../employees/employee.model");
const Organization = require("../organizations/organization.model");
const { createOrgUser } = require("../users/user.service");
const { audit } = require("../auditLogs/auditLogs.service");
const sendMail = require("../../utils/sendMail");

const toKey = (value) => String(value || "").trim().toLowerCase();

const normalizeCandidateStatusByStage = (stage, futureConsideration = true) => {
  if (stage === "hired") return "hired";
  if (stage === "rejected") return futureConsideration ? "talent_pool" : "rejected";
  return "active";
};

const normalizeSkills = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((s) => String(s || "").trim())
    .filter(Boolean)
    .slice(0, 30);
};

const formatEmploymentType = (value) =>
  String(value || "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Full Time";

const sendOfferLetterEmail = async ({ organizationId, candidate, job }) => {
  if (!candidate?.email) return false;

  const org = await Organization.findById(organizationId).select("name");
  const candidateName = `${candidate.firstName || ""} ${candidate.lastName || ""}`.trim() || "Candidate";
  const jobTitle = job?.title || "Position";
  const companyName = org?.name || "Our Company";
  const expectedCTC =
    Number(candidate?.expectedCTC || 0) > 0
      ? `INR ${Number(candidate.expectedCTC).toLocaleString("en-IN")} per annum`
      : "As discussed";

  return sendMail(
    "offerLetter",
    candidateName,
    `Offer Letter - ${jobTitle}`,
    {
      candidateName,
      jobTitle,
      companyName,
      location: job?.location || "As discussed",
      employmentType: formatEmploymentType(job?.employmentType),
      expectedCTC,
      hrEmail: process.env.HR_CONTACT_EMAIL || process.env.SMTP_USER || "",
      portalUrl: process.env.FRONTEND_LOGIN_URL || ""
    },
    candidate.email
  );
};

const sendRejectionNoticeEmail = async ({ organizationId, candidate, job }) => {
  if (!candidate?.email) return false;

  const org = await Organization.findById(organizationId).select("name");
  const candidateName = `${candidate.firstName || ""} ${candidate.lastName || ""}`.trim() || "Candidate";
  const companyName = org?.name || "Our Company";
  const jobTitle = job?.title || "the role";

  return sendMail(
    "candidateRejection",
    candidateName,
    `Application Update - ${jobTitle}`,
    {
      candidateName,
      companyName,
      jobTitle,
      hrEmail: process.env.HR_CONTACT_EMAIL || process.env.SMTP_USER || ""
    },
    candidate.email
  );
};

const resolveAssignedTo = async ({ organizationId, assignedTo }) => {
  if (!assignedTo) return null;
  const exists = await Employee.findOne({
    _id: assignedTo,
    organizationId,
    status: "active"
  }).select("_id");
  if (!exists) {
    throw { code: 400, message: "Assigned employee not found" };
  }
  return exists._id;
};

const resolveInterviewer = async ({ organizationId, interviewerEmployeeId }) => {
  if (!interviewerEmployeeId) return null;
  const exists = await Employee.findOne({
    _id: interviewerEmployeeId,
    organizationId,
    status: "active"
  }).select("_id");
  if (!exists) {
    throw { code: 400, message: "Interviewer employee not found" };
  }
  return exists._id;
};

const assertJobExists = async ({ organizationId, jobId }) => {
  const job = await HiringJob.findOne({
    _id: jobId,
    organizationId
  }).select("_id status");
  if (!job) throw { code: 400, message: "Job not found" };
  return job;
};

exports.createJob = async (req) => {
  const organizationId = req.user.organizationId;
  const titleKey = toKey(req.body.title);
  const duplicate = await HiringJob.findOne({ organizationId, titleKey }).select("_id");
  if (duplicate) throw { code: 409, message: "Job title already exists" };

  const row = await HiringJob.create({
    organizationId,
    title: req.body.title,
    titleKey,
    department: req.body.department || "",
    employmentType: req.body.employmentType || "full_time",
    location: req.body.location || "",
    openings: Number(req.body.openings || 1),
    description: req.body.description || "",
    status: req.body.status || "open",
    createdBy: req.user.userId,
    updatedBy: req.user.userId
  });

  await audit({
    req,
    module: "hiring",
    action: "JOB_CREATE",
    entityId: row._id,
    after: row.toObject()
  });

  return row;
};

exports.listJobs = async (req) => {
  const query = { organizationId: req.user.organizationId };
  if (req.query.status && req.query.status !== "all") {
    query.status = req.query.status;
  }
  if (req.query.search) {
    const search = String(req.query.search).trim();
    query.$or = [
      { title: { $regex: search, $options: "i" } },
      { department: { $regex: search, $options: "i" } },
      { location: { $regex: search, $options: "i" } }
    ];
  }

  return HiringJob.find(query).sort({ createdAt: -1 }).lean();
};

exports.updateJob = async (req) => {
  const row = await HiringJob.findOne({
    _id: req.params.id,
    organizationId: req.user.organizationId
  });
  if (!row) throw { code: 404, message: "Job not found" };
  const before = row.toObject();

  if (req.body.title !== undefined) {
    const titleKey = toKey(req.body.title);
    const duplicate = await HiringJob.findOne({
      _id: { $ne: row._id },
      organizationId: req.user.organizationId,
      titleKey
    }).select("_id");
    if (duplicate) throw { code: 409, message: "Job title already exists" };
    row.title = req.body.title;
    row.titleKey = titleKey;
  }

  if (req.body.department !== undefined) row.department = req.body.department || "";
  if (req.body.employmentType !== undefined) row.employmentType = req.body.employmentType;
  if (req.body.location !== undefined) row.location = req.body.location || "";
  if (req.body.openings !== undefined) row.openings = Number(req.body.openings || 1);
  if (req.body.description !== undefined) row.description = req.body.description || "";
  if (req.body.status !== undefined) row.status = req.body.status;
  row.updatedBy = req.user.userId;
  await row.save();

  await audit({
    req,
    module: "hiring",
    action: "JOB_UPDATE",
    entityId: row._id,
    before,
    after: row.toObject()
  });

  return row;
};

exports.removeJob = async (req) => {
  const row = await HiringJob.findOne({
    _id: req.params.id,
    organizationId: req.user.organizationId
  });
  if (!row) throw { code: 404, message: "Job not found" };
  const before = row.toObject();

  row.isDeleted = true;
  row.deletedAt = new Date();
  row.deletedBy = req.user.userId;
  row.updatedBy = req.user.userId;
  await row.save();

  await HiringCandidate.updateMany(
    { organizationId: req.user.organizationId, jobId: row._id },
    {
      $set: {
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: req.user.userId,
        updatedBy: req.user.userId
      }
    }
  );

  await audit({
    req,
    module: "hiring",
    action: "JOB_DELETE",
    entityId: row._id,
    before,
    after: row.toObject()
  });
};

exports.createCandidate = async (req) => {
  const organizationId = req.user.organizationId;
  const stage = req.body.stage || "applied";
  await assertJobExists({ organizationId, jobId: req.body.jobId });

  const duplicate = await HiringCandidate.findOne({
    organizationId,
    jobId: req.body.jobId,
    email: String(req.body.email || "").toLowerCase().trim()
  }).select("_id");
  if (duplicate) throw { code: 409, message: "Candidate already exists for this job" };

  const assignedTo = await resolveAssignedTo({
    organizationId,
    assignedTo: req.body.assignedTo || null
  });
  const futureConsideration = req.body.futureConsideration !== undefined
    ? Boolean(req.body.futureConsideration)
    : true;
  const status = req.body.status || normalizeCandidateStatusByStage(stage, futureConsideration);

  const row = await HiringCandidate.create({
    organizationId,
    jobId: req.body.jobId,
    firstName: req.body.firstName,
    lastName: req.body.lastName || "",
    email: String(req.body.email || "").toLowerCase().trim(),
    phone: req.body.phone || "",
    source: req.body.source || "direct",
    resumeUrl: req.body.resumeUrl || "",
    yearsExperience: Number(req.body.yearsExperience || 0),
    currentLocation: req.body.currentLocation || "",
    preferredLocation: req.body.preferredLocation || "",
    highestQualification: req.body.highestQualification || "",
    specialization: req.body.specialization || "",
    collegeName: req.body.collegeName || "",
    graduationYear: req.body.graduationYear || null,
    keySkills: normalizeSkills(req.body.keySkills),
    linkedInUrl: req.body.linkedInUrl || "",
    portfolioUrl: req.body.portfolioUrl || "",
    currentCompany: req.body.currentCompany || "",
    currentCTC: Number(req.body.currentCTC || 0),
    expectedCTC: Number(req.body.expectedCTC || 0),
    noticePeriodDays: Number(req.body.noticePeriodDays || 0),
    futureConsideration,
    nextFollowUpAt: req.body.nextFollowUpAt || null,
    lastRejectedAt: stage === "rejected" ? new Date() : null,
    stage,
    status,
    assignedTo,
    rating: Number(req.body.rating || 0),
    remarks: req.body.remarks || "",
    interviewNotes: req.body.interviewNotes || "",
    stageTimeline: [
      {
        stage,
        changedBy: req.user.userId,
        note: "Initial stage"
      }
    ],
    createdBy: req.user.userId,
    updatedBy: req.user.userId
  });

  await audit({
    req,
    module: "hiring",
    action: "CANDIDATE_CREATE",
    entityId: row._id,
    after: row.toObject()
  });

  return row;
};

exports.listCandidates = async (req) => {
  const query = { organizationId: req.user.organizationId };

  if (req.query.jobId) query.jobId = req.query.jobId;
  if (req.query.stage && req.query.stage !== "all") query.stage = req.query.stage;
  if (req.query.status && req.query.status !== "all") query.status = req.query.status;
  if (req.query.search) {
    const search = String(req.query.search).trim();
    query.$or = [
      { firstName: { $regex: search, $options: "i" } },
      { lastName: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
      { phone: { $regex: search, $options: "i" } },
      { keySkills: { $regex: search, $options: "i" } }
    ];
  }

  return HiringCandidate.find(query)
    .populate("jobId", "title status")
    .populate("assignedTo", "firstName lastName employeeCode")
    .populate("interviews.interviewerEmployeeId", "firstName lastName employeeCode")
    .sort({ createdAt: -1 })
    .lean();
};

exports.updateCandidate = async (req) => {
  const row = await HiringCandidate.findOne({
    _id: req.params.id,
    organizationId: req.user.organizationId
  });
  if (!row) throw { code: 404, message: "Candidate not found" };
  const before = row.toObject();

  if (req.body.jobId !== undefined && String(req.body.jobId) !== String(row.jobId)) {
    await assertJobExists({ organizationId: req.user.organizationId, jobId: req.body.jobId });
    const duplicate = await HiringCandidate.findOne({
      _id: { $ne: row._id },
      organizationId: req.user.organizationId,
      jobId: req.body.jobId,
      email: String(req.body.email || row.email).toLowerCase().trim()
    }).select("_id");
    if (duplicate) throw { code: 409, message: "Candidate already exists for this job" };
    row.jobId = req.body.jobId;
  }

  if (req.body.firstName !== undefined) row.firstName = req.body.firstName;
  if (req.body.lastName !== undefined) row.lastName = req.body.lastName || "";
  if (req.body.email !== undefined) row.email = String(req.body.email || "").toLowerCase().trim();
  if (req.body.phone !== undefined) row.phone = req.body.phone || "";
  if (req.body.source !== undefined) row.source = req.body.source || "";
  if (req.body.resumeUrl !== undefined) row.resumeUrl = req.body.resumeUrl || "";
  if (req.body.yearsExperience !== undefined) row.yearsExperience = Number(req.body.yearsExperience || 0);
  if (req.body.currentLocation !== undefined) row.currentLocation = req.body.currentLocation || "";
  if (req.body.preferredLocation !== undefined) row.preferredLocation = req.body.preferredLocation || "";
  if (req.body.highestQualification !== undefined) row.highestQualification = req.body.highestQualification || "";
  if (req.body.specialization !== undefined) row.specialization = req.body.specialization || "";
  if (req.body.collegeName !== undefined) row.collegeName = req.body.collegeName || "";
  if (req.body.graduationYear !== undefined) row.graduationYear = req.body.graduationYear || null;
  if (req.body.keySkills !== undefined) row.keySkills = normalizeSkills(req.body.keySkills);
  if (req.body.linkedInUrl !== undefined) row.linkedInUrl = req.body.linkedInUrl || "";
  if (req.body.portfolioUrl !== undefined) row.portfolioUrl = req.body.portfolioUrl || "";
  if (req.body.currentCompany !== undefined) row.currentCompany = req.body.currentCompany || "";
  if (req.body.currentCTC !== undefined) row.currentCTC = Number(req.body.currentCTC || 0);
  if (req.body.expectedCTC !== undefined) row.expectedCTC = Number(req.body.expectedCTC || 0);
  if (req.body.noticePeriodDays !== undefined) row.noticePeriodDays = Number(req.body.noticePeriodDays || 0);
  if (req.body.futureConsideration !== undefined) row.futureConsideration = Boolean(req.body.futureConsideration);
  if (req.body.nextFollowUpAt !== undefined) row.nextFollowUpAt = req.body.nextFollowUpAt || null;
  if (req.body.rating !== undefined) row.rating = Number(req.body.rating || 0);
  if (req.body.remarks !== undefined) row.remarks = req.body.remarks || "";
  if (req.body.interviewNotes !== undefined) row.interviewNotes = req.body.interviewNotes || "";
  if (req.body.status !== undefined) row.status = req.body.status;
  if (req.body.stage !== undefined && req.body.stage !== row.stage) {
    const previousStage = row.stage;
    row.stage = req.body.stage;
    row.stageTimeline = row.stageTimeline || [];
    row.stageTimeline.push({
      stage: req.body.stage,
      changedBy: req.user.userId,
      note: "Stage updated"
    });
    if (req.body.status === undefined) {
      row.status = normalizeCandidateStatusByStage(req.body.stage, row.futureConsideration);
    }
    row.lastRejectedAt = req.body.stage === "rejected" ? new Date() : row.lastRejectedAt;

  }

  if (req.body.assignedTo !== undefined) {
    row.assignedTo = await resolveAssignedTo({
      organizationId: req.user.organizationId,
      assignedTo: req.body.assignedTo || null
    });
  }

  row.updatedBy = req.user.userId;
  await row.save();

  await audit({
    req,
    module: "hiring",
    action: "CANDIDATE_UPDATE",
    entityId: row._id,
    before,
    after: row.toObject()
  });

  return row;
};

exports.updateCandidateStage = async (req) => {
  const row = await HiringCandidate.findOne({
    _id: req.params.id,
    organizationId: req.user.organizationId
  });
  if (!row) throw { code: 404, message: "Candidate not found" };
  const before = row.toObject();

  const previousStage = row.stage;
  row.stage = req.body.stage;
  row.status = normalizeCandidateStatusByStage(req.body.stage, row.futureConsideration);
  row.lastRejectedAt = req.body.stage === "rejected" ? new Date() : row.lastRejectedAt;
  row.stageTimeline = row.stageTimeline || [];
  row.stageTimeline.push({
    stage: req.body.stage,
    changedBy: req.user.userId,
    note: req.body.note || ""
  });
  row.updatedBy = req.user.userId;
  await row.save();

  await audit({
    req,
    module: "hiring",
    action: "CANDIDATE_STAGE_UPDATE",
    entityId: row._id,
    before,
    after: row.toObject()
  });

  return row;
};

exports.releaseOfferLetter = async (req) => {
  const row = await HiringCandidate.findOne({
    _id: req.params.id,
    organizationId: req.user.organizationId
  });
  if (!row) throw { code: 404, message: "Candidate not found" };
  if (row.stage !== "offer") {
    throw { code: 400, message: "Offer letter can be released only for candidates in offer stage" };
  }

  const job = await HiringJob.findById(row.jobId).select("title location employmentType");
  const sent = await sendOfferLetterEmail({
    organizationId: req.user.organizationId,
    candidate: row,
    job
  });
  if (!sent) {
    throw { code: 500, message: "Failed to send offer letter email" };
  }

  const before = row.toObject();
  row.offerLetterReleasedAt = new Date();
  row.offerLetterReleasedBy = req.user.userId;
  row.updatedBy = req.user.userId;
  row.stageTimeline = row.stageTimeline || [];
  row.stageTimeline.push({
    stage: "offer",
    changedBy: req.user.userId,
    note: req.body.note || "Offer letter released"
  });
  await row.save();

  await audit({
    req,
    module: "hiring",
    action: "OFFER_LETTER_RELEASE",
    entityId: row._id,
    before,
    after: row.toObject()
  });

  return row;
};

exports.sendRejectionEmail = async (req) => {
  const row = await HiringCandidate.findOne({
    _id: req.params.id,
    organizationId: req.user.organizationId
  });
  if (!row) throw { code: 404, message: "Candidate not found" };
  if (row.stage !== "rejected") {
    throw { code: 400, message: "Rejection email can be sent only for candidates in rejected stage" };
  }

  const job = await HiringJob.findById(row.jobId).select("title");
  const sent = await sendRejectionNoticeEmail({
    organizationId: req.user.organizationId,
    candidate: row,
    job
  });
  if (!sent) {
    throw { code: 500, message: "Failed to send rejection email" };
  }

  const before = row.toObject();
  row.rejectionEmailSentAt = new Date();
  row.rejectionEmailSentBy = req.user.userId;
  row.updatedBy = req.user.userId;
  row.stageTimeline = row.stageTimeline || [];
  row.stageTimeline.push({
    stage: "rejected",
    changedBy: req.user.userId,
    note: req.body.note || "Rejection email sent"
  });
  await row.save();

  await audit({
    req,
    module: "hiring",
    action: "REJECTION_EMAIL_SEND",
    entityId: row._id,
    before,
    after: row.toObject()
  });

  return row;
};

exports.convertCandidateToEmployee = async (req) => {
  const organizationId = req.user.organizationId;
  const row = await HiringCandidate.findOne({
    _id: req.params.id,
    organizationId
  });
  if (!row) throw { code: 404, message: "Candidate not found" };
  if (row.stage !== "hired") {
    throw { code: 400, message: "Only hired candidates can be converted to employees" };
  }
  if (row.convertedToEmployeeId) {
    throw { code: 409, message: "Candidate is already converted to employee" };
  }

  const before = row.toObject();
  const firstName = String(row.firstName || "").trim();
  const lastName = String(row.lastName || "").trim() || "Candidate";
  const email = String(row.email || "").toLowerCase().trim();
  if (!firstName || !email) {
    throw { code: 400, message: "Candidate first name and email are required for conversion" };
  }

  const createdUser = await createOrgUser({
    email,
    password: req.body.password,
    roleIds: req.body.roleIds,
    firstName,
    lastName,
    departmentId: req.body.departmentId,
    designationId: req.body.designationId,
    employmentType: req.body.employmentType,
    dateOfJoining: req.body.dateOfJoining,
    managerId: req.body.managerId || undefined,
    shiftId: req.body.shiftId || undefined,
    creator: req.user
  });

  const employee = await Employee.findOne({
    organizationId,
    userId: createdUser.userId
  }).select("_id");

  row.convertedToEmployeeId = employee?._id || null;
  row.convertedAt = new Date();
  row.convertedBy = req.user.userId;
  row.updatedBy = req.user.userId;
  row.stageTimeline = row.stageTimeline || [];
  row.stageTimeline.push({
    stage: "hired",
    changedBy: req.user.userId,
    note: "Converted to employee"
  });
  await row.save();

  await audit({
    req,
    module: "hiring",
    action: "CANDIDATE_CONVERT_TO_EMPLOYEE",
    entityId: row._id,
    before,
    after: row.toObject()
  });

  return {
    candidateId: row._id,
    employeeId: row.convertedToEmployeeId,
    userId: createdUser.userId,
    email: createdUser.email
  };
};

exports.scheduleInterview = async (req) => {
  const row = await HiringCandidate.findOne({
    _id: req.params.id,
    organizationId: req.user.organizationId
  });
  if (!row) throw { code: 404, message: "Candidate not found" };
  if (["hired", "rejected"].includes(row.stage)) {
    throw { code: 400, message: "Interview cannot be scheduled for this candidate stage" };
  }

  const interviewerEmployeeId = await resolveInterviewer({
    organizationId: req.user.organizationId,
    interviewerEmployeeId: req.body.interviewerEmployeeId || null
  });

  const before = row.toObject();
  row.interviews = row.interviews || [];
  row.interviews.push({
    roundName: req.body.roundName || "L1",
    interviewerEmployeeId,
    scheduledAt: new Date(req.body.scheduledAt),
    mode: req.body.mode || "virtual",
    meetingLink: req.body.meetingLink || "",
    status: "scheduled",
    createdBy: req.user.userId,
    updatedBy: req.user.userId
  });
  row.updatedBy = req.user.userId;
  await row.save();

  await audit({
    req,
    module: "hiring",
    action: "INTERVIEW_SCHEDULE",
    entityId: row._id,
    before,
    after: row.toObject()
  });

  return row;
};

exports.submitInterviewFeedback = async (req) => {
  const row = await HiringCandidate.findOne({
    _id: req.params.id,
    organizationId: req.user.organizationId
  });
  if (!row) throw { code: 404, message: "Candidate not found" };

  const interview = (row.interviews || []).id(req.params.interviewId);
  if (!interview) {
    throw { code: 404, message: "Interview not found" };
  }

  const before = row.toObject();
  interview.feedback = req.body.feedback || "";
  interview.scorecard = {
    communication: req.body.communication ?? interview.scorecard?.communication ?? null,
    technical: req.body.technical ?? interview.scorecard?.technical ?? null,
    problemSolving: req.body.problemSolving ?? interview.scorecard?.problemSolving ?? null,
    cultureFit: req.body.cultureFit ?? interview.scorecard?.cultureFit ?? null,
    overall: req.body.overall ?? interview.scorecard?.overall ?? null
  };
  interview.recommendation = req.body.recommendation ?? interview.recommendation ?? null;
  interview.status = req.body.status || "completed";
  interview.updatedBy = req.user.userId;
  row.updatedBy = req.user.userId;
  await row.save();

  await audit({
    req,
    module: "hiring",
    action: "INTERVIEW_FEEDBACK_SUBMIT",
    entityId: row._id,
    before,
    after: row.toObject()
  });

  return row;
};

exports.removeCandidate = async (req) => {
  const row = await HiringCandidate.findOne({
    _id: req.params.id,
    organizationId: req.user.organizationId
  });
  if (!row) throw { code: 404, message: "Candidate not found" };
  const before = row.toObject();

  row.isDeleted = true;
  row.deletedAt = new Date();
  row.deletedBy = req.user.userId;
  row.updatedBy = req.user.userId;
  await row.save();

  await audit({
    req,
    module: "hiring",
    action: "CANDIDATE_DELETE",
    entityId: row._id,
    before,
    after: row.toObject()
  });
};

exports.getOverview = async (req) => {
  const organizationId = req.user.organizationId;
  const [
    totalJobs,
    openJobs,
    totalCandidates,
    stageBreakdown
  ] = await Promise.all([
    HiringJob.countDocuments({ organizationId }),
    HiringJob.countDocuments({ organizationId, status: "open" }),
    HiringCandidate.countDocuments({ organizationId }),
    HiringCandidate.aggregate([
      { $match: { organizationId, isDeleted: false } },
      { $group: { _id: "$stage", count: { $sum: 1 } } }
    ])
  ]);

  const stageMap = {
    applied: 0,
    screening: 0,
    interview: 0,
    offer: 0,
    hired: 0,
    rejected: 0
  };
  for (const row of stageBreakdown || []) {
    if (row?._id && stageMap[row._id] !== undefined) {
      stageMap[row._id] = Number(row.count || 0);
    }
  }

  return {
    totalJobs,
    openJobs,
    totalCandidates,
    stageBreakdown: stageMap
  };
};

exports.listEmployees = async (req) => {
  return Employee.find({
    organizationId: req.user.organizationId,
    status: "active"
  })
    .select("_id firstName lastName employeeCode")
    .sort({ firstName: 1, lastName: 1 })
    .lean();
};
