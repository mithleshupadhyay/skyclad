import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GeminiProviderAdapter } from "../../src/providers/geminiProvider.js";

describe("gemini provider adapter", () => {
  it("maps unified chat requests to Gemini generateContent and normalizes the response", async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = "";
    let capturedBody: Record<string, unknown> | undefined;

    globalThis.fetch = (async (input, init) => {
      capturedUrl = String(input);
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;

      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: "Gemini response" }],
              },
              finishReason: "STOP",
            },
          ],
          usageMetadata: {
            promptTokenCount: 6,
            candidatesTokenCount: 4,
            totalTokenCount: 10,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      const adapter = new GeminiProviderAdapter({
        apiKey: "test-gemini-key",
        baseUrl: "https://gemini.test/v1beta",
      });

      const completion = await adapter.complete(
        {
          requestId: "request-1",
          providerName: "gemini",
          model: "gemini-2.5-flash",
          messages: [
            { role: "system", content: "Be concise." },
            { role: "user", content: "Hello" },
            { role: "assistant", content: "Hi" },
            { role: "user", content: "Explain routing." },
          ],
          maxTokens: 256,
          temperature: 0.2,
        },
        new AbortController().signal,
      );

      assert.equal(capturedUrl, "https://gemini.test/v1beta/models/gemini-2.5-flash:generateContent");
      assert.deepEqual(capturedBody?.system_instruction, { parts: [{ text: "Be concise." }] });
      assert.deepEqual(capturedBody?.generationConfig, { temperature: 0.2, maxOutputTokens: 256 });
      assert.deepEqual(capturedBody?.contents, [
        { role: "user", parts: [{ text: "Hello" }] },
        { role: "model", parts: [{ text: "Hi" }] },
        { role: "user", parts: [{ text: "Explain routing." }] },
      ]);
      assert.equal(completion.providerName, "gemini");
      assert.equal(completion.content, "Gemini response");
      assert.equal(completion.usage.totalTokens, 10);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

