import type { Settings } from "../config/settings.js";
import type { ProviderName } from "../domain/types.js";
import type { LLMProviderAdapter } from "./adapter.js";
import { AnthropicProviderAdapter } from "./anthropicProvider.js";
import { GeminiProviderAdapter } from "./geminiProvider.js";
import { MockProviderAdapter } from "./mockProvider.js";
import { OpenAIProviderAdapter } from "./openaiProvider.js";

export class ProviderRegistry {
  private readonly adapters: Map<ProviderName, LLMProviderAdapter>;

  constructor(settings: Settings) {
    const adapters: LLMProviderAdapter[] = [
      new OpenAIProviderAdapter({ apiKey: settings.openaiApiKey }),
      new AnthropicProviderAdapter({ apiKey: settings.anthropicApiKey }),
      new GeminiProviderAdapter({ apiKey: settings.geminiApiKey }),
      new MockProviderAdapter("mock-openai"),
      new MockProviderAdapter("mock-anthropic"),
    ];

    this.adapters = new Map(adapters.map((adapter) => [adapter.name, adapter]));
  }

  get(providerName: ProviderName): LLMProviderAdapter {
    const adapter = this.adapters.get(providerName);
    if (!adapter) {
      throw new Error(`No adapter registered for provider ${providerName}`);
    }
    return adapter;
  }

  isConfigured(providerName: ProviderName): boolean {
    return this.get(providerName).isConfigured();
  }

  list(): Array<{ providerName: ProviderName; configured: boolean }> {
    return [...this.adapters.values()].map((adapter) => ({
      providerName: adapter.name,
      configured: adapter.isConfigured(),
    }));
  }
}
