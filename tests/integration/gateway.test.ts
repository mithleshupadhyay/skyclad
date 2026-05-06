import request from "supertest";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createApp } from "../../src/app.js";
import { loadSettings } from "../../src/config/settings.js";

function buildApp() {
  return createApp(
    loadSettings({
      databasePath: ":memory:",
      seedDemoData: true,
      openaiApiKey: undefined,
      anthropicApiKey: undefined,
      geminiApiKey: undefined,
      providerMaxRetries: 0,
      circuitFailureThreshold: 3,
      cacheEnabled: true,
    }),
  ).app;
}

describe("multi-tenant LLM gateway", () => {
  it("serves health and provider metadata", async () => {
    const app = buildApp();

    await request(app).get("/health").expect(200, { status: "ok" });

    const providers = await request(app)
      .get("/v1/providers")
      .set("Authorization", "Bearer sk_test_alpha")
      .expect(200);

    assert.ok(providers.body.providers.some((provider: Record<string, unknown>) => provider.provider_name === "openai" && provider.allowed === true));
    assert.ok(providers.body.providers.some((provider: Record<string, unknown>) => provider.provider_name === "anthropic" && provider.allowed === true));
    assert.ok(providers.body.providers.some((provider: Record<string, unknown>) => provider.provider_name === "gemini" && provider.allowed === true));
    assert.ok(providers.body.providers.some((provider: Record<string, unknown>) => provider.provider_name === "mock-openai" && provider.configured === true));
    assert.ok(providers.body.providers.some((provider: Record<string, unknown>) => provider.provider_name === "mock-anthropic" && provider.configured === true));
  });

  it("returns a unified non-streaming chat response and caches repeat requests", async () => {
    const app = buildApp();
    const body = {
      messages: [{ role: "user", content: "Summarize why routing matters." }],
    };

    const first = await request(app)
      .post("/v1/chat/completions")
      .set("Authorization", "Bearer sk_test_alpha")
      .send(body)
      .expect(200);

    assert.equal(first.body.provider, "mock-openai");
    assert.equal(first.body.cache_hit, false);
    assert.match(first.body.choices[0].message.content, /routing matters/);
    assert.ok(first.body.usage.total_tokens > 0);

    const second = await request(app)
      .post("/v1/chat/completions")
      .set("Authorization", "Bearer sk_test_alpha")
      .send(body)
      .expect(200);

    assert.equal(second.body.cache_hit, true);
    assert.equal(second.body.choices[0].message.content, first.body.choices[0].message.content);
  });

  it("isolates tenant budgets", async () => {
    const app = buildApp();

    for (let index = 0; index < 3; index += 1) {
      await request(app)
        .post("/v1/chat/completions")
        .set("Authorization", "Bearer sk_test_beta")
        .send({
          cache: false,
          max_tokens: 512,
          messages: [{ role: "user", content: `beta budget request ${index}` }],
        })
        .expect(200);
    }

    const exhausted = await request(app)
      .post("/v1/chat/completions")
      .set("Authorization", "Bearer sk_test_beta")
      .send({
        cache: false,
        max_tokens: 512,
        messages: [{ role: "user", content: "this should exceed beta budget" }],
      })
      .expect(402);

    assert.equal(exhausted.body.error.code, "budget_exhausted");

    await request(app)
      .post("/v1/chat/completions")
      .set("Authorization", "Bearer sk_test_alpha")
      .send({
        cache: false,
        messages: [{ role: "user", content: "alpha should still work" }],
      })
      .expect(200);
  });

  it("fails over when the lowest-cost provider fails", async () => {
    const app = buildApp();

    await request(app)
      .post("/v1/failure-injections/mock-openai")
      .set("Authorization", "Bearer sk_test_alpha")
      .send({ mode: "fail", remaining_count: 1, status_code: 503 })
      .expect(200);

    const response = await request(app)
      .post("/v1/chat/completions")
      .set("Authorization", "Bearer sk_test_alpha")
      .send({
        cache: false,
        messages: [{ role: "user", content: "use fallback provider" }],
      })
      .expect(200);

    assert.equal(response.body.provider, "mock-anthropic");
  });

  it("returns a provider error when a forced provider fails", async () => {
    const app = buildApp();

    await request(app)
      .post("/v1/failure-injections/mock-openai")
      .set("Authorization", "Bearer sk_test_alpha")
      .send({ mode: "fail", remaining_count: 1, status_code: 503 })
      .expect(200);

    const response = await request(app)
      .post("/v1/chat/completions")
      .set("Authorization", "Bearer sk_test_alpha")
      .send({
        provider: "mock-openai",
        cache: false,
        messages: [{ role: "user", content: "forced provider should fail" }],
      })
      .expect(503);

    assert.equal(response.body.error.code, "injected_provider_failure");
  });

  it("keeps partial streaming output visible when upstream drops mid-stream", async () => {
    const app = buildApp();

    await request(app)
      .post("/v1/failure-injections/mock-openai")
      .set("Authorization", "Bearer sk_test_alpha")
      .send({ mode: "stream_drop", remaining_count: 1, stream_drop_after_chunks: 2 })
      .expect(200);

    const response = await request(app)
      .post("/v1/chat/completions")
      .set("Authorization", "Bearer sk_test_alpha")
      .send({
        provider: "mock-openai",
        stream: true,
        cache: false,
        messages: [{ role: "user", content: "stream and then drop" }],
      })
      .expect(200);

    assert.match(response.text, /event: chunk/);
    assert.match(response.text, /event: error/);
    assert.match(response.text, /"partial":true/);
  });

  it("falls back for streaming when first provider fails before chunks", async () => {
    const app = buildApp();

    await request(app)
      .post("/v1/failure-injections/mock-openai")
      .set("Authorization", "Bearer sk_test_alpha")
      .send({ mode: "fail", remaining_count: 1, status_code: 503 })
      .expect(200);

    const response = await request(app)
      .post("/v1/chat/completions")
      .set("Authorization", "Bearer sk_test_alpha")
      .send({
        stream: true,
        cache: false,
        messages: [{ role: "user", content: "stream with fallback" }],
      })
      .expect(200);

    assert.match(response.text, /"provider":"mock-openai"/);
    assert.match(response.text, /"provider":"mock-anthropic"/);
    assert.match(response.text, /event: done/);
  });

  it("reports usage and exposes prometheus metrics", async () => {
    const app = buildApp();

    await request(app)
      .post("/v1/chat/completions")
      .set("Authorization", "Bearer sk_test_alpha")
      .send({
        cache: false,
        messages: [{ role: "user", content: "track this spend" }],
      })
      .expect(200);

    const usage = await request(app)
      .get("/v1/usage")
      .set("Authorization", "Bearer sk_test_alpha")
      .expect(200);

    assert.equal(usage.body.totalRequests, 1);
    assert.ok(usage.body.totalCostCents > 0);
    assert.equal(usage.body.byProvider[0].providerName, "mock-openai");

    const metrics = await request(app).get("/metrics").expect(200);
    assert.match(metrics.text, /llm_gateway_requests_total/);
    assert.match(metrics.text, /llm_gateway_cost_cents_total/);
  });
});
