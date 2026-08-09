const service = require("./timesheet.service");
const { buildSuccessResponse } = require("../../utils/responseBuilder");

const toNameCase = (value) => {
  if (value === undefined || value === null) return value;
  const text = String(value).trim().replace(/\s+/g, " ");
  if (!text) return "";
  return text
    .split(" ")
    .map((part) =>
      part
        .split("-")
        .map((segment) =>
          segment ? `${segment.charAt(0).toUpperCase()}${segment.slice(1).toLowerCase()}` : segment
        )
        .join("-")
    )
    .join(" ");
};

const normalizeNameFieldsDeep = (input) => {
  if (Array.isArray(input)) {
    return input.map((item) => normalizeNameFieldsDeep(item));
  }
  if (!input || typeof input !== "object") return input;
  if (input instanceof Date) return input;

  const source =
    typeof input.toObject === "function"
      ? input.toObject()
      : input;

  const output = {};
  Object.keys(source).forEach((key) => {
    const value = source[key];
    if (key === "firstName" || key === "lastName") {
      output[key] = toNameCase(value);
      return;
    }
    output[key] = normalizeNameFieldsDeep(value);
  });
  return output;
};

const buildNormalizedSuccessResponse = (payload) =>
  buildSuccessResponse(normalizeNameFieldsDeep(payload));

exports.checkIn = async (req, res) => {
  const data = await service.checkIn(req);
  res.status(201).json(buildNormalizedSuccessResponse({ message: "Checked in", data }));
};

exports.checkOut = async (req, res) => {
  const data = await service.checkOut(req);
  res.status(200).json(buildNormalizedSuccessResponse({ message: "Checked out", data }));
};

exports.getCheckInPolicy = async (req, res) => {
  const data = await service.getCheckInPolicy(req);
  res.status(200).json(buildNormalizedSuccessResponse({ data }));
};

exports.myAttendance = async (req, res) => {
  const data = await service.getMyAttendance(req);
  res.status(200).json(buildNormalizedSuccessResponse({ data }));
};

exports.attendanceList = async (req, res) => {
  const data = await service.getAttendance(req);
  res.status(200).json(buildNormalizedSuccessResponse({ data }));
};

exports.attendanceMatrix = async (req, res) => {
  const data = await service.getAttendanceMatrix(req);
  res.status(200).json(buildNormalizedSuccessResponse({ data }));
};

exports.myAttendanceMatrix = async (req, res) => {
  const data = await service.getMyAttendanceMatrix(req);
  res.status(200).json(buildNormalizedSuccessResponse({ data }));
};

exports.attendanceCellHistory = async (req, res) => {
  const data = await service.getAttendanceCellHistory(req);
  res.status(200).json(buildNormalizedSuccessResponse({ data }));
};

exports.myAttendanceCellHistory = async (req, res) => {
  const data = await service.getMyAttendanceCellHistory(req);
  res.status(200).json(buildNormalizedSuccessResponse({ data }));
};

exports.overrideAttendance = async (req, res) => {
  const data = await service.overrideAttendance(req);
  res.status(200).json(buildNormalizedSuccessResponse({ message: "Attendance updated", data }));
};

exports.bulkOverrideAttendance = async (req, res) => {
  const data = await service.bulkOverrideAttendance(req);
  res.status(200).json(buildNormalizedSuccessResponse({ message: "Attendance bulk updated", data }));
};

exports.customBulkOverrideAttendance = async (req, res) => {
  const data = await service.customBulkOverrideAttendance(req);
  res.status(200).json(buildNormalizedSuccessResponse({ message: "Customized attendance updated", data }));
};

exports.lockAttendanceMonth = async (req, res) => {
  const data = await service.lockAttendanceMonth(req);
  res.status(200).json(buildNormalizedSuccessResponse({ message: "Attendance locked for payroll", data }));
};

exports.raiseAttendanceRequest = async (req, res) => {
  const data = await service.raiseAttendanceRequest(req);
  res.status(201).json(buildNormalizedSuccessResponse({ message: "Attendance request raised", data }));
};

exports.attendanceRequestDefaults = async (req, res) => {
  const data = await service.getAttendanceRequestDefaults(req);
  res.status(200).json(buildNormalizedSuccessResponse({ data }));
};

exports.myAttendanceRequests = async (req, res) => {
  const data = await service.getMyAttendanceRequests(req);
  res.status(200).json(buildNormalizedSuccessResponse({ data }));
};

exports.attendanceRequests = async (req, res) => {
  const data = await service.getAttendanceRequests(req);
  res.status(200).json(buildNormalizedSuccessResponse({ data }));
};

exports.pendingMyAttendanceApprovals = async (req, res) => {
  const data = await service.getMyPendingAttendanceApprovals(req);
  res.status(200).json(buildNormalizedSuccessResponse({ data }));
};

exports.actionAttendanceRequest = async (req, res) => {
  const data = await service.actionAttendanceRequest(req);
  res.status(200).json(buildNormalizedSuccessResponse({ message: `Attendance request ${req.body.status}`, data }));
};

exports.online = async (req, res) => {
  const data = await service.getOnline(req);
  res.status(200).json(buildNormalizedSuccessResponse({ data }));
};

exports.onLeave = async (req, res) => {
  const data = await service.getOnLeave(req);
  res.status(200).json(buildNormalizedSuccessResponse({ data }));
};

exports.createWeekly = async (req, res) => {
  const data = await service.createWeekly(req);
  res.status(201).json(buildNormalizedSuccessResponse({ message: "Timesheet created", data }));
};

exports.updateWeekly = async (req, res) => {
  const data = await service.updateWeekly(req);
  res.status(200).json(buildNormalizedSuccessResponse({ message: "Timesheet updated", data }));
};

exports.submitWeekly = async (req, res) => {
  const data = await service.submitWeekly(req);
  res.status(200).json(buildNormalizedSuccessResponse({ message: "Timesheet submitted", data }));
};

exports.myWeekly = async (req, res) => {
  const data = await service.getMyWeekly(req);
  res.status(200).json(buildNormalizedSuccessResponse({ data }));
};

exports.listWeekly = async (req, res) => {
  const data = await service.getAllWeekly(req);
  res.status(200).json(buildNormalizedSuccessResponse({ data }));
};

exports.actionWeekly = async (req, res) => {
  const data = await service.actionWeekly(req);
  res.status(200).json(buildNormalizedSuccessResponse({ message: req.body.status, data }));
};

exports.recallWeekly = async (req, res) => {
  const data = await service.recallWeekly(req);
  res.status(200).json(buildNormalizedSuccessResponse({ message: "Timesheet recalled", data }));
};
