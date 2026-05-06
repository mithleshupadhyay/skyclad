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

type GeminiProviderOptions = {
  apiKey?: string;
  baseUrl?: string;
};

type GeminiPart = {
  text?: string;
};

type GeminiContent = {
  role?: "user" | "model";
  parts: GeminiPart[];
};

type GeminiGenerateResponse = {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[];
    };
    finishReason?: string;
  }>;
  promptFeedback?: {
    blockReason?: string;
  };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
};

function mapMessages(messages: ChatMessage[]): {
  systemInstruction?: { parts: GeminiPart[] };
  contents: GeminiContent[];
} {
  const systemText = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");

  const contents: GeminiContent[] = [];

  for (const message of messages.filter((item) => item.role !== "system")) {
    const role = message.role === "assistant" ? "model" : "user";
    const previous = contents.at(-1);

    if (previous?.role === role) {
      previous.parts.push({ text: message.content });
      continue;
    }

    contents.push({
      role,
      parts: [{ text: message.content }],
    });
  }

  if (contents.length === 0 && systemText) {
    contents.push({
      role: "user",
      parts: [{ text: systemText }],
    });
  }

  return {
    systemInstruction: systemText ? { parts: [{ text: systemText }] } : undefined,
    contents,
  };
}

function extractText(data: GeminiGenerateResponse): string {
  return data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
}

function mapUsage(data: GeminiGenerateResponse, messages: ChatMessage[], content: string): TokenUsage {
  return normalizeUsage(
    {
      promptTokens: data.usageMetadata?.promptTokenCount,
      completionTokens: data.usageMetadata?.candidatesTokenCount,
      totalTokens: data.usageMetadata?.totalTokenCount,
    },
    messages,
    content,
  );
}

function parseGeminiError(data: unknown, fallback: string): string {
  if (typeof data !== "object" || data === null || !("error" in data)) {
    return fallback;
  }

  const error = (data as { error?: { message?: string } }).error;
  return error?.message || fallback;
}

export class GeminiProviderAdapter implements LLMProviderAdapter {
  public readonly name = "gemini" as const;
  private readonly baseUrl: string;

  constructor(private readonly options: GeminiProviderOptions) {
    this.baseUrl = options.baseUrl || "https://generativelanguage.googleapis.com/v1beta";
  }

  isConfigured(): boolean {
    return Boolean(this.options.apiKey);
  }

  async complete(request: ProviderChatRequest, signal: AbortSignal): Promise<ProviderCompletion> {
    if (!this.options.apiKey) {
      throw new ProviderError("provider_not_configured", "Gemini API key is not configured.", false);
    }

    const response = await fetch(`${this.baseUrl}/models/${encodeURIComponent(request.model)}:generateContent`, {
      method: "POST",
      headers: {
        "x-goog-api-key": this.options.apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify(this.buildPayload(request)),
      signal,
    });

    const data = (await response.json()) as GeminiGenerateResponse | { error?: { message?: string } };

    if (!response.ok) {
      throw new ProviderError(
        "provider_http_error",
        parseGeminiError(data, `Gemini returned HTTP ${response.status}.`),
        response.status === 429 || response.status >= 500,
        response.status,
      );
    }

    const geminiData = data as GeminiGenerateResponse;

    if (!geminiData.candidates?.length) {
      throw new ProviderError(
        "provider_content_blocked",
        geminiData.promptFeedback?.blockReason
          ? `Gemini blocked the prompt: ${geminiData.promptFeedback.blockReason}.`
          : "Gemini returned no candidates.",
        false,
        422,
      );
    }

    const content = extractText(geminiData);
    const usage = mapUsage(geminiData, request.messages, content);

    return {
      providerName: this.name,
      model: request.model,
      content,
      finishReason: geminiData.candidates[0]?.finishReason || "stop",
      usage,
      rawResponse: geminiData,
    };
  }

  async *stream(request: ProviderChatRequest, signal: AbortSignal): AsyncGenerator<ProviderStreamChunk> {
    if (!this.options.apiKey) {
      throw new ProviderError("provider_not_configured", "Gemini API key is not configured.", false);
    }

    const response = await fetch(`${this.baseUrl}/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse`, {
      method: "POST",
      headers: {
        "x-goog-api-key": this.options.apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify(this.buildPayload(request)),
      signal,
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => undefined)) as unknown;
      throw new ProviderError(
        "provider_http_error",
        parseGeminiError(data, `Gemini returned HTTP ${response.status}.`),
        response.status === 429 || response.status >= 500,
        response.status,
      );
    }

    let index = 0;
    let usage: Partial<TokenUsage> | undefined;
    let finishReason: string | undefined;

    for await (const message of iterateSse(response.body)) {
      const data = JSON.parse(message.data) as GeminiGenerateResponse;
      const delta = extractText(data);

      if (data.usageMetadata) {
        usage = {
          promptTokens: data.usageMetadata.promptTokenCount,
          completionTokens: data.usageMetadata.candidatesTokenCount,
          totalTokens: data.usageMetadata.totalTokenCount,
        };
      }

      finishReason = data.candidates?.[0]?.finishReason || finishReason;

      if (delta) {
        yield {
          text: delta,
          index,
          isFinished: false,
        };
        index += 1;
      }
    }

    yield {
      text: "",
      index,
      isFinished: true,
      finishReason: finishReason || "stop",
      usage,
    };
  }

  private buildPayload(request: ProviderChatRequest): Record<string, unknown> {
    const mapped = mapMessages(request.messages);

    return {
      contents: mapped.contents,
      ...(mapped.systemInstruction ? { system_instruction: mapped.systemInstruction } : {}),
      generationConfig: {
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        maxOutputTokens: request.maxTokens,
      },
    };
  }
}
