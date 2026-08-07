# Rigweda SaaS scalability target

## Capacity objective

The product target is up to 10,000 employees per organization and 1,000,000 API
requests per minute across the SaaS platform. One million requests per minute is
approximately 16,667 requests per second before peak headroom. It is a
distributed-system capacity target, not a capability of one Node.js process or
one PostgreSQL server.

Use at least 2x peak headroom in production capacity planning. The target is not
accepted until a production-like load test demonstrates the agreed traffic mix,
dataset size, latency percentiles, error rate, and recovery behavior.

## Required production topology

1. Serve the versioned frontend from a CDN and object storage. Do not route
   static assets through the API containers.
2. Put a managed API gateway and load balancer in front of stateless Rigweda API
   containers across at least three availability zones.
3. Autoscale API containers using requests per second, p95 latency, CPU, and
   event-loop delay. Keep access-token validation local and store no user session
   state in process memory.
4. Use a distributed Redis-compatible store for rate-limit counters, short-lived
   authorization/metadata caches, idempotency keys, and cache invalidation. The
   in-process rate-limit store is development-only.
5. Put PgBouncer in transaction-pooling mode between API containers and
   PostgreSQL. Keep each container's pool deliberately small so autoscaling does
   not exhaust database connections.
6. Use a highly available PostgreSQL writer, read replicas for safe report and
   directory reads, point-in-time recovery, and tested failover. High-volume
   attendance, audit, and ledger tables should be time/tenant partitioned after
   measured thresholds justify it.
7. Move payroll runs, accruals, bulk imports, exports, notifications, and other
   long-running jobs to durable queues and independently scaled workers. Store
   generated files in object storage and return job IDs instead of holding HTTP
   connections.
8. Export metrics, structured logs, traces, slow-query samples, and tenant-safe
   correlation IDs. Alert on saturation, replica lag, queue age, error budgets,
   and connection-pool wait time.

## Application rules

- Every business query starts with `organization_id` and uses a supporting
  tenant-first index.
- Every collection is paginated and capped. Synchronous calendar and report
  ranges are bounded; very large exports must become asynchronous jobs.
- Balances are created lazily per employee, leave type, and period. Empty rows
  are not preallocated for every employee and policy combination.
- Concurrent leave submissions lock the employee row, and balance transitions
  lock only the affected annual accounts. This prevents double spending without
  organization-wide locks.
- Immutable ledgers and audit histories are append-only. Mutable projections are
  kept small and indexed for normal UI reads.
- Writes use optimistic versions where a human can edit the same record, and
  database constraints remain the final integrity boundary.
- APIs must be idempotent before clients or gateways automatically retry writes.

## Load-test acceptance plan

Create a production-sized synthetic dataset with multiple tenants, including at
least one 10,000-employee tenant. Exercise a realistic mix rather than repeating
one cached endpoint:

- 55% cached/read-only metadata and dashboard traffic
- 25% employee, attendance, leave, and calendar reads
- 10% authentication/session traffic
- 7% attendance and leave writes
- 3% administrative/report requests, with large work moved to queues

Ramp through 1k, 5k, 10k, and 16.7k requests/second, then test at the agreed peak
headroom. Record p50/p95/p99 latency, errors, CPU, memory, event-loop lag,
database time, lock waits, cache hit rate, queue age, and recovery after an API
instance and a database replica are removed.

## Current repository status

The codebase is ready for horizontal API deployment in that request state is not
stored in the Node process, collection queries are bounded, tenant indexes are
present, and Leave balances are lazy. The repository alone does **not** prove the
one-million-per-minute target. Before production capacity sign-off, add the
managed gateway, distributed rate-limit/cache store, PgBouncer, replicas, queue
workers, production telemetry, and the load-test environment described above.
