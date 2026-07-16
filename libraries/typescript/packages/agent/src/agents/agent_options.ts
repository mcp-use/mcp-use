import type { MCPClient } from "@mcp-use/client";
import type { BaseConnector } from "@mcp-use/client";
import type { ProviderConfig } from "../llm/types.js";
import type { NativeLLMConfig } from "../llm/provider_config.js";
import type { MCPServerConfig } from "./types.js";

/** Live MCP connection handle (McpServer from useMcp / useMcpClient). */
export interface McpConnectionLike {
  tools?: Array<{
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
  }>;
  callTool: (
    name: string,
    args: Record<string, unknown>,
    options?: { signal?: AbortSignal }
  ) => Promise<unknown>;
}

/** Spawn configs (Node) OR live connections (browser). */
export type McpServersInput =
  | Record<string, MCPServerConfig>
  | McpConnectionLike[];

export interface MCPAgentOptions {
  /** Simplified: `"openai/gpt-4o"`. Explicit: `ProviderConfig`. */
  llm: string | ProviderConfig;
  llmConfig?: NativeLLMConfig;
  client?: MCPClient;
  connectors?: BaseConnector[];
  /** Config map to spawn servers, or live connection array. */
  mcpServers?: McpServersInput;
  maxSteps?: number;
  autoInitialize?: boolean;
  memoryEnabled?: boolean;
  systemPrompt?: string | null;
  disallowedTools?: string[];
  exposeResourcesAsTools?: boolean;
  exposePromptsAsTools?: boolean;
  agentId?: string;
  apiKey?: string;
  baseUrl?: string;
}
