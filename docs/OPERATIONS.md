# Operations Notes

## Local Runbook

Start the service:

```bash
npm run dev
```

If local port `3000` is already in use:

```bash
PORT=3010 npm run dev
```

The same command through `make`:

```bash
make dev
```

Start the compiled server after a build:

```bash
npm run build
npm start
```

Start with Docker:

```bash
docker compose up --build
```

If local port `3000` is already in use:

```bash
PORT=3010 docker compose up --build
```

The default Compose service does not pass `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GEMINI_API_KEY` from the host environment. That keeps local evaluation mock-driven and avoids accidental secret exposure in Compose output. For real provider testing, pass keys explicitly through your own local override or `docker run --env-file .env`; do not commit those values.

When real provider keys are configured for a direct `npm run dev` run, normal routing prefers configured real providers. Mock providers remain available for explicit local tests and failure injection by setting `"provider": "mock-openai"` or `"provider": "mock-anthropic"` in the request.

## Real Gemini Smoke Test

Add the key to `.env` without committing it:

```env
GEMINI_API_KEY=your_gemini_key_here
```

Restart the API:

```bash
npm run dev
```

Confirm the gateway sees Gemini as configured:

```bash
curl -H "Authorization: Bearer sk_test_alpha" \
  http://localhost:3000/v1/providers | jq '.providers[] | select(.provider_name=="gemini")'
```

The important fields are:

```json
{
  "provider_name": "gemini",
  "allowed": true,
  "configured": true
}
```

Make a real non-streaming call:

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk_test_alpha" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "gemini",
    "model": "gemini-2.5-flash",
    "messages": [{"role": "user", "content": "Explain this gateway in one sentence from a user perspective."}],
    "cache": false,
    "max_tokens": 128
  }' | jq .
```

Make a real streaming call:

```bash
curl -N -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk_test_alpha" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "gemini",
    "model": "gemini-2.5-flash",
    "stream": true,
    "messages": [{"role": "user", "content": "Stream three short bullets about why provider abstraction helps."}],
    "cache": false,
    "max_tokens": 160
  }'
```

Check accounting:

```bash
curl -H "Authorization: Bearer sk_test_alpha" \
  "http://localhost:3000/v1/usage?since=2026-05-01T00:00:00.000Z" | jq .
```

If Gemini fails with `provider_http_error`, check that the model is available for your API key and that `.env` was loaded after restart. The recommended smoke-test model in this repo is `gemini-2.5-flash`.

Stop Docker:

```bash
docker compose down
```

Run verification:

```bash
npm run lint
npm test
npm run build
```

Or run the full local verification bundle:

```bash
make verify
```

The default SQLite database is created at:

```text
./data/skyclad-gateway.db
```

To reset local state:

```bash
rm -f data/skyclad-gateway.db data/skyclad-gateway.db-shm data/skyclad-gateway.db-wal
npm run dev
```

The Makefile equivalent:

```bash
make reset-db
```

Docker keeps SQLite state in the `gateway_data` named volume. To remove it during local testing:

```bash
docker compose down -v
```

## Logs

Logs are structured JSON on stdout. Useful fields:

```text
requestId
tenantId
providerName
attempt
code
retryable
statusCode
latencyMs
```

Sensitive headers, API keys, prompts, raw messages, and provider keys are redacted or not logged.

## Metrics

Fetch metrics:

```bash
curl http://localhost:3000/metrics
```

Key questions and metrics:

| Question | Metric or endpoint |
| --- | --- |
| How many requests are coming in? | `llm_gateway_requests_total` |
| Which provider is failing? | `llm_gateway_provider_requests_total{status="failed"}` |
| What is provider latency? | `llm_gateway_provider_latency_ms` |
| What did this tenant spend? | `GET /v1/usage` |
| Which model burned tokens? | `llm_gateway_tokens_total` and `/v1/usage` |

## Failure Injection

Fail next request:

```bash
curl -X POST http://localhost:3000/v1/failure-injections/mock-openai \
  -H "Authorization: Bearer sk_test_alpha" \
  -H "Content-Type: application/json" \
  -d '{"mode":"fail","remaining_count":1,"status_code":503}'
```

Slow a provider:

```bash
curl -X POST http://localhost:3000/v1/failure-injections/mock-openai \
  -H "Authorization: Bearer sk_test_alpha" \
  -H "Content-Type: application/json" \
  -d '{"mode":"slow","remaining_count":1,"latency_ms":3000}'
```

Drop stream after partial output:

```bash
curl -X POST http://localhost:3000/v1/failure-injections/mock-openai \
  -H "Authorization: Bearer sk_test_alpha" \
  -H "Content-Type: application/json" \
  -d '{"mode":"stream_drop","remaining_count":1,"stream_drop_after_chunks":2}'
```

Clear injection:

```bash
curl -X POST http://localhost:3000/v1/failure-injections/mock-openai \
  -H "Authorization: Bearer sk_test_alpha" \
  -H "Content-Type: application/json" \
  -d '{"mode":"none"}'
```

## Synthetic Incident Walkthrough

Symptom: requests are returning 503.

1. Check `/metrics` for `llm_gateway_provider_requests_total{status="failed"}`.
2. Check `/v1/circuit-breakers` to see whether a provider circuit is open.
3. Search logs by `requestId` from the response header.
4. If failures were injected, check `/v1/failure-injections`.
5. Reset the provider circuit only after confirming the upstream is healthy.

Symptom: tenant receives 402.

1. Call `/v1/usage` with that tenant API key.
2. Check `tenants.spent_cents` and `cost_ledger` in SQLite.
3. Confirm cache was not disabled for repeat requests.
4. Raise the tenant budget or wait for a billing-period reset in a production version.

## Production Monitoring Gaps

For a real customer deployment, add persistent dashboards, alert thresholds, log retention, distributed traces, and per-provider SLOs. The current service emits the right raw signals but does not ship a dashboard bundle.

## Infrastructure Scope Notes

Docker and Makefile are included only to reduce local setup friction. The current assignment runtime intentionally does not start Kafka, Redis, Postgres, Celery, Kubernetes, or a separate worker stack. Those are documented in [FUTURE_SCOPE.md](./FUTURE_SCOPE.md) with the conditions under which they become worth adding.
