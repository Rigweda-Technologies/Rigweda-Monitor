const service = require("./shift.service");
const { buildSuccessResponse } = require("../../utils/responseBuilder");

exports.create = async (req, res) => {
  const data = await service.createShift(req);
  res.status(201).json(buildSuccessResponse({ message: "Shift created", data }));
};

exports.list = async (req, res) => {
  const data = await service.listShifts(req);
  res.status(200).json(buildSuccessResponse({ data }));
};

exports.update = async (req, res) => {
  const data = await service.updateShift(req);
  res.status(200).json(buildSuccessResponse({ message: "Shift updated", data }));
};

exports.remove = async (req, res) => {
  const data = await service.removeShift(req);
  res.status(200).json(buildSuccessResponse({ message: "Shift deactivated", data }));
};

exports.myShift = async (req, res) => {
  const data = await service.getMyShift(req);
  res.status(200).json(buildSuccessResponse({ data }));
};

