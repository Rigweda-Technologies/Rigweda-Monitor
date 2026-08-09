const leaveTypeService = require("./leaveType.service");
const { buildSuccessResponse, buildFailureResponse } = require("../../utils/responseBuilder");

exports.create = async (req, res) => {
  const data = await leaveTypeService.createLeaveType(req);
  return res.status(201).json(buildSuccessResponse({ data }));
};

exports.list = async (req, res) => {
  // Assuming activeOrganizationId is attached to req.user by auth middleware
  const orgId = req.user.organizationId; 
  const data = await leaveTypeService.getLeaveTypesByOrg(orgId);
  return res.status(200).json(buildSuccessResponse({ data }));
};

/**
 * UPDATE LEAVE TYPE (Can be used to change name, days, or status)
 */
exports.update = async (req, res) => {
  try {
    const leaveType = await leaveTypeService.updateLeaveType(
      req.params.id,
      req.body
    );

    return res.status(200).json(
      buildSuccessResponse({
        code: 200,
        message: "Leave type updated successfully",
        data: leaveType
      })
    );
  } catch (err) {
    return res.status(err.code || 500).json(
      buildFailureResponse({
        code: err.code || 500,
        message: err.message || "Failed to update leave type",
        error: err.error || null
      })
    );
  }
};

/**
 * DELETE (SOFT) - Disables the leave type
 */
exports.deleteById = async (req, res) => {
  try {
    await leaveTypeService.deleteLeaveType(req.params.id);

    return res.status(200).json(
      buildSuccessResponse({
        code: 200,
        message: "Leave type deactivated successfully"
      })
    );
  } catch (err) {
    return res.status(err.code || 500).json(
      buildFailureResponse({
        code: err.code || 500,
        message: err.message || "Failed to deactivate leave type",
        error: err.error || null
      })
    );
  }
};
