require("dotenv").config();

const mongoose = require("mongoose");
const { ensureSystemBootstrap } = require("../utils/bootstrapSystem");

(async () => {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error("MONGO_URI not found in environment variables");
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ MongoDB connected");

    const bootstrapResult = await ensureSystemBootstrap();

    if (bootstrapResult?.created) {
      console.log("🎉 SYSTEM BOOTSTRAPPED SUCCESSFULLY");
      console.log("----------------------------------");
      console.log("SYSTEM ORG ID        :", bootstrapResult.systemOrgId);
      console.log("SuperAdmin Email     :", bootstrapResult.email);
      console.log("SuperAdmin Password  :", bootstrapResult.password);
    } else {
      console.log("⚠️ SuperAdmin already exists. Bootstrap skipped.");
    }

    process.exit(0);
  } catch (err) {
    console.error("❌ Bootstrap failed:", err.message);
    process.exit(1);
  }
})();
