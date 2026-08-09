const mongoose = require("mongoose");
const Role = require("./role.model");
const organizationService = require("../organizations/organization.service");
const permissionService = require("../permissions/permission.service");

const PROTECTED_ROLE_SLUGS = new Set([
  "org-admin",
  "hr",
  "manager",
  "employee"
]);

const restoreProtectedRoles = async (roles = []) => {
  const protectedInactiveRoleIds = roles
    .filter((role) => PROTECTED_ROLE_SLUGS.has(role.slug) && role.status === "inactive")
    .map((role) => role._id);

  if (protectedInactiveRoleIds.length) {
    await Role.updateMany(
      { _id: { $in: protectedInactiveRoleIds } },
      { $set: { status: "active" } }
    );
    roles.forEach((role) => {
      if (protectedInactiveRoleIds.some((roleId) => String(roleId) === String(role._id))) {
        role.status = "active";
      }
    });
  }

  return roles;
};

const getDefaultPermissionIds = async (organizationId) => {
  const employeeRole = await Role.findOne({
    organizationId,
    slug: "employee"
  }).select("permissionIds");

  return employeeRole?.permissionIds || [];
};
/**
 * Get roles by roleIds (used by auth/login)
 */
exports.getRolesByIds = async (roleIds = []) => {
  if (!Array.isArray(roleIds) || roleIds.length === 0) return [];

  const roles = await Role.find({
    _id: { $in: roleIds.map(id => new mongoose.Types.ObjectId(id)) }
  }).lean();

  return restoreProtectedRoles(roles);
};

/**
 * Create role
 */
exports.create = async ({ organizationId, name, slug, permissionIds = [], isSystemRole = false }) => {

  await organizationService.getOrganizationById(organizationId);

  const existing = await Role.findOne({ organizationId, slug }).lean();
  if (existing) {
    throw {
      code: 409,
      message: "Role with same slug already exists in this organization"
    };
  }

  const resolvedPermissionIds = permissionIds.length
    ? permissionIds
    : await getDefaultPermissionIds(organizationId);

  await permissionService.getByIds(resolvedPermissionIds, organizationId);

  return Role.create({
    organizationId,
    name,
    slug,
    permissionIds: resolvedPermissionIds,
    isSystemRole
  });
};

/**
 * Update role
 */
exports.update = async (id, data) => {
  const role = await Role.findById(id);
  if (!role) throw { code: 404, message: "Role not found" };

  if (PROTECTED_ROLE_SLUGS.has(role.slug) && data?.status && data.status !== role.status) {
    throw { code: 403, message: "Default roles cannot be deactivated" };
  }

  if (role.isSystemRole && data?.status && data.status !== role.status) {
    throw { code: 403, message: "System roles cannot be deactivated" };
  }

  Object.assign(role, data);
  return role.save();
};

/**
 * Deactivate role
 */
exports.remove = async (id) => {
  const role = await Role.findById(id);
  if (!role) throw { code: 404, message: "Role not found" };

  if (PROTECTED_ROLE_SLUGS.has(role.slug)) {
    throw { code: 403, message: "Default roles cannot be deactivated" };
  }

  if (role.isSystemRole) {
    throw { code: 403, message: "System roles cannot be deactivated" };
  }

  if (role.status === "inactive") {
    return role;
  }

  role.status = "inactive";
  return role.save();
};

/**
 * List roles
 */
exports.list = async (organizationId) => {
  const roles = await Role.find({ organizationId }).sort({ isSystemRole: -1, createdAt: 1 }).lean();
  return restoreProtectedRoles(roles);
};

/**
 * Get role by id
 */
exports.getById = async (id) => {
  const role = await Role.findById(id).lean();
  if (!role) throw { code: 404, message: "Role not found" };
  await restoreProtectedRoles([role]);
  return role;
};
