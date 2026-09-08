const User = require("../modules/users/user.model");
const Role = require("../modules/roles/role.model");
const Permission = require("../modules/permissions/permission.model");
const Organization = require("../modules/organizations/organization.model");
const OrgUser = require("../modules/organizations/org-user.model");
const { genHashedPassword } = require("./bcryptUtils");

const SUPERADMIN_EMAIL = "superadmin@luvetha.com";
const SUPERADMIN_PASSWORD = "SuperAdmin@123";

const ensureSystemBootstrap = async () => {
  let systemOrg = await Organization.findOne({ code: "SYSTEM" });
  if (!systemOrg) {
    systemOrg = await Organization.create({
      name: "SYSTEM",
      code: "SYSTEM",
      timezone: "Asia/Kolkata",
      currency: "USD",
      status: "active"
    });
  }

  let systemPermission = await Permission.findOne({
    organizationId: systemOrg._id,
    code: "*"
  });
  if (!systemPermission) {
    systemPermission = await Permission.create({
      name: "ALL_ACCESS",
      code: "*",
      module: "SYSTEM",
      organizationId: systemOrg._id
    });
  }

  let superAdminRole = await Role.findOne({
    organizationId: systemOrg._id,
    slug: "superadmin"
  });
  if (!superAdminRole) {
    superAdminRole = await Role.create({
      name: "SuperAdmin",
      slug: "superadmin",
      permissionIds: [systemPermission._id],
      isSystemRole: true,
      organizationId: systemOrg._id
    });
  }

  let superAdmin = await User.findOne({ email: SUPERADMIN_EMAIL });
  if (!superAdmin) {
    superAdmin = await User.create({
      email: SUPERADMIN_EMAIL,
      password: await genHashedPassword(SUPERADMIN_PASSWORD),
      organizationIds: [systemOrg._id],
      activeOrganizationId: systemOrg._id,
      status: "active"
    });
  }

  await OrgUser.updateOne(
    {
      userId: superAdmin._id,
      organizationId: systemOrg._id
    },
    {
      $set: {
        roleIds: [superAdminRole._id]
      }
    },
    {
      upsert: true
    }
  );

  return {
    created: true,
    systemOrgId: systemOrg._id.toString(),
    email: SUPERADMIN_EMAIL,
    password: SUPERADMIN_PASSWORD
  };
};

module.exports = { ensureSystemBootstrap };
