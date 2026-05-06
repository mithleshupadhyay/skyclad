import type { DatabaseClient } from "./database.js";
import type { FailureInjection, FailureMode, ProviderName } from "../domain/types.js";

type FailureInjectionRow = {
  provider_name: ProviderName;
  mode: FailureMode;
  remaining_count: number;
  latency_ms: number;
  status_code: number;
  stream_drop_after_chunks: number;
};

function mapFailure(row: FailureInjectionRow): FailureInjection {
  return {
    providerName: row.provider_name,
    mode: row.mode,
    remainingCount: row.remaining_count,
    latencyMs: row.latency_ms,
    statusCode: row.status_code,
    streamDropAfterChunks: row.stream_drop_after_chunks,
  };
}

export class FailureInjectionRepository {
  constructor(private readonly db: DatabaseClient) {}

  get(providerName: ProviderName): FailureInjection {
    const row = this.db
      .prepare(
        `
          SELECT *
          FROM failure_injections
          WHERE provider_name = ?
        `,
      )
      .get(providerName) as FailureInjectionRow | undefined;

    if (!row) {
      this.set({
        providerName,
        mode: "none",
        remainingCount: 0,
        latencyMs: 0,
        statusCode: 503,
        streamDropAfterChunks: 1,
      });
      return this.get(providerName);
    }

    return mapFailure(row);
  }

  set(injection: FailureInjection): FailureInjection {
    this.db
      .prepare(
        `
          INSERT INTO failure_injections (
            provider_name, mode, remaining_count, latency_ms, status_code, stream_drop_after_chunks
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(provider_name)
          DO UPDATE SET
            mode = excluded.mode,
            remaining_count = excluded.remaining_count,
            latency_ms = excluded.latency_ms,
            status_code = excluded.status_code,
            stream_drop_after_chunks = excluded.stream_drop_after_chunks,
            updated_at = CURRENT_TIMESTAMP
        `,
      )
      .run(
        injection.providerName,
        injection.mode,
        injection.remainingCount,
        injection.latencyMs,
        injection.statusCode,
        injection.streamDropAfterChunks,
      );

    return this.get(injection.providerName);
  }

  consume(providerName: ProviderName): FailureInjection {
    const transaction = this.db.transaction(() => {
      const current = this.get(providerName);

      if (current.mode === "none") {
        return current;
      }

      if (current.remainingCount > 1) {
        this.db
          .prepare(
            `
              UPDATE failure_injections
              SET remaining_count = remaining_count - 1,
                  updated_at = CURRENT_TIMESTAMP
              WHERE provider_name = ?
            `,
          )
          .run(providerName);
        return this.get(providerName);
      }

      if (current.remainingCount === 1) {
        this.db
          .prepare(
            `
              UPDATE failure_injections
              SET mode = 'none',
                  remaining_count = 0,
                  latency_ms = 0,
                  updated_at = CURRENT_TIMESTAMP
              WHERE provider_name = ?
            `,
          )
          .run(providerName);
      }

      return current;
    });

    return transaction();
  }

  list(): FailureInjection[] {
    const rows = this.db
      .prepare(
        `
          SELECT *
          FROM failure_injections
          ORDER BY provider_name ASC
        `,
      )
      .all() as FailureInjectionRow[];

    return rows.map(mapFailure);
  }
}
