import { createHash } from "node:crypto";
import type { ChatRequest, ProviderName } from "./types.js";

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function buildRequestHash(body: ChatRequest): string {
  return sha256(
    stableJson({
      messages: body.messages,
      modelClass: body.modelClass,
      provider: body.provider,
      model: body.model,
      temperature: body.temperature,
      maxTokens: body.maxTokens,
      metadata: body.metadata,
    }),
  );
}

export function buildCacheKey(params: {
  tenantId: string;
  body: ChatRequest;
  providerName: ProviderName;
  model: string;
}): string {
  return sha256(
    stableJson({
      tenantId: params.tenantId,
      providerName: params.providerName,
      model: params.model,
      messages: params.body.messages,
      temperature: params.body.temperature,
      maxTokens: params.body.maxTokens,
    }),
  );
}
