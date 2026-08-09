const Permission = require("./permission.model");

/**
 * Validate permissions by IDs within an organization
 */
exports.getByIds = async (permissionIds, organizationId) => {
  if (!permissionIds || permissionIds.length === 0) {
    return [];
  }

  const permissions = await Permission.find({
    _id: { $in: permissionIds },
    organizationId
  }).select("_id");

  if (permissions.length !== permissionIds.length) {
    throw {
      code: 400,
      message:
        "One or more permissions are invalid or do not belong to this organization"
    };
  }

  return permissions;
};

exports.listByOrganization = async (organizationId) => {
  return Permission.find({ organizationId })
    .sort({ module: 1, code: 1 });
};
