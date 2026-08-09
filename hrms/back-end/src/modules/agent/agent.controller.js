const agentService = require("./agent.service");
const { buildSuccessResponse, buildFailureResponse } = require("../../utils/responseBuilder");

exports.getMe = async (req, res) => {
  try {
    const data = await agentService.getCurrentAgent(req);
    return res.status(200).json(
      buildSuccessResponse({
        code: 200,
        message: "Agent profile fetched successfully",
        data
      })
    );
  } catch (error) {
    return res.status(error?.code || 500).json(
      buildFailureResponse({
        code: error?.code || 500,
        message: error?.message || "Failed to fetch agent profile",
        error
      })
    );
  }
};
