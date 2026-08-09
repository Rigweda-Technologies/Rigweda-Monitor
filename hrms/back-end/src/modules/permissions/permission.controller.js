const service = require("./permission.service");
const { buildSuccessResponse, buildFailureResponse } = require("../../utils/responseBuilder");

exports.list = async (req, res) => {
  try {
    const data = await service.listByOrganization(req.user.organizationId);
    return res.status(200).json(
      buildSuccessResponse({
        code: 200,
        message: "Permissions fetched successfully",
        data
      })
    );
  } catch (err) {
    return res.status(err.code || 500).json(
      buildFailureResponse({
        code: err.code || 500,
        message: err.message || "Failed to fetch permissions",
        error: err.error || null
      })
    );
  }
};
