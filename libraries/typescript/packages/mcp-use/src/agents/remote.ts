/**
 * Remote agent implementation for executing agents via API.
 */

import type { ZodSchema } from "zod";
import { toJSONSchema } from "zod";
import { logger } from "../logging.js";
import type { RunOptions } from "./mcp_agent.js";
import type { BaseMessage } from "./types.js";

// API endpoint constants
const API_CHATS_ENDPOINT = "/api/v1/chats";
const API_CHAT_EXECUTE_ENDPOINT = "/api/v1/chats/{chat_id}/execute";

/**
 * Helper function to normalize run options for remote agent
 */
function normalizeRemoteRunOptions<T>(
  queryOrOptions: string | RunOptions<T>,
  maxSteps?: number,
  manageConnector?: boolean,
  externalHistory?: BaseMessage[],
  outputSchema?: ZodSchema<T>
): {
  query: string;
  maxSteps?: number;
  manageConnector?: boolean;
  externalHistory?: BaseMessage[];
  outputSchema?: ZodSchema<T>;
} {
  // Check if first argument is an options object
  if (typeof queryOrOptions === "object" && queryOrOptions !== null) {
    const options = queryOrOptions as RunOptions<T>;
    return {
      query: options.prompt,
      maxSteps: options.maxSteps,
      manageConnector: options.manageConnector,
      externalHistory: options.externalHistory,
      outputSchema: options.schema,
    };
  }

  // Old-style positional arguments
  return {
    query: queryOrOptions as string,
    maxSteps,
    manageConnector,
    externalHistory,
    outputSchema,
  };
}

export class RemoteAgent {
  private agentId: string;
  private apiKey: string;
  private baseUrl: string;
  private chatId: string | null = null;

  constructor(options: { agentId: string; apiKey?: string; baseUrl?: string }) {
    this.agentId = options.agentId;
    this.baseUrl = options.baseUrl ?? "https://cloud.mcp-use.com";

    // Handle API key validation
    const apiKey =
      options.apiKey ??
      (typeof process !== "undefined" && process.env?.MCP_USE_API_KEY);
    if (!apiKey) {
      throw new Error(
        "API key is required for remote execution. " +
          "Please provide it as a parameter or set the MCP_USE_API_KEY environment variable. " +
          "You can get an API key from https://cloud.mcp-use.com"
      );
    }
    this.apiKey = apiKey;
  }

  private pydanticToJsonSchema<T>(schema: ZodSchema<T>): any {
    /**
     * Convert a Zod schema to JSON schema for API transmission.
     */
    return toJSONSchema(schema);
  }

  private parseStructuredResponse<T>(
    responseData: any,
    outputSchema: ZodSchema<T>
  ): T {
    /**
     * Parse the API response into the structured output format.
     */
    let resultData: any;

    // Handle different response formats
    if (typeof responseData === "object" && responseData !== null) {
      if ("result" in responseData) {
        const outerResult = responseData.result;
        // Check if this is a nested result structure (agent execution response)
        if (
          typeof outerResult === "object" &&
          outerResult !== null &&
          "result" in outerResult
        ) {
          // Extract the actual structured output from the nested result
          resultData = outerResult.result;
        } else {
          // Use the outer result directly
          resultData = outerResult;
        }
      } else {
        resultData = responseData;
      }
    } else if (typeof responseData === "string") {
      try {
        resultData = JSON.parse(responseData);
      } catch {
        // If it's not valid JSON, try to create the model from the string content
        resultData = { content: responseData };
      }
    } else {
      resultData = responseData;
    }

    // Parse into the Zod schema
    try {
      return outputSchema.parse(resultData);
    } catch (e) {
      logger.warn(`Failed to parse structured output: ${e}`);
      // Fallback: try to parse it as raw content if the schema has a content field
      const schemaShape = (outputSchema as any)._def?.shape();
      if (schemaShape && "content" in schemaShape) {
        return outputSchema.parse({ content: String(resultData) });
      }
      throw e;
    }
  }

  private async createChatSession(): Promise<string> {
    /**
     * Create a persistent chat session for the agent.
     */
    const chatPayload = {
      title: `Remote Agent Session - ${this.agentId}`,
      agent_id: this.agentId,
      type: "agent_execution",
    };

    const headers = {
      "Content-Type": "application/json",
      "x-api-key": this.apiKey,
    };
    const chatUrl = `${this.baseUrl}${API_CHATS_ENDPOINT}`;

    logger.info(`📝 Creating chat session for agent ${this.agentId}`);

    try {
      const response = await fetch(chatUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(chatPayload),
      });

      if (!response.ok) {
        const responseText = await response.text();
        const statusCode = response.status;

        if (statusCode === 404) {
          throw new Error(
            `Agent not found: Agent '${this.agentId}' does not exist or you don't have access to it. ` +
              "Please verify the agent ID and ensure it exists in your account."
          );
        }
        throw new Error(
          `Failed to create chat session: ${statusCode} - ${responseText}`
        );
      }

      const chatData = await response.json();
      const chatId = chatData.id;
      logger.info(`✅ Chat session created: ${chatId}`);
      return chatId;
    } catch (e) {
      if (e instanceof Error) {
        throw new TypeError(`Failed to create chat session: ${e.message}`);
      }
      throw new Error(`Failed to create chat session: ${String(e)}`);
    }
  }

  /**
   * Runs the remote agent with options object and returns a promise for the final result.
   */
  public async run(options: RunOptions): Promise<string>;

  /**
   * Runs the remote agent with options object and structured output.
   */
  public async run<T>(options: RunOptions<T>): Promise<T>;

  /**
   * Runs the remote agent and returns a promise for the final result.
   * @deprecated Use options object instead: run({ prompt, maxSteps, ... })
   */
  public async run<T = string>(
    query: string,
    maxSteps?: number,
    manageConnector?: boolean,
    externalHistory?: BaseMessage[],
    outputSchema?: ZodSchema<T>
  ): Promise<T>;

  public async run<T = string>(
    queryOrOptions: string | RunOptions<T>,
    maxSteps?: number,
    manageConnector?: boolean,
    externalHistory?: BaseMessage[],
    outputSchema?: ZodSchema<T>
  ): Promise<T> {
    /**
     * Run a query on the remote agent.
     */
    // Normalize input to internal parameters
    const {
      query,
      maxSteps: steps,
      externalHistory: history,
      outputSchema: schema,
    } = normalizeRemoteRunOptions(
      queryOrOptions,
      maxSteps,
      manageConnector,
      externalHistory,
      outputSchema
    );

    if (history !== undefined) {
      logger.warn("External history is not yet supported for remote execution");
    }

    try {
      logger.info(`🌐 Executing query on remote agent ${this.agentId}`);

      // Step 1: Create a chat session for this agent (only if we don't have one)
      if (this.chatId === null) {
        this.chatId = await this.createChatSession();
      }

      const chatId = this.chatId;

      // Step 2: Execute the agent within the chat context
      const executionPayload: any = {
        query,
        max_steps: steps ?? 10,
      };

      // Add structured output schema if provided
      if (schema) {
        executionPayload.output_schema = this.pydanticToJsonSchema(schema);
        logger.info(`🔧 Using structured output with schema`);
      }

      const headers = {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
      };
      const executionUrl = `${this.baseUrl}${API_CHAT_EXECUTE_ENDPOINT.replace("{chat_id}", chatId)}`;
      logger.info(`🚀 Executing agent in chat ${chatId}`);

      const response = await fetch(executionUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(executionPayload),
        signal: AbortSignal.timeout(300000), // 5 minute timeout
      });

      if (!response.ok) {
        const responseText = await response.text();
        const statusCode = response.status;

        // Provide specific error messages based on status code
        if (statusCode === 401) {
          logger.error(`❌ Authentication failed: ${responseText}`);
          throw new Error(
            "Authentication failed: Invalid or missing API key. " +
              "Please check your API key and ensure the MCP_USE_API_KEY environment variable is set correctly."
          );
        } else if (statusCode === 403) {
          logger.error(`❌ Access forbidden: ${responseText}`);
          throw new Error(
            `Access denied: You don't have permission to execute agent '${this.agentId}'. ` +
              "Check if the agent exists and you have the necessary permissions."
          );
        } else if (statusCode === 404) {
          logger.error(`❌ Agent not found: ${responseText}`);
          throw new Error(
            `Agent not found: Agent '${this.agentId}' does not exist or you don't have access to it. ` +
              "Please verify the agent ID and ensure it exists in your account."
          );
        } else if (statusCode === 422) {
          logger.error(`❌ Validation error: ${responseText}`);
          throw new Error(
            `Request validation failed: ${responseText}. ` +
              "Please check your query parameters and output schema format."
          );
        } else if (statusCode === 500) {
          logger.error(`❌ Server error: ${responseText}`);
          throw new Error(
            "Internal server error occurred during agent execution. " +
              "Please try again later or contact support if the issue persists."
          );
        } else {
          logger.error(
            `❌ Remote execution failed with status ${statusCode}: ${responseText}`
          );
          throw new Error(
            `Remote agent execution failed: ${statusCode} - ${responseText}`
          );
        }
      }

      const result = await response.json();
      logger.info(`🔧 Response: ${JSON.stringify(result)}`);
      logger.info("✅ Remote execution completed successfully");

      // Check for error responses (even with 200 status)
      if (typeof result === "object" && result !== null) {
        // Check for actual error conditions (not just presence of error field)
        if (result.status === "error" || result.error !== null) {
          const errorMsg = result.error ?? String(result);
          logger.error(`❌ Remote agent execution failed: ${errorMsg}`);
          throw new Error(`Remote agent execution failed: ${errorMsg}`);
        }

        // Check if the response indicates agent initialization failure
        if (String(result).includes("failed to initialize")) {
          logger.error(`❌ Agent initialization failed: ${result}`);
          throw new Error(
            "Agent initialization failed on remote server. " +
              "This usually indicates:\n" +
              "• Invalid agent configuration (LLM model, system prompt)\n" +
              "• Missing or invalid MCP server configurations\n" +
              "• Network connectivity issues with MCP servers\n" +
              "• Missing environment variables or credentials\n" +
              `Raw error: ${result}`
          );
        }
      }

      // Handle structured output
      if (schema) {
        return this.parseStructuredResponse(result, schema);
      }

      // Regular string output
      if (typeof result === "object" && result !== null && "result" in result) {
        return result.result as T;
      } else if (typeof result === "string") {
        return result as T;
      } else {
        return String(result) as T;
      }
    } catch (e) {
      if (e instanceof Error) {
        // Check for specific error types
        if (e.name === "AbortError") {
          logger.error(`❌ Remote execution timed out: ${e}`);
          throw new Error(
            "Remote agent execution timed out. The server may be overloaded or the query is taking too long to " +
              "process. Try again or use a simpler query."
          );
        }
        logger.error(`❌ Remote execution error: ${e}`);
        throw new Error(`Remote agent execution failed: ${e.message}`);
      }
      logger.error(`❌ Remote execution error: ${e}`);
      throw new Error(`Remote agent execution failed: ${String(e)}`);
    }
  }

  /**
   * Streams the remote agent execution with options object.
   */
  public stream(options: RunOptions): AsyncGenerator<any, string, void>;

  /**
   * Streams the remote agent execution with options object and structured output.
   */
  public stream<T>(options: RunOptions<T>): AsyncGenerator<any, T, void>;

  /**
   * Streams the remote agent execution.
   * @deprecated Use options object instead: stream({ prompt, maxSteps, ... })
   */
  public stream<T = string>(
    query: string,
    maxSteps?: number,
    manageConnector?: boolean,
    externalHistory?: BaseMessage[],
    outputSchema?: ZodSchema<T>
  ): AsyncGenerator<any, T, void>;

  // eslint-disable-next-line require-yield
  public async *stream<T = string>(
    queryOrOptions: string | RunOptions<T>,
    maxSteps?: number,
    manageConnector?: boolean,
    externalHistory?: BaseMessage[],
    outputSchema?: ZodSchema<T>
  ): AsyncGenerator<any, T, void> {
    /**
     * Stream implementation for remote agent - currently just wraps run.
     * In the future, this could be enhanced to support actual streaming from the API.
     */
    const result = await this.run(
      queryOrOptions as any,
      maxSteps,
      manageConnector,
      externalHistory,
      outputSchema
    );
    return result;
  }

  public async close(): Promise<void> {
    /**
     * Close the remote agent connection.
     */
    logger.info("🔌 Remote agent client closed");
    // In the future, we might want to delete the chat session here
    // if (this.chatId) {
    //   await this.deleteChatSession(this.chatId)
    // }
  }
}
