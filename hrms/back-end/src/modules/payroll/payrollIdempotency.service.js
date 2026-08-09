const crypto = require("crypto");
const { getPayrollPgPool } = require("../../config/payrollDb");
const logger = require("../../logger/logger");
const { observePayrollIdempotencyReplay } = require("../../observability/payrollMetrics");
const { getTenantIdForOrganization } = require("./payrollProvisioning.service");

const MAX_KEY_LENGTH = 120;
const MAX_IN_PROGRESS_AGE_SECONDS = Number(process.env.PAYROLL_IDEMPOTENCY_IN_PROGRESS_TIMEOUT_SEC || 600);
const isMissingIdempotencyTable = (error) => error?.code === "42P01";

const getTenantId = async (client, organizationId) => {
  const result = await client.query(
    `SELECT id FROM payroll_tenants WHERE organization_id = $1`,
    [String(organizationId)]
  );
  return result.rows[0]?.id || null;
};

const getKeyFromRequest = (req) => {
  const headerValue = req.headers?.["idempotency-key"] || req.headers?.["x-idempotency-key"];
  if (!headerValue) return null;
  const key = String(headerValue).trim();
  if (!key) return null;
  if (key.length > MAX_KEY_LENGTH) {
    throw { code: 406, message: `Idempotency-Key max length is ${MAX_KEY_LENGTH}` };
  }
  return key;
};

const createRequestHash = (req, actionKey, runId) => {
  const payload = {
    actionKey,
    runId: runId || null,
    method: req.method || "POST",
    path: req.originalUrl || req.path,
    body: req.body || {},
    params: req.params || {},
    query: req.query || {},
    userId: req.user?.userId ? String(req.user.userId) : null,
    organizationId: req.user?.organizationId ? String(req.user.organizationId) : null
  };

  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
};

const markSuccess = async (pool, id, responsePayload, statusCode = 200) => {
  const client = await pool.connect();
  try {
    await client.query(
      `
        UPDATE payroll_action_idempotency
        SET
          status = 'succeeded',
          response_payload = $2::jsonb,
          error_payload = NULL,
          http_status = $3,
          last_seen_at = NOW(),
          updated_at = NOW()
        WHERE id = $1
      `,
      [id, JSON.stringify(responsePayload ?? null), statusCode]
    );
  } finally {
    client.release();
  }
};

const markFailed = async (pool, id, error, statusCode) => {
  const payload = {
    code: error?.code || statusCode || 500,
    message: error?.message || "Payroll action failed"
  };

  const client = await pool.connect();
  try {
    await client.query(
      `
        UPDATE payroll_action_idempotency
        SET
          status = 'failed',
          error_payload = $2::jsonb,
          http_status = $3,
          last_seen_at = NOW(),
          updated_at = NOW()
        WHERE id = $1
      `,
      [id, JSON.stringify(payload), statusCode || payload.code || 500]
    );
  } finally {
    client.release();
  }
};

exports.executeIdempotentPayrollAction = async ({ req, actionKey, runId = null, resolver }) => {
  const idempotencyKey = getKeyFromRequest(req);
  if (!idempotencyKey) {
    return resolver();
  }

  const pool = await getPayrollPgPool();
  if (!pool) {
    return resolver();
  }

  const lockClient = await pool.connect();
  let idempotencyRecordId = null;

  try {
    const tenantId = await getTenantIdForOrganization(lockClient, req.user.organizationId, {
      actorId: req.user.userId
    });

    const requestHash = createRequestHash(req, actionKey, runId);
    const actorUserId = req.user?.userId ? String(req.user.userId) : null;

    const inserted = await lockClient.query(
      `
        INSERT INTO payroll_action_idempotency (
          tenant_id,
          action_key,
          idempotency_key,
          payroll_run_id,
          actor_user_id,
          request_hash,
          request_payload,
          status
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,'processing')
        ON CONFLICT (tenant_id, action_key, idempotency_key)
        DO NOTHING
        RETURNING id
      `,
      [
        tenantId,
        actionKey,
        idempotencyKey,
        runId || null,
        actorUserId,
        requestHash,
        JSON.stringify({ body: req.body || {}, params: req.params || {}, query: req.query || {} })
      ]
    );

    if (inserted.rows[0]?.id) {
      idempotencyRecordId = inserted.rows[0].id;
    } else {
      const existingResult = await lockClient.query(
        `
          SELECT *
          FROM payroll_action_idempotency
          WHERE tenant_id = $1
            AND action_key = $2
            AND idempotency_key = $3
          LIMIT 1
        `,
        [tenantId, actionKey, idempotencyKey]
      );

      const existing = existingResult.rows[0];
      if (!existing) {
        throw { code: 409, message: "Idempotency conflict. Retry with a new key." };
      }

      if (existing.request_hash !== requestHash) {
        throw {
          code: 409,
          message: "Idempotency-Key was already used with a different request payload"
        };
      }

      if (existing.status === "succeeded") {
        observePayrollIdempotencyReplay(actionKey);
        logger.info("payroll.idempotency.replay", {
          actionKey,
          runId,
          idempotencyKey,
          tenantId,
          actorUserId
        });
        return existing.response_payload;
      }

      if (existing.status === "processing") {
        const rowAgeSeconds = Math.max(
          0,
          Math.floor((Date.now() - new Date(existing.updated_at).getTime()) / 1000)
        );
        if (rowAgeSeconds <= MAX_IN_PROGRESS_AGE_SECONDS) {
          throw {
            code: 409,
            message: "A request with this Idempotency-Key is already being processed"
          };
        }
      }

      const claimed = await lockClient.query(
        `
          UPDATE payroll_action_idempotency
          SET
            status = 'processing',
            error_payload = NULL,
            response_payload = NULL,
            http_status = NULL,
            last_seen_at = NOW(),
            updated_at = NOW()
          WHERE id = $1
          RETURNING id
        `,
        [existing.id]
      );

      idempotencyRecordId = claimed.rows[0]?.id || existing.id;
    }
  } catch (error) {
    if (isMissingIdempotencyTable(error)) {
      logger.warn("payroll.idempotency.table_missing", {
        actionKey,
        runId,
        message: "payroll_action_idempotency table missing; skipping idempotency enforcement"
      });
      return resolver();
    }
    throw error;
  } finally {
    lockClient.release();
  }

  try {
    const result = await resolver();
    if (idempotencyRecordId) {
      await markSuccess(pool, idempotencyRecordId, result, 200);
    }
    return result;
  } catch (error) {
    const statusCode = error?.code && Number.isInteger(error.code) ? error.code : 500;
    try {
      if (idempotencyRecordId) {
        await markFailed(pool, idempotencyRecordId, error, statusCode);
      }
    } catch (updateError) {
      logger.error("payroll.idempotency.mark_failed.error", {
        message: updateError?.message,
        actionKey,
        runId,
        idempotencyRecordId
      });
    }
    throw error;
  }
};
