import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateCostCents, estimatePromptTokens } from "../../src/domain/tokenAccounting.js";
import type { ProviderConfig } from "../../src/domain/types.js";

describe("token accounting", () => {
  it("estimates prompt tokens from characters", () => {
    assert.equal(estimatePromptTokens([{ role: "user", content: "12345678" }]), 2);
  });

  it("calculates integer-cent costs", () => {
    const config: ProviderConfig = {
      providerName: "mock-openai",
      displayName: "Mock",
      isEnabled: true,
      defaultModel: "mock",
      cheapModel: "mock",
      premiumModel: "mock",
      promptCostPer1kCents: 1,
      completionCostPer1kCents: 3,
      timeoutMs: 1000,
    };

    assert.equal(
      calculateCostCents(config, {
        promptTokens: 500,
        completionTokens: 500,
        totalTokens: 1000,
      }),
      2,
    );
  });
});
