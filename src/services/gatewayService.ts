import { randomUUID } from "node:crypto";
import type { Settings } from "../config/settings.js";
import type { CacheRepository } from "../db/cacheRepository.js";
import type { RequestRepository } from "../db/requestRepository.js";
import type { TenantRepository } from "../db/tenantRepository.js";
import { AppError, ProviderError } from "../domain/errors.js";
import { buildCacheKey, buildRequestHash } from "../domain/cacheKey.js";
import type {
  ApiKeyContext,
  ChatRequest,
  ProviderCompletion,
  ProviderStreamChunk,
  RoutingCandidate,
} from "../domain/types.js";
import { estimateMaxCostCents } from "../domain/tokenAccounting.js";
import { logger } from "../logging/logger.js";
import {
  gatewayLatencyHistogram,
  gatewayRequestCounter,
  recordTokenUsage,
} from "../metrics/metrics.js";
import type { ProviderExecutor, CompletionWithCost } from "../resilience/providerExecutor.js";
import type { RoutingService } from "../routing/routingService.js";
import type { ProviderRepository } from "../db/providerRepository.js";

export type ChatCompletionResponse = {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  provider: string;
  cache_hit: boolean;
  choices: Array<{
    index: number;
    message: {
      role: "assistant";
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cost_cents: number;
  };
};

export type StreamEvent =
  | { event: "request"; data: { request_id: string; provider: string; model: string } }
  | { event: "chunk"; data: { request_id: string; index: number; delta: string } }
  | { event: "error"; data: { request_id: string; code: string; message: string; partial: boolean } }
  | { event: "done"; data: { request_id: string; provider: string; model: string; usage?: unknown; cost_cents?: number } };

export class GatewayService {
  constructor(
    private readonly settings: Settings,
    private readonly routingService: RoutingService,
    private readonly providerRepository: ProviderRepository,
    private readonly tenantRepository: TenantRepository,
    private readonly requestRepository: RequestRepository,
    private readonly cacheRepository: CacheRepository,
    private readonly providerExecutor: ProviderExecutor,
  ) {}

  async complete(context: ApiKeyContext, body: ChatRequest): Promise<ChatCompletionResponse> {
    const startedAt = Date.now();
    const requestId = randomUUID();
    const requestHash = buildRequestHash(body);
    const promptChars = countPromptChars(body);

    this.assertPromptSize(promptChars);
    this.requestRepository.createRequest({ requestId, context, body, requestHash, promptChars });

    try {
      this.tenantRepository.consumeRateLimit(context.tenant, Date.now());
      const decision = this.routingService.selectProvider(context.tenant, body);
      this.requestRepository.saveRoutingDecision(requestId, context.tenant.id, decision);

      for (const candidate of decision.candidates) {
        const cacheKey = buildCacheKey({
          tenantId: context.tenant.id,
          body,
          providerName: candidate.providerName,
          model: candidate.model,
        });

        if (this.settings.cacheEnabled && body.cache) {
          const cached = this.cacheRepository.get(cacheKey, Date.now());
          if (cached) {
            const latencyMs = Date.now() - startedAt;
            this.requestRepository.markRequestCacheHit(requestId, cacheKey, latencyMs);
            this.recordGatewaySuccess(context.tenant.id, cached, true, latencyMs, body.stream, 0);
            return this.mapResponse(requestId, cached, true, 0);
          }
        }

        const reservedCents = this.estimateReservation(candidate, body);
        this.requestRepository.markRequestRunning(requestId, reservedCents, cacheKey);
        this.tenantRepository.reserveBudget(context.tenant.id, requestId, reservedCents);

        try {
          const result = await this.providerExecutor.complete({
            tenant: context.tenant,
            requestId,
            providerName: candidate.providerName,
            model: candidate.model,
            messages: body.messages,
            temperature: body.temperature,
            maxTokens: body.maxTokens,
          });

          this.finalizeUsage(context, requestId, result, reservedCents);
          this.cacheRepository.set({
            cacheKey,
            tenantId: context.tenant.id,
            providerName: result.completion.providerName,
            model: result.completion.model,
            requestHash,
            completion: result.completion,
            expiresAtMs: Date.now() + this.settings.cacheTtlSeconds * 1000,
          });

          const latencyMs = Date.now() - startedAt;
          this.requestRepository.markRequestSuccess(requestId, latencyMs);
          this.recordGatewaySuccess(context.tenant.id, result.completion, false, latencyMs, body.stream, result.costCents);
          return this.mapResponse(requestId, result.completion, false, result.costCents);
        } catch (error) {
          this.tenantRepository.adjustReservedBudget(context.tenant.id, requestId, 0, reservedCents);
          logger.warn(
            {
              requestId,
              tenantId: context.tenant.id,
              providerName: candidate.providerName,
              code: error instanceof ProviderError ? error.code : "provider_failed",
            },
            "candidate_failed_trying_next_provider",
          );

          if (body.provider) {
            throw error;
          }
        }
      }

      throw new ProviderError("all_providers_failed", "All routing candidates failed.", true);
    } catch (error) {
      const appError = normalizeGatewayError(error);
      const latencyMs = Date.now() - startedAt;
      this.requestRepository.markRequestFailed(requestId, latencyMs, appError.code, appError.message);
      gatewayRequestCounter.inc({
        tenant_id: context.tenant.id,
        status: "failed",
        provider_name: body.provider || "none",
        stream: "false",
        cache_hit: "false",
      });
      gatewayLatencyHistogram.observe({ tenant_id: context.tenant.id, status: "failed", stream: "false" }, latencyMs);
      throw appError;
    }
  }

  async *stream(context: ApiKeyContext, body: ChatRequest): AsyncGenerator<StreamEvent> {
    const startedAt = Date.now();
    const requestId = randomUUID();
    const requestHash = buildRequestHash(body);
    const promptChars = countPromptChars(body);

    this.assertPromptSize(promptChars);
    this.requestRepository.createRequest({ requestId, context, body, requestHash, promptChars });

    let yieldedChunk = false;

    try {
      this.tenantRepository.consumeRateLimit(context.tenant, Date.now());
      const decision = this.routingService.selectProvider(context.tenant, body);
      this.requestRepository.saveRoutingDecision(requestId, context.tenant.id, decision);

      for (const candidate of decision.candidates) {
        const reservedCents = this.estimateReservation(candidate, body);
        let candidateYieldedChunk = false;

        try {
          this.requestRepository.markRequestRunning(requestId, reservedCents);
          this.tenantRepository.reserveBudget(context.tenant.id, requestId, reservedCents);

          yield {
            event: "request",
            data: {
              request_id: requestId,
              provider: candidate.providerName,
              model: candidate.model,
            },
          };

          for await (const item of this.providerExecutor.stream({
            tenant: context.tenant,
            requestId,
            providerName: candidate.providerName,
            model: candidate.model,
            messages: body.messages,
            temperature: body.temperature,
            maxTokens: body.maxTokens,
          })) {
            if (isCompletionWithCost(item)) {
              this.finalizeUsage(context, requestId, item, reservedCents);
              const latencyMs = Date.now() - startedAt;
              this.requestRepository.markRequestSuccess(requestId, latencyMs);
              this.recordGatewaySuccess(context.tenant.id, item.completion, false, latencyMs, true, item.costCents);
              yield {
                event: "done",
                data: {
                  request_id: requestId,
                  provider: item.completion.providerName,
                  model: item.completion.model,
                  usage: item.completion.usage,
                  cost_cents: item.costCents,
                },
              };
              return;
            } else if (item.text) {
              yieldedChunk = true;
              candidateYieldedChunk = true;
              yield {
                event: "chunk",
                data: {
                  request_id: requestId,
                  index: item.index,
                  delta: item.text,
                },
              };
            }
          }
        } catch (error) {
          this.tenantRepository.adjustReservedBudget(context.tenant.id, requestId, 0, reservedCents);

          if (error instanceof ProviderError && !body.provider && !candidateYieldedChunk) {
            logger.warn(
              {
                requestId,
                tenantId: context.tenant.id,
                providerName: candidate.providerName,
                code: error.code,
              },
              "stream_candidate_failed_before_chunks_trying_next_provider",
            );
            continue;
          }

          const appError = normalizeGatewayError(error);
          const latencyMs = Date.now() - startedAt;
          if (yieldedChunk) {
            this.requestRepository.markRequestPartial(requestId, latencyMs, appError.code, appError.message);
          } else {
            this.requestRepository.markRequestFailed(requestId, latencyMs, appError.code, appError.message);
          }
          gatewayRequestCounter.inc({
            tenant_id: context.tenant.id,
            status: yieldedChunk ? "partial" : "failed",
            provider_name: candidate.providerName,
            stream: "true",
            cache_hit: "false",
          });
          gatewayLatencyHistogram.observe(
            { tenant_id: context.tenant.id, status: yieldedChunk ? "partial" : "failed", stream: "true" },
            latencyMs,
          );

          yield {
            event: "error",
            data: {
              request_id: requestId,
              code: appError.code,
              message: appError.message,
              partial: yieldedChunk,
            },
          };
          return;
        }
      }

      throw new ProviderError("all_providers_failed", "All streaming routing candidates failed before producing chunks.", true);
    } catch (error) {
      const appError = normalizeGatewayError(error);
      const latencyMs = Date.now() - startedAt;
      this.requestRepository.markRequestFailed(requestId, latencyMs, appError.code, appError.message);
      gatewayRequestCounter.inc({
        tenant_id: context.tenant.id,
        status: "failed",
        provider_name: "none",
        stream: "true",
        cache_hit: "false",
      });
      gatewayLatencyHistogram.observe(
        { tenant_id: context.tenant.id, status: "failed", stream: "true" },
        latencyMs,
      );

      yield {
        event: "error",
        data: {
          request_id: requestId,
          code: appError.code,
          message: appError.message,
          partial: false,
        },
      };
    }
  }

  private estimateReservation(candidate: RoutingCandidate, body: ChatRequest): number {
    const config = this.providerRepository.getProviderConfig(candidate.providerName);
    if (!config) {
      return Math.max(1, candidate.estimatedCostCents);
    }
    return estimateMaxCostCents(config, body.messages, body.maxTokens);
  }

  private finalizeUsage(
    context: ApiKeyContext,
    requestId: string,
    result: CompletionWithCost,
    reservedCents: number,
  ): void {
    this.requestRepository.recordUsage({
      requestId,
      tenantId: context.tenant.id,
      providerRequestId: result.providerRequestId,
      completion: result.completion,
      costCents: result.costCents,
    });
    this.tenantRepository.adjustReservedBudget(
      context.tenant.id,
      requestId,
      result.costCents,
      reservedCents,
    );
  }

  private recordGatewaySuccess(
    tenantId: string,
    completion: ProviderCompletion,
    cacheHit: boolean,
    latencyMs: number,
    stream: boolean,
    costCents: number,
  ): void {
    gatewayRequestCounter.inc({
      tenant_id: tenantId,
      status: "success",
      provider_name: completion.providerName,
      stream: stream ? "true" : "false",
      cache_hit: cacheHit ? "true" : "false",
    });
    gatewayLatencyHistogram.observe({ tenant_id: tenantId, status: "success", stream: stream ? "true" : "false" }, latencyMs);
    if (!cacheHit) {
      recordTokenUsage({
        tenantId,
        providerName: completion.providerName,
        model: completion.model,
        promptTokens: completion.usage.promptTokens,
        completionTokens: completion.usage.completionTokens,
        costCents,
      });
    }
  }

  private mapResponse(
    requestId: string,
    completion: ProviderCompletion,
    cacheHit: boolean,
    costCents: number,
  ): ChatCompletionResponse {
    return {
      id: requestId,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: completion.model,
      provider: completion.providerName,
      cache_hit: cacheHit,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: completion.content,
          },
          finish_reason: completion.finishReason,
        },
      ],
      usage: {
        prompt_tokens: completion.usage.promptTokens,
        completion_tokens: completion.usage.completionTokens,
        total_tokens: completion.usage.totalTokens,
        cost_cents: costCents,
      },
    };
  }

  private assertPromptSize(promptChars: number): void {
    if (promptChars > this.settings.maxPromptChars) {
      throw new AppError(
        413,
        "prompt_too_large",
        `Prompt exceeds max configured size of ${this.settings.maxPromptChars} characters.`,
      );
    }
  }
}

function countPromptChars(body: ChatRequest): number {
  return body.messages.reduce((total, message) => total + message.content.length, 0);
}

function isCompletionWithCost(item: CompletionWithCost | ProviderStreamChunk): item is CompletionWithCost {
  return "completion" in item;
}

function normalizeGatewayError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof ProviderError) {
    return new AppError(error.providerStatusCode || 503, error.code, error.message);
  }

  if (error instanceof Error) {
    return new AppError(500, "internal_error", error.message);
  }

  return new AppError(500, "internal_error", "Unknown gateway error.");
}
