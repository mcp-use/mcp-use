import { logger } from "@mcp-use/client";
import type { ProviderConfig, ProviderName } from "./types.js";

/** Optional credentials and request settings for a string model identifier. */
export interface NativeLLMConfig {
  /** Provider API key. When omitted, the provider environment variable is used. */
  apiKey?: string;
  /** Sampling temperature forwarded to the provider. */
  temperature?: number;
  /** Maximum number of output tokens requested from the provider. */
  maxTokens?: number;
  /** Provider API base URL override. */
  baseUrl?: string;
  /** Additional HTTP headers sent with every request. */
  extraHeaders?: Record<string, string>;
  /** Fetch credentials mode used for provider requests. */
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
  const hint =
    envVars.length > 0 ? envVars.join(" or ") : "apiKey in llmConfig";
  throw new Error(`API key not found for provider '${provider}'. Set ${hint}.`);
}

/**
 * Parses a `"provider/model"` identifier into a provider configuration.
 *
 * @param llmString - Provider and model separated by the first slash.
 * @param config - Optional credentials and request overrides.
 * @returns A complete provider configuration.
 * @throws Error if the identifier is invalid, the provider is unsupported, or
 * no required API key is available.
 */
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

/**
 * Builds a provider configuration from separate provider and model values.
 *
 * @param provider - Provider implementation to use.
 * @param model - Provider-specific model identifier.
 * @param config - Optional credentials and request overrides.
 * @returns A complete provider configuration.
 * @throws Error if no required API key is available.
 */
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
