import type { LLMProviderAdapter } from "./adapter.js";
import type {
  ProviderChatRequest,
  ProviderCompletion,
  ProviderName,
  ProviderStreamChunk,
} from "../domain/types.js";
import { normalizeUsage } from "../domain/tokenAccounting.js";

function lastUserMessage(messages: ProviderChatRequest["messages"]): string {
  const userMessage = [...messages].reverse().find((message) => message.role === "user");
  return userMessage?.content || "empty prompt";
}

export class MockProviderAdapter implements LLMProviderAdapter {
  constructor(public readonly name: ProviderName) {}

  isConfigured(): boolean {
    return true;
  }

  async complete(request: ProviderChatRequest): Promise<ProviderCompletion> {
    const content = `[${this.name}] ${request.model} handled: ${lastUserMessage(request.messages).slice(0, 180)}`;
    return {
      providerName: this.name,
      model: request.model,
      content,
      finishReason: "stop",
      usage: normalizeUsage(undefined, request.messages, content),
    };
  }

  async *stream(request: ProviderChatRequest): AsyncGenerator<ProviderStreamChunk> {
    const completion = await this.complete(request);
    const words = completion.content.split(" ");

    for (let index = 0; index < words.length; index += 1) {
      yield {
        text: `${words[index]}${index === words.length - 1 ? "" : " "}`,
        index,
        isFinished: false,
      };
    }

    yield {
      text: "",
      index: words.length,
      isFinished: true,
      finishReason: completion.finishReason,
      usage: completion.usage,
    };
  }
}
