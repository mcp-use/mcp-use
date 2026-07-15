import { logger } from "@mcp-use/client";
import type { ProviderConfig, ProviderName } from "./types.js";

export interface NativeLLMConfig {
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
  baseUrl?: string;
  extraHeaders?: Record<string, string>;
  credentials?: RequestCredentials;
}

const PROVIDER_ENV: Record<string, string[]> = {
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  google: ["GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  ollama: [],
  "openai-compatible": ["OPENAI_API_KEY"],
};

function resolveApiKey(provider: string, config?: NativeLLMConfig): string {
  if (config?.apiKey) return config.apiKey;
  const envVars = PROVIDER_ENV[provider] ?? [];
  if (typeof process !== "undefined" && process.env) {
    for (const envVar of envVars) {
      const key = process.env[envVar];
      if (key) {
        logger.debug(`Using API key from ${envVar} for ${provider}`);
        return key;
      }
    }
  }
  if (provider === "ollama") return "";
  const hint = envVars.length > 0 ? envVars.join(" or ") : "apiKey in llmConfig";
  throw new Error(
    `API key not found for provider '${provider}'. Set ${hint}.`
  );
}

/** Parse "provider/model" into native ProviderConfig (no LangChain). */
export function parseLLMStringToProviderConfig(
  llmString: string,
  config?: NativeLLMConfig
): ProviderConfig {
  const parts = llmString.split("/");
  if (parts.length < 2) {
    throw new Error(
      `Invalid LLM string '${llmString}'. Expected 'provider/model'.`
    );
  }
  const provider = parts[0].toLowerCase();
  const model = parts.slice(1).join("/");
  const supported: ProviderName[] = [
    "openai",
    "anthropic",
    "google",
    "openrouter",
    "ollama",
    "openai-compatible",
  ];
  if (!supported.includes(provider as ProviderName)) {
    throw new Error(
      `Unsupported provider '${provider}'. Supported: ${supported.join(", ")}`
    );
  }
  return {
    provider: provider as ProviderName,
    model,
    apiKey: resolveApiKey(provider, config),
    temperature: config?.temperature,
    maxTokens: config?.maxTokens,
    baseUrl: config?.baseUrl,
    extraHeaders: config?.extraHeaders,
    credentials: config?.credentials,
  };
}

export function providerConfigFromOptions(
  provider: ProviderName,
  model: string,
  config?: NativeLLMConfig
): ProviderConfig {
  return {
    provider,
    model,
    apiKey: resolveApiKey(provider, config),
    temperature: config?.temperature,
    maxTokens: config?.maxTokens,
    baseUrl: config?.baseUrl,
    extraHeaders: config?.extraHeaders,
    credentials: config?.credentials,
  };
}
