require("dotenv").config();

const mongoose = require("mongoose");
const Organization = require("../modules/organizations/organization.model");
const { seedOrgRolesAndPermissions } = require("../modules/roles/role.seeder");

(async () => {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error("MONGO_URI not found");
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ MongoDB connected");

    /**
     * Fetch all NON-SYSTEM organizations
     */
    const organizations = await Organization.find({
      code: { $ne: "SYSTEM" }
    });

    if (!organizations.length) {
      console.log("⚠️ No organizations found (excluding SYSTEM)");
      process.exit(0);
    }

    for (const org of organizations) {
      console.log(`\n🔹 Seeding roles & permissions for org: ${org.name}`);
      await seedOrgRolesAndPermissions(org._id);
    }

    console.log("\n🎉 Org roles & permissions seeded successfully");
    process.exit(0);

  } catch (err) {
    console.error("❌ Seeding failed:", err);
    process.exit(1);
  }
})();
