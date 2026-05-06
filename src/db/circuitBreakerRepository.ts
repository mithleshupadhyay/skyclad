import type { DatabaseClient } from "./database.js";
import type { ProviderHealthState, ProviderName } from "../domain/types.js";

export type ProviderHealth = {
  providerName: ProviderName;
  state: ProviderHealthState;
  failureCount: number;
  openedUntilMs: number;
};

type ProviderHealthRow = {
  provider_name: ProviderName;
  state: ProviderHealthState;
  failure_count: number;
  opened_until_ms: number;
};

export class CircuitBreakerRepository {
  constructor(private readonly db: DatabaseClient) {}

  get(providerName: ProviderName): ProviderHealth {
    const row = this.db
      .prepare(
        `
          SELECT provider_name, state, failure_count, opened_until_ms
          FROM provider_health
          WHERE provider_name = ?
        `,
      )
      .get(providerName) as ProviderHealthRow | undefined;

    if (!row) {
      this.db
        .prepare(
          `
            INSERT INTO provider_health (provider_name, state, failure_count, opened_until_ms)
            VALUES (?, 'closed', 0, 0)
          `,
        )
        .run(providerName);

      return {
        providerName,
        state: "closed",
        failureCount: 0,
        openedUntilMs: 0,
      };
    }

    return {
      providerName: row.provider_name,
      state: row.state,
      failureCount: row.failure_count,
      openedUntilMs: row.opened_until_ms,
    };
  }

  markHalfOpen(providerName: ProviderName): void {
    this.db
      .prepare(
        `
          UPDATE provider_health
          SET state = 'half_open', updated_at = CURRENT_TIMESTAMP
          WHERE provider_name = ?
        `,
      )
      .run(providerName);
  }

  markSuccess(providerName: ProviderName): void {
    this.db
      .prepare(
        `
          UPDATE provider_health
          SET state = 'closed',
              failure_count = 0,
              opened_until_ms = 0,
              updated_at = CURRENT_TIMESTAMP
          WHERE provider_name = ?
        `,
      )
      .run(providerName);
  }

  markFailure(providerName: ProviderName, threshold: number, resetTimeoutMs: number, nowMs: number): ProviderHealth {
    const transaction = this.db.transaction(() => {
      const current = this.get(providerName);
      const nextFailureCount = current.failureCount + 1;
      const shouldOpen = nextFailureCount >= threshold;

      this.db
        .prepare(
          `
            UPDATE provider_health
            SET state = ?,
                failure_count = ?,
                opened_until_ms = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE provider_name = ?
          `,
        )
        .run(
          shouldOpen ? "open" : current.state,
          nextFailureCount,
          shouldOpen ? nowMs + resetTimeoutMs : current.openedUntilMs,
          providerName,
        );

      return this.get(providerName);
    });

    return transaction();
  }

  list(): ProviderHealth[] {
    const rows = this.db
      .prepare(
        `
          SELECT provider_name, state, failure_count, opened_until_ms
          FROM provider_health
          ORDER BY provider_name ASC
        `,
      )
      .all() as ProviderHealthRow[];

    return rows.map((row) => ({
      providerName: row.provider_name,
      state: row.state,
      failureCount: row.failure_count,
      openedUntilMs: row.opened_until_ms,
    }));
  }

  reset(providerName: ProviderName): void {
    this.markSuccess(providerName);
  }
}
