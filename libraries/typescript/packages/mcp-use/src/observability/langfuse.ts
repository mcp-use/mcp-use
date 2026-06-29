/**
 * Langfuse observability integration for MCP-use.
 *
 * This module provides automatic instrumentation and callback handler
 * for Langfuse observability platform.
 *
 * Note: This module expects environment variables to be loaded before import.
 * Users should load their environment variables using their preferred method
 * (e.g., dotenv, direct process.env assignment, or system environment).
 */
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./types.d.ts" />

import type { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { Langfuse } from "langfuse";
import { logger } from "../logging.js";

type LangfuseMetadata = Record<string, unknown>;

interface LangfuseCallbackConfig extends LangfuseMetadata {
  verbose?: boolean;
}

/**
 * Retrieve the value of an environment variable when `process.env` is available.
 *
 * @param key - The environment variable name to look up
 * @returns The variable's value if present, `undefined` otherwise
 */
function getEnvVar(key: string): string | undefined {
  if (typeof process !== "undefined" && process.env) {
    return process.env[key];
  }
  return undefined;
}

function recordFromUnknown(value: unknown): LangfuseMetadata {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as LangfuseMetadata)
    : {};
}

function stringMetadataValue(
  metadata: LangfuseMetadata,
  key: string
): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

// Check if Langfuse is disabled via environment variable
const langfuseDisabled =
  getEnvVar("MCP_USE_LANGFUSE")?.toLowerCase() === "false";

// Initialize variables - using const with object to avoid linter issues with mutable exports
const langfuseState = {
  handler: null as BaseCallbackHandler | null,
  client: null as Langfuse | null,
  initPromise: null as Promise<void> | null,
};

/**
 * Initializes Langfuse observability for the application and installs a callback handler that augments traces with optional agent metadata and tags.
 *
 * This will attempt to dynamically load the Langfuse LangChain integration and, if available, create and store a wrapped callback handler (and optionally a Langfuse client) on the module state so tracing can be used elsewhere in the application.
 *
 * @param agentId - Optional identifier for the agent to include in traces
 * @param metadata - Optional static metadata to attach to traces; merged with dynamic metadata if a provider is supplied
 * @param metadataProvider - Optional function that returns dynamic metadata to attach to traces at runtime
 * @param tagsProvider - Optional function that returns an array of tags to attach to traces at runtime
 */
async function initializeLangfuse(
  agentId?: string,
  metadata?: LangfuseMetadata,
  metadataProvider?: () => LangfuseMetadata,
  tagsProvider?: () => string[]
): Promise<void> {
  try {
    // Dynamically import to avoid errors if package not installed
    const langfuseModule = await import("langfuse-langchain").catch(() => null);
    if (!langfuseModule) {
      logger.debug(
        "Langfuse package not installed - tracing disabled. Install with: npm install @langfuse/langchain"
      );
      return;
    }

    const { CallbackHandler } = langfuseModule;
    // Create a custom CallbackHandler wrapper to add logging and custom metadata
    class LoggingCallbackHandler extends CallbackHandler {
      private agentId?: string;
      private metadata?: LangfuseMetadata;
      private metadataProvider?: () => LangfuseMetadata;
      private tagsProvider?: () => string[];
      private isVerbose: boolean;

      constructor(
        config?: LangfuseCallbackConfig,
        agentId?: string,
        metadata?: LangfuseMetadata,
        metadataProvider?: () => LangfuseMetadata,
        tagsProvider?: () => string[]
      ) {
        super(config);
        this.agentId = agentId;
        this.metadata = metadata;
        this.metadataProvider = metadataProvider;
        this.tagsProvider = tagsProvider;
        this.isVerbose = config?.verbose ?? false;
      }

      // Override to add custom metadata to traces
      async handleChainStart(
        chain: unknown,
        inputs: unknown,
        runId?: string,
        parentRunId?: string,
        tags?: string[],
        metadata?: unknown,
        name?: string,
        kwargs?: unknown
      ): Promise<void> {
        logger.debug("Langfuse: Chain start intercepted");

        // Add custom tags and metadata
        const customTags = this.getCustomTags();
        const metadataToAdd = this.getMetadata();

        // Merge with existing tags and metadata
        const enhancedTags = [...(tags || []), ...customTags];
        const enhancedMetadata = {
          ...recordFromUnknown(metadata),
          ...metadataToAdd,
        };

        if (this.isVerbose) {
          logger.debug(
            `Langfuse: Chain start with custom tags: ${JSON.stringify(enhancedTags)}`
          );
          logger.debug(
            `Langfuse: Chain start with metadata: ${JSON.stringify(enhancedMetadata)}`
          );
        }

        return super.handleChainStart(
          chain,
          inputs,
          runId,
          parentRunId,
          enhancedTags,
          enhancedMetadata,
          name,
          kwargs
        );
      }

      // Get custom tags based on environment and agent configuration
      private getCustomTags(): string[] {
        const tags: string[] = [];

        // Add environment tag
        const env = this.getEnvironmentTag();
        if (env) {
          tags.push(`env:${env}`);
        }

        // Add agent ID tag if available
        if (this.agentId) {
          tags.push(`agent_id:${this.agentId}`);
        }

        // Add tags from provider if available
        if (this.tagsProvider) {
          const providerTags = this.tagsProvider();
          if (providerTags && providerTags.length > 0) {
            tags.push(...providerTags);
          }
        }

        return tags;
      }

      // Get metadata
      private getMetadata(): LangfuseMetadata {
        const metadata: LangfuseMetadata = {};

        // Add environment metadata
        const env = this.getEnvironmentTag();
        if (env) {
          metadata.env = env;
        }

        // Add agent ID metadata if available
        if (this.agentId) {
          metadata.agent_id = this.agentId;
        }

        // Add static metadata if provided
        if (this.metadata) {
          Object.assign(metadata, this.metadata);
        }

        // Add dynamic metadata from provider if available
        if (this.metadataProvider) {
          const dynamicMetadata = this.metadataProvider();
          if (dynamicMetadata) {
            Object.assign(metadata, dynamicMetadata);
          }
        }

        return metadata;
      }

      // Determine environment tag based on MCP_USE_AGENT_ENV
      private getEnvironmentTag(): string | null {
        const agentEnv = getEnvVar("MCP_USE_AGENT_ENV");
        if (!agentEnv) {
          // Default to 'unknown' if environment is not explicitly set
          return "unknown";
        }

        const envLower = agentEnv.toLowerCase();
        if (envLower === "local" || envLower === "development") {
          return "local";
        } else if (envLower === "production" || envLower === "prod") {
          return "production";
        } else if (envLower === "staging" || envLower === "stage") {
          return "staging";
        } else if (envLower === "hosted" || envLower === "cloud") {
          return "hosted";
        }

        // For other values, use the value as-is but sanitized
        return envLower.replace(/[^a-z0-9_-]/g, "_");
      }

      async handleLLMStart(...args: unknown[]): Promise<void> {
        logger.debug("Langfuse: LLM start intercepted");
        if (this.isVerbose) {
          logger.debug(`Langfuse: LLM start args: ${JSON.stringify(args)}`);
        }
        return super.handleLLMStart(...args);
      }

      async handleToolStart(...args: unknown[]): Promise<void> {
        logger.debug("Langfuse: Tool start intercepted");
        if (this.isVerbose) {
          logger.debug(`Langfuse: Tool start args: ${JSON.stringify(args)}`);
        }
        return super.handleToolStart(...args);
      }

      async handleRetrieverStart(...args: unknown[]): Promise<void> {
        logger.debug("Langfuse: Retriever start intercepted");
        if (this.isVerbose) {
          logger.debug(
            `Langfuse: Retriever start args: ${JSON.stringify(args)}`
          );
        }
        return super.handleRetrieverStart(...args);
      }

      async handleAgentAction(...args: unknown[]): Promise<void> {
        logger.debug("Langfuse: Agent action intercepted");
        if (this.isVerbose) {
          logger.debug(`Langfuse: Agent action args: ${JSON.stringify(args)}`);
        }
        return super.handleAgentAction(...args);
      }

      async handleAgentEnd(...args: unknown[]): Promise<void> {
        logger.debug("Langfuse: Agent end intercepted");
        if (this.isVerbose) {
          logger.debug(`Langfuse: Agent end args: ${JSON.stringify(args)}`);
        }
        return super.handleAgentEnd(...args);
      }
    }

    // Create the handler with configuration
    // Get initial metadata and tags for handler initialization
    const initialMetadata =
      metadata || (metadataProvider ? metadataProvider() : {});
    const initialTags = tagsProvider ? tagsProvider() : [];

    const config = {
      publicKey: getEnvVar("LANGFUSE_PUBLIC_KEY"),
      secretKey: getEnvVar("LANGFUSE_SECRET_KEY"),
      baseUrl:
        getEnvVar("LANGFUSE_HOST") ||
        getEnvVar("LANGFUSE_BASEURL") ||
        "https://cloud.langfuse.com",
      flushAt: Number.parseInt(getEnvVar("LANGFUSE_FLUSH_AT") || "15"),
      flushInterval: Number.parseInt(
        getEnvVar("LANGFUSE_FLUSH_INTERVAL") || "10000"
      ),
      release: getEnvVar("LANGFUSE_RELEASE"),
      requestTimeout: Number.parseInt(
        getEnvVar("LANGFUSE_REQUEST_TIMEOUT") || "10000"
      ),
      enabled: getEnvVar("LANGFUSE_ENABLED") !== "false",
      // Set trace name - can be customized via metadata.trace_name or defaults to 'mcp-use-agent'
      traceName:
        stringMetadataValue(initialMetadata, "trace_name") ||
        getEnvVar("LANGFUSE_TRACE_NAME") ||
        "mcp-use-agent",
      // Pass sessionId, userId, and tags to the handler
      sessionId: stringMetadataValue(initialMetadata, "session_id"),
      userId: stringMetadataValue(initialMetadata, "user_id"),
      tags: initialTags.length > 0 ? initialTags : undefined,
      metadata: initialMetadata || undefined,
    };

    logger.debug(
      "Langfuse handler config:",
      JSON.stringify(
        {
          traceName: config.traceName,
          sessionId: config.sessionId,
          userId: config.userId,
          tags: config.tags,
        },
        null,
        2
      )
    );

    langfuseState.handler = new LoggingCallbackHandler(
      config,
      agentId,
      metadata,
      metadataProvider,
      tagsProvider
    );
    logger.debug(
      "Langfuse observability initialized successfully with logging enabled"
    );

    // Also initialize the client for direct usage if needed
    try {
      const langfuseCore = await import("langfuse").catch(() => null);
      if (langfuseCore) {
        const { Langfuse } = langfuseCore;
        langfuseState.client = new Langfuse({
          publicKey: getEnvVar("LANGFUSE_PUBLIC_KEY"),
          secretKey: getEnvVar("LANGFUSE_SECRET_KEY"),
          baseUrl: getEnvVar("LANGFUSE_HOST") || "https://cloud.langfuse.com",
        });
        logger.debug("Langfuse client initialized");
      }
    } catch (error) {
      logger.debug(`Langfuse client initialization failed: ${error}`);
    }
  } catch (error) {
    logger.debug(`Langfuse initialization error: ${error}`);
  }
}

// Only initialize if not disabled and required keys are present
if (langfuseDisabled) {
  logger.debug(
    "Langfuse tracing disabled via MCP_USE_LANGFUSE environment variable"
  );
} else if (
  !getEnvVar("LANGFUSE_PUBLIC_KEY") ||
  !getEnvVar("LANGFUSE_SECRET_KEY")
) {
  logger.debug(
    "Langfuse API keys not found - tracing disabled. Set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY to enable"
  );
} else {
  // Create initialization promise to ensure handlers are ready when needed
  langfuseState.initPromise = initializeLangfuse();
}

// Export getters to access the state
export const langfuseHandler = () => langfuseState.handler;
export const langfuseInitPromise = () => langfuseState.initPromise;
export { initializeLangfuse };
