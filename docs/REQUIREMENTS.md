# Requirements Mapping

## Functional Requirements

| Requirement | Implementation |
| --- | --- |
| Unified API surface | `POST /v1/chat/completions` accepts one request shape and returns normalized chat responses. Provider-specific logic stays in `src/providers`. |
| Streaming | SSE streaming is implemented in `src/api/sse.ts` and `GatewayService.stream`. Partial output is preserved when a provider drops mid-stream. |
| Two providers minimum | Real OpenAI, Anthropic, and Gemini adapters are wired in. Mock OpenAI and Mock Anthropic are included for local tests and demos without spend. |
| Multi-tenancy | Tenant API keys, tenant budgets, provider allowlists, usage records, and rate limits are stored in SQLite. |
| Independent tenant budgets | Budget reservation and adjustment happen through atomic SQLite updates in `TenantRepository`. |
| Rate limits | Per-tenant minute windows are persisted in `tenant_rate_limits`. |
| Routing | Cost-optimized routing with retained failover candidates is implemented in `RoutingService`. Configured real providers are preferred; mocks are used when no real provider is configured or when explicitly requested. |
| Resilience | Retries, provider timeouts, circuit breaker state, and fallback behavior are implemented in `ProviderExecutor` and `GatewayService`. |
| Observability | Structured logs, Prometheus metrics, request IDs, request logs, provider attempt logs, token usage, and cost ledgers are included. |
| Caching | Non-streaming responses are cached by tenant, provider, model, request payload, temperature, and max tokens with TTL. |
| Persistence | SQLite stores tenant config, keys, allowlists, budgets, request logs, provider attempts, token usage, cost ledger, cache entries, circuit state, and failure injection state. |
| Failure injection | `POST /v1/failure-injections/:provider` supports fail, timeout, slow, and stream-drop scenarios. |

## Evaluation Flows

| Evaluator action | How to test |
| --- | --- |
| Spin up locally | `npm install && cp .env.example .env && npm run dev` |
| Send concurrent tenant requests | Use `sk_test_alpha` and `sk_test_beta`; budget and rate state are tenant-scoped. |
| Exhaust tenant budget | Send multiple `cache:false` requests with `sk_test_beta`. |
| Simulate provider failure | In the no-key local path, configure `mock-openai` failure injection, then send a request without forcing provider. It falls back to `mock-anthropic`. With real keys configured, explicitly request mock providers for deterministic failure-injection demos. |
| Test a real provider | Add `GEMINI_API_KEY` to `.env`, restart, confirm `/v1/providers` reports `gemini.configured=true`, then call `POST /v1/chat/completions` with `"provider":"gemini"`. |
| Debug from logs and metrics | Check structured stdout logs, `/metrics`, and `/v1/usage`. |
| Read code | Main flow is in `src/services/gatewayService.ts`; provider attempts are in `src/resilience/providerExecutor.ts`. |

## Known Scope Cuts

| Cut | Reason |
| --- | --- |
| No frontend | Assignment explicitly does not grade frontend. |
| No full user auth | Tenant API keys are enough for assignment isolation. JWT/OAuth hardening is documented as production work. |
| No external Redis cache | SQLite-backed cache is simpler and inspectable for local evaluation. |
| No queue workers | Retries are synchronous for MVP clarity. Queue-based async retry is documented as production follow-up. |
| No Kubernetes/cloud deployment | Local backend-first delivery is enough for the assignment. Docker is included only as a local packaging option. |
| No Kafka/Postgres/Celery/Alembic runtime | These are documented in `docs/FUTURE_SCOPE.md`; adding them now would increase setup friction without improving core evaluation flows. |
