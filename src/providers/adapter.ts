import type {
  ProviderChatRequest,
  ProviderCompletion,
  ProviderName,
  ProviderStreamChunk,
} from "../domain/types.js";

export interface LLMProviderAdapter {
  readonly name: ProviderName;
  isConfigured(): boolean;
  complete(request: ProviderChatRequest, signal: AbortSignal): Promise<ProviderCompletion>;
  stream(request: ProviderChatRequest, signal: AbortSignal): AsyncGenerator<ProviderStreamChunk>;
}

export type SseMessage = {
  event?: string;
  data: string;
};

export async function* iterateSse(body: ReadableStream<Uint8Array> | null): AsyncGenerator<SseMessage> {
  if (!body) {
    return;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";

    for (const part of parts) {
      const lines = part.split("\n");
      let event: string | undefined;
      const dataLines: string[] = [];

      for (const line of lines) {
        if (line.startsWith("event:")) {
          event = line.slice("event:".length).trim();
        }
        if (line.startsWith("data:")) {
          dataLines.push(line.slice("data:".length).trim());
        }
      }

      if (dataLines.length > 0) {
        yield { event, data: dataLines.join("\n") };
      }
    }
  }
}
