import type { LLMProviderAdapter } from "./adapter.js";
import { iterateSse } from "./adapter.js";
import { ProviderError } from "../domain/errors.js";
import type {
  ProviderChatRequest,
  ProviderCompletion,
  ProviderStreamChunk,
  TokenUsage,
} from "../domain/types.js";
import { normalizeUsage } from "../domain/tokenAccounting.js";

type OpenAIProviderOptions = {
  apiKey?: string;
  baseUrl?: string;
};

export class OpenAIProviderAdapter implements LLMProviderAdapter {
  public readonly name = "openai" as const;
  private readonly baseUrl: string;

  constructor(private readonly options: OpenAIProviderOptions) {
    this.baseUrl = options.baseUrl || "https://api.openai.com/v1";
  }

  isConfigured(): boolean {
    return Boolean(this.options.apiKey);
  }

  async complete(request: ProviderChatRequest, signal: AbortSignal): Promise<ProviderCompletion> {
    if (!this.options.apiKey) {
      throw new ProviderError("provider_not_configured", "OpenAI API key is not configured.", false);
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        stream: false,
      }),
      signal,
    });

    if (!response.ok) {
      throw new ProviderError(
        "provider_http_error",
        `OpenAI returned HTTP ${response.status}.`,
        response.status === 429 || response.status >= 500,
        response.status,
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    const content = data.choices?.[0]?.message?.content || "";
    const usage = normalizeUsage(
      {
        promptTokens: data.usage?.prompt_tokens,
        completionTokens: data.usage?.completion_tokens,
        totalTokens: data.usage?.total_tokens,
      },
      request.messages,
      content,
    );

    return {
      providerName: this.name,
      model: request.model,
      content,
      finishReason: data.choices?.[0]?.finish_reason || "stop",
      usage,
      rawResponse: data,
    };
  }

  async *stream(request: ProviderChatRequest, signal: AbortSignal): AsyncGenerator<ProviderStreamChunk> {
    if (!this.options.apiKey) {
      throw new ProviderError("provider_not_configured", "OpenAI API key is not configured.", false);
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal,
    });

    if (!response.ok) {
      throw new ProviderError(
        "provider_http_error",
        `OpenAI returned HTTP ${response.status}.`,
        response.status === 429 || response.status >= 500,
        response.status,
      );
    }

    let index = 0;
    let usage: Partial<TokenUsage> | undefined;

    for await (const message of iterateSse(response.body)) {
      if (message.data === "[DONE]") {
        break;
      }

      const data = JSON.parse(message.data) as {
        choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const delta = data.choices?.[0]?.delta?.content || "";
      if (data.usage) {
        usage = {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        };
      }

      if (delta) {
        yield {
          text: delta,
          index,
          isFinished: false,
        };
        index += 1;
      }

      const finishReason = data.choices?.[0]?.finish_reason;
      if (finishReason) {
        yield {
          text: "",
          index,
          isFinished: true,
          finishReason,
          usage,
        };
      }
    }
  }
}
