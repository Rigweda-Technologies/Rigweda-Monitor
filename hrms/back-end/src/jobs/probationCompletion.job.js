const cron = require("node-cron");
const { notifyProbationCompleted } = require("../modules/employees/employeeLifecycle.service");

cron.schedule("0 0 * * *", async () => {
  try {
    const count = await notifyProbationCompleted();
    if (count > 0) {
      console.log(`🟢 Probation completion notifications sent for ${count} employee(s)`);
    }
  } catch (error) {
    console.error("❌ Probation completion job failed:", error?.message || error);
  }
});
