import type { DatabaseClient } from "./database.js";
import { randomUUID } from "node:crypto";
import type {
  ApiKeyContext,
  ChatRequest,
  ProviderCompletion,
  ProviderName,
  RoutingDecision,
  TokenUsage,
  UsageSummary,
} from "../domain/types.js";

type ProviderUsageRow = {
  provider_name: ProviderName;
  model: string;
  requests: number;
  total_tokens: number;
  total_cost_cents: number;
};

export class RequestRepository {
  constructor(private readonly db: DatabaseClient) {}

  createRequest(params: {
    requestId: string;
    context: ApiKeyContext;
    body: ChatRequest;
    requestHash: string;
    promptChars: number;
  }): void {
    this.db
      .prepare(
        `
          INSERT INTO llm_requests (
            id, tenant_id, api_key_id, client_request_id, request_hash, model_class,
            requested_provider, requested_model, stream, status, prompt_chars
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', ?)
        `,
      )
      .run(
        params.requestId,
        params.context.tenant.id,
        params.context.apiKeyId,
        params.body.clientRequestId || null,
        params.requestHash,
        params.body.modelClass,
        params.body.provider || null,
        params.body.model || null,
        params.body.stream ? 1 : 0,
        params.promptChars,
      );
  }

  markRequestRunning(requestId: string, reservedCents: number, cacheKey?: string): void {
    this.db
      .prepare(
        `
          UPDATE llm_requests
          SET status = 'running', reserved_cents = ?, cache_key = ?
          WHERE id = ?
        `,
      )
      .run(reservedCents, cacheKey || null, requestId);
  }

  markRequestCacheHit(requestId: string, cacheKey: string, latencyMs: number): void {
    this.db
      .prepare(
        `
          UPDATE llm_requests
          SET status = 'success', cache_hit = 1, cache_key = ?, completed_at = CURRENT_TIMESTAMP, latency_ms = ?
          WHERE id = ?
        `,
      )
      .run(cacheKey, latencyMs, requestId);
  }

  markRequestSuccess(requestId: string, latencyMs: number): void {
    this.db
      .prepare(
        `
          UPDATE llm_requests
          SET status = 'success', completed_at = CURRENT_TIMESTAMP, latency_ms = ?
          WHERE id = ?
        `,
      )
      .run(latencyMs, requestId);
  }

  markRequestPartial(requestId: string, latencyMs: number, errorCode: string, errorMessage: string): void {
    this.db
      .prepare(
        `
          UPDATE llm_requests
          SET status = 'partial', completed_at = CURRENT_TIMESTAMP, latency_ms = ?,
              error_code = ?, error_message = ?
          WHERE id = ?
        `,
      )
      .run(latencyMs, errorCode, errorMessage, requestId);
  }

  markRequestFailed(requestId: string, latencyMs: number, errorCode: string, errorMessage: string): void {
    this.db
      .prepare(
        `
          UPDATE llm_requests
          SET status = 'failed', completed_at = CURRENT_TIMESTAMP, latency_ms = ?,
              error_code = ?, error_message = ?
          WHERE id = ?
        `,
      )
      .run(latencyMs, errorCode, errorMessage, requestId);
  }

  saveRoutingDecision(requestId: string, tenantId: string, decision: RoutingDecision): void {
    this.db
      .prepare(
        `
          INSERT INTO routing_decisions (
            id, request_id, tenant_id, policy, selected_provider, selected_model,
            candidate_providers_json, reason
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        randomUUID(),
        requestId,
        tenantId,
        decision.policy,
        decision.selectedProvider,
        decision.selectedModel,
        JSON.stringify(decision.candidates),
        decision.reason,
      );
  }

  createProviderRequest(params: {
    providerRequestId: string;
    requestId: string;
    tenantId: string;
    providerName: ProviderName;
    model: string;
    attempt: number;
  }): void {
    this.db
      .prepare(
        `
          INSERT INTO provider_requests (
            id, request_id, tenant_id, provider_name, model, attempt, status
          ) VALUES (?, ?, ?, ?, ?, ?, 'running')
        `,
      )
      .run(
        params.providerRequestId,
        params.requestId,
        params.tenantId,
        params.providerName,
        params.model,
        params.attempt,
      );
  }

  markProviderRequestSuccess(
    providerRequestId: string,
    latencyMs: number,
    usage: TokenUsage,
    costCents: number,
  ): void {
    this.db
      .prepare(
        `
          UPDATE provider_requests
          SET status = 'success',
              completed_at = CURRENT_TIMESTAMP,
              latency_ms = ?,
              prompt_tokens = ?,
              completion_tokens = ?,
              total_tokens = ?,
              cost_cents = ?
          WHERE id = ?
        `,
      )
      .run(
        latencyMs,
        usage.promptTokens,
        usage.completionTokens,
        usage.totalTokens,
        costCents,
        providerRequestId,
      );
  }

  markProviderRequestFailed(
    providerRequestId: string,
    latencyMs: number,
    errorCode: string,
    errorMessage: string,
  ): void {
    this.db
      .prepare(
        `
          UPDATE provider_requests
          SET status = 'failed',
              completed_at = CURRENT_TIMESTAMP,
              latency_ms = ?,
              error_code = ?,
              error_message = ?
          WHERE id = ?
        `,
      )
      .run(latencyMs, errorCode, errorMessage, providerRequestId);
  }

  recordUsage(params: {
    requestId: string;
    tenantId: string;
    providerRequestId?: string;
    completion: ProviderCompletion;
    costCents: number;
  }): void {
    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `
            INSERT INTO token_usage (
              id, request_id, tenant_id, provider_name, model, prompt_tokens,
              completion_tokens, total_tokens, cost_cents
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
      )
      .run(
        randomUUID(),
          params.requestId,
          params.tenantId,
          params.completion.providerName,
          params.completion.model,
          params.completion.usage.promptTokens,
          params.completion.usage.completionTokens,
          params.completion.usage.totalTokens,
          params.costCents,
        );

      this.db
        .prepare(
          `
            INSERT INTO cost_ledger (
              id, tenant_id, request_id, provider_request_id, amount_cents, kind
            ) VALUES (?, ?, ?, ?, ?, 'actual_usage')
          `,
      )
      .run(
          randomUUID(),
          params.tenantId,
          params.requestId,
          params.providerRequestId || null,
          params.costCents,
        );
    });

    transaction();
  }

  getUsageSummary(tenantId: string, sinceIso?: string): UsageSummary {
    const sinceFilter = sinceIso ? "AND tu.created_at >= ?" : "";
    const queryParams = sinceIso ? [tenantId, sinceIso] : [tenantId];

    const totals = this.db
      .prepare(
        `
          SELECT
            COUNT(DISTINCT request_id) AS total_requests,
            COALESCE(SUM(total_tokens), 0) AS total_tokens,
            COALESCE(SUM(cost_cents), 0) AS total_cost_cents
          FROM token_usage tu
          WHERE tenant_id = ? ${sinceFilter}
        `,
      )
      .get(...queryParams) as {
      total_requests: number;
      total_tokens: number;
      total_cost_cents: number;
    };

    const rows = this.db
      .prepare(
        `
          SELECT
            provider_name,
            model,
            COUNT(DISTINCT request_id) AS requests,
            COALESCE(SUM(total_tokens), 0) AS total_tokens,
            COALESCE(SUM(cost_cents), 0) AS total_cost_cents
          FROM token_usage tu
          WHERE tenant_id = ? ${sinceFilter}
          GROUP BY provider_name, model
          ORDER BY total_cost_cents DESC, total_tokens DESC
        `,
      )
      .all(...queryParams) as ProviderUsageRow[];

    return {
      tenantId,
      totalRequests: totals.total_requests,
      totalTokens: totals.total_tokens,
      totalCostCents: totals.total_cost_cents,
      byProvider: rows.map((row) => ({
        providerName: row.provider_name,
        model: row.model,
        requests: row.requests,
        totalTokens: row.total_tokens,
        totalCostCents: row.total_cost_cents,
      })),
    };
  }
}
