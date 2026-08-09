const { createJwtToken } = require("../../utils/jwtToken");
const Role = require("./role.model");
const UserModel = require("../users/user.model");
const OrgSettings = require("../orgSettings/orgSettings.model");
const { buildSuccessResponse } = require("../../utils/responseBuilder");
const { rotateUserToken } = require("../../utils/tokenManager");

exports.switchRole = async (req, res) => {
  const { roleId } = req.body || {};
  const user = req.user;

  console.log(user.activeRoleId?.toString(), roleId);

  // 🛑 Same role check
  if (user.activeRoleId?.toString() === roleId) {
    const existingRole = await Role.findOne({
      _id: roleId,
      organizationId: user.organizationId
    }).select("name slug");

    return res.json(
      buildSuccessResponse({
        message: "Role already active",
        data: {
          activeRoleId: roleId,
          activeRole: existingRole
            ? { _id: existingRole._id, name: existingRole.name, slug: existingRole.slug }
            : null
        }
      })
    );
  }

  // 🔍 Ensure role belongs to user
  if (!user.roleIds.map(String).includes(roleId)) {
    throw { code: 403, message: "Role not assigned to user" };
  }

  // 🔍 Ensure role exists in same org
  const role = await Role.findOne({
    _id: roleId,
    organizationId: user.organizationId
  });

  if (!role) {
    throw { code: 404, message: "Role not found" };
  }

  // 🔐 Issue NEW token
  const token = createJwtToken({
    userId: user.userId,
    email: user.email,
    organizationId: user.organizationId,
    roleIds: user.roleIds,
    activeRoleId: role._id
  });

  const settings = await OrgSettings.findOne({ organizationId: user.organizationId })
    .select("maxActiveLoginsPerUser")
    .lean();
  await rotateUserToken(UserModel, user.userId, token, {
    organizationId: user.organizationId,
    maxActiveLoginsPerUser: Number(settings?.maxActiveLoginsPerUser || 1)
  });
  await UserModel.findByIdAndUpdate(user.userId, {
    lastActiveRoleId: role._id
  });
  // ✅ Send token in header
  res.setHeader("Authorization", `Bearer ${token}`);

  return res.json(
    buildSuccessResponse({
      message: "Role switched successfully",
      data: {
        token,
        activeRoleId: role._id,
        activeRole: {
          _id: role._id,
          name: role.name,
          slug: role.slug
        }
      }
    })
  );
};
