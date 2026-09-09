# Monitoring app commercial readiness — 2026-09-09

Do not onboard production customer monitoring data until the critical and high findings below are fixed and tested with separate organizations. This is a focused source review, not certification of the entire HRMS application.

Scope: Python screenshot agent; Desktop authentication, screenshot ingestion and cloud integration; HRMS monitoring settings, routes, completion and queries; schema and updater inspection. No live customer requests, real credentials, cloud operations or database writes were used. Application code was not changed during this audit. Existing theme changes were left alone.

## Release blockers

### 1. Critical: employee-accessible storage API secret

- HRMS agent.monitorUploads.routes.js allows EMP_SELF_VIEW on GET /api/agents/cloudinary/upload-config.
- agent.monitorSettings.controller.js:100 returns getRawSettings unchanged; agent.monitorSettings.service.js:165 explicitly includes decrypted apiSecret.
- An ordinary authorized employee can obtain credentials for the configured Cloudinary account. Shared accounts increase the potential blast radius.
- Fix: return upload signatures only. Any server-to-server secret access must use dedicated service authentication. Rotate exposed credentials after closing the endpoint if it has been deployed and accessible.
- Evidence: isolated controller probe returned a synthetic secret unchanged; route permissions verified in source. No live employee login was used.
- Cloudinary explicitly prohibits exposing API secrets to clients: https://cloudinary.com/documentation/client_side_uploading

### 2. Critical: screenshot completion lacks ownership checks

- HRMS agent.monitorUploads.controller.js omits authenticated identity from completion calls.
- agent.monitorUploads.service.js:270 updates by device_id and client_screenshot_id without organization, employee or batch predicates.
- Desktop screenshots.controller.js and screenshots.model.js:128 repeat the defect.
- An authenticated caller who obtains another record's identifiers can alter its URL, status or duplicate linkage, including across organizations. Random identifiers do not provide authorization.
- Fix: registered-device ownership checks; tenant, employee and batch predicates on all writes; affected-row validation; two-tenant negative tests.
- Evidence: actual HRMS service executed with a mocked database and emitted an unscoped update. No live cross-tenant exploit was attempted.
- OWASP guidance: https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/

### 3. High: completion trusts client claims and can acknowledge nothing

- Both completion services accept cloudinaryUrl without verifying a provider signature or expected asset.
- HRMS completion returns null if the batch does not exist; the controller still sends success.
- Python screenshot.py:923 ignores completion response data and deletes submitted local files after HTTP success.
- Result: fabricated evidence, or local deletion after false success if a fallback backend lacks matching metadata.
- Fix: verify provider evidence against expected tenant/public ID; transactional commit; return exact acknowledged screenshot IDs; delete only acknowledged files.
- Evidence: real service with a fake database accepted an arbitrary URL and returned null without error; agent deletion behavior traced in source.

### 4. High: process crashes strand uploaded screenshots

- screenshot.py:903 persists cloudinary_uploaded before commit.
- screenshot.py:719 retries only pending, failed and uploading states. File discovery skips existing rows.
- Power loss or force termination in this window leaves screenshots outside recovery and potentially pending in the dashboard indefinitely.
- Fix: durable uploaded-but-uncommitted state, stable batch identity and commit-only recovery.
- Evidence: actual retry selector executed against SQLite excluded an uploaded-before-crash row. Ordinary caught exceptions differ: the existing exception handler marks rows failed.

### 5. High: backlog is not bound to its original account

- screenshot.py:55 uses one queue per runtime data root; schema at line 522 has no organization or employee identity.
- Upload uses the current access token, and the server assigns that token's employee.
- Signing into another account in the same runtime profile with a pending backlog can upload old screenshots under the new organization/account.
- Fix: persist immutable organization/employee/device ownership at capture; partition queue and files by identity; quarantine legacy unowned files.
- Evidence: source trace; real two-account desktop switching remains untested.

### 6. High: application does not enforce private screenshot delivery

- HRMS agent.monitorUploads.service.js:121 and Desktop integrations/cloudinary.js sign uploads without authenticated delivery type.
- HRMS agent.screenshots.service.js returns stored URLs directly.
- Under normal Cloudinary public-upload behavior, anyone with the URL can retrieve media outside HRMS permission checks.
- Fix: authenticated originals and derivatives, temporary authorized delivery, and copied-URL/revocation tests.
- Evidence: source configuration; live Cloudinary account restrictions were not inspected and could reduce exposure.
- Provider reference: https://cloudinary.com/documentation/control_access_to_media

### 7. High: Desktop JWT verification skips session revocation

- Desktop middleware/auth.js returns immediately after local JWT signature verification.
- HRMS auth.middleware.js checks active account and tokenList status.
- With locally verifiable tokens, revoked but unexpired sessions can still reach Desktop endpoints lacking a secondary HRMS lookup, including completion.
- Fix: consistent revocation policy, per-device credentials and disabled-account/device checks on both API hosts.
- Evidence: source trace; no live revoked token used.

### 8. High: legacy screenshot endpoint logs credentials and omits tenant metadata

- Desktop screenshots.controller.js:74 adds auth to the payload, then line 78 logs it, including auth.token.
- It supplies no top-level organizationId; screenshots.service.js stores payload.organizationId or null.
- Result: credentials in logs and successful legacy uploads missing from tenant-filtered dashboard queries.
- Fix: remove credential-bearing logging, redact tokens and require verified tenant identity before persistence.
- Evidence: mounted POST /screenshots route and source trace.

## Architecture and scale risks

1. **Duplicate ingestion ownership:** HRMS and Desktop implement screenshot creation/completion and schemas over the same tables; the agent falls back between them. Keep Desktop as the sole ingestion owner and HRMS as tenant-authorized reader, with explicit contracts and one migration owner.
2. **DDL during requests:** HRMS ensureMonitorTables executes CREATE TABLE/INDEX during upload/complete; Desktop cloud settings resolution performs schema checks. Use versioned deployment migrations.
3. **Repeated remote work:** Desktop resolves cloud settings for each signed image, refreshing remotely by default. Employee lookup awaits both candidate profile endpoints even if the first succeeds. Resolve once per batch, cache per tenant, and add explicit deadlines.
4. **Retention/capacity controls:** no screenshot cloud deletion/metadata retention worker was found in the reviewed jobs and ingestion directories. Establish retention, disk limits, storage quotas, orphan cleanup, retry backoff and alerts. External lifecycle policies were not inspected.
5. **Query/index mismatch:** reviewed indexes cover employee/time and organization/employee/hash. HRMS organization-wide browsing uses COUNT and OFFSET with time ordering. Benchmark an organization/time/ID index, bounded date windows and cursor pagination.
6. **Known encryption fallback:** both cloud-settings implementations use MONITOR_SETTINGS_SECRET or JWT_SECRET or the literal monitor-settings-dev-key. Desktop startup does not require either encryption variable. Fail startup without a dedicated key and define rotation.
7. **Operational evidence missing:** production topology, database connection budgets, monitoring/payroll database separation, backups/PITR and restore, alert routing, OS permissions and release settings need verification. The Windows updater already contains SHA256, Authenticode and rollback logic; missing update verification is not a finding.

Illustrative workload, not measured capacity: 1,000 employees × 8 hours × 60 screenshots/hour = 480,000 screenshots per working day. Assuming 200 KB/image, that is about 96 GB/day or 2.88 TB over 30 such days, before replicas and other telemetry. Actual compressed size and capture hours must be measured.

## Recommended target

Enrolled device → identity-bound SQLite queue → Desktop upload-session API → direct private storage upload → server-verified commit → durable metadata and asynchronous reconciliation/retention.

HRMS reads through tenant/role-scoped APIs and issues temporary media access. One ingestion implementation, per-device revocation, tenant quotas and observable retries are the immediate priorities; additional microservices are not required to address these findings.

## Customer pilot acceptance checks

- Two organizations and two employees: deny cross-tenant and unauthorized cross-employee reads/writes/completion.
- No employee can retrieve storage secrets; copied media URLs cannot bypass access policy.
- Revoke sessions/devices and verify denial on both API hosts.
- Test offline backlog, crash at each upload transition, restart, partial uploads and HTTP success with no acknowledgement.
- Account switching never reassigns old screenshots.
- Retention deletes both metadata and media; demonstrate backup restore.
- Load-test agreed employee count/capture interval and dashboard queries; track queue age, failures, database latency, disk usage and storage growth.
- Test supported OS capture permissions, screen lock, sleep/resume, multi-monitor capture and updates on real machines.

## Reproduction and limits

From repository root:

    node docs/audits/monitor-readiness-probe.cjs
    python3 docs/audits/monitor-queue-probe.py

These probes assert that vulnerable behavior currently exists; they are diagnostic evidence, not passing security acceptance tests. They must change after fixes. They use mocks/in-memory storage and do not establish live exploitability, deployed media policy or throughput. No full application audit, production load test or dependency vulnerability scan was performed.
