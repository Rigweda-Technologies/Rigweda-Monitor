const dotenv = require("dotenv");
dotenv.config({ quiet: true });

const connectDB = require("../config/db");
const Organization = require("../modules/organizations/organization.model");
const Permission = require("../modules/permissions/permission.model");
const OrganizationDocument = require("../modules/organizationDocuments/organizationDocument.model");

const PERMISSIONS = [
  { code: "ORG_DOCUMENT_VIEW", name: "View Organization Documents", module: "Organization Documents" },
  { code: "ORG_DOCUMENT_UPLOAD", name: "Upload Organization Documents", module: "Organization Documents" },
  { code: "ORG_DOCUMENT_DELETE", name: "Delete Organization Documents", module: "Organization Documents" },
  { code: "ORG_DOCUMENT_REPORT_VIEW", name: "View Organization Document Reports", module: "Organization Documents" }
];

const run = async () => {
  await connectDB();
  await OrganizationDocument.syncIndexes();

  const orgs = await Organization.find({ code: { $ne: "SYSTEM" } }).select("_id").lean();
  for (const org of orgs) {
    for (const permission of PERMISSIONS) {
      await Permission.updateOne(
        { organizationId: org._id, code: permission.code },
        { $setOnInsert: { organizationId: org._id, ...permission } },
        { upsert: true }
      );
    }
  }

  console.log(`Organization document migration complete for ${orgs.length} organization(s).`);
  process.exit(0);
};

run().catch((error) => {
  console.error("Organization document migration failed:", error);
  process.exit(1);
});
