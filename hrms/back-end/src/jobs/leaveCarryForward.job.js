const cron = require("node-cron");
const Organization = require("../modules/organizations/organization.model");
const {
  runCarryForwardForOrg
} = require("../modules/leaveCarryForward/leaveCarryForward.service");

cron.schedule("0 0 * * *", async () => {
  // cron.schedule("* * * * *", async () => {
  console.log("🟢 Carry forward cron triggered");

  const orgs = await Organization.find({});
  for (const org of orgs) {
    console.log("➡ Running carry forward for org:", org._id);
    await runCarryForwardForOrg(org._id);
  }
});
