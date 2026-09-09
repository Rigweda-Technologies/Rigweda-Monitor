# Monitoring app commercial readiness — 2026-09-09

Do not onboard production customer monitoring data until the critical and high findings below are fixed and tested with separate organizations. This is a focused source review, not certification of the entire HRMS application.

Scope: Python screenshot agent; Desktop authentication, screenshot ingestion and cloud integration; HRMS monitoring settings, routes, completion and queries; schema and updater inspection. No live customer requests, real credentials, cloud operations or database writes were used. Application code was not changed during this audit. Existing theme changes were left alone.

## Release blockers

### 1. Critical: employee-accessible storage API secret — code fix completed

- Fix status: HRMS now returns public settings only; Desktop reads encrypted tenant settings directly from the shared database and returns an explicit public projection. Five focused regression tests pass. Deployment of both backends, rotation of previously exposed credentials, and real-cloud upload verification remain operational follow-ups. The evidence below describes the original defect.
- HRMS agent.monitorUploads.routes.js allows EMP_SELF_VIEW on GET /api/agents/cloudinary/upload-config.
- agent.monitorSettings.controller.js:100 returns getRawSettings unchanged; agent.monitorSettings.service.js:165 explicitly includes decrypted apiSecret.
- An ordinary authorized employee can obtain credentials for the configured Cloudinary account. Shared accounts increase the potential blast radius.
- Fix: return upload signatures only. Any server-to-server secret access must use dedicated service authentication. Rotate exposed credentials after closing the endpoint if it has been deployed and accessible.
- Evidence: isolated controller probe returned a synthetic secret unchanged; route permissions verified in source. No live employee login was used.
- Cloudinary explicitly prohibits exposing API secrets to clients: https://cloudinary.com/documentation/client_side_uploading

### 2. Critical: screenshot completion lacks ownership checks — code fix completed

- Fix status: both APIs derive tenant/employee identity from authentication, validate device and batch ownership, scope every screenshot write, validate duplicate ownership/hash, and commit atomically. Create-session upsert conflicts cannot overwrite another owner. PostgreSQL tests cover both deployments. Provider-upload verification remains the next separate fix. Original evidence follows.
- HRMS agent.monitorUploads.controller.js omits authenticated identity from completion calls.
- agent.monitorUploads.service.js:270 updates by device_id and client_screenshot_id without organization, employee or batch predicates.
- Desktop screenshots.controller.js and screenshots.model.js:128 repeat the defect.
- An authenticated caller who obtains another record's identifiers can alter its URL, status or duplicate linkage, including across organizations. Random identifiers do not provide authorization.
- Fix: registered-device ownership checks; tenant, employee and batch predicates on all writes; affected-row validation; two-tenant negative tests.
- Evidence: actual HRMS service executed with a mocked database and emitted an unscoped update. No live cross-tenant exploit was attempted.
- OWASP guidance: https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/

### 3. High: completion trusts client claims and can acknowledge nothing - code fix completed

- Fix status: HRMS and Desktop completion now verify the expected Cloudinary asset with the organization's server credentials before writing uploaded metadata. Completion stores the provider-returned asset ID, version, format, URL and size, and rolls back if verification fails.
- The Python agent now requires a successful response for the same batch, same device and exact `acknowledgedScreenshotIds` before deleting local files.
- Tests: `screenshotAssetVerification.test.js`, `screenshotOwnership.test.js` and `test_screenshot_commit.py`.
- Evidence: real service with a fake database accepted an arbitrary URL and returned null without error; agent deletion behavior traced in source.

### 4. High: process crashes strand uploaded screenshots - code fix completed

- Fix status: `cloudinary_uploaded` rows are no longer treated as ordinary upload candidates. The agent resumes them through `resume_uploaded_screenshots`, preserving their original batch ID and retrying backend completion without reuploading the file.
- Completion retry keeps rows in `cloudinary_uploaded` on temporary backend failure and increments retry metadata.
- Tests: `test_screenshot_recovery.py` and `monitor-queue-probe.py`.

### 5. High: backlog is not bound to its original account - code fix completed

- Fix status: captured screenshots now store organization, user and device identity in SQLite, and upload selection is scoped to the current token-derived identity.
- New screenshot files are written under an identity-derived owner folder. Legacy/unowned rows are quarantined instead of being silently assigned to the next logged-in account.
- Tests: `test_screenshot_identity.py`.

### 6. High: application does not enforce private screenshot delivery - code fix completed

- Fix status: new monitor screenshot uploads are signed with Cloudinary `type: authenticated`, completion verifies authenticated assets, and HRMS screenshot listing returns short-lived signed authenticated delivery URLs instead of the stored provider URL.
- Existing screenshots uploaded before this fix may still exist as public `upload` assets in Cloudinary and should be migrated or deleted according to retention policy.
- Tests: `screenshotSignedDelivery.test.js`, `screenshotAssetVerification.test.js`, and `cloudinarySecrets.test.js`.
- Provider reference: https://cloudinary.com/documentation/control_access_to_media
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
