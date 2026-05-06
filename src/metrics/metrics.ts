import client from "prom-client";
import type { ProviderName } from "../domain/types.js";

client.collectDefaultMetrics();

export const httpRequestCounter = new client.Counter({
  name: "llm_gateway_http_requests_total",
  help: "HTTP requests handled by the gateway",
  labelNames: ["method", "route", "status_code"],
});

export const gatewayRequestCounter = new client.Counter({
  name: "llm_gateway_requests_total",
  help: "Gateway chat requests",
  labelNames: ["tenant_id", "status", "provider_name", "stream", "cache_hit"],
});

export const providerRequestCounter = new client.Counter({
  name: "llm_gateway_provider_requests_total",
  help: "Upstream provider attempts",
  labelNames: ["tenant_id", "provider_name", "status"],
});

export const providerLatencyHistogram = new client.Histogram({
  name: "llm_gateway_provider_latency_ms",
  help: "Provider latency in milliseconds",
  labelNames: ["provider_name", "status"],
  buckets: [50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000],
});

export const gatewayLatencyHistogram = new client.Histogram({
  name: "llm_gateway_request_latency_ms",
  help: "Gateway request latency in milliseconds",
  labelNames: ["tenant_id", "status", "stream"],
  buckets: [50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000],
});

export const tokenUsageCounter = new client.Counter({
  name: "llm_gateway_tokens_total",
  help: "Token usage recorded by the gateway",
  labelNames: ["tenant_id", "provider_name", "model", "token_type"],
});

export const costCounter = new client.Counter({
  name: "llm_gateway_cost_cents_total",
  help: "Provider usage cost in integer cents",
  labelNames: ["tenant_id", "provider_name", "model"],
});

export function recordTokenUsage(params: {
  tenantId: string;
  providerName: ProviderName;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costCents: number;
}): void {
  tokenUsageCounter.inc(
    {
      tenant_id: params.tenantId,
      provider_name: params.providerName,
      model: params.model,
      token_type: "prompt",
    },
    params.promptTokens,
  );
  tokenUsageCounter.inc(
    {
      tenant_id: params.tenantId,
      provider_name: params.providerName,
      model: params.model,
      token_type: "completion",
    },
    params.completionTokens,
  );
  costCounter.inc(
    {
      tenant_id: params.tenantId,
      provider_name: params.providerName,
      model: params.model,
    },
    params.costCents,
  );
}

export async function metricsText(): Promise<string> {
  return client.register.metrics();
}

export function metricsContentType(): string {
  return client.register.contentType;
}

export function resetMetricsForTests(): void {
  client.register.resetMetrics();
}
