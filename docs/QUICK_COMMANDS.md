# Demo Video Script

Target length: 8-12 minutes.

Recording format: screen share with microphone. Show your face for the first 20-30 seconds or at the end. Do not show `.env`, real API keys, browser password managers, or any terminal command that prints secrets.

## 0. Before Recording

Open these files/tabs:

- `README.md`
- `DESIGN.md`
- `docs/API.md`
- terminal in the repo root
- GitHub repo page

Start the API:

```bash
npm run dev
```

If port `3000` is busy:

```bash
PORT=3010 npm run dev
```

Check the API once before recording:

```bash
curl http://localhost:3000/health
```

If you are showing real Gemini, keep `GEMINI_API_KEY` in `.env`, but never open `.env` during the recording.

## 1. Intro And Scope

Time: 30-45 seconds.

Show your face briefly and say:

> Hi, I am Mithlesh Upadhyay. This is my Skyclad Ventures Senior Backend Engineer assignment. I built a TypeScript and Express multi-tenant LLM gateway that exposes one unified chat API in front of OpenAI, Anthropic, Google Gemini, and local mock providers.

Continue:

> The gateway handles tenant API keys, provider allowlists, rate limits, budget caps, routing, retries, timeouts, circuit breakers, response caching, SSE streaming, structured logs, Prometheus metrics, token accounting, cost accounting, request logs, and SQLite persistence.

Then say:

> I did not use LiteLLM, OpenRouter, Portkey, Helicone, or any off-the-shelf gateway. Provider integration is implemented directly through local provider adapters.

## 2. Architecture Walkthrough

Time: around 3 minutes.

Open `DESIGN.md`.

Show the Mermaid architecture diagram and say:

> The client only talks to `/v1/chat/completions`. The route layer is intentionally thin. It authenticates the tenant API key, validates the request, and delegates to the gateway service.

Point to the service boxes and say:

> `GatewayService` owns the request workflow: tenant checks, rate limits, routing, cache lookup, budget reservation, provider execution, accounting, and final response mapping.

Point to routing and providers:

> `RoutingService` implements cost-optimized routing with failover. It prefers configured real providers, and uses mock providers when no real provider is configured or when a mock is explicitly requested for tests.

Point to provider adapters:

> OpenAI, Anthropic, and Gemini have different request and streaming formats. Those differences stay inside `src/providers`. The client API does not change when a provider is added.

Point to SQLite:

> SQLite is the source of truth for the assignment. It stores tenants, API key hashes, provider configs, allowlists, rate limits, budgets, request logs, provider attempts, token usage, cost ledger entries, cache entries, circuit breaker state, and failure injection state. I chose SQLite because it is real persistence and easy for evaluators to run locally.

Show the sequence diagram and say:

> The important reliability choice is budget reservation before provider execution. The gateway reserves estimated cost atomically, calls the provider, then adjusts the tenant spend to actual usage. That prevents concurrent requests from overspending a tenant budget.

## 3. Setup And Repo Walkthrough

Time: 1 minute.

Open `README.md` and say:

> The README is written for clone-to-running evaluation. The basic path is `npm install`, copy `.env.example`, and run `npm run dev`. Docker and Makefile are included as convenience wrappers, but the runtime remains simple.

Show scripts:

```bash
npm run lint
npm test
npm run build
make verify
```

Say:

> Tests are mock-driven so the evaluator does not need to spend provider credits. Real providers can be tested by adding API keys locally.

## 4. Live API Demo

Time: 3-4 minutes.

### Health

Run:

```bash
curl http://localhost:3000/health
```

Say:

> This confirms the API is running.

### Providers

Run:

```bash
curl -H "Authorization: Bearer sk_test_alpha" \
  http://localhost:3000/v1/providers | jq .
```

Say:

> This shows tenant-visible providers. Notice the `allowed` and `configured` fields. `allowed` comes from the tenant allowlist. `configured` comes from whether the provider adapter has the required API key.

If Gemini is configured, say:

> Gemini is configured here, so I can make a real provider call without changing the client API.

### Real Gemini Non-Streaming

Run:

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

Say:

> This is a real Gemini call through the gateway. The response shape is still the same unified chat completion shape, including provider, model, choices, token usage, and cost.

Point out:

- `provider`
- `model`
- `choices[0].message.content`
- `usage`
- `cost_cents`

### Real Gemini Streaming

Run:

```bash
curl -N -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk_test_alpha" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "gemini",
    "model": "gemini-2.5-flash",
    "stream": true,
    "messages": [{"role": "user", "content": "Stream three short bullets about provider abstraction."}],
    "cache": false,
    "max_tokens": 160
  }'
```

Say:

> Streaming is implemented with SSE end to end. The client receives a request event, chunk events, and a done event with usage and cost.

### Usage

Run:

```bash
curl -H "Authorization: Bearer sk_test_alpha" \
  "http://localhost:3000/v1/usage?since=2026-05-01T00:00:00.000Z" | jq .
```

Say:

> Usage and cost are queryable per tenant. This answers the assignment question: what did tenant X spend and on which model?

### Metrics

Run:

```bash
curl http://localhost:3000/metrics | head -40
```

Say:

> Metrics are exposed in Prometheus format. They include request count, provider requests, latency, tokens, and cost.

## 5. Failure Injection Demo

Time: 1.5-2 minutes.

Say:

> I use mock providers for deterministic failure testing. Real providers are wired for real calls, but mocks let evaluators trigger failures without spending credits or depending on an external outage.

If your main server has real Gemini configured, start a second no-key demo server in another terminal:

```bash
PORT=3010 DATABASE_PATH=/tmp/skyclad-failure-demo.db \
OPENAI_API_KEY= ANTHROPIC_API_KEY= GEMINI_API_KEY= npm run dev
```

Inject a failure:

```bash
curl -X POST http://localhost:3010/v1/failure-injections/mock-openai \
  -H "Authorization: Bearer sk_test_alpha" \
  -H "Content-Type: application/json" \
  -d '{"mode":"fail","remaining_count":1,"status_code":503}' | jq .
```

Run a fallback request:

```bash
curl -X POST http://localhost:3010/v1/chat/completions \
  -H "Authorization: Bearer sk_test_alpha" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Show fallback after provider failure."}],
    "cache": false
  }' | jq .
```

Say:

> The first candidate fails, the gateway records the failed provider attempt, refunds the reservation, and falls back to the next allowed provider. This demonstrates routing, resilience, and tenant-safe accounting.

Optional partial streaming failure:

```bash
curl -X POST http://localhost:3010/v1/failure-injections/mock-openai \
  -H "Authorization: Bearer sk_test_alpha" \
  -H "Content-Type: application/json" \
  -d '{"mode":"stream_drop","remaining_count":1,"stream_drop_after_chunks":2}' | jq .
```

```bash
curl -N -X POST http://localhost:3010/v1/chat/completions \
  -H "Authorization: Bearer sk_test_alpha" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "mock-openai",
    "stream": true,
    "cache": false,
    "messages": [{"role": "user", "content": "Stream and then drop."}]
  }'
```

Say:

> When a stream drops after partial output, the gateway does not hide the partial output. It emits an SSE error event with `partial: true`.

## 6. Decision I Am Proud Of

Time: around 1 minute.

Say:

> The decision I am proud of is the provider adapter boundary. OpenAI, Anthropic, and Gemini have different APIs, authentication, message formats, and streaming behavior. The gateway normalizes all of that behind one client API. Adding Gemini did not require changing the client request shape.

Continue:

> I also kept mocks, but only for the right reason: deterministic local failure testing and no-spend evaluation. They do not replace real providers.

## 7. Decision I Am Unsure About

Time: around 1 minute.

Say:

> The decision I am least certain about for production is SQLite. It is the right assignment choice because it gives real persistence and simple local setup. But before customer traffic, I would move to Postgres for stronger concurrency, migrations, pooling, backups, and analytics queries.

Continue:

> I would also move distributed rate limits, hot cache entries, and circuit breaker coordination to Redis once the API runs across multiple workers.

## 8. What I Cut For Scope

Time: 30-45 seconds.

Open `docs/FUTURE_SCOPE.md`.

Say:

> I did not add Kafka, Kubernetes, Redis, Postgres, Celery, or admin dashboards into the local runtime. Those are documented as future scope. Adding them now would make evaluation harder without improving the core assignment signal.

## 9. Open Question For Skyclad

Time: 30-60 seconds.

Say:

> My main question for Skyclad is: across your portfolio, is the routing problem mostly about cost, latency, output quality, compliance, or tenant-specific provider preference? That answer would change how I evolve the routing policy.

Optional second question:

> I would also ask whether tenants bring their own provider keys or whether Skyclad centrally manages provider credentials. That affects secrets management, billing, and provider isolation.

## 10. Closing

Time: 15-30 seconds.

Say:

> That is the walkthrough. The repo includes setup instructions, API docs, operations notes, requirement mapping, future scope, and the design document. The implementation is verified with lint, build, tests, and audit.

End recording.

## Quick Command List

Use this list during recording.

```bash
curl http://localhost:3000/health
```

```bash
curl -H "Authorization: Bearer sk_test_alpha" \
  http://localhost:3000/v1/providers | jq .
```

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

```bash
curl -N -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk_test_alpha" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "gemini",
    "model": "gemini-2.5-flash",
    "stream": true,
    "messages": [{"role": "user", "content": "Stream three short bullets about provider abstraction."}],
    "cache": false,
    "max_tokens": 160
  }'
```

```bash
curl -H "Authorization: Bearer sk_test_alpha" \
  "http://localhost:3000/v1/usage?since=2026-05-01T00:00:00.000Z" | jq .
```

```bash
curl http://localhost:3000/metrics | head -40
```

```bash
PORT=3010 DATABASE_PATH=/tmp/skyclad-failure-demo.db \
OPENAI_API_KEY= ANTHROPIC_API_KEY= GEMINI_API_KEY= npm run dev
```

```bash
curl -X POST http://localhost:3010/v1/failure-injections/mock-openai \
  -H "Authorization: Bearer sk_test_alpha" \
  -H "Content-Type: application/json" \
  -d '{"mode":"fail","remaining_count":1,"status_code":503}' | jq .
```

```bash
curl -X POST http://localhost:3010/v1/chat/completions \
  -H "Authorization: Bearer sk_test_alpha" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Show fallback after provider failure."}],
    "cache": false
  }' | jq .
```

