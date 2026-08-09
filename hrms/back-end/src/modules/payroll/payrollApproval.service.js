const { getPayrollPgPool } = require("../../config/payrollDb");
const { safeRollback } = require("./payrollTx");
const { getTenantIdForOrganization } = require("./payrollProvisioning.service");
const Role = require("../roles/role.model");
const { isAdminOverrideActor } = require("../../utils/approvalFlowEngine");

const getTenantId = async (client, organizationId) => {
  const result = await client.query(
    `SELECT id FROM payroll_tenants WHERE organization_id = $1`,
    [String(organizationId)]
  );
  return result.rows[0]?.id || null;
};

const getRunForUpdate = async (client, tenantId, runId) => {
  const result = await client.query(
    `
      SELECT *
      FROM payroll_runs
      WHERE id = $1 AND tenant_id = $2
      FOR UPDATE
    `,
    [runId, tenantId]
  );
  return result.rows[0] || null;
};

const createAuditEntry = async ({
  client,
  tenantId,
  runId,
  action,
  fromStatus,
  toStatus,
  actorUserId,
  actorRoleId,
  reason,
  payload,
  req,
  actionStatus = "success"
}) => {
  await client.query(
    `
      INSERT INTO payroll_run_audit_entries (
        tenant_id,
        payroll_run_id,
        action,
        action_status,
        from_status,
        to_status,
        actor_user_id,
        actor_role_id,
        reason,
        payload,
        ip_address,
        user_agent
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)
    `,
    [
      tenantId,
      runId,
      action,
      actionStatus,
      fromStatus || null,
      toStatus || null,
      actorUserId,
      actorRoleId || null,
      reason || null,
      JSON.stringify(payload || {}),
      req.ip || null,
      req.headers["user-agent"] || null
    ]
  );
};

const assertAllowedTransition = (currentStatus, allowedStatuses, actionLabel) => {
  if (!allowedStatuses.includes(currentStatus)) {
    throw {
      code: 409,
      message: `Cannot ${actionLabel} payroll run in status: ${currentStatus}`
    };
  }
};

const updateRunStatus = async (client, runId, status, actorId, extraSet = "", extraValues = []) => {
  const result = await client.query(
    `
      UPDATE payroll_runs
      SET
        status = $2,
        updated_by = $3
        ${extraSet}
      WHERE id = $1
      RETURNING *
    `,
    [runId, status, actorId, ...extraValues]
  );
  return result.rows[0];
};

const getLastSubmitActorId = async (client, runId) => {
  const result = await client.query(
    `
      SELECT actor_user_id
      FROM payroll_run_audit_entries
      WHERE payroll_run_id = $1
        AND action = 'submit_for_approval'
        AND action_status = 'success'
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [runId]
  );
  return result.rows[0]?.actor_user_id || null;
};

const getActorContext = (req) => ({
  actorUserId: String(req.user.userId),
  actorRoleId: req.user.activeRoleId ? String(req.user.activeRoleId) : null
});

const getActorRoleSlug = async (req) => {
  if (!req.user.activeRoleId) return null;
  const role = await Role.findOne({
    _id: req.user.activeRoleId,
    organizationId: req.user.organizationId
  }).select("slug").lean();
  return role?.slug || null;
};

const ensurePool = async () => {
  const pool = await getPayrollPgPool();
  if (!pool) throw { code: 400, message: "Payroll Postgres is not enabled" };
  return pool;
};

exports.submitForApproval = async (req) => {
  const pool = await ensurePool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });

    const run = await getRunForUpdate(client, tenantId, req.params.runId);
    if (!run) throw { code: 404, message: "Payroll run not found" };

    assertAllowedTransition(run.status, ["draft", "validation_failed"], "submit for approval");

    const actor = getActorContext(req);
    const updated = await updateRunStatus(
      client,
      run.id,
      "ready_for_approval",
      actor.actorUserId,
      `,
        metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb
      `,
      [JSON.stringify({ lastSubmittedAt: new Date().toISOString() })]
    );

    await createAuditEntry({
      client,
      tenantId,
      runId: run.id,
      action: "submit_for_approval",
      fromStatus: run.status,
      toStatus: "ready_for_approval",
      actorUserId: actor.actorUserId,
      actorRoleId: actor.actorRoleId,
      reason: req.body.remarks || null,
      payload: { remarks: req.body.remarks || null },
      req
    });

    await client.query("COMMIT");
    return updated;
  } catch (error) {
    await safeRollback(client);
    throw error;
  } finally {
    client.release();
  }
};

exports.approveRun = async (req) => {
  const pool = await ensurePool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });

    const run = await getRunForUpdate(client, tenantId, req.params.runId);
    if (!run) throw { code: 404, message: "Payroll run not found" };
    assertAllowedTransition(run.status, ["ready_for_approval"], "approve");

    const actor = getActorContext(req);
    const submitActorId = await getLastSubmitActorId(client, run.id);
    const actorRoleSlug = await getActorRoleSlug(req);
    const allowAdminOverride = isAdminOverrideActor({ actorRoleSlug });
    if (!allowAdminOverride && submitActorId && submitActorId === actor.actorUserId) {
      throw {
        code: 409,
        message:
          "Maker-checker violation: submitter cannot approve the same payroll run"
      };
    }

    const updated = await client.query(
      `
        UPDATE payroll_runs
        SET
          status = 'approved',
          approved_by = $2,
          approved_at = NOW(),
          updated_by = $2,
          metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
        WHERE id = $1
        RETURNING *
      `,
      [run.id, actor.actorUserId, JSON.stringify({ approvalRemarks: req.body.remarks || null })]
    );

    await createAuditEntry({
      client,
      tenantId,
      runId: run.id,
      action: "approve",
      fromStatus: run.status,
      toStatus: "approved",
      actorUserId: actor.actorUserId,
      actorRoleId: actor.actorRoleId,
      reason: req.body.remarks || null,
      payload: { remarks: req.body.remarks || null },
      req
    });

    await client.query("COMMIT");
    return updated.rows[0];
  } catch (error) {
    await safeRollback(client);
    throw error;
  } finally {
    client.release();
  }
};

exports.rejectRun = async (req) => {
  const pool = await ensurePool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });

    const run = await getRunForUpdate(client, tenantId, req.params.runId);
    if (!run) throw { code: 404, message: "Payroll run not found" };
    assertAllowedTransition(run.status, ["ready_for_approval"], "reject");

    const actor = getActorContext(req);
    const submitActorId = await getLastSubmitActorId(client, run.id);
    const actorRoleSlug = await getActorRoleSlug(req);
    const allowAdminOverride = isAdminOverrideActor({ actorRoleSlug });
    if (!allowAdminOverride && submitActorId && submitActorId === actor.actorUserId) {
      throw {
        code: 409,
        message:
          "Maker-checker violation: submitter cannot reject the same payroll run"
      };
    }

    const updated = await client.query(
      `
        UPDATE payroll_runs
        SET
          status = 'validation_failed',
          updated_by = $2,
          metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
        WHERE id = $1
        RETURNING *
      `,
      [run.id, actor.actorUserId, JSON.stringify({ rejectionReason: req.body.reason })]
    );

    await createAuditEntry({
      client,
      tenantId,
      runId: run.id,
      action: "reject",
      fromStatus: run.status,
      toStatus: "validation_failed",
      actorUserId: actor.actorUserId,
      actorRoleId: actor.actorRoleId,
      reason: req.body.reason,
      payload: { reason: req.body.reason },
      req
    });

    await client.query("COMMIT");
    return updated.rows[0];
  } catch (error) {
    await safeRollback(client);
    throw error;
  } finally {
    client.release();
  }
};

exports.lockRun = async (req) => {
  const pool = await ensurePool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });

    const run = await getRunForUpdate(client, tenantId, req.params.runId);
    if (!run) throw { code: 404, message: "Payroll run not found" };
    assertAllowedTransition(run.status, ["approved"], "lock");

    const actor = getActorContext(req);
    const updated = await client.query(
      `
        UPDATE payroll_runs
        SET
          status = 'locked',
          locked_by = $2,
          locked_at = NOW(),
          updated_by = $2,
          metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
        WHERE id = $1
        RETURNING *
      `,
      [run.id, actor.actorUserId, JSON.stringify({ lockRemarks: req.body.remarks || null })]
    );

    await createAuditEntry({
      client,
      tenantId,
      runId: run.id,
      action: "lock",
      fromStatus: run.status,
      toStatus: "locked",
      actorUserId: actor.actorUserId,
      actorRoleId: actor.actorRoleId,
      reason: req.body.remarks || null,
      payload: { remarks: req.body.remarks || null },
      req
    });

    await client.query("COMMIT");
    return updated.rows[0];
  } catch (error) {
    await safeRollback(client);
    throw error;
  } finally {
    client.release();
  }
};

exports.reopenRun = async (req) => {
  const pool = await ensurePool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });

    const run = await getRunForUpdate(client, tenantId, req.params.runId);
    if (!run) throw { code: 404, message: "Payroll run not found" };
    assertAllowedTransition(run.status, ["locked", "approved", "ready_for_approval", "validation_failed"], "reopen");

    const actor = getActorContext(req);
    const updated = await client.query(
      `
        UPDATE payroll_runs
        SET
          status = 'draft',
          updated_by = $2,
          metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
        WHERE id = $1
        RETURNING *
      `,
      [run.id, actor.actorUserId, JSON.stringify({ reopenReason: req.body.reason })]
    );

    await createAuditEntry({
      client,
      tenantId,
      runId: run.id,
      action: "reopen",
      fromStatus: run.status,
      toStatus: "draft",
      actorUserId: actor.actorUserId,
      actorRoleId: actor.actorRoleId,
      reason: req.body.reason,
      payload: { reason: req.body.reason },
      req
    });

    await client.query("COMMIT");
    return updated.rows[0];
  } catch (error) {
    await safeRollback(client);
    throw error;
  } finally {
    client.release();
  }
};

exports.listRunAuditEntries = async (req) => {
  const pool = await ensurePool();
  const client = await pool.connect();
  try {
    const tenantId = await getTenantIdForOrganization(client, req.user.organizationId, {
      actorId: req.user.userId
    });

    const result = await client.query(
      `
        SELECT *
        FROM payroll_run_audit_entries
        WHERE tenant_id = $1 AND payroll_run_id = $2
        ORDER BY created_at DESC
      `,
      [tenantId, req.params.runId]
    );
    return result.rows;
  } finally {
    client.release();
  }
};
