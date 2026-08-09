"use strict";

module.exports = {
  id: "0006",
  name: "payroll_approvals_audit",
  up: [
    `
      CREATE TABLE IF NOT EXISTS payroll_run_audit_entries (
        id BIGSERIAL PRIMARY KEY,
        tenant_id UUID NOT NULL REFERENCES payroll_tenants(id) ON DELETE CASCADE,
        payroll_run_id UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
        action VARCHAR(30) NOT NULL
          CHECK (action IN (
            'submit_for_approval',
            'approve',
            'reject',
            'lock',
            'reopen'
          )),
        action_status VARCHAR(20) NOT NULL DEFAULT 'success'
          CHECK (action_status IN ('success', 'failed')),
        from_status VARCHAR(30),
        to_status VARCHAR(30),
        actor_user_id VARCHAR(64) NOT NULL,
        actor_role_id VARCHAR(64),
        reason TEXT,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        ip_address VARCHAR(100),
        user_agent TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_payroll_run_audit_run_time
        ON payroll_run_audit_entries (payroll_run_id, created_at DESC);
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_payroll_run_audit_tenant_action
        ON payroll_run_audit_entries (tenant_id, action, created_at DESC);
    `
  ],
  down: [
    `
      DROP TABLE IF EXISTS payroll_run_audit_entries;
    `
  ]
};
