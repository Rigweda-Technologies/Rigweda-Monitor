require("dotenv").config();

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const User = require("../modules/users/user.model");
const OrgUser = require("../modules/organizations/org-user.model");
const Organization = require("../modules/organizations/organization.model");
const { getPayrollPgPool, isPayrollDbEnabled } = require("../config/payrollDb");

const args = process.argv.slice(2);
const orgArg = args.find((arg) => arg.startsWith("--org="));
const isDryRun = args.includes("--dry-run");
const forceYes = args.includes("--yes");
const includeOrphanUsers = args.includes("--include-orphan-users");

const organizationId = String(orgArg?.split("=")[1] || "").trim();

const MODULES_DIR = path.join(__dirname, "..", "modules");
const REPORTS_DIR = path.join(__dirname, "..", "..", "reports", "org-residual-cleanup");

const walkFiles = (dirPath) => {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
      continue;
    }
    files.push(fullPath);
  }

  return files;
};

const loadAllModels = () => {
  const modelFiles = walkFiles(MODULES_DIR)
    .filter((filePath) => filePath.endsWith(".model.js"))
    .sort();

  for (const filePath of modelFiles) {
    require(filePath);
  }
};

const assertArgs = () => {
  if (!mongoose.Types.ObjectId.isValid(organizationId)) {
    throw new Error("Provide a valid --org=<organizationId>");
  }

  if (!isDryRun && !forceYes) {
    throw new Error("Add --yes to confirm permanent residual cleanup execution");
  }
};

const ensureReportsDir = () => {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
};

const getReportFilePath = (mode = "run") => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(REPORTS_DIR, `${timestamp}-${organizationId}-${mode}.json`);
};

const writeReportFile = (filePath, payload) => {
  ensureReportsDir();
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Report written: ${filePath}`);
};

const getOrgScopedModels = () =>
  mongoose.modelNames()
    .map((modelName) => mongoose.model(modelName))
    .filter((model) => model?.schema?.path("organizationId"))
    .sort((left, right) => left.collection.name.localeCompare(right.collection.name));

const buildSummary = async (orgObjectId) => {
  const orgScopedModels = getOrgScopedModels();
  const collectionCounts = [];

  for (const model of orgScopedModels) {
    const count = await model.countDocuments({ organizationId: orgObjectId });
    if (count > 0) {
      collectionCounts.push({
        modelName: model.modelName,
        collectionName: model.collection.name,
        count
      });
    }
  }

  const linkedUsers = await User.find(
    {
      $or: [
        { organizationIds: orgObjectId },
        { activeOrganizationId: orgObjectId },
        { "softDeleteMeta.organizationId": orgObjectId }
      ]
    },
    { _id: 1, email: 1, organizationIds: 1, activeOrganizationId: 1 }
  ).lean();

  const orphanUsers = linkedUsers.filter((user) => {
    const orgIds = Array.isArray(user.organizationIds) ? user.organizationIds : [];
    return orgIds.length <= 1;
  });

  const membershipCount = await OrgUser.countDocuments({ organizationId: orgObjectId });
  const organizationExists = await Organization.exists({ _id: orgObjectId });

  let payrollTenantCount = 0;
  if (isPayrollDbEnabled()) {
    const pool = await getPayrollPgPool();
    if (pool) {
      const result = await pool.query(
        "SELECT COUNT(*)::int AS count FROM payroll_tenants WHERE organization_id = $1",
        [String(orgObjectId)]
      );
      payrollTenantCount = Number(result.rows?.[0]?.count || 0);
    }
  }

  return {
    organizationId: String(orgObjectId),
    organizationExists: Boolean(organizationExists),
    collectionCounts,
    linkedUsersCount: linkedUsers.length,
    orphanUsersCount: orphanUsers.length,
    multiOrgUsersCount: linkedUsers.length - orphanUsers.length,
    membershipCount,
    payrollTenantCount
  };
};

const buildOrphanUserSummary = async () => {
  const memberships = await OrgUser.aggregate([
    { $group: { _id: "$userId", membershipCount: { $sum: 1 } } }
  ]);
  const membershipMap = new Map(
    memberships.map((row) => [String(row._id), Number(row.membershipCount || 0)])
  );

  const users = await User.find(
    {},
    { _id: 1, email: 1, organizationIds: 1, activeOrganizationId: 1, status: 1 }
  ).lean();

  const orphanUsers = users.filter((user) => {
    const orgIds = Array.isArray(user.organizationIds) ? user.organizationIds : [];
    const membershipCount = membershipMap.get(String(user._id)) || 0;
    return orgIds.length === 0 && !user.activeOrganizationId && membershipCount === 0;
  });

  return {
    orphanUserCount: orphanUsers.length,
    sampleEmails: orphanUsers.slice(0, 25).map((user) => user.email)
  };
};

const printSummary = (summary) => {
  console.log("Organization Residual Cleanup");
  console.log(`Organization id: ${summary.organizationId}`);
  console.log(`Organization row exists: ${summary.organizationExists ? "yes" : "no"}`);
  console.log(`Org memberships to delete: ${summary.membershipCount}`);
  console.log(`Linked users: ${summary.linkedUsersCount}`);
  console.log(`Orphan users to delete: ${summary.orphanUsersCount}`);
  console.log(`Multi-org users to detach only: ${summary.multiOrgUsersCount}`);
  console.log(`Payroll tenants to delete: ${summary.payrollTenantCount}`);

  if (!summary.collectionCounts.length) {
    console.log("No organization-scoped Mongo collections have rows for this org id.");
    return;
  }

  console.log("Mongo collections to purge:");
  summary.collectionCounts.forEach((entry) => {
    console.log(`  - ${entry.collectionName}: ${entry.count}`);
  });
};

const printOrphanUserSummary = (summary) => {
  console.log(`Globally orphan users to delete: ${summary.orphanUserCount}`);
  if (summary.sampleEmails.length) {
    console.log("Sample orphan user emails:");
    summary.sampleEmails.forEach((email) => {
      console.log(`  - ${email}`);
    });
  }
};

const cleanupUsers = async (orgObjectId, dryRun) => {
  const users = await User.find({
    $or: [
      { organizationIds: orgObjectId },
      { activeOrganizationId: orgObjectId },
      { "softDeleteMeta.organizationId": orgObjectId }
    ]
  });

  let detachedUsers = 0;
  let deletedUsers = 0;

  for (const user of users) {
    const currentOrganizationIds = Array.isArray(user.organizationIds) ? user.organizationIds : [];
    const nextOrganizationIds = currentOrganizationIds.filter(
      (orgRef) => String(orgRef) !== String(orgObjectId)
    );
    const shouldDeleteUser = nextOrganizationIds.length === 0;

    if (shouldDeleteUser) {
      deletedUsers += 1;
      if (!dryRun) {
        await User.deleteOne({ _id: user._id });
      }
      continue;
    }

    detachedUsers += 1;
    if (!dryRun) {
      user.organizationIds = nextOrganizationIds;
      if (String(user.activeOrganizationId || "") === String(orgObjectId)) {
        user.activeOrganizationId = nextOrganizationIds[0] || null;
      }
      if (Array.isArray(user.tokenList)) {
        user.tokenList = user.tokenList.filter(
          (token) => String(token?.organizationId || "") !== String(orgObjectId)
        );
      }
      if (String(user.softDeleteMeta?.organizationId || "") === String(orgObjectId)) {
        user.softDeleteMeta = { organizationId: null, originalEmail: null, deletedAt: null };
      }
      await user.save();
    }
  }

  return { detachedUsers, deletedUsers };
};

const cleanupOrphanUsers = async (dryRun) => {
  const memberships = await OrgUser.aggregate([
    { $group: { _id: "$userId", membershipCount: { $sum: 1 } } }
  ]);
  const membershipMap = new Map(
    memberships.map((row) => [String(row._id), Number(row.membershipCount || 0)])
  );

  const users = await User.find({});
  const orphanUserIds = users
    .filter((user) => {
      const orgIds = Array.isArray(user.organizationIds) ? user.organizationIds : [];
      const membershipCount = membershipMap.get(String(user._id)) || 0;
      return orgIds.length === 0 && !user.activeOrganizationId && membershipCount === 0;
    })
    .map((user) => user._id);

  if (!dryRun && orphanUserIds.length) {
    await User.deleteMany({ _id: { $in: orphanUserIds } });
  }

  return { deletedOrphanUsers: orphanUserIds.length };
};

const cleanupMongo = async (orgObjectId, dryRun) => {
  const results = {};

  for (const model of getOrgScopedModels()) {
    const count = await model.countDocuments({ organizationId: orgObjectId });
    if (!count) continue;
    results[model.collection.name] = count;
    if (!dryRun) {
      await model.deleteMany({ organizationId: orgObjectId });
    }
  }

  return results;
};

const cleanupPayroll = async (orgObjectId, dryRun) => {
  if (!isPayrollDbEnabled()) {
    return { payrollTenantDeleted: 0 };
  }

  const pool = await getPayrollPgPool();
  if (!pool) {
    return { payrollTenantDeleted: 0 };
  }

  if (dryRun) {
    const result = await pool.query(
      "SELECT COUNT(*)::int AS count FROM payroll_tenants WHERE organization_id = $1",
      [String(orgObjectId)]
    );
    return { payrollTenantDeleted: Number(result.rows?.[0]?.count || 0) };
  }

  const result = await pool.query(
    "DELETE FROM payroll_tenants WHERE organization_id = $1",
    [String(orgObjectId)]
  );
  return { payrollTenantDeleted: Number(result.rowCount || 0) };
};

(async () => {
  try {
    loadAllModels();
    assertArgs();
    await connectDB();

    const orgObjectId = new mongoose.Types.ObjectId(organizationId);
    const beforeSummary = await buildSummary(orgObjectId);
    const orphanUserSummary = includeOrphanUsers ? await buildOrphanUserSummary() : null;
    printSummary(beforeSummary);
    if (orphanUserSummary) {
      printOrphanUserSummary(orphanUserSummary);
    }

    if (isDryRun) {
      writeReportFile(
        getReportFilePath("dry-run"),
        {
          mode: "dry-run",
          generatedAt: new Date().toISOString(),
          summary: beforeSummary,
          orphanUserSummary
        }
      );
      process.exit(0);
    }

    const mongoDeleted = await cleanupMongo(orgObjectId, false);
    const userCleanup = await cleanupUsers(orgObjectId, false);
    const orphanUserCleanup = includeOrphanUsers
      ? await cleanupOrphanUsers(false)
      : { deletedOrphanUsers: 0 };
    const payrollCleanup = await cleanupPayroll(orgObjectId, false);
    const organizationDeleteResult = await Organization.deleteOne({ _id: orgObjectId });

    const result = {
      mode: "executed",
      organizationId,
      executedAt: new Date().toISOString(),
      mongoDeleted,
      userCleanup,
      orphanUserCleanup,
      payrollCleanup,
      organizationDeleted: Number(organizationDeleteResult?.deletedCount || 0) > 0
    };

    console.log("Residual cleanup completed");
    console.log(JSON.stringify(result, null, 2));
    writeReportFile(
      getReportFilePath("executed"),
      {
        beforeSummary,
        result
      }
    );
    process.exit(0);
  } catch (error) {
    console.error("Residual cleanup failed:", error?.message || error);
    process.exit(1);
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }
})();
