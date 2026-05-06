# Future Scope

This assignment intentionally ships the smallest production-shaped gateway that is pleasant to run locally. The items below are real production improvements, but they were kept out of the MVP because they would add setup friction without improving the core evaluator flows: tenant isolation, routing, resilience, streaming, persistence, and observability.

## What Was Added Now

Docker and Makefile support are included because they reduce local friction without changing the runtime design.

Docker runs the same Node.js service and stores SQLite data in a named volume. It is useful for repeatable local evaluation, but it is not a claim that this is a complete production deployment.

The Makefile is a command wrapper for humans:

```bash
make dev
make verify
make docker-up
make docker-down
```

## Postgres

Postgres is the first datastore upgrade I would make before real customer traffic. SQLite is acceptable for this assignment because it is persistent, inspectable, and requires no external service. At higher concurrency, Postgres gives better write throughput, row-level locking, connection pooling, backups, read replicas, and operational tooling.

The migration path would be:

1. Introduce a Node-compatible migration tool such as `node-pg-migrate`, Drizzle migrations, Kysely migrations, or Prisma migrations.
2. Port schema tables from SQLite to Postgres with explicit indexes for tenant usage, request logs, provider attempts, and cost ledger queries.
3. Move budget reservation to `UPDATE ... WHERE spent_cents + reservation <= monthly_budget_cents` inside transactions.
4. Add a reconciliation job for stale reservations.
5. Add backup, restore, and dashboard query runbooks.

Estimated first-pass effort: 3-5 engineering days.

## Redis

Redis becomes useful once the gateway runs more than one API worker. The current SQLite-backed rate limit and cache state is fine for a single-node assignment, but distributed workers need shared fast state.

Redis should own:

- distributed rate limit counters
- hot response cache entries
- single-flight locks for repeated cache misses
- coordinated circuit breaker state
- short-lived idempotency or request de-duplication guards

The main tradeoff is operational complexity. Redis adds another system that can fail, needs monitoring, and requires a clear fallback policy. I would add it only when horizontal API scaling is required.

Estimated first-pass effort: 2-4 engineering days.

## Kafka Or Event Streaming

Kafka is not needed for the current gateway. The service writes request logs, provider attempts, token usage, and cost records directly to the datastore. That is simpler and easier to evaluate.

Kafka becomes justified when multiple independent consumers need the same durable stream, for example:

- billing pipeline
- fraud or abuse detection
- warehouse ingestion
- customer analytics export
- async alerting
- long-term audit retention

If only background jobs are needed, I would start with a simpler queue such as SQS, BullMQ, or pg-boss. Kafka is a strong choice only when event fan-out and replay become product requirements.

Estimated first-pass effort: 4-8 engineering days depending on deployment environment and consumer count.

## Queue Workers

The assignment uses synchronous retries because evaluator requests need immediate, visible behavior. Production would benefit from workers for non-critical or delayed work:

- stale budget reservation reconciliation
- usage export
- webhook-style customer callbacks
- slow analytics aggregation
- periodic provider health probes

For a TypeScript service, I would use BullMQ with Redis, pg-boss with Postgres, or cloud-native queues. Celery is a Python tool and is not a natural fit unless a future Python service owns model evaluation, data processing, or ML-specific jobs.

Estimated first-pass effort: 2-5 engineering days.

## Alembic

Alembic is a Python migration tool. I would not introduce it into this TypeScript codebase. If a future Python service owns a separate database schema, Alembic would be appropriate there. For this gateway, migrations should live in the Node.js toolchain so setup, tests, and deployment remain coherent.

## Kubernetes And Cloud Deployment

Kubernetes is not needed for local evaluation. A production deployment would likely include:

- managed Postgres
- managed Redis
- container image scanning
- secret manager integration
- horizontal pod autoscaling
- request and memory limits
- readiness and liveness probes
- blue-green or rolling deploys
- dashboard and alert bundles

I would add Kubernetes or cloud manifests only after the target environment is known. Premature manifests often age badly because cloud networking, secret injection, ingress, and observability conventions differ across teams.

Estimated first-pass effort: 3-7 engineering days after environment decisions are made.

## OpenTelemetry And Dashboards

The service already emits structured JSON logs, Prometheus metrics, request IDs, provider attempts, and usage data. Production should add:

- OpenTelemetry traces across API, DB, cache, and provider calls
- Grafana dashboards for tenant cost, provider latency, error rates, cache hit rate, and circuit state
- alerts for provider failure spikes, open circuits, budget write failures, high p95 latency, and DB saturation
- log retention policies with sensitive data review

Estimated first-pass effort: 2-4 engineering days.

## Admin Control Plane

The current failure injection and circuit reset endpoints are evaluator tools. A real admin plane would need:

- strong admin authentication
- role-based permissions
- tenant config management
- provider allowlist changes
- key rotation and revocation
- audit logs for every admin action
- safer separation between test controls and production controls

Estimated first-pass effort: 5-10 engineering days depending on existing identity infrastructure.

## What I Would Prioritize First

If this were moving toward paying customers, my order would be:

1. Postgres with migrations and stale-reservation reconciliation.
2. API key hardening and admin audit logs.
3. Redis for distributed rate limits and cache if horizontal scaling is needed.
4. OpenTelemetry, dashboards, and alert rules.
5. Load and soak testing for non-streaming and streaming traffic.
6. Queue workers for reconciliation and async exports.
7. Kafka only after multiple durable event consumers exist.

