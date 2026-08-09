require("dotenv").config();

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const User = require("../modules/users/user.model");
const OrgUser = require("../modules/organizations/org-user.model");
const Organization = require("../modules/organizations/organization.model");
const { getPayrollPgPool, isPayrollDbEnabled } = require("../config/payrollDb");
const { applyOrganizationLifecycleAction } = require("../modules/organizations/organization.service");

const args = process.argv.slice(2);
const orgArg = args.find((arg) => arg.startsWith("--org="));
const actorArg = args.find((arg) => arg.startsWith("--actor="));
const confirmArg = args.find((arg) => arg.startsWith("--confirm="));
const isDryRun = args.includes("--dry-run");
const forceYes = args.includes("--yes");

const organizationId = String(orgArg?.split("=")[1] || "").trim();
const actorUserId = String(actorArg?.split("=")[1] || "").trim();
const confirmationCode = String(confirmArg?.split("=")[1] || "").trim();

const MODULES_DIR = path.join(__dirname, "..", "modules");
const REPORTS_DIR = path.join(__dirname, "..", "..", "reports", "org-hard-delete");

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

  if (isDryRun) return;

  if (!mongoose.Types.ObjectId.isValid(actorUserId)) {
    throw new Error("Provide a valid --actor=<superAdminUserId>");
  }

  if (!confirmationCode) {
    throw new Error("Provide --confirm=<ORG_CODE> to execute hard delete");
  }

  if (!forceYes) {
    throw new Error("Add --yes to confirm permanent hard delete execution");
  }
};

const getOrgScopedModels = () =>
  mongoose.modelNames()
    .map((modelName) => mongoose.model(modelName))
    .filter((model) => model?.schema?.path("organizationId"))
    .sort((left, right) => left.collection.name.localeCompare(right.collection.name));

const buildDryRunSummary = async (orgObjectId) => {
  const organization = await Organization.findById(orgObjectId).select("name code status isSoftDeleted").lean();
  if (!organization) {
    throw new Error("Organization not found");
  }

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
    { _id: 1, organizationIds: 1 }
  ).lean();

  const orphanUsers = linkedUsers.filter(
    (user) => !Array.isArray(user.organizationIds) || user.organizationIds.length <= 1
  );
  const multiOrgUsers = linkedUsers.length - orphanUsers.length;

  const membershipCount = await OrgUser.countDocuments({ organizationId: orgObjectId });

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
    organization,
    collectionCounts,
    linkedUsers: linkedUsers.length,
    orphanUsers: orphanUsers.length,
    multiOrgUsers,
    membershipCount,
    payrollTenantCount
  };
};

const printDryRunSummary = (summary) => {
  console.log("Hard Delete Dry Run");
  console.log(`Organization: ${summary.organization.name} (${summary.organization.code})`);
  console.log(`Status: ${summary.organization.status}${summary.organization.isSoftDeleted ? " / deleted" : ""}`);
  console.log(`Org memberships to delete: ${summary.membershipCount}`);
  console.log(`Linked users: ${summary.linkedUsers}`);
  console.log(`Orphan users to delete: ${summary.orphanUsers}`);
  console.log(`Multi-org users to detach only: ${summary.multiOrgUsers}`);
  console.log(`Payroll tenants to delete: ${summary.payrollTenantCount}`);

  if (!summary.collectionCounts.length) {
    console.log("No organization-scoped Mongo collections found with rows for this org.");
    return;
  }

  console.log("Mongo collections to purge:");
  summary.collectionCounts.forEach((entry) => {
    console.log(`  - ${entry.collectionName}: ${entry.count}`);
  });
};

const ensureReportsDir = () => {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
};

const getReportFilePath = (orgCode = "org", mode = "run") => {
  const safeCode = String(orgCode || "org")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "org";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(REPORTS_DIR, `${timestamp}-${safeCode}-${mode}.json`);
};

const writeReportFile = (filePath, payload) => {
  ensureReportsDir();
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Report written: ${filePath}`);
};

(async () => {
  try {
    loadAllModels();
    assertArgs();
    await connectDB();

    const orgObjectId = new mongoose.Types.ObjectId(organizationId);

    if (isDryRun) {
      const summary = await buildDryRunSummary(orgObjectId);
      printDryRunSummary(summary);
      writeReportFile(
        getReportFilePath(summary.organization?.code, "dry-run"),
        {
          mode: "dry-run",
          organizationId,
          generatedAt: new Date().toISOString(),
          summary
        }
      );
      process.exit(0);
    }

    const beforeSummary = await buildDryRunSummary(orgObjectId);
    const result = await applyOrganizationLifecycleAction({
      organizationId,
      action: "hard_delete",
      confirmationCode,
      actorUserId
    });

    console.log("Hard delete completed");
    console.log(JSON.stringify(result, null, 2));
    writeReportFile(
      getReportFilePath(beforeSummary.organization?.code, "executed"),
      {
        mode: "executed",
        organizationId,
        actorUserId,
        confirmationCode,
        executedAt: new Date().toISOString(),
        beforeSummary,
        result
      }
    );
    process.exit(0);
  } catch (error) {
    console.error("Hard delete failed:", error?.message || error);
    process.exit(1);
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }
})();
