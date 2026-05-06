import type { DatabaseClient } from "./database.js";
import type { ProviderConfig, ProviderName } from "../domain/types.js";

type ProviderConfigRow = {
  provider_name: ProviderName;
  display_name: string;
  is_enabled: number;
  default_model: string;
  cheap_model: string;
  premium_model: string;
  prompt_cost_per_1k_cents: number;
  completion_cost_per_1k_cents: number;
  timeout_ms: number;
};

function mapProviderConfig(row: ProviderConfigRow): ProviderConfig {
  return {
    providerName: row.provider_name,
    displayName: row.display_name,
    isEnabled: row.is_enabled === 1,
    defaultModel: row.default_model,
    cheapModel: row.cheap_model,
    premiumModel: row.premium_model,
    promptCostPer1kCents: row.prompt_cost_per_1k_cents,
    completionCostPer1kCents: row.completion_cost_per_1k_cents,
    timeoutMs: row.timeout_ms,
  };
}

export class ProviderRepository {
  constructor(private readonly db: DatabaseClient) {}

  listEnabledProviders(): ProviderConfig[] {
    const rows = this.db
      .prepare(
        `
          SELECT *
          FROM provider_configs
          WHERE is_enabled = 1
          ORDER BY provider_name ASC
        `,
      )
      .all() as ProviderConfigRow[];

    return rows.map(mapProviderConfig);
  }

  getProviderConfig(providerName: ProviderName): ProviderConfig | null {
    const row = this.db
      .prepare(
        `
          SELECT *
          FROM provider_configs
          WHERE provider_name = ?
        `,
      )
      .get(providerName) as ProviderConfigRow | undefined;

    return row ? mapProviderConfig(row) : null;
  }
}
