import type { ChatRequest } from "../domain/types.js";
import type { ChatCompletionRequestInput } from "./chatSchemas.js";

export function mapChatRequest(input: ChatCompletionRequestInput): ChatRequest {
  return {
    messages: input.messages,
    modelClass: input.model_class,
    provider: input.provider,
    model: input.model,
    stream: input.stream,
    cache: input.cache,
    temperature: input.temperature,
    maxTokens: input.max_tokens,
    metadata: input.metadata,
    clientRequestId: input.request_id,
  };
}
