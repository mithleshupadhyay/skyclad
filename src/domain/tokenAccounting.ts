import type { ChatMessage, ProviderConfig, TokenUsage } from "./types.js";

export function estimatePromptTokens(messages: ChatMessage[]): number {
  const chars = messages.reduce((total, message) => total + message.content.length, 0);
  return Math.max(1, Math.ceil(chars / 4));
}

export function normalizeUsage(usage: Partial<TokenUsage> | undefined, messages: ChatMessage[], content: string): TokenUsage {
  const promptTokens = usage?.promptTokens ?? estimatePromptTokens(messages);
  const completionTokens = usage?.completionTokens ?? Math.max(1, Math.ceil(content.length / 4));
  return {
    promptTokens,
    completionTokens,
    totalTokens: usage?.totalTokens ?? promptTokens + completionTokens,
  };
}

export function calculateCostCents(config: ProviderConfig, usage: TokenUsage): number {
  const promptCost = (usage.promptTokens / 1000) * config.promptCostPer1kCents;
  const completionCost = (usage.completionTokens / 1000) * config.completionCostPer1kCents;
  return Math.max(1, Math.ceil(promptCost + completionCost));
}

export function estimateMaxCostCents(config: ProviderConfig, messages: ChatMessage[], maxTokens: number): number {
  return calculateCostCents(config, {
    promptTokens: estimatePromptTokens(messages),
    completionTokens: maxTokens,
    totalTokens: estimatePromptTokens(messages) + maxTokens,
  });
}
