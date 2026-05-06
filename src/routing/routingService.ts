import type { ProviderRepository } from "../db/providerRepository.js";
import type { TenantRepository } from "../db/tenantRepository.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type {
  ChatRequest,
  ProviderConfig,
  ProviderName,
  RoutingCandidate,
  RoutingDecision,
  Tenant,
} from "../domain/types.js";
import { AppError } from "../domain/errors.js";
import { estimateMaxCostCents } from "../domain/tokenAccounting.js";

function modelForClass(config: ProviderConfig, body: ChatRequest): string {
  if (body.model) {
    return body.model;
  }

  if (body.modelClass === "premium") {
    return config.premiumModel;
  }

  if (body.modelClass === "balanced") {
    return config.defaultModel;
  }

  return config.cheapModel;
}

export class RoutingService {
  constructor(
    private readonly providerRepository: ProviderRepository,
    private readonly tenantRepository: TenantRepository,
    private readonly providerRegistry: ProviderRegistry,
  ) {}

  selectProvider(tenant: Tenant, body: ChatRequest): RoutingDecision {
    const allowedProviders = new Set(this.tenantRepository.listAllowedProviders(tenant.id));
    const providerConfigs = this.providerRepository
      .listEnabledProviders()
      .filter((config) => allowedProviders.has(config.providerName));

    if (body.provider) {
      const config = providerConfigs.find((item) => item.providerName === body.provider);
      if (!config) {
        throw new AppError(403, "provider_not_allowed", "Requested provider is not allowed for this tenant.");
      }

      const model = modelForClass(config, body);
      const candidate = {
        providerName: config.providerName,
        model,
        estimatedCostCents: estimateMaxCostCents(config, body.messages, body.maxTokens),
        reason: "explicit provider requested",
      };

      return {
        policy: "cost_optimized_with_failover",
        candidates: [candidate],
        selectedProvider: candidate.providerName,
        selectedModel: candidate.model,
        reason: "client requested a specific allowed provider",
      };
    }

    const configuredProviderConfigs = providerConfigs
      .filter((config) => this.providerRegistry.isConfigured(config.providerName))
      .filter((config, _index, configs) => {
        const hasRealProvider = configs.some((item) => !isMockProvider(item.providerName));
        return hasRealProvider ? !isMockProvider(config.providerName) : true;
      });

    const candidates = configuredProviderConfigs
      .map<RoutingCandidate>((config) => ({
        providerName: config.providerName,
        model: modelForClass(config, body),
        estimatedCostCents: estimateMaxCostCents(config, body.messages, body.maxTokens),
        reason: isMockProvider(config.providerName)
          ? "local mock provider used because no real configured provider is available"
          : "real provider configured and allowed for tenant",
      }))
      .sort((left, right) => {
        if (left.estimatedCostCents !== right.estimatedCostCents) {
          return left.estimatedCostCents - right.estimatedCostCents;
        }

        return providerPreference(left.providerName) - providerPreference(right.providerName);
      });

    if (candidates.length === 0) {
      throw new AppError(
        503,
        "no_configured_provider",
        "No configured provider is available for this tenant.",
      );
    }

    const selected = candidates[0];
    return {
      policy: "cost_optimized_with_failover",
      candidates,
      selectedProvider: selected.providerName,
      selectedModel: selected.model,
      reason: configuredProviderConfigs.some((config) => !isMockProvider(config.providerName))
        ? "selected lowest estimated cost real provider with failover candidates retained"
        : "selected lowest estimated cost local mock provider with failover candidates retained",
    };
  }
}

function isMockProvider(providerName: ProviderName): boolean {
  return providerName.startsWith("mock-");
}

function providerPreference(providerName: ProviderName): number {
  const order: ProviderName[] = ["openai", "gemini", "anthropic", "mock-openai", "mock-anthropic"];
  const index = order.indexOf(providerName);
  return index === -1 ? 100 : index;
}
