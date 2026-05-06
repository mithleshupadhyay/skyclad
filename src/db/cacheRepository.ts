import type { DatabaseClient } from "./database.js";
import type { ProviderCompletion, ProviderName, TokenUsage } from "../domain/types.js";

type CacheRow = {
  cache_key: string;
  tenant_id: string;
  provider_name: ProviderName;
  model: string;
  response_json: string;
  usage_json: string;
  expires_at_ms: number;
};

export class CacheRepository {
  constructor(private readonly db: DatabaseClient) {}

  get(cacheKey: string, nowMs: number): ProviderCompletion | null {
    const row = this.db
      .prepare(
        `
          SELECT *
          FROM cache_entries
          WHERE cache_key = ? AND expires_at_ms > ?
        `,
      )
      .get(cacheKey, nowMs) as CacheRow | undefined;

    if (!row) {
      return null;
    }

    this.db
      .prepare(
        `
          UPDATE cache_entries
          SET last_hit_at = CURRENT_TIMESTAMP
          WHERE cache_key = ?
        `,
      )
      .run(cacheKey);

    const response = JSON.parse(row.response_json) as { content: string; finishReason: string };
    const usage = JSON.parse(row.usage_json) as TokenUsage;

    return {
      providerName: row.provider_name,
      model: row.model,
      content: response.content,
      finishReason: response.finishReason,
      usage,
    };
  }

  set(params: {
    cacheKey: string;
    tenantId: string;
    providerName: ProviderName;
    model: string;
    requestHash: string;
    completion: ProviderCompletion;
    expiresAtMs: number;
  }): void {
    this.db
      .prepare(
        `
          INSERT INTO cache_entries (
            cache_key, tenant_id, provider_name, model, request_hash,
            response_json, usage_json, expires_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(cache_key)
          DO UPDATE SET
            response_json = excluded.response_json,
            usage_json = excluded.usage_json,
            expires_at_ms = excluded.expires_at_ms,
            last_hit_at = NULL
        `,
      )
      .run(
        params.cacheKey,
        params.tenantId,
        params.providerName,
        params.model,
        params.requestHash,
        JSON.stringify({
          content: params.completion.content,
          finishReason: params.completion.finishReason,
        }),
        JSON.stringify(params.completion.usage),
        params.expiresAtMs,
      );
  }

  deleteExpired(nowMs: number): number {
    const result = this.db
      .prepare(
        `
          DELETE FROM cache_entries
          WHERE expires_at_ms <= ?
        `,
      )
      .run(nowMs);

    return result.changes;
  }
}
