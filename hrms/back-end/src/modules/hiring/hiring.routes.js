const router = require("express").Router();
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const validate = require("../../middlewares/validate.middleware");
const asyncHandler = require("../../middlewares/asyncHandler");

const controller = require("./hiring.controller");
const {
  createJobSchema,
  updateJobSchema,
  listJobsQuerySchema,
  createCandidateSchema,
  updateCandidateSchema,
  updateCandidateStageSchema,
  releaseOfferLetterSchema,
  sendRejectionEmailSchema,
  convertCandidateToEmployeeSchema,
  scheduleInterviewSchema,
  submitInterviewFeedbackSchema,
  listCandidatesQuerySchema
} = require("./hiring.validation");

router.get(
  "/overview",
  auth,
  authorize(["HIRING_VIEW", "HIRING_MANAGE"]),
  asyncHandler(controller.overview)
);

router.get(
  "/employees",
  auth,
  authorize(["HIRING_VIEW", "HIRING_MANAGE"]),
  asyncHandler(controller.listEmployees)
);

router.post(
  "/jobs",
  auth,
  authorize("HIRING_MANAGE"),
  validate(createJobSchema),
  asyncHandler(controller.createJob)
);

router.get(
  "/jobs",
  auth,
  authorize(["HIRING_VIEW", "HIRING_MANAGE"]),
  validate(listJobsQuerySchema, "query"),
  asyncHandler(controller.listJobs)
);

router.put(
  "/jobs/:id",
  auth,
  authorize("HIRING_MANAGE"),
  validate(updateJobSchema),
  asyncHandler(controller.updateJob)
);

router.delete(
  "/jobs/:id",
  auth,
  authorize("HIRING_MANAGE"),
  asyncHandler(controller.removeJob)
);

router.post(
  "/candidates",
  auth,
  authorize("HIRING_MANAGE"),
  validate(createCandidateSchema),
  asyncHandler(controller.createCandidate)
);

router.get(
  "/candidates",
  auth,
  authorize(["HIRING_VIEW", "HIRING_MANAGE"]),
  validate(listCandidatesQuerySchema, "query"),
  asyncHandler(controller.listCandidates)
);

router.put(
  "/candidates/:id",
  auth,
  authorize("HIRING_MANAGE"),
  validate(updateCandidateSchema),
  asyncHandler(controller.updateCandidate)
);

router.put(
  "/candidates/:id/stage",
  auth,
  authorize("HIRING_MANAGE"),
  validate(updateCandidateStageSchema),
  asyncHandler(controller.updateCandidateStage)
);

router.post(
  "/candidates/:id/release-offer-letter",
  auth,
  authorize("HIRING_MANAGE"),
  validate(releaseOfferLetterSchema),
  asyncHandler(controller.releaseOfferLetter)
);

router.post(
  "/candidates/:id/send-rejection-email",
  auth,
  authorize("HIRING_MANAGE"),
  validate(sendRejectionEmailSchema),
  asyncHandler(controller.sendRejectionEmail)
);

router.post(
  "/candidates/:id/convert-to-employee",
  auth,
  authorize("HIRING_MANAGE"),
  validate(convertCandidateToEmployeeSchema),
  asyncHandler(controller.convertCandidateToEmployee)
);

router.post(
  "/candidates/:id/interviews",
  auth,
  authorize("HIRING_MANAGE"),
  validate(scheduleInterviewSchema),
  asyncHandler(controller.scheduleInterview)
);

router.put(
  "/candidates/:id/interviews/:interviewId/feedback",
  auth,
  authorize("HIRING_MANAGE"),
  validate(submitInterviewFeedbackSchema),
  asyncHandler(controller.submitInterviewFeedback)
);

router.delete(
  "/candidates/:id",
  auth,
  authorize("HIRING_MANAGE"),
  asyncHandler(controller.removeCandidate)
);

module.exports = router;
