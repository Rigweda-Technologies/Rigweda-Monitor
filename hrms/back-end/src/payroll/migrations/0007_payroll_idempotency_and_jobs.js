"use strict";

module.exports = {
  id: "0007",
  name: "payroll_idempotency_and_jobs",
  up: [
    `
      CREATE TABLE IF NOT EXISTS payroll_action_idempotency (
        id BIGSERIAL PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES payroll_tenants(id) ON DELETE CASCADE,
        action_key VARCHAR(80) NOT NULL,
        idempotency_key VARCHAR(120) NOT NULL,
        payroll_run_id UUID REFERENCES payroll_runs(id) ON DELETE SET NULL,
        actor_user_id VARCHAR(64),
        request_hash CHAR(64) NOT NULL,
        request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        status VARCHAR(20) NOT NULL DEFAULT 'processing'
          CHECK (status IN ('processing', 'succeeded', 'failed')),
        response_payload JSONB,
        error_payload JSONB,
        http_status INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_payroll_action_idempotency UNIQUE (tenant_id, action_key, idempotency_key)
      );
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_payroll_idempotency_tenant_action_status
        ON payroll_action_idempotency (tenant_id, action_key, status, updated_at DESC);
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_payroll_idempotency_run
        ON payroll_action_idempotency (payroll_run_id, created_at DESC);
    `,
    `
      CREATE TRIGGER trg_payroll_action_idempotency_updated_at
      BEFORE UPDATE ON payroll_action_idempotency
      FOR EACH ROW
      EXECUTE FUNCTION set_row_updated_at();
    `
  ],
  down: [
    `
      DROP TRIGGER IF EXISTS trg_payroll_action_idempotency_updated_at ON payroll_action_idempotency;
    `,
    `
      DROP TABLE IF EXISTS payroll_action_idempotency;
    `
  ]
};
