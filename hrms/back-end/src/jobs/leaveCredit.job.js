const cron = require("node-cron");
const Organization = require("../modules/organizations/organization.model");
const {
  applyLeaveCreditsForOrg
} = require("../modules/leaveBalances/leaveCredit.service");

cron.schedule("0 0 * * *", async () => {
  console.log("🟢 Leave credit cron triggered");

  const orgs = await Organization.find({});
  for (const org of orgs) {
    await applyLeaveCreditsForOrg(org._id);
  }
});
