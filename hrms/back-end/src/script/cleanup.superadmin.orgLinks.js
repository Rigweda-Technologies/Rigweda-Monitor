require("dotenv").config();

const mongoose = require("mongoose");
const User = require("../modules/users/user.model");
const Organization = require("../modules/organizations/organization.model");
const OrgUser = require("../modules/organizations/org-user.model");
const Employee = require("../modules/employees/employee.model");

const SUPERADMIN_EMAIL = String(process.env.SUPERADMIN_EMAIL || "superadmin@luvetha.com").toLowerCase().trim();

const resolveSystemOrgId = async () => {
  if (process.env.SYSTEM_ORG_ID) return String(process.env.SYSTEM_ORG_ID);
  const systemOrg = await Organization.findOne({ code: "SYSTEM" }).select("_id").lean();
  return systemOrg?._id ? String(systemOrg._id) : "";
};

(async () => {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error("MONGO_URI not found in environment variables");
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ MongoDB connected");

    const systemOrgId = await resolveSystemOrgId();
    if (!systemOrgId) {
      throw new Error("SYSTEM org not found (set SYSTEM_ORG_ID or ensure code='SYSTEM' exists)");
    }

    const superAdmin = await User.findOne({ email: SUPERADMIN_EMAIL }).select("_id organizationIds activeOrganizationId email").lean();
    if (!superAdmin?._id) {
      throw new Error(`SuperAdmin user not found for email: ${SUPERADMIN_EMAIL}`);
    }

    const superAdminUserId = String(superAdmin._id);

    const orgUserDelete = await OrgUser.deleteMany({
      userId: superAdminUserId,
      organizationId: { $ne: systemOrgId }
    });

    const employeeDelete = await Employee.deleteMany({
      userId: superAdminUserId,
      organizationId: { $ne: systemOrgId }
    });

    const nextOrgIds = Array.from(new Set([systemOrgId]));
    const nextActiveOrgId = systemOrgId;

    await User.updateOne(
      { _id: superAdminUserId },
      { $set: { organizationIds: nextOrgIds, activeOrganizationId: nextActiveOrgId } }
    );

    console.log("✅ Cleanup complete");
    console.log("Removed OrgUser links :", orgUserDelete.deletedCount);
    console.log("Removed Employee docs :", employeeDelete.deletedCount);
    console.log("Reset orgIds/activeOrg :", systemOrgId);

    process.exit(0);
  } catch (err) {
    console.error("❌ Cleanup failed:", err.message || err);
    process.exit(1);
  }
})();

