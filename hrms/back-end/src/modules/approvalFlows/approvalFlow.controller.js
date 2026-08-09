const service = require("./approvalFlow.service");
const { buildSuccessResponse } = require("../../utils/responseBuilder");

exports.create = async (req, res) => {
  const data = await service.createFlow(req);
  res.status(201).json(buildSuccessResponse({ message: "Approval flow created", data }));
};

exports.list = async (req, res) => {
  const data = await service.listFlows(req);
  res.status(200).json(buildSuccessResponse({ data }));
};

exports.update = async (req, res) => {
  const data = await service.updateFlow(req);
  res.status(200).json(buildSuccessResponse({ message: "Approval flow updated", data }));
};

exports.remove = async (req, res) => {
  const data = await service.removeFlow(req);
  res.status(200).json(buildSuccessResponse({ message: "Approval flow deleted", data }));
};

