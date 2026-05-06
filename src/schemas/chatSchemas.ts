import { z } from "zod";

export const providerNameSchema = z.enum(["openai", "anthropic", "gemini", "mock-openai", "mock-anthropic"]);

export const chatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string().min(1).max(200000),
});

export const chatCompletionRequestSchema = z.object({
  messages: z.array(chatMessageSchema).min(1).max(100),
  model_class: z.enum(["cheap", "balanced", "premium"]).optional().default("cheap"),
  provider: providerNameSchema.optional(),
  model: z.string().min(1).max(200).optional(),
  stream: z.boolean().optional().default(false),
  cache: z.boolean().optional().default(true),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().min(1).max(8192).optional().default(1024),
  metadata: z.record(z.unknown()).optional(),
  request_id: z.string().min(1).max(128).optional(),
});

export const failureInjectionRequestSchema = z.object({
  mode: z.enum(["none", "fail", "timeout", "slow", "stream_drop"]),
  remaining_count: z.number().int().min(0).max(100).optional().default(1),
  latency_ms: z.number().int().min(0).max(120000).optional().default(0),
  status_code: z.number().int().min(400).max(599).optional().default(503),
  stream_drop_after_chunks: z.number().int().min(1).max(100).optional().default(1),
});

export type ChatCompletionRequestInput = z.infer<typeof chatCompletionRequestSchema>;
export type FailureInjectionRequestInput = z.infer<typeof failureInjectionRequestSchema>;
