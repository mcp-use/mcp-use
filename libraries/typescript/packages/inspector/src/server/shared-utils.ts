/**
 * Browser-compatible utilities for MCP Inspector chat functionality
 * Works in both Node.js and browser environments without Node.js-specific APIs
 */

import { convertMessagesToProvider } from "../llm/messageFormat";
import { runToolLoop, runToolLoopNonStreaming } from "../llm/toolLoop";
import type { ProviderMessage, ProviderName, ProviderTool } from "../llm/types";

interface LLMConfig {
  provider: ProviderName;
  model: string;
  apiKey: string;
  temperature?: number;
  baseUrl?: string;
}

interface OAuthTokens {
  access_token: string;
  token_type?: string;
  [key: string]: unknown;
}

interface AuthConfig {
  type?: string;
  clientId?: string;
  redirectUri?: string;
  scope?: string;
  username?: string;
  password?: string;
  token?: string;
  oauthTokens?: OAuthTokens;
  [key: string]: unknown;
}

interface MessageAttachment {
  type: "image" | "file";
  data: string; // base64 encoded
  mimeType: string;
  name?: string;
  size?: number;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  attachments?: MessageAttachment[];
}

interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
}

interface ServerConfig {
  url: string;
  headers?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * Cross-platform base64 encoding utility
 */
function toBase64(str: string): string {
  // Check if we're in a browser environment
  if (typeof window !== "undefined" && typeof window.btoa === "function") {
    return window.btoa(str);
  }
  // Node.js environment
  if (typeof Buffer !== "undefined") {
    return Buffer.from(str).toString("base64");
  }
  // Fallback - shouldn't reach here in practice
  throw new Error("No base64 encoding method available");
}

/**
 * Handle chat API request with MCP agent (streaming)
 */
export async function* handleChatRequestStream(requestBody: {
  mcpServerUrl: string;
  llmConfig: LLMConfig;
  authConfig?: AuthConfig;
  messages: ChatMessage[];
}): AsyncGenerator<string, void, void> {
  const { mcpServerUrl, llmConfig, authConfig, messages } = requestBody;

  if (!mcpServerUrl || !llmConfig || !messages) {
    throw new Error(
      "Missing required fields: mcpServerUrl, llmConfig, messages"
    );
  }

  const { MCPClient } = await import("@mcp-use/client");

  const client = new MCPClient() as any;
  const serverName = `inspector-${Date.now()}`;

  const serverConfig: ServerConfig = {
    url: mcpServerUrl,
    preventAutoAuth: true,
  };

  if (authConfig && authConfig.type !== "none") {
    serverConfig.headers = {};
    if (
      authConfig.type === "basic" &&
      authConfig.username &&
      authConfig.password
    ) {
      const auth = toBase64(`${authConfig.username}:${authConfig.password}`);
      serverConfig.headers.Authorization = `Basic ${auth}`;
    } else if (authConfig.type === "bearer" && authConfig.token) {
      serverConfig.headers.Authorization = `Bearer ${authConfig.token}`;
    } else if (authConfig.type === "oauth") {
      if (authConfig.oauthTokens?.access_token) {
        const tokenType = authConfig.oauthTokens.token_type
          ? authConfig.oauthTokens.token_type.charAt(0).toUpperCase() +
            authConfig.oauthTokens.token_type.slice(1)
          : "Bearer";
        serverConfig.headers.Authorization = `${tokenType} ${authConfig.oauthTokens.access_token}`;
      }
    }
  }

  try {
    const url = new URL(mcpServerUrl);
    if (
      url.username &&
      url.password &&
      (!authConfig || authConfig.type === "none")
    ) {
      const auth = toBase64(`${url.username}:${url.password}`);
      serverConfig.headers = serverConfig.headers || {};
      serverConfig.headers.Authorization = `Basic ${auth}`;
      serverConfig.url = `${url.protocol}//${url.host}${url.pathname}${url.search}`;
    }
  } catch (error) {
    console.warn("Failed to parse MCP server URL for auth:", error);
  }

  client.addServer(serverName, serverConfig);

  try {
    // Open a session to the MCP server so we can enumerate + call tools.
    await client.createAllSessions();
    const session = client.getAllActiveSessions()[serverName];
    if (!session) {
      throw new Error(`Failed to create MCP session for ${serverName}`);
    }

    const mcpTools = session.connector.tools ?? [];
    const tools: ProviderTool[] = mcpTools.map((t: any) => ({
      name: t.name,
      description: t.description,
      inputSchema: (t.inputSchema as Record<string, unknown>) ?? {
        type: "object",
      },
    }));

    const providerMessages: ProviderMessage[] = [
      {
        role: "system",
        content:
          "You are a helpful assistant with access to MCP tools. Help users interact with the MCP server.",
      },
      ...convertMessagesToProvider(messages as any),
    ];

    const messageId = `msg-${Date.now()}`;
    yield `data: ${JSON.stringify({ type: "message", id: messageId, role: "assistant" })}\n\n`;

    // Track in-flight tool calls so we can pair start/result events.
    const toolCallIdByIndex = new Map<
      number,
      { toolCallId: string; toolName: string; argsBuffer: string }
    >();

    for await (const ev of runToolLoop({
      config: {
        provider: llmConfig.provider,
        model: llmConfig.model,
        apiKey: llmConfig.apiKey,
        temperature: llmConfig.temperature,
        baseUrl: llmConfig.baseUrl,
      },
      messages: providerMessages,
      tools,
      callTool: async (name, args) => {
        return await session.connector.callTool(name, args);
      },
      maxSteps: 10,
    })) {
      if (ev.type === "text-delta") {
        yield `data: ${JSON.stringify({
          type: "text",
          id: messageId,
          content: ev.delta,
        })}\n\n`;
      } else if (ev.type === "tool-call-start") {
        toolCallIdByIndex.set(ev.index, {
          toolCallId: ev.toolCallId,
          toolName: ev.toolName,
          argsBuffer: "",
        });
      } else if (ev.type === "tool-call-args-delta") {
        const rec = toolCallIdByIndex.get(ev.index);
        if (rec) rec.argsBuffer += ev.argsDelta;
      } else if (ev.type === "tool-call-ready") {
        yield `data: ${JSON.stringify({
          type: "tool-call",
          id: messageId,
          toolCallId: ev.toolCallId,
          toolName: ev.toolName,
          args: ev.args,
        })}\n\n`;
      } else if (ev.type === "tool-result") {
        yield `data: ${JSON.stringify({
          type: "tool-result",
          id: messageId,
          toolCallId: ev.toolCallId,
          toolName: ev.toolName,
          result: ev.result,
        })}\n\n`;
      } else if (ev.type === "error") {
        yield `data: ${JSON.stringify({
          type: "error",
          id: messageId,
          error: ev.message,
        })}\n\n`;
      }
    }

    yield `data: ${JSON.stringify({ type: "done", id: messageId })}\n\n`;
  } finally {
    await client.closeAllSessions();
  }
}

/**
 * Execute a non-streaming chat turn using an MCP agent and the specified LLM configuration.
 *
 * @param requestBody - Request parameters
 * @param requestBody.mcpServerUrl - Base URL of the MCP server to connect to
 * @param requestBody.llmConfig - LLM provider configuration (provider, model, apiKey, etc.)
 * @param requestBody.authConfig - Optional authentication configuration for the MCP server
 * @param requestBody.messages - Array of chat messages; only the last message with role "user" is used as the query
 * @returns An object containing `content` with the agent's response text and `toolCalls` with recorded tool invocations (empty for this non-streaming implementation)
 * @throws If required fields are missing, if the LLM provider is unsupported, or if no user message is found
 */
export async function handleChatRequest(requestBody: {
  mcpServerUrl: string;
  llmConfig: LLMConfig;
  authConfig?: AuthConfig;
  messages: ChatMessage[];
}): Promise<{ content: string; toolCalls: ToolCall[] }> {
  const { mcpServerUrl, llmConfig, authConfig, messages } = requestBody;

  if (!mcpServerUrl || !llmConfig || !messages) {
    throw new Error(
      "Missing required fields: mcpServerUrl, llmConfig, messages"
    );
  }

  const { MCPClient } = await import("@mcp-use/client");

  const client = new MCPClient() as any;
  const serverName = `inspector-${Date.now()}`;

  const serverConfig: ServerConfig = {
    url: mcpServerUrl,
    preventAutoAuth: true,
  };

  if (authConfig && authConfig.type !== "none") {
    serverConfig.headers = {};
    if (
      authConfig.type === "basic" &&
      authConfig.username &&
      authConfig.password
    ) {
      const auth = toBase64(`${authConfig.username}:${authConfig.password}`);
      serverConfig.headers.Authorization = `Basic ${auth}`;
    } else if (authConfig.type === "bearer" && authConfig.token) {
      serverConfig.headers.Authorization = `Bearer ${authConfig.token}`;
    } else if (authConfig.type === "oauth") {
      if (authConfig.oauthTokens?.access_token) {
        const tokenType = authConfig.oauthTokens.token_type
          ? authConfig.oauthTokens.token_type.charAt(0).toUpperCase() +
            authConfig.oauthTokens.token_type.slice(1)
          : "Bearer";
        serverConfig.headers.Authorization = `${tokenType} ${authConfig.oauthTokens.access_token}`;
      }
    }
  }

  try {
    const url = new URL(mcpServerUrl);
    if (
      url.username &&
      url.password &&
      (!authConfig || authConfig.type === "none")
    ) {
      const auth = toBase64(`${url.username}:${url.password}`);
      serverConfig.headers = serverConfig.headers || {};
      serverConfig.headers.Authorization = `Basic ${auth}`;
      serverConfig.url = `${url.protocol}//${url.host}${url.pathname}${url.search}`;
    }
  } catch (error) {
    console.warn("Failed to parse MCP server URL for auth:", error);
  }

  client.addServer(serverName, serverConfig);

  try {
    await client.createAllSessions();
    const session = client.getAllActiveSessions()[serverName];
    if (!session) {
      throw new Error(`Failed to create MCP session for ${serverName}`);
    }

    const mcpTools = session.connector.tools ?? [];
    const tools: ProviderTool[] = mcpTools.map((t: any) => ({
      name: t.name,
      description: t.description,
      inputSchema: (t.inputSchema as Record<string, unknown>) ?? {
        type: "object",
      },
    }));

    const providerMessages: ProviderMessage[] = [
      {
        role: "system",
        content:
          "You are a helpful assistant with access to MCP tools. Help users interact with the MCP server.",
      },
      ...convertMessagesToProvider(messages as any),
    ];

    const { content, toolCalls } = await runToolLoopNonStreaming({
      config: {
        provider: llmConfig.provider,
        model: llmConfig.model,
        apiKey: llmConfig.apiKey,
        temperature: llmConfig.temperature,
        baseUrl: llmConfig.baseUrl,
      },
      messages: providerMessages,
      tools,
      callTool: async (name, args) => {
        return await session.connector.callTool(name, args);
      },
      maxSteps: 10,
    });

    return {
      content,
      toolCalls: toolCalls.map((tc) => ({
        name: tc.toolName,
        arguments: tc.args,
        result: tc.result,
      })),
    };
  } finally {
    await client.closeAllSessions();
  }
}
