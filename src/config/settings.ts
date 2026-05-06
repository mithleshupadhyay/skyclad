import dotenv from "dotenv";

dotenv.config();

function readInt(name: string, defaultValue: number): number {
  const rawValue = process.env[name];
  if (!rawValue) {
    return defaultValue;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid integer value for ${name}`);
  }

  return parsed;
}

function readBool(name: string, defaultValue: boolean): boolean {
  const rawValue = process.env[name];
  if (!rawValue) {
    return defaultValue;
  }

  return ["1", "true", "yes", "on"].includes(rawValue.toLowerCase());
}

export type Settings = {
  nodeEnv: string;
  port: number;
  databasePath: string;
  logLevel: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  geminiApiKey?: string;
  providerTimeoutMs: number;
  providerMaxRetries: number;
  circuitFailureThreshold: number;
  circuitResetTimeoutMs: number;
  maxPromptChars: number;
  cacheTtlSeconds: number;
  cacheEnabled: boolean;
  seedDemoData: boolean;
};

export function loadSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    nodeEnv: process.env.NODE_ENV || "development",
    port: readInt("PORT", 3000),
    databasePath: process.env.DATABASE_PATH || "./data/skyclad-gateway.db",
    logLevel: process.env.LOG_LEVEL || (process.env.NODE_ENV === "test" ? "silent" : "info"),
    openaiApiKey: process.env.OPENAI_API_KEY || undefined,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
    geminiApiKey: process.env.GEMINI_API_KEY || undefined,
    providerTimeoutMs: readInt("PROVIDER_TIMEOUT_MS", 15000),
    providerMaxRetries: readInt("PROVIDER_MAX_RETRIES", 2),
    circuitFailureThreshold: readInt("CIRCUIT_FAILURE_THRESHOLD", 3),
    circuitResetTimeoutMs: readInt("CIRCUIT_RESET_TIMEOUT_MS", 30000),
    maxPromptChars: readInt("MAX_PROMPT_CHARS", 200000),
    cacheTtlSeconds: readInt("CACHE_TTL_SECONDS", 300),
    cacheEnabled: readBool("CACHE_ENABLED", true),
    seedDemoData: readBool("SEED_DEMO_DATA", true),
    ...overrides,
  };
}

export const settings = loadSettings();
