import type { LLMProviderAdapter } from "./adapter.js";
import { iterateSse } from "./adapter.js";
import { ProviderError } from "../domain/errors.js";
import type {
  ChatMessage,
  ProviderChatRequest,
  ProviderCompletion,
  ProviderStreamChunk,
  TokenUsage,
} from "../domain/types.js";
import { normalizeUsage } from "../domain/tokenAccounting.js";

type AnthropicProviderOptions = {
  apiKey?: string;
  baseUrl?: string;
};

function mapMessages(messages: ChatMessage[]): { system?: string; messages: Array<{ role: "user" | "assistant"; content: string }> } {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");

  return {
    system: system || undefined,
    messages: messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content,
      })),
  };
}

export class AnthropicProviderAdapter implements LLMProviderAdapter {
  public readonly name = "anthropic" as const;
  private readonly baseUrl: string;

  constructor(private readonly options: AnthropicProviderOptions) {
    this.baseUrl = options.baseUrl || "https://api.anthropic.com/v1";
  }

  isConfigured(): boolean {
    return Boolean(this.options.apiKey);
  }

  async complete(request: ProviderChatRequest, signal: AbortSignal): Promise<ProviderCompletion> {
    if (!this.options.apiKey) {
      throw new ProviderError("provider_not_configured", "Anthropic API key is not configured.", false);
    }

    const payload = mapMessages(request.messages);
    const response = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "x-api-key": this.options.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: request.model,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
        stream: false,
        ...payload,
      }),
      signal,
    });

    if (!response.ok) {
      throw new ProviderError(
        "provider_http_error",
        `Anthropic returned HTTP ${response.status}.`,
        response.status === 429 || response.status >= 500,
        response.status,
      );
    }

    const data = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
      stop_reason?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const content = data.content?.map((part) => part.text || "").join("") || "";
    const usage = normalizeUsage(
      {
        promptTokens: data.usage?.input_tokens,
        completionTokens: data.usage?.output_tokens,
      },
      request.messages,
      content,
    );

    return {
      providerName: this.name,
      model: request.model,
      content,
      finishReason: data.stop_reason || "stop",
      usage,
      rawResponse: data,
    };
  }

  async *stream(request: ProviderChatRequest, signal: AbortSignal): AsyncGenerator<ProviderStreamChunk> {
    if (!this.options.apiKey) {
      throw new ProviderError("provider_not_configured", "Anthropic API key is not configured.", false);
    }

    const payload = mapMessages(request.messages);
    const response = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "x-api-key": this.options.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: request.model,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
        stream: true,
        ...payload,
      }),
      signal,
    });

    if (!response.ok) {
      throw new ProviderError(
        "provider_http_error",
        `Anthropic returned HTTP ${response.status}.`,
        response.status === 429 || response.status >= 500,
        response.status,
      );
    }

    let index = 0;
    let usage: Partial<TokenUsage> | undefined;

    for await (const message of iterateSse(response.body)) {
      const data = JSON.parse(message.data) as {
        type?: string;
        delta?: { type?: string; text?: string; stop_reason?: string };
        usage?: { input_tokens?: number; output_tokens?: number };
      };

      if (data.type === "content_block_delta" && data.delta?.text) {
        yield {
          text: data.delta.text,
          index,
          isFinished: false,
        };
        index += 1;
      }

      if (data.usage) {
        usage = {
          promptTokens: data.usage.input_tokens,
          completionTokens: data.usage.output_tokens,
        };
      }

      if (data.type === "message_stop") {
        yield {
          text: "",
          index,
          isFinished: true,
          finishReason: data.delta?.stop_reason || "stop",
          usage,
        };
      }
    }
  }
}
