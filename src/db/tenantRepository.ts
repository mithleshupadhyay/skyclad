import type { DatabaseClient } from "./database.js";
import { hashApiKey } from "./database.js";
import type { ApiKeyContext, ProviderName, Tenant } from "../domain/types.js";
import { AppError } from "../domain/errors.js";
import { randomUUID } from "node:crypto";

type TenantRow = {
  api_key_id: string;
  tenant_id: string;
  name: string;
  monthly_budget_cents: number;
  spent_cents: number;
  rate_limit_per_minute: number;
};

export class TenantRepository {
  constructor(private readonly db: DatabaseClient) {}

  findByApiKey(apiKey: string): ApiKeyContext | null {
    const row = this.db
      .prepare(
        `
          SELECT
            tak.id AS api_key_id,
            t.id AS tenant_id,
            t.name,
            t.monthly_budget_cents,
            t.spent_cents,
            t.rate_limit_per_minute
          FROM tenant_api_keys tak
          JOIN tenants t ON t.id = tak.tenant_id
          WHERE tak.key_hash = ? AND tak.is_active = 1
        `,
      )
      .get(hashApiKey(apiKey)) as TenantRow | undefined;

    if (!row) {
      return null;
    }

    return {
      apiKeyId: row.api_key_id,
      tenant: {
        id: row.tenant_id,
        name: row.name,
        monthlyBudgetCents: row.monthly_budget_cents,
        spentCents: row.spent_cents,
        rateLimitPerMinute: row.rate_limit_per_minute,
      },
    };
  }

  getTenant(tenantId: string): Tenant | null {
    const row = this.db
      .prepare(
        `
          SELECT id, name, monthly_budget_cents, spent_cents, rate_limit_per_minute
          FROM tenants
          WHERE id = ?
        `,
      )
      .get(tenantId) as Omit<TenantRow, "api_key_id" | "tenant_id"> & { id: string } | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      name: row.name,
      monthlyBudgetCents: row.monthly_budget_cents,
      spentCents: row.spent_cents,
      rateLimitPerMinute: row.rate_limit_per_minute,
    };
  }

  listAllowedProviders(tenantId: string): ProviderName[] {
    const rows = this.db
      .prepare(
        `
          SELECT provider_name
          FROM tenant_provider_allowlists
          WHERE tenant_id = ?
          ORDER BY provider_name ASC
        `,
      )
      .all(tenantId) as Array<{ provider_name: ProviderName }>;

    return rows.map((row) => row.provider_name);
  }

  consumeRateLimit(tenant: Tenant, nowMs: number): void {
    const windowStartMs = Math.floor(nowMs / 60000) * 60000;

    const transaction = this.db.transaction(() => {
      const existing = this.db
        .prepare(
          `
            SELECT request_count
            FROM tenant_rate_limits
            WHERE tenant_id = ? AND window_start_ms = ?
          `,
        )
        .get(tenant.id, windowStartMs) as { request_count: number } | undefined;

      const nextCount = (existing?.request_count || 0) + 1;
      if (nextCount > tenant.rateLimitPerMinute) {
        throw new AppError(
          429,
          "rate_limit_exceeded",
          "Tenant rate limit exceeded for the current minute.",
        );
      }

      this.db
        .prepare(
          `
            INSERT INTO tenant_rate_limits (tenant_id, window_start_ms, request_count)
            VALUES (?, ?, 1)
            ON CONFLICT(tenant_id, window_start_ms)
            DO UPDATE SET request_count = excluded.request_count + tenant_rate_limits.request_count
          `,
        )
        .run(tenant.id, windowStartMs);
    });

    transaction();
  }

  reserveBudget(tenantId: string, requestId: string, amountCents: number): void {
    if (amountCents <= 0) {
      return;
    }

    const transaction = this.db.transaction(() => {
      const result = this.db
        .prepare(
          `
            UPDATE tenants
            SET spent_cents = spent_cents + ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND spent_cents + ? <= monthly_budget_cents
          `,
        )
        .run(amountCents, tenantId, amountCents);

      if (result.changes !== 1) {
        throw new AppError(
          402,
          "budget_exhausted",
          "Tenant budget has been exhausted.",
        );
      }

      this.db
        .prepare(
          `
            INSERT INTO cost_ledger (id, tenant_id, request_id, amount_cents, kind)
            VALUES (?, ?, ?, ?, 'reservation')
          `,
        )
        .run(randomUUID(), tenantId, requestId, amountCents);
    });

    transaction();
  }

  adjustReservedBudget(tenantId: string, requestId: string, actualCents: number, reservedCents: number): void {
    const delta = actualCents - reservedCents;
    if (delta === 0) {
      return;
    }

    const transaction = this.db.transaction(() => {
      if (delta > 0) {
        const result = this.db
          .prepare(
            `
              UPDATE tenants
              SET spent_cents = spent_cents + ?, updated_at = CURRENT_TIMESTAMP
              WHERE id = ? AND spent_cents + ? <= monthly_budget_cents
            `,
          )
          .run(delta, tenantId, delta);

        if (result.changes !== 1) {
          throw new AppError(
            402,
            "budget_exhausted_after_provider_response",
            "Tenant budget was exhausted while finalizing provider usage.",
          );
        }
      } else {
        this.db
          .prepare(
            `
              UPDATE tenants
              SET spent_cents = MAX(0, spent_cents + ?), updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
            `,
          )
          .run(delta, tenantId);
      }

      this.db
        .prepare(
          `
            INSERT INTO cost_ledger (id, tenant_id, request_id, amount_cents, kind)
            VALUES (?, ?, ?, ?, ?)
          `,
        )
        .run(randomUUID(), tenantId, requestId, delta, delta > 0 ? "extra_charge" : "refund");
    });

    transaction();
  }
}
