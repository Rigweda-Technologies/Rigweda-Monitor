const Role = require("../modules/roles/role.model");
const Permission = require("../modules/permissions/permission.model");

module.exports = (requiredPermission) => {
  return async (req, res, next) => {
    try {
      const user = req.user;
      if (!user || !user.activeRoleId) {
        return res.status(403).json({
          success: false,
          code: 403,
          message: "Access denied: active role not set",
          data: null,
          error: null
        });
      }

      const role = await Role.findOne({
        _id: user.activeRoleId,
        organizationId: user.organizationId
      }).lean();

      // console.log(role,"role", user);
      
      if (!role) {
        const roleDetails = await Role.findOne({
        _id: user.activeRoleId,
      }).lean();
        console.log(roleDetails,"userDetails");
        if(roleDetails?.slug == "superadmin"){
          return next();
        } 
        return res.status(403).json({
          success: false,
          code: 403,
          message: "Role not found",
          data: null,
          error: null
        });
      }

      if (role.isSystemRole === true) return next();

      if (!role.permissionIds?.length) {
        return res.status(403).json({
          success: false,
          code: 403,
          message: "No permissions assigned",
          data: null,
          error: null
        });
      }

      const permissions = await Permission.find({
        _id: { $in: role.permissionIds },
        organizationId: user.organizationId
      })
        .select("code")
        .lean();

      const permissionCodes = permissions.map(p => p.code);

      if (permissionCodes.includes("*")) return next();

      const requiredPermissions = Array.isArray(requiredPermission)
        ? requiredPermission
        : [requiredPermission];
      const hasRequiredPermission = requiredPermissions.some((perm) =>
        permissionCodes.includes(perm)
      );

      if (!hasRequiredPermission) {
        return res.status(403).json({
          success: false,
          code: 403,
          message: `Permission denied: ${requiredPermissions.join(" | ")}`,
          data: null,
          error: null
        });
      }

      next();
    } catch (err) {
      console.log(err);
      
      return res.status(500).json({
        success: false,
        code: 500,
        message: "Authorization failed",
        data: null,
        error: err.message
      });
    }
  };
};
