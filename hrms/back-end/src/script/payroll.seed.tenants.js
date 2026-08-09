require("dotenv").config();

const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Organization = require("../modules/organizations/organization.model");
const {
  getPayrollPgPool,
  validatePayrollDbConfig
} = require("../config/payrollDb");

if (!process.env.PAYROLL_DB_ENABLED) {
  process.env.PAYROLL_DB_ENABLED = "true";
}

const upsertTenant = async (client, org) => {
  const organizationId = String(org._id);
  const legalName = String(org.name || "Organization");
  const tradeName = String(org.code || org.name || "Organization");
  const timezone = String(org.timezone || "Asia/Kolkata");
  const currencyCode = "INR";

  const result = await client.query(
    `
      INSERT INTO payroll_tenants (
        organization_id,
        legal_name,
        trade_name,
        country_code,
        state_code,
        timezone,
        currency_code,
        is_active,
        metadata,
        created_by,
        updated_by
      )
      VALUES (
        $1, $2, $3, 'IN', 'TS', $4, $5, true, '{}'::jsonb, 'system', 'system'
      )
      ON CONFLICT (organization_id)
      DO UPDATE SET
        legal_name = EXCLUDED.legal_name,
        trade_name = EXCLUDED.trade_name,
        timezone = EXCLUDED.timezone,
        currency_code = EXCLUDED.currency_code,
        updated_by = 'system',
        updated_at = NOW()
      RETURNING id, organization_id, legal_name
    `,
    [organizationId, legalName, tradeName, timezone, currencyCode]
  );

  return result.rows[0];
};

(async () => {
  let client;
  try {
    await connectDB();
    validatePayrollDbConfig();

    const pool = await getPayrollPgPool();
    if (!pool) {
      throw new Error("Payroll Postgres is not enabled");
    }

    client = await pool.connect();

    const organizations = await Organization.find({}).select(
      "_id name code timezone currency"
    );
    if (!organizations.length) {
      console.log("ℹ No organizations found in MongoDB");
      process.exit(0);
    }

    let processed = 0;
    for (const org of organizations) {
      const row = await upsertTenant(client, org);
      processed += 1;
      console.log(
        `✅ Payroll tenant synced: org=${row.organization_id} tenant=${row.id} name=${row.legal_name}`
      );
    }

    console.log(`🎉 Payroll tenant sync completed. Processed ${processed} organization(s).`);
    process.exit(0);
  } catch (error) {
    console.error("❌ Payroll tenant sync failed:", error?.message || error);
    process.exit(1);
  } finally {
    if (client) client.release();
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }
})();
