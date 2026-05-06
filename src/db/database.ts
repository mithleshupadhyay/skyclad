import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Settings } from "../config/settings.js";

export type DatabaseClient = Database.Database;

export function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

export function openDatabase(databasePath: string): DatabaseClient {
  if (databasePath !== ":memory:") {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  }

  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

export function initializeDatabase(db: DatabaseClient, settings: Settings): void {
  runMigrations(db);

  if (settings.seedDemoData) {
    seedDemoData(db);
  }
}

function runMigrations(db: DatabaseClient): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      monthly_budget_cents INTEGER NOT NULL,
      spent_cents INTEGER NOT NULL DEFAULT 0,
      rate_limit_per_minute INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tenant_api_keys (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      key_hash TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tenant_provider_allowlists (
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      provider_name TEXT NOT NULL,
      PRIMARY KEY (tenant_id, provider_name)
    );

    CREATE TABLE IF NOT EXISTS provider_configs (
      provider_name TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      default_model TEXT NOT NULL,
      cheap_model TEXT NOT NULL,
      premium_model TEXT NOT NULL,
      prompt_cost_per_1k_cents INTEGER NOT NULL,
      completion_cost_per_1k_cents INTEGER NOT NULL,
      timeout_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS provider_health (
      provider_name TEXT PRIMARY KEY REFERENCES provider_configs(provider_name) ON DELETE CASCADE,
      state TEXT NOT NULL DEFAULT 'closed',
      failure_count INTEGER NOT NULL DEFAULT 0,
      opened_until_ms INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tenant_rate_limits (
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      window_start_ms INTEGER NOT NULL,
      request_count INTEGER NOT NULL,
      PRIMARY KEY (tenant_id, window_start_ms)
    );

    CREATE TABLE IF NOT EXISTS llm_requests (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      api_key_id TEXT NOT NULL REFERENCES tenant_api_keys(id) ON DELETE CASCADE,
      client_request_id TEXT,
      request_hash TEXT NOT NULL,
      model_class TEXT NOT NULL,
      requested_provider TEXT,
      requested_model TEXT,
      stream INTEGER NOT NULL,
      status TEXT NOT NULL,
      cache_key TEXT,
      cache_hit INTEGER NOT NULL DEFAULT 0,
      prompt_chars INTEGER NOT NULL,
      reserved_cents INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      latency_ms INTEGER,
      error_code TEXT,
      error_message TEXT
    );

    CREATE INDEX IF NOT EXISTS ix_llm_requests_tenant_started
      ON llm_requests(tenant_id, started_at);

    CREATE TABLE IF NOT EXISTS routing_decisions (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL REFERENCES llm_requests(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      policy TEXT NOT NULL,
      selected_provider TEXT NOT NULL,
      selected_model TEXT NOT NULL,
      candidate_providers_json TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS provider_requests (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL REFERENCES llm_requests(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      provider_name TEXT NOT NULL,
      model TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      latency_ms INTEGER,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      cost_cents INTEGER NOT NULL DEFAULT 0,
      error_code TEXT,
      error_message TEXT
    );

    CREATE INDEX IF NOT EXISTS ix_provider_requests_request
      ON provider_requests(request_id, provider_name, attempt);

    CREATE TABLE IF NOT EXISTS token_usage (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL REFERENCES llm_requests(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      provider_name TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_tokens INTEGER NOT NULL,
      completion_tokens INTEGER NOT NULL,
      total_tokens INTEGER NOT NULL,
      cost_cents INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS cost_ledger (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      request_id TEXT NOT NULL REFERENCES llm_requests(id) ON DELETE CASCADE,
      provider_request_id TEXT,
      amount_cents INTEGER NOT NULL,
      kind TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS ix_cost_ledger_tenant_created
      ON cost_ledger(tenant_id, created_at);

    CREATE TABLE IF NOT EXISTS cache_entries (
      cache_key TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      provider_name TEXT NOT NULL,
      model TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      response_json TEXT NOT NULL,
      usage_json TEXT NOT NULL,
      expires_at_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_hit_at TEXT
    );

    CREATE INDEX IF NOT EXISTS ix_cache_entries_tenant_expires
      ON cache_entries(tenant_id, expires_at_ms);

    CREATE TABLE IF NOT EXISTS failure_injections (
      provider_name TEXT PRIMARY KEY,
      mode TEXT NOT NULL DEFAULT 'none',
      remaining_count INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      status_code INTEGER NOT NULL DEFAULT 503,
      stream_drop_after_chunks INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function seedDemoData(db: DatabaseClient): void {
  const insertTenant = db.prepare(`
    INSERT OR IGNORE INTO tenants (
      id, name, monthly_budget_cents, spent_cents, rate_limit_per_minute
    ) VALUES (?, ?, ?, 0, ?)
  `);

  const insertKey = db.prepare(`
    INSERT OR IGNORE INTO tenant_api_keys (id, tenant_id, key_hash, label)
    VALUES (?, ?, ?, ?)
  `);

  const insertProvider = db.prepare(`
    INSERT OR IGNORE INTO provider_configs (
      provider_name, display_name, is_enabled, default_model, cheap_model,
      premium_model, prompt_cost_per_1k_cents, completion_cost_per_1k_cents, timeout_ms
    ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)
  `);

  const insertAllowlist = db.prepare(`
    INSERT OR IGNORE INTO tenant_provider_allowlists (tenant_id, provider_name)
    VALUES (?, ?)
  `);

  const insertHealth = db.prepare(`
    INSERT OR IGNORE INTO provider_health (provider_name, state, failure_count, opened_until_ms)
    VALUES (?, 'closed', 0, 0)
  `);

  const insertFailure = db.prepare(`
    INSERT OR IGNORE INTO failure_injections (provider_name)
    VALUES (?)
  `);

  const transaction = db.transaction(() => {
    insertTenant.run("tenant-alpha", "Demo Tenant Alpha", 500, 60);
    insertTenant.run("tenant-beta", "Demo Tenant Beta", 3, 60);

    insertKey.run("key-alpha", "tenant-alpha", hashApiKey("sk_test_alpha"), "Alpha demo key");
    insertKey.run("key-beta", "tenant-beta", hashApiKey("sk_test_beta"), "Beta low-budget demo key");

    insertProvider.run("openai", "OpenAI", "gpt-4o-mini", "gpt-4o-mini", "gpt-4o", 1, 3, 15000);
    insertProvider.run("anthropic", "Anthropic", "claude-3-5-haiku-latest", "claude-3-5-haiku-latest", "claude-3-5-sonnet-latest", 1, 4, 15000);
    insertProvider.run("gemini", "Google Gemini", "gemini-2.5-flash", "gemini-2.5-flash", "gemini-2.5-pro", 1, 3, 15000);
    insertProvider.run("mock-openai", "Mock OpenAI", "mock-gpt-4o-mini", "mock-gpt-4o-mini", "mock-gpt-4o", 1, 1, 5000);
    insertProvider.run("mock-anthropic", "Mock Anthropic", "mock-claude-haiku", "mock-claude-haiku", "mock-claude-sonnet", 1, 1, 5000);

    for (const tenantId of ["tenant-alpha", "tenant-beta"]) {
      for (const providerName of ["openai", "anthropic", "gemini", "mock-openai", "mock-anthropic"]) {
        insertAllowlist.run(tenantId, providerName);
      }
    }

    for (const providerName of ["openai", "anthropic", "gemini", "mock-openai", "mock-anthropic"]) {
      insertHealth.run(providerName);
      insertFailure.run(providerName);
    }
  });

  transaction();
}
