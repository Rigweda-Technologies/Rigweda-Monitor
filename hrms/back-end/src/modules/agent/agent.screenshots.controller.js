const screenshotsService = require("./agent.screenshots.service");
const { buildSuccessResponse } = require("../../utils/responseBuilder");

exports.listScreenshots = async (req, res) => {
  const data = await screenshotsService.getScreenshots(req);
  return res.status(200).json(
    buildSuccessResponse({
      code: 200,
      message: "Screenshots fetched successfully",
      data
    })
  );
};
