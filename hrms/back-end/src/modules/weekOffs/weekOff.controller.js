const service = require("./weekOff.service");
const { buildSuccessResponse } = require("../../utils/responseBuilder");

exports.upsert = async (req, res) => {
  const data = await service.upsert(req);
  res.status(200).json(
    buildSuccessResponse({
      message: "Week off configuration saved",
      data
    })
  );
};

exports.get = async (req, res) => {
  const data = await service.get(req);
  res.status(200).json(
    buildSuccessResponse({ data })
  );
};

exports.getAll = async (req, res) => {
  const data = await service.getAll(req);
  res.status(200).json(
    buildSuccessResponse({ data })
  );
};
