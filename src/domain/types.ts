export type ProviderName = "openai" | "anthropic" | "gemini" | "mock-openai" | "mock-anthropic";

export type ChatRole = "system" | "user" | "assistant";

export type ModelClass = "cheap" | "balanced" | "premium";

export type ProviderHealthState = "closed" | "open" | "half_open";

export type FailureMode = "none" | "fail" | "timeout" | "slow" | "stream_drop";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type ChatRequest = {
  messages: ChatMessage[];
  modelClass: ModelClass;
  provider?: ProviderName;
  model?: string;
  stream: boolean;
  cache: boolean;
  temperature?: number;
  maxTokens: number;
  metadata?: Record<string, unknown>;
  clientRequestId?: string;
};

export type Tenant = {
  id: string;
  name: string;
  monthlyBudgetCents: number;
  spentCents: number;
  rateLimitPerMinute: number;
};

export type ApiKeyContext = {
  apiKeyId: string;
  tenant: Tenant;
};

export type ProviderConfig = {
  providerName: ProviderName;
  displayName: string;
  isEnabled: boolean;
  defaultModel: string;
  cheapModel: string;
  premiumModel: string;
  promptCostPer1kCents: number;
  completionCostPer1kCents: number;
  timeoutMs: number;
};

export type RoutingCandidate = {
  providerName: ProviderName;
  model: string;
  estimatedCostCents: number;
  reason: string;
};

export type RoutingDecision = {
  policy: "cost_optimized_with_failover";
  candidates: RoutingCandidate[];
  selectedProvider: ProviderName;
  selectedModel: string;
  reason: string;
};

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type ProviderCompletion = {
  providerName: ProviderName;
  model: string;
  content: string;
  finishReason: string;
  usage: TokenUsage;
  rawResponse?: unknown;
};

export type ProviderStreamChunk = {
  text: string;
  index: number;
  isFinished: boolean;
  finishReason?: string;
  usage?: Partial<TokenUsage>;
};

export type ProviderChatRequest = {
  requestId: string;
  providerName: ProviderName;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens: number;
};

export type FailureInjection = {
  providerName: ProviderName;
  mode: FailureMode;
  remainingCount: number;
  latencyMs: number;
  statusCode: number;
  streamDropAfterChunks: number;
};

export type UsageSummary = {
  tenantId: string;
  totalRequests: number;
  totalTokens: number;
  totalCostCents: number;
  byProvider: Array<{
    providerName: ProviderName;
    model: string;
    requests: number;
    totalTokens: number;
    totalCostCents: number;
  }>;
};
