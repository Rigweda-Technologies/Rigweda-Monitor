const hiringService = require("./hiring.service");
const { buildSuccessResponse } = require("../../utils/responseBuilder");

exports.overview = async (req, res) => {
  const data = await hiringService.getOverview(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Hiring overview fetched successfully",
      data
    })
  );
};

exports.createJob = async (req, res) => {
  const data = await hiringService.createJob(req);
  return res.status(201).json(
    buildSuccessResponse({
      message: "Job created successfully",
      data
    })
  );
};

exports.listJobs = async (req, res) => {
  const data = await hiringService.listJobs(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Jobs fetched successfully",
      data
    })
  );
};

exports.updateJob = async (req, res) => {
  const data = await hiringService.updateJob(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Job updated successfully",
      data
    })
  );
};

exports.removeJob = async (req, res) => {
  await hiringService.removeJob(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Job deleted successfully"
    })
  );
};

exports.createCandidate = async (req, res) => {
  const data = await hiringService.createCandidate(req);
  return res.status(201).json(
    buildSuccessResponse({
      message: "Candidate created successfully",
      data
    })
  );
};

exports.listCandidates = async (req, res) => {
  const data = await hiringService.listCandidates(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Candidates fetched successfully",
      data
    })
  );
};

exports.updateCandidate = async (req, res) => {
  const data = await hiringService.updateCandidate(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Candidate updated successfully",
      data
    })
  );
};

exports.updateCandidateStage = async (req, res) => {
  const data = await hiringService.updateCandidateStage(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Candidate stage updated successfully",
      data
    })
  );
};

exports.removeCandidate = async (req, res) => {
  await hiringService.removeCandidate(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Candidate deleted successfully"
    })
  );
};

exports.releaseOfferLetter = async (req, res) => {
  const data = await hiringService.releaseOfferLetter(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Offer letter released successfully",
      data
    })
  );
};

exports.sendRejectionEmail = async (req, res) => {
  const data = await hiringService.sendRejectionEmail(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Rejection email sent successfully",
      data
    })
  );
};

exports.convertCandidateToEmployee = async (req, res) => {
  const data = await hiringService.convertCandidateToEmployee(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Candidate converted to employee successfully",
      data
    })
  );
};

exports.scheduleInterview = async (req, res) => {
  const data = await hiringService.scheduleInterview(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Interview scheduled successfully",
      data
    })
  );
};

exports.submitInterviewFeedback = async (req, res) => {
  const data = await hiringService.submitInterviewFeedback(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Interview feedback submitted successfully",
      data
    })
  );
};

exports.listEmployees = async (req, res) => {
  const data = await hiringService.listEmployees(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Employees fetched successfully",
      data
    })
  );
};
