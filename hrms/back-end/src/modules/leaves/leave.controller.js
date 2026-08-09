const service = require("./leave.service");
const { buildSuccessResponse } = require("../../utils/responseBuilder");

exports.apply = async (req, res) => {
  const data = await service.applyLeave(req);
  res.status(201).json(
    buildSuccessResponse({ message: "Leave applied" })
  );
};

exports.myLeaves = async (req, res) => {
  const data = await service.getMyLeaves(req);
  res.status(200).json(
    buildSuccessResponse({ data })
  );
};

exports.list = async (req, res) => {
  const data = await service.getAllLeaves(req);
  res.status(200).json(
    buildSuccessResponse({ data })
  );
};

exports.pendingMyApprovals = async (req, res) => {
  const data = await service.getMyPendingApprovals(req);
  res.status(200).json(
    buildSuccessResponse({ data })
  );
};

exports.myLeavesRange = async (req, res) => {
  const data = await service.getMyLeavesRange(req);
  res.status(200).json(
    buildSuccessResponse({ data })
  );
};

exports.applyContext = async (req, res) => {
  const data = await service.getApplyContext(req);
  res.status(200).json(
    buildSuccessResponse({ data })
  );
};

exports.action = async (req, res) => {
  const data = await service.actionLeave(req);
  res.status(200).json(
    buildSuccessResponse({ message: req.body.status })
  );
};

exports.requestRevert = async (req, res) => {
  const data = await service.requestLeaveRevert(req);
  res.status(200).json(
    buildSuccessResponse({ message: "Leave revert requested", data })
  );
};

exports.revertAction = async (req, res) => {
  const data = await service.actionLeaveRevert(req);
  res.status(200).json(
    buildSuccessResponse({ message: `Leave revert ${req.body.status}`, data })
  );
};
