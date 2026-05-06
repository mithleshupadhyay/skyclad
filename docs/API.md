# API Documentation

Base URL: `http://localhost:3000`

Authentication for tenant-scoped endpoints:

```http
Authorization: Bearer sk_test_alpha
```

or:

```http
x-api-key: sk_test_alpha
```

## GET /health

Returns service health.

```json
{
  "status": "ok"
}
```

## GET /metrics

Returns Prometheus metrics. This endpoint is intentionally unauthenticated for local assignment inspection.

Important metric names:

```text
llm_gateway_requests_total
llm_gateway_provider_requests_total
llm_gateway_request_latency_ms
llm_gateway_provider_latency_ms
llm_gateway_tokens_total
llm_gateway_cost_cents_total
```

## GET /v1/providers

Lists enabled providers for the authenticated tenant, including whether they are tenant-allowed and locally configured.

```bash
curl -H "Authorization: Bearer sk_test_alpha" \
  http://localhost:3000/v1/providers | jq .
```

## POST /v1/chat/completions

Unified chat completion endpoint. Supports both JSON responses and SSE streaming.

Provider behavior:

- If `provider` is omitted, routing uses configured real providers first and chooses the lowest estimated cost candidate.
- If no real provider key is configured, routing uses local mock providers so tests and demos do not spend credits.
- If `provider` is set, the request is pinned to that tenant-allowed provider, including `openai`, `anthropic`, `gemini`, `mock-openai`, or `mock-anthropic`.

Request:

```json
{
  "messages": [
    { "role": "system", "content": "You are concise." },
    { "role": "user", "content": "Explain fallback routing." }
  ],
  "model_class": "cheap",
  "provider": "mock-openai",
  "model": "mock-gpt-4o-mini",
  "stream": false,
  "cache": true,
  "temperature": 0.2,
  "max_tokens": 512,
  "metadata": {
    "workflow": "demo"
  },
  "request_id": "optional-client-id"
}
```

Fields:

```text
messages      required, 1-100 chat messages
model_class   cheap, balanced, or premium; default cheap
provider      optional explicit provider
model         optional explicit provider model
stream        boolean; default false
cache         boolean; default true for non-streaming responses
temperature   optional 0-2
max_tokens    optional 1-8192; default 1024
metadata      optional object, persisted only as part of request hash behavior
request_id    optional client correlation id
```

Non-streaming response:

```json
{
  "id": "gateway-request-id",
  "object": "chat.completion",
  "created": 1778057000,
  "model": "mock-gpt-4o-mini",
  "provider": "mock-openai",
  "cache_hit": false,
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "[mock-openai] mock-gpt-4o-mini handled: Explain fallback routing."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 7,
    "completion_tokens": 20,
    "total_tokens": 27,
    "cost_cents": 1
  }
}
```

Real OpenAI example when `OPENAI_API_KEY` is configured:

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

Real Gemini example when `GEMINI_API_KEY` is configured:

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

Expected real Gemini response shape:

```json
{
  "id": "gateway-request-id",
  "object": "chat.completion",
  "model": "gemini-2.5-flash",
  "provider": "gemini",
  "cache_hit": false,
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "..."
      },
      "finish_reason": "STOP"
    }
  ],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 20,
    "total_tokens": 30,
    "cost_cents": 1
  }
}
```

Real Gemini streaming example:

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

Streaming response uses Server-Sent Events:

```text
event: request
data: {"request_id":"...","provider":"mock-openai","model":"mock-gpt-4o-mini"}

event: chunk
data: {"request_id":"...","index":0,"delta":"[mock-openai] "}

event: done
data: {"request_id":"...","provider":"mock-openai","model":"mock-gpt-4o-mini","usage":{"promptTokens":8,"completionTokens":16,"totalTokens":24},"cost_cents":1}
```

If an upstream stream drops after partial output, the gateway keeps already-sent chunks visible and ends with:

```text
event: error
data: {"request_id":"...","code":"injected_stream_drop","message":"Injected stream drop after partial response.","partial":true}
```

## GET /v1/usage

Returns tenant usage and cost summary. Optional `since` query filters by timestamp.

```bash
curl -H "Authorization: Bearer sk_test_alpha" \
  "http://localhost:3000/v1/usage?since=2026-05-01T00:00:00.000Z" | jq .
```

Response:

```json
{
  "tenantId": "tenant-alpha",
  "totalRequests": 1,
  "totalTokens": 27,
  "totalCostCents": 1,
  "byProvider": [
    {
      "providerName": "mock-openai",
      "model": "mock-gpt-4o-mini",
      "requests": 1,
      "totalTokens": 27,
      "totalCostCents": 1
    }
  ]
}
```

## GET /v1/circuit-breakers

Lists provider circuit states.

## POST /v1/circuit-breakers/:provider/reset

Resets one provider circuit breaker to closed.

## GET /v1/failure-injections

Lists current provider failure injection state.

## POST /v1/failure-injections/:provider

Configures failure injection.

```json
{
  "mode": "fail",
  "remaining_count": 1,
  "latency_ms": 0,
  "status_code": 503,
  "stream_drop_after_chunks": 1
}
```

Supported providers:

```text
openai, anthropic, gemini, mock-openai, mock-anthropic
```

Supported modes:

```text
none, fail, timeout, slow, stream_drop
```
