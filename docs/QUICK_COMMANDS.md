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

