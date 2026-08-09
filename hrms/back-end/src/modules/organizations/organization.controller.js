const organizationService = require("./organization.service");
const {
  buildSuccessResponse,
  buildFailureResponse
} = require("../../utils/responseBuilder");

/**
 * CREATE ORGANIZATION
 */
exports.create = async (req, res) => {
  try {
    const org = await organizationService.createOrganization({
      ...req.body,
      creator: req.user
    });

    return res.status(201).json(
      buildSuccessResponse({
        code: 201,
        message: "Organization created successfully",
        data: org
      })
    );
  } catch (err) {
    return res.status(err.code || 500).json(
      buildFailureResponse({
        code: err.code || 500,
        message: err.message || "Organization creation failed",
        error: err.error || null
      })
    );
  }
};

/**
 * UPDATE ORGANIZATION
 */
exports.update = async (req, res) => {
  try {
    const org = await organizationService.updateOrganization(
      req.params.id,
      req.body
    );

    return res.status(200).json(
      buildSuccessResponse({
        code: 200,
        message: "Organization updated successfully",
        data: org
      })
    );
  } catch (err) {
    return res.status(err.code || 500).json(
      buildFailureResponse({
        code: err.code || 500,
        message: err.message || "Organization update failed",
        error: err.error || null
      })
    );
  }
};

/**
 * GET ORGANIZATION BY ID
 */
exports.getById = async (req, res) => {
  try {
    const org = await organizationService.getOrganizationById(req.params.id);

    return res.status(200).json(
      buildSuccessResponse({
        code: 200,
        message: "Organization fetched successfully",
        data: org
      })
    );
  } catch (err) {
    return res.status(err.code || 500).json(
      buildFailureResponse({
        code: err.code || 500,
        message: err.message || "Organization not found",
        error: err.error || null
      })
    );
  }
};

/**
 * LIST ORGANIZATIONS
 */
exports.list = async (req, res) => {
  try {
    const orgs = await organizationService.getOrganizations({
      user: req.user
    });

    return res.status(200).json(
      buildSuccessResponse({
        code: 200,
        message: "Organizations fetched successfully",
        data: orgs
      })
    );
  } catch (err) {
    return res.status(500).json(
      buildFailureResponse({
        code: 500,
        message: "Failed to fetch organizations",
        error: err.message
      })
    );
  }
};

/**
 * DELETE (SOFT)
 */
exports.deleteById = async (req, res) => {
  try {
    await organizationService.deleteOrganization(req.params.id);

    return res.status(200).json(
      buildSuccessResponse({
        code: 200,
        message: "Organization deactivated successfully"
      })
    );
  } catch (err) {
    return res.status(err.code || 500).json(
      buildFailureResponse({
        code: err.code || 500,
        message: err.message || "Organization deletion failed",
        error: err.error || null
      })
    );
  }
};

/**
 * ORGANIZATION LIFECYCLE ACTION
 */
exports.lifecycleAction = async (req, res) => {
  try {
    const result = await organizationService.applyOrganizationLifecycleAction({
      organizationId: req.params.id,
      action: req.body.action,
      confirmationCode: req.body.confirmationCode,
      actorUserId: req.user.userId
    });

    return res.status(200).json(
      buildSuccessResponse({
        code: 200,
        message: "Organization lifecycle action completed",
        data: result
      })
    );
  } catch (err) {
    return res.status(err.code || 500).json(
      buildFailureResponse({
        code: err.code || 500,
        message: err.message || "Organization lifecycle action failed",
        error: err.error || null
      })
    );
  }
};

exports.clearPayrollData = async (req, res) => {
  try {
    const result = await organizationService.clearOrganizationPayrollData({
      organizationId: req.params.id,
      mode: req.body.mode,
      confirmationCode: req.body.confirmationCode,
      actorUserId: req.user.userId
    });

    return res.status(200).json(
      buildSuccessResponse({
        code: 200,
        message: "Organization payroll data cleared successfully",
        data: result
      })
    );
  } catch (err) {
    return res.status(err.code || 500).json(
      buildFailureResponse({
        code: err.code || 500,
        message: err.message || "Organization payroll clear failed",
        error: err.error || null
      })
    );
  }
};
