import type { LanguageModel } from "../types.js";
import { logger } from "../../logging.js";

/**
 * Configuration for LLM instances
 */
export interface LLMConfig {
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  [key: string]: any; // Allow additional provider-specific config
}

/**
 * Supported LLM providers
 */
export type LLMProvider = "openai" | "anthropic" | "google" | "groq";

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
    defaultModel: "claude-3-5-sonnet-20241022",
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
 * Parse LLM string format: "provider/model"
 * Examples:
 *   - "openai/gpt-4" -> { provider: "openai", model: "gpt-4" }
 *   - "anthropic/claude-3-5-sonnet-20241022" -> { provider: "anthropic", model: "claude-3-5-sonnet-20241022" }
 *   - "google/gemini-pro" -> { provider: "google", model: "gemini-pro" }
 */
export function parseLLMString(llmString: string): {
  provider: LLMProvider;
  model: string;
} {
  const parts = llmString.split("/");

  if (parts.length !== 2) {
    throw new Error(
      `Invalid LLM string format. Expected 'provider/model', got '${llmString}'. ` +
        `Examples: 'openai/gpt-4', 'anthropic/claude-3-5-sonnet-20241022', 'google/gemini-pro', 'groq/llama-3.1-70b-versatile'`
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
 * Dynamically import and instantiate an LLM from a string specification
 *
 * @param llmString - LLM specification in format "provider/model" (e.g., "openai/gpt-4")
 * @param config - Optional configuration for the LLM (apiKey, temperature, etc.)
 * @returns Promise<LanguageModel> - Instantiated LLM instance
 *
 * @example
 * ```typescript
 * const llm = await createLLMFromString('openai/gpt-4', { temperature: 0.7 });
 * ```
 *
 * @example
 * ```typescript
 * const llm = await createLLMFromString('anthropic/claude-3-5-sonnet-20241022');
 * ```
 */
export async function createLLMFromString(
  llmString: string,
  config?: LLMConfig
): Promise<LanguageModel> {
  logger.info(`Creating LLM from string: ${llmString}`);

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
          `Install it with: npm install ${providerConfig.package} or yarn add ${providerConfig.package}`
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
    logger.info(`Successfully created ${provider} LLM with model ${model}`);
    return llmInstance as LanguageModel;
  } catch (error: any) {
    throw new Error(
      `Failed to instantiate ${providerConfig.className} with model '${model}': ${error?.message || error}`
    );
  }
}

/**
 * Validate that an LLM string is in the correct format
 */
export function isValidLLMString(llmString: string): boolean {
  try {
    parseLLMString(llmString);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get list of supported providers
 */
export function getSupportedProviders(): LLMProvider[] {
  return Object.keys(PROVIDER_CONFIG) as LLMProvider[];
}