const service = require("./dashboard.service");
const { buildSuccessResponse } = require("../../utils/responseBuilder");

exports.summary = async (req, res) => {
  const data = await service.getSummary(req);
  res.status(200).json(buildSuccessResponse({ data }));
};

