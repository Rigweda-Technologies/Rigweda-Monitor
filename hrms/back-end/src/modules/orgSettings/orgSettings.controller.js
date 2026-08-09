const service = require("./orgSettings.service");
const { buildSuccessResponse } = require("../../utils/responseBuilder");

exports.get = async (req, res) => {
  const data = await service.get(req);
  res.status(200).json(buildSuccessResponse({ data }));
};

exports.upsert = async (req, res) => {
  const data = await service.upsert(req);
  res.status(200).json(
    buildSuccessResponse({
      message: "Organization settings saved",
      data
    })
  );
};
