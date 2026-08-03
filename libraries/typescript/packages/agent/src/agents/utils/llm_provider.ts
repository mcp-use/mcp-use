import type { LanguageModel } from "../types.js";
import { logger } from "@mcp-use/client";

/** Constructor settings forwarded to a dynamically loaded LangChain model. */
export interface LLMConfig {
  /** Provider API key. When omitted, the provider environment variable is used. */
  apiKey?: string;
  /** Sampling temperature. */
  temperature?: number;
  /** Maximum number of output tokens. */
  maxTokens?: number;
  /** Nucleus sampling probability. */
  topP?: number;
  /** Additional provider-specific constructor settings. */
  [key: string]: any; // Allow additional provider-specific config
}

/** LangChain providers supported by {@link createLLMFromString}. */
export type LLMProvider = "openai" | "anthropic" | "google" | "groq";

/** Parsed components of a LangChain model identifier. */
export interface ParsedLLMString {
  /** Normalized provider name. */
  provider: LLMProvider;
  /** Provider-specific model name. */
  model: string;
}

/**
 * Provider configuration mapping
 */
const PROVIDER_CONFIG = {
  openai: {
    package: "@langchain/openai",
    className: "ChatOpenAI",
    envVars: ["OPENAI_API_KEY"],
    defaultModel: "gpt-4o",
  },
  anthropic: {
    package: "@langchain/anthropic",
    className: "ChatAnthropic",
    envVars: ["ANTHROPIC_API_KEY"],
    defaultModel: "claude-sonnet-4-6",
  },
  google: {
    package: "@langchain/google-genai",
    className: "ChatGoogleGenerativeAI",
    envVars: ["GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
    defaultModel: "gemini-pro",
  },
  groq: {
    package: "@langchain/groq",
    className: "ChatGroq",
    envVars: ["GROQ_API_KEY"],
    defaultModel: "llama-3.1-70b-versatile",
  },
} as const;

/**
 * Parses an LLM identifier in `"provider/model"` format.
 *
 * @param llmString - Provider and model separated by one slash.
 * @returns The normalized provider and model.
 * @throws Error if the format is invalid or the provider is unsupported.
 */
export function parseLLMString(llmString: string): ParsedLLMString {
  const parts = llmString.split("/");

  if (parts.length !== 2) {
    throw new Error(
      `Invalid LLM string format. Expected 'provider/model', got '${llmString}'. ` +
        `Examples: 'openai/gpt-4', 'anthropic/claude-sonnet-4-6', 'google/gemini-pro', 'groq/llama-3.1-70b-versatile'`
    );
  }

  const [provider, model] = parts;

  if (!provider || !model) {
    throw new Error(
      `Invalid LLM string format. Both provider and model must be non-empty. Got '${llmString}'`
    );
  }

  const normalizedProvider = provider.toLowerCase() as LLMProvider;

  if (!(normalizedProvider in PROVIDER_CONFIG)) {
    const supportedProviders = Object.keys(PROVIDER_CONFIG).join(", ");
    throw new Error(
      `Unsupported LLM provider '${provider}'. Supported providers: ${supportedProviders}`
    );
  }

  return { provider: normalizedProvider, model };
}

/**
 * Determine the API key to use for a given provider by checking `llmConfig` then provider-specific environment variables.
 *
 * @param provider - The LLM provider identifier (e.g., "openai").
 * @param config - Optional LLM configuration; if `config.apiKey` is present it is returned.
 * @returns The resolved API key string.
 * @throws Error if no API key is found in `config.apiKey` or any of the provider's expected environment variables.
 */
function getAPIKey(provider: LLMProvider, config?: LLMConfig): string {
  // First check if provided in config
  if (config?.apiKey) {
    return config.apiKey;
  }

  // Get provider config for error message
  const providerConfig = PROVIDER_CONFIG[provider];

  // Check environment variables (only if process.env is available)
  if (typeof process !== "undefined" && process.env) {
    for (const envVar of providerConfig.envVars) {
      const apiKey = process.env[envVar];
      if (apiKey) {
        logger.debug(
          `Using API key from environment variable ${envVar} for provider ${provider}`
        );
        return apiKey;
      }
    }
  }

  // No API key found
  const envVarsStr = providerConfig.envVars.join(" or ");
  throw new Error(
    `API key not found for provider '${provider}'. ` +
      `Set ${envVarsStr} environment variable or pass apiKey in llmConfig. ` +
      `Example: new MCPAgent({ llm: '${provider}/model', llmConfig: { apiKey: 'your-key' } })`
  );
}

/**
 * Dynamically imports and instantiates a LangChain chat model.
 *
 * @param llmString - LLM specification in format "provider/model" (e.g., "openai/gpt-4")
 * @param config - Optional configuration for the LLM (apiKey, temperature, etc.)
 * @returns The instantiated LangChain model.
 * @throws Error if credentials are unavailable, the provider package is not
 * installed, or the model cannot be constructed.
 *
 * @example
 * ```ts
 * const llm = await createLLMFromString('openai/gpt-4', { temperature: 0.7 });
 * ```
 *
 * @example
 * ```ts
 * const llm = await createLLMFromString('anthropic/claude-sonnet-4-6');
 * ```
 */
export async function createLLMFromString(
  llmString: string,
  config?: LLMConfig
): Promise<LanguageModel> {
  logger.debug(`Creating LLM from string: ${llmString}`);

  const { provider, model } = parseLLMString(llmString);
  const providerConfig = PROVIDER_CONFIG[provider];

  // Get API key
  const apiKey = getAPIKey(provider, config);

  // Dynamically import the provider package
  let providerModule: any;
  try {
    logger.debug(`Importing package ${providerConfig.package}...`);
    providerModule = await import(providerConfig.package);
  } catch (error: any) {
    // Check if it's a module not found error
    if (
      error?.code === "MODULE_NOT_FOUND" ||
      error?.message?.includes("Cannot find module") ||
      error?.message?.includes("Cannot find package")
    ) {
      throw new Error(
        `Package '${providerConfig.package}' is not installed. ` +
          `Install it with: npm install ${providerConfig.package}, pnpm add ${providerConfig.package}, or bun add ${providerConfig.package}`
      );
    }
    throw new Error(
      `Failed to import ${providerConfig.package}: ${error?.message || error}`
    );
  }

  // Get the class from the module
  const LLMClass = providerModule[providerConfig.className];
  if (!LLMClass) {
    throw new Error(
      `Could not find ${providerConfig.className} in package ${providerConfig.package}. ` +
        `This might be a version compatibility issue.`
    );
  }

  // Build configuration object
  const llmConfig: Record<string, any> = {
    model,
    apiKey,
    ...config,
  };

  // Remove apiKey from the spread to avoid duplication
  if (config?.apiKey) {
    delete llmConfig.apiKey;
    llmConfig.apiKey = apiKey;
  }

  // Provider-specific configuration mapping
  if (provider === "anthropic") {
    // Anthropic uses 'model' parameter
    llmConfig.model = model;
  } else if (provider === "google") {
    // Google uses 'model' parameter
    llmConfig.model = model;
  } else if (provider === "openai") {
    // OpenAI uses 'model' parameter
    llmConfig.model = model;
  } else if (provider === "groq") {
    // Groq uses 'model' parameter
    llmConfig.model = model;
  }

  // Instantiate the LLM
  try {
    const llmInstance = new LLMClass(llmConfig);
    logger.debug(`Successfully created ${provider} LLM with model ${model}`);
    return llmInstance as LanguageModel;
  } catch (error: any) {
    throw new Error(
      `Failed to instantiate ${providerConfig.className} with model '${model}': ${error?.message || error}`
    );
  }
}

/**
 * Tests whether an LLM identifier has a supported provider and valid format.
 *
 * @param llmString - Candidate `"provider/model"` identifier.
 * @returns `true` when {@link parseLLMString} accepts the identifier.
 */
export function isValidLLMString(llmString: string): boolean {
  try {
    parseLLMString(llmString);
    return true;
  } catch {
    return false;
  }
}

/** @returns A new array containing every supported LangChain provider. */
export function getSupportedProviders(): LLMProvider[] {
  return Object.keys(PROVIDER_CONFIG) as LLMProvider[];
}
