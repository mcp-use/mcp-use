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
import { logger } from "../logging.js";

// Check if Langfuse is disabled via environment variable
const langfuseDisabled =
  process.env.MCP_USE_LANGFUSE?.toLowerCase() === "false";

// Initialize variables - using const with object to avoid linter issues with mutable exports
const langfuseState = {
  handler: null as BaseCallbackHandler | null,
  client: null as any,
  initPromise: null as Promise<void> | null,
};

async function initializeLangfuse(
  agentId?: string,
  metadata?: Record<string, any>,
  metadataProvider?: () => Record<string, any>,
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

    const { CallbackHandler } = langfuseModule as any;
    // Create a custom CallbackHandler wrapper to add logging and custom metadata
    class LoggingCallbackHandler extends CallbackHandler {
      private agentId?: string;
      private metadata?: Record<string, any>;
      private metadataProvider?: () => Record<string, any>;
      private tagsProvider?: () => string[];
      private verbose: boolean;

      constructor(
        config?: any,
        agentId?: string,
        metadata?: Record<string, any>,
        metadataProvider?: () => Record<string, any>,
        tagsProvider?: () => string[]
      ) {
        super(config);
        this.agentId = agentId;
        this.metadata = metadata;
        this.metadataProvider = metadataProvider;
        this.tagsProvider = tagsProvider;
        this.verbose = config?.verbose ?? false;
      }

      // Override to add custom metadata to traces
      async handleChainStart(
        chain: any,
        inputs: any,
        runId?: string,
        parentRunId?: string,
        tags?: string[],
        metadata?: any,
        name?: string,
        kwargs?: any
      ): Promise<void> {
        logger.debug("Langfuse: Chain start intercepted");

        // Add custom tags and metadata
        const customTags = this.getCustomTags();
        const metadataToAdd = this.getMetadata();

        // Merge with existing tags and metadata
        const enhancedTags = [...(tags || []), ...customTags];
        const enhancedMetadata = { ...(metadata || {}), ...metadataToAdd };

        if (this.verbose) {
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
      private getMetadata(): any {
        const metadata: any = {};

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
        const agentEnv = process.env.MCP_USE_AGENT_ENV;
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

        // For any other values, use the value as-is but sanitized
        return envLower.replace(/[^a-z0-9_-]/g, "_");
      }

      async handleLLMStart(...args: any[]): Promise<void> {
        logger.debug("Langfuse: LLM start intercepted");
        if (this.verbose) {
          logger.debug(`Langfuse: LLM start args: ${JSON.stringify(args)}`);
        }
        return super.handleLLMStart(...args);
      }

      async handleToolStart(...args: any[]): Promise<void> {
        logger.debug("Langfuse: Tool start intercepted");
        if (this.verbose) {
          logger.debug(`Langfuse: Tool start args: ${JSON.stringify(args)}`);
        }
        return super.handleToolStart(...args);
      }

      async handleRetrieverStart(...args: any[]): Promise<void> {
        logger.debug("Langfuse: Retriever start intercepted");
        if (this.verbose) {
          logger.debug(
            `Langfuse: Retriever start args: ${JSON.stringify(args)}`
          );
        }
        return super.handleRetrieverStart(...args);
      }

      async handleAgentAction(...args: any[]): Promise<void> {
        logger.debug("Langfuse: Agent action intercepted");
        if (this.verbose) {
          logger.debug(`Langfuse: Agent action args: ${JSON.stringify(args)}`);
        }
        return super.handleAgentAction(...args);
      }

      async handleAgentEnd(...args: any[]): Promise<void> {
        logger.debug("Langfuse: Agent end intercepted");
        if (this.verbose) {
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
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      baseUrl:
        process.env.LANGFUSE_HOST ||
        process.env.LANGFUSE_BASEURL ||
        "https://cloud.langfuse.com",
      flushAt: Number.parseInt(process.env.LANGFUSE_FLUSH_AT || "15"),
      flushInterval: Number.parseInt(
        process.env.LANGFUSE_FLUSH_INTERVAL || "10000"
      ),
      release: process.env.LANGFUSE_RELEASE,
      requestTimeout: Number.parseInt(
        process.env.LANGFUSE_REQUEST_TIMEOUT || "10000"
      ),
      enabled: process.env.LANGFUSE_ENABLED !== "false",
      // Set trace name - can be customized via metadata.trace_name or defaults to 'mcp-use-agent'
      traceName:
        initialMetadata.trace_name ||
        process.env.LANGFUSE_TRACE_NAME ||
        "mcp-use-agent",
      // Pass sessionId, userId, and tags to the handler
      sessionId: initialMetadata.session_id || undefined,
      userId: initialMetadata.user_id || undefined,
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
    ) as unknown as BaseCallbackHandler;
    logger.debug(
      "Langfuse observability initialized successfully with logging enabled"
    );

    // Also initialize the client for direct usage if needed
    try {
      const langfuseCore = await import("langfuse").catch(() => null);
      if (langfuseCore) {
        const { Langfuse } = langfuseCore as any;
        langfuseState.client = new Langfuse({
          publicKey: process.env.LANGFUSE_PUBLIC_KEY,
          secretKey: process.env.LANGFUSE_SECRET_KEY,
          baseUrl: process.env.LANGFUSE_HOST || "https://cloud.langfuse.com",
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
  !process.env.LANGFUSE_PUBLIC_KEY ||
  !process.env.LANGFUSE_SECRET_KEY
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
export const langfuseClient = () => langfuseState.client;
export const langfuseInitPromise = () => langfuseState.initPromise;
export { initializeLangfuse };
