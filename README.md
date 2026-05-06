# Skyclad Multi-Tenant LLM Gateway

Backend-only TypeScript service for the Skyclad Ventures Senior Backend Engineer assignment. It exposes one provider-agnostic chat API in front of OpenAI, Anthropic, Google Gemini, and local mock providers, with tenant API keys, rate limits, budget caps, routing, retries, circuit breakers, response caching, streaming, metrics, and persisted request accounting.

The local no-key path is mock-driven so the evaluator can run tests without spending provider credits. Real OpenAI, Anthropic, and Gemini adapters are wired in and become the normal routing path when API keys are configured.

## Quick Start

```bash
npm install
cp .env.example .env
npm run dev
```

The API starts on `http://localhost:3000`.

If port `3000` is already in use:

```bash
PORT=3010 npm run dev
```

Seeded demo API keys:

```text
tenant-alpha: sk_test_alpha
tenant-beta:  sk_test_beta
```

`tenant-beta` has a deliberately tiny budget so budget exhaustion is easy to test.

## Docker Quick Start

Docker is included as an evaluator convenience. It runs the same API process and stores SQLite data in a named Docker volume.
The default Compose path is mock-provider driven and does not pass real provider API keys from your host environment.

```bash
docker compose up --build
```

If port `3000` is already busy:

```bash
PORT=3010 docker compose up --build
```

Then verify, replacing the port if you overrode it:

```bash
curl http://localhost:3000/health
```

Stop the service:

```bash
docker compose down
```

## Scripts

```bash
npm run dev      # start local API with tsx
npm start        # start compiled API after npm run build
npm run build    # compile TypeScript to dist/
npm run lint     # TypeScript strict check
npm test         # build and run unit/integration tests
```

The `Makefile` wraps the same commands:

```bash
make dev
make verify
make docker-up
make docker-down
```

## Environment

Important variables from `.env.example`:

```env
PORT=3000
DATABASE_PATH=./data/skyclad-gateway.db
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
PROVIDER_TIMEOUT_MS=15000
PROVIDER_MAX_RETRIES=2
CIRCUIT_FAILURE_THRESHOLD=3
CIRCUIT_RESET_TIMEOUT_MS=30000
CACHE_TTL_SECONDS=300
```

Real providers are optional for local evaluation. Without keys, `openai`, `anthropic`, and `gemini` are visible but not routed automatically; `mock-openai` and `mock-anthropic` are used for local tests and demos. When `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GEMINI_API_KEY` is configured, normal cost-optimized routing prefers configured real providers and uses mocks only when no real provider is available or when a mock provider is explicitly requested.

## Test Real Gemini

Add your Gemini key to `.env`:

```env
GEMINI_API_KEY=your_gemini_key_here
```

Restart the API after editing `.env`:

```bash
npm run dev
```

Confirm Gemini is configured for the demo tenant:

```bash
curl -H "Authorization: Bearer sk_test_alpha" \
  http://localhost:3000/v1/providers | jq '.providers[] | select(.provider_name=="gemini")'
```

Expected signal:

```json
{
  "provider_name": "gemini",
  "allowed": true,
  "configured": true
}
```

Send a real non-streaming Gemini request:

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

Send a real streaming Gemini request:

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

Check usage after the call:

```bash
curl -H "Authorization: Bearer sk_test_alpha" \
  "http://localhost:3000/v1/usage?since=2026-05-01T00:00:00.000Z" | jq .
```

The response should include `providerName: "gemini"` in `byProvider` after a successful real Gemini call.

## API Examples

Health:

```bash
curl http://localhost:3000/health
```

List providers for the current tenant:

```bash
curl -H "Authorization: Bearer sk_test_alpha" \
  http://localhost:3000/v1/providers | jq .
```

Non-streaming chat:

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk_test_alpha" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Explain cost-aware LLM routing in one paragraph."}],
    "model_class": "cheap"
  }' | jq .
```

Force real OpenAI when `OPENAI_API_KEY` is configured:

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk_test_alpha" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "openai",
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Return one sentence from the real provider path."}],
    "cache": false
  }' | jq .
```

Force real Gemini when `GEMINI_API_KEY` is configured:

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk_test_alpha" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "gemini",
    "model": "gemini-2.5-flash",
    "messages": [{"role": "user", "content": "Return one sentence from the Gemini provider path."}],
    "cache": false
  }' | jq .
```

Streaming chat:

```bash
curl -N -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk_test_alpha" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "mock-openai",
    "stream": true,
    "messages": [{"role": "user", "content": "Stream a short answer."}]
  }'
```

Tenant usage summary:

```bash
curl -H "Authorization: Bearer sk_test_alpha" \
  "http://localhost:3000/v1/usage?since=2026-05-01T00:00:00.000Z" | jq .
```

Prometheus metrics:

```bash
curl http://localhost:3000/metrics
```

## Failure Injection

Provider failures are persisted in SQLite so evaluators can inject failures without editing code.

Fail the next `mock-openai` request and watch routing fall back to `mock-anthropic`:

```bash
curl -X POST http://localhost:3000/v1/failure-injections/mock-openai \
  -H "Authorization: Bearer sk_test_alpha" \
  -H "Content-Type: application/json" \
  -d '{"mode":"fail","remaining_count":1,"status_code":503}' | jq .
```

Drop a streaming response after two chunks:

```bash
curl -X POST http://localhost:3000/v1/failure-injections/mock-openai \
  -H "Authorization: Bearer sk_test_alpha" \
  -H "Content-Type: application/json" \
  -d '{"mode":"stream_drop","remaining_count":1,"stream_drop_after_chunks":2}' | jq .
```

Supported modes:

```text
none, fail, timeout, slow, stream_drop
```

Reset a circuit breaker:

```bash
curl -X POST http://localhost:3000/v1/circuit-breakers/mock-openai/reset \
  -H "Authorization: Bearer sk_test_alpha" | jq .
```

## What To Inspect

- `src/api/routes.ts` keeps handlers thin and delegates to services.
- `src/services/gatewayService.ts` owns request flow, routing, caching, budgeting, fallback, and accounting.
- `src/resilience/providerExecutor.ts` owns retries, timeout handling, circuit breaker updates, and failure injection.
- `src/providers/` contains provider-specific request/response mapping.
- `src/db/database.ts` defines the SQLite schema and demo seed data.
- `tests/integration/gateway.test.ts` covers the evaluator-facing flows.

## Documentation

- [DESIGN.md](./DESIGN.md) covers the required seven design sections.
- [docs/API.md](./docs/API.md) documents endpoints and payloads.
- [docs/REQUIREMENTS.md](./docs/REQUIREMENTS.md) maps assignment requirements to implementation.
- [docs/OPERATIONS.md](./docs/OPERATIONS.md) explains metrics, logs, failure injection, and incident debugging.
- [docs/FUTURE_SCOPE.md](./docs/FUTURE_SCOPE.md) documents production follow-ups such as Postgres, Redis, Kafka, queues, and deployment hardening.
