const service = require("./holiday.service");
const { buildSuccessResponse } = require("../../utils/responseBuilder");

exports.create = async (req, res) => {
  const data = await service.create(req);
  res.status(201).json(
    buildSuccessResponse({ message: req.body.name + " Holiday created" })
  );
};

exports.list = async (req, res) => {
  const data = await service.list(req);
  res.status(200).json(
    buildSuccessResponse({ data })
  );
};

exports.update = async (req, res) => {
  const data = await service.update(req.params.id, req);
  res.status(200).json(
    buildSuccessResponse({ message: "Holiday updated", data })
  );
};

exports.remove = async (req, res) => {
  await service.remove(req.params.id, req);
  res.status(200).json(
    buildSuccessResponse({ message: "Holiday deleted" })
  );
};
