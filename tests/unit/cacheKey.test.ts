import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildRequestHash, stableJson } from "../../src/domain/cacheKey.js";
import type { ChatRequest } from "../../src/domain/types.js";

describe("cache key helpers", () => {
  it("serializes objects deterministically", () => {
    assert.equal(stableJson({ b: 2, a: 1 }), stableJson({ a: 1, b: 2 }));
  });

  it("builds the same request hash for equivalent metadata ordering", () => {
    const left: ChatRequest = {
      messages: [{ role: "user", content: "hello" }],
      modelClass: "cheap",
      stream: false,
      cache: true,
      maxTokens: 100,
      metadata: { z: true, a: "first" },
    };
    const right: ChatRequest = {
      ...left,
      metadata: { a: "first", z: true },
    };

    assert.equal(buildRequestHash(left), buildRequestHash(right));
  });
});
