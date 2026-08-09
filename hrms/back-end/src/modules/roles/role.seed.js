const Role = require("./role.model");

const SYSTEM_ROLES = [
  { name: "Super Admin", slug: "super_admin" },
  { name: "Admin", slug: "admin" },
  { name: "HR", slug: "hr" },
  { name: "Manager", slug: "manager" },
  { name: "Employee", slug: "employee" }
];

exports.seedRoles = async (organizationId) => {
  for (const role of SYSTEM_ROLES) {
    const exists = await Role.findOne({
      organizationId,
      slug: role.slug
    });

    if (!exists) {
      await Role.create({
        organizationId,
        name: role.name,
        slug: role.slug,
        permissionIds: [],
        isSystemRole: true
      });
    }
  }
};
