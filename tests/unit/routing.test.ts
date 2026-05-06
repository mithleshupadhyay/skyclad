import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadSettings } from "../../src/config/settings.js";
import { initializeDatabase, openDatabase } from "../../src/db/database.js";
import { ProviderRepository } from "../../src/db/providerRepository.js";
import { TenantRepository } from "../../src/db/tenantRepository.js";
import { RoutingService } from "../../src/routing/routingService.js";
import { ProviderRegistry } from "../../src/providers/registry.js";

function buildRoutingService(openaiApiKey?: string, anthropicApiKey?: string, geminiApiKey?: string) {
  const settings = loadSettings({
    databasePath: ":memory:",
    seedDemoData: true,
    openaiApiKey,
    anthropicApiKey,
    geminiApiKey,
  });
  const db = openDatabase(":memory:");
  initializeDatabase(db, settings);

  const tenantRepository = new TenantRepository(db);
  const providerRepository = new ProviderRepository(db);
  const providerRegistry = new ProviderRegistry(settings);
  const routingService = new RoutingService(providerRepository, tenantRepository, providerRegistry);
  const tenant = tenantRepository.findByApiKey("sk_test_alpha")?.tenant;

  assert.ok(tenant);

  return { db, routingService, tenant };
}

describe("routing service", () => {
  it("uses mock providers when no real provider is configured", () => {
    const { db, routingService, tenant } = buildRoutingService();

    const decision = routingService.selectProvider(tenant, {
      messages: [{ role: "user", content: "local demo" }],
      modelClass: "cheap",
      stream: false,
      cache: true,
      maxTokens: 256,
    });

    assert.equal(decision.selectedProvider, "mock-openai");
    assert.ok(decision.candidates.every((candidate) => candidate.providerName.startsWith("mock-")));
    db.close();
  });

  it("prefers real configured providers for normal routing", () => {
    const { db, routingService, tenant } = buildRoutingService("test-openai-key");

    const decision = routingService.selectProvider(tenant, {
      messages: [{ role: "user", content: "real provider path" }],
      modelClass: "cheap",
      stream: false,
      cache: true,
      maxTokens: 256,
    });

    assert.equal(decision.selectedProvider, "openai");
    assert.ok(decision.candidates.every((candidate) => !candidate.providerName.startsWith("mock-")));
    db.close();
  });

  it("still allows an explicit mock provider for failure-injection demos", () => {
    const { db, routingService, tenant } = buildRoutingService("test-openai-key");

    const decision = routingService.selectProvider(tenant, {
      provider: "mock-openai",
      messages: [{ role: "user", content: "forced mock path" }],
      modelClass: "cheap",
      stream: false,
      cache: true,
      maxTokens: 256,
    });

    assert.equal(decision.selectedProvider, "mock-openai");
    assert.equal(decision.candidates.length, 1);
    db.close();
  });

  it("can route to Gemini when it is the configured real provider", () => {
    const { db, routingService, tenant } = buildRoutingService(undefined, undefined, "test-gemini-key");

    const decision = routingService.selectProvider(tenant, {
      messages: [{ role: "user", content: "real gemini path" }],
      modelClass: "cheap",
      stream: false,
      cache: true,
      maxTokens: 256,
    });

    assert.equal(decision.selectedProvider, "gemini");
    assert.ok(decision.candidates.every((candidate) => !candidate.providerName.startsWith("mock-")));
    db.close();
  });
});
