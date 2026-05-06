import { randomUUID } from "node:crypto";
import type { Settings } from "../config/settings.js";
import type { CircuitBreakerRepository } from "../db/circuitBreakerRepository.js";
import type { FailureInjectionRepository } from "../db/failureInjectionRepository.js";
import type { ProviderRepository } from "../db/providerRepository.js";
import type { RequestRepository } from "../db/requestRepository.js";
import { ProviderError } from "../domain/errors.js";
import type {
  ProviderChatRequest,
  ProviderCompletion,
  ProviderName,
  ProviderStreamChunk,
  Tenant,
} from "../domain/types.js";
import { calculateCostCents, normalizeUsage } from "../domain/tokenAccounting.js";
import { logger } from "../logging/logger.js";
import { providerLatencyHistogram, providerRequestCounter } from "../metrics/metrics.js";
import type { ProviderRegistry } from "../providers/registry.js";
import { sleep } from "./sleep.js";

type ExecuteParams = {
  tenant: Tenant;
  requestId: string;
  providerName: ProviderName;
  model: string;
  messages: ProviderChatRequest["messages"];
  temperature?: number;
  maxTokens: number;
};

export type CompletionWithCost = {
  completion: ProviderCompletion;
  providerRequestId: string;
  costCents: number;
};

export class ProviderExecutor {
  constructor(
    private readonly settings: Settings,
    private readonly providerRegistry: ProviderRegistry,
    private readonly providerRepository: ProviderRepository,
    private readonly requestRepository: RequestRepository,
    private readonly circuitBreakerRepository: CircuitBreakerRepository,
    private readonly failureInjectionRepository: FailureInjectionRepository,
  ) {}

  async complete(params: ExecuteParams): Promise<CompletionWithCost> {
    const providerConfig = this.providerRepository.getProviderConfig(params.providerName);
    if (!providerConfig) {
      throw new ProviderError("provider_config_not_found", "Provider config was not found.", false);
    }

    let lastError: unknown;
    const maxAttempts = Math.max(1, this.settings.providerMaxRetries + 1);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const providerRequestId = randomUUID();
      const startedAt = Date.now();
      this.requestRepository.createProviderRequest({
        providerRequestId,
        requestId: params.requestId,
        tenantId: params.tenant.id,
        providerName: params.providerName,
        model: params.model,
        attempt,
      });

      try {
        await this.ensureCircuitAllowsCall(params.providerName);
        await this.applyPreCallFailureInjection(params.providerName, false);

        const adapter = this.providerRegistry.get(params.providerName);
        const completion = await this.withTimeout(
          params.providerName,
          providerConfig.timeoutMs,
          (signal) =>
            adapter.complete(
              {
                requestId: params.requestId,
                providerName: params.providerName,
                model: params.model,
                messages: params.messages,
                temperature: params.temperature,
                maxTokens: params.maxTokens,
              },
              signal,
            ),
        );

        const usage = normalizeUsage(completion.usage, params.messages, completion.content);
        completion.usage = usage;
        const costCents = calculateCostCents(providerConfig, usage);
        const latencyMs = Date.now() - startedAt;
        this.requestRepository.markProviderRequestSuccess(providerRequestId, latencyMs, usage, costCents);
        this.circuitBreakerRepository.markSuccess(params.providerName);
        providerRequestCounter.inc({
          tenant_id: params.tenant.id,
          provider_name: params.providerName,
          status: "success",
        });
        providerLatencyHistogram.observe({ provider_name: params.providerName, status: "success" }, latencyMs);

        return {
          completion,
          providerRequestId,
          costCents,
        };
      } catch (error) {
        lastError = error;
        const latencyMs = Date.now() - startedAt;
        const providerError = normalizeProviderError(error);
        this.requestRepository.markProviderRequestFailed(
          providerRequestId,
          latencyMs,
          providerError.code,
          providerError.message,
        );
        this.circuitBreakerRepository.markFailure(
          params.providerName,
          this.settings.circuitFailureThreshold,
          this.settings.circuitResetTimeoutMs,
          Date.now(),
        );
        providerRequestCounter.inc({
          tenant_id: params.tenant.id,
          provider_name: params.providerName,
          status: "failed",
        });
        providerLatencyHistogram.observe({ provider_name: params.providerName, status: "failed" }, latencyMs);
        logger.warn(
          {
            requestId: params.requestId,
            tenantId: params.tenant.id,
            providerName: params.providerName,
            attempt,
            code: providerError.code,
            retryable: providerError.retryable,
          },
          "provider_attempt_failed",
        );

        if (!providerError.retryable || attempt >= maxAttempts) {
          break;
        }

        await sleep(backoffMs(attempt));
      }
    }

    throw normalizeProviderError(lastError);
  }

  async *stream(params: ExecuteParams): AsyncGenerator<CompletionWithCost | ProviderStreamChunk> {
    const providerConfig = this.providerRepository.getProviderConfig(params.providerName);
    if (!providerConfig) {
      throw new ProviderError("provider_config_not_found", "Provider config was not found.", false);
    }

    const providerRequestId = randomUUID();
    const startedAt = Date.now();
    let content = "";
    let finalUsage = undefined as ProviderStreamChunk["usage"] | undefined;

    this.requestRepository.createProviderRequest({
      providerRequestId,
      requestId: params.requestId,
      tenantId: params.tenant.id,
      providerName: params.providerName,
      model: params.model,
      attempt: 1,
    });

    try {
      await this.ensureCircuitAllowsCall(params.providerName);
      const streamDrop = await this.applyPreCallFailureInjection(params.providerName, true);
      const adapter = this.providerRegistry.get(params.providerName);
      const generator = await this.withTimeout(
        params.providerName,
        providerConfig.timeoutMs,
        async (signal) =>
          adapter.stream(
            {
              requestId: params.requestId,
              providerName: params.providerName,
              model: params.model,
              messages: params.messages,
              temperature: params.temperature,
              maxTokens: params.maxTokens,
            },
            signal,
          ),
      );

      let yieldedChunks = 0;
      for await (const chunk of generator) {
        if (chunk.text) {
          content += chunk.text;
          yieldedChunks += 1;
        }
        if (chunk.usage) {
          finalUsage = chunk.usage;
        }

        yield chunk;

        if (streamDrop && yieldedChunks >= streamDrop.streamDropAfterChunks) {
          throw new ProviderError("injected_stream_drop", "Injected stream drop after partial response.", true, 503);
        }
      }

      const usage = normalizeUsage(finalUsage, params.messages, content);
      const costCents = calculateCostCents(providerConfig, usage);
      const latencyMs = Date.now() - startedAt;
      this.requestRepository.markProviderRequestSuccess(providerRequestId, latencyMs, usage, costCents);
      this.circuitBreakerRepository.markSuccess(params.providerName);
      providerRequestCounter.inc({
        tenant_id: params.tenant.id,
        provider_name: params.providerName,
        status: "success",
      });
      providerLatencyHistogram.observe({ provider_name: params.providerName, status: "success" }, latencyMs);

      yield {
        providerRequestId,
        costCents,
        completion: {
          providerName: params.providerName,
          model: params.model,
          content,
          finishReason: "stop",
          usage,
        },
      };
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const providerError = normalizeProviderError(error);
      this.requestRepository.markProviderRequestFailed(
        providerRequestId,
        latencyMs,
        providerError.code,
        providerError.message,
      );
      this.circuitBreakerRepository.markFailure(
        params.providerName,
        this.settings.circuitFailureThreshold,
        this.settings.circuitResetTimeoutMs,
        Date.now(),
      );
      providerRequestCounter.inc({
        tenant_id: params.tenant.id,
        provider_name: params.providerName,
        status: "failed",
      });
      providerLatencyHistogram.observe({ provider_name: params.providerName, status: "failed" }, latencyMs);
      throw providerError;
    }
  }

  private async ensureCircuitAllowsCall(providerName: ProviderName): Promise<void> {
    const health = this.circuitBreakerRepository.get(providerName);
    if (health.state === "open") {
      if (health.openedUntilMs > Date.now()) {
        throw new ProviderError("circuit_open", "Provider circuit breaker is open.", true, 503);
      }

      this.circuitBreakerRepository.markHalfOpen(providerName);
    }
  }

  private async applyPreCallFailureInjection(providerName: ProviderName, stream: boolean) {
    const injection = this.failureInjectionRepository.consume(providerName);

    if (injection.mode === "none") {
      return null;
    }

    if (injection.mode === "slow") {
      await sleep(injection.latencyMs);
      return null;
    }

    if (injection.mode === "timeout") {
      throw new ProviderError("injected_timeout", "Injected provider timeout.", true, 504);
    }

    if (injection.mode === "fail") {
      throw new ProviderError("injected_provider_failure", "Injected provider failure.", true, injection.statusCode);
    }

    if (injection.mode === "stream_drop" && stream) {
      return injection;
    }

    return null;
  }

  private async withTimeout<T>(
    providerName: ProviderName,
    timeoutMs: number,
    callback: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await callback(controller.signal);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ProviderError("provider_timeout", `Provider ${providerName} timed out.`, true, 504);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function normalizeProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) {
    return error;
  }

  if (error instanceof Error && error.name === "AbortError") {
    return new ProviderError("provider_timeout", "Provider request timed out.", true, 504);
  }

  if (error instanceof Error) {
    return new ProviderError("provider_error", error.message, true);
  }

  return new ProviderError("provider_error", "Unknown provider error.", true);
}

function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** (attempt - 1), 5000);
}
