import type { StructuredToolInterface } from "@langchain/core/tools";
import type { LangChainAdapter } from "../adapters/langchain_adapter.js";
import type { MCPClient } from "@mcp-use/client";

/** State and operations required by MCP server management tools. */
export interface IServerManager {
  /** Whether tools have been loaded for each configured server. */
  readonly initializedServers: Record<string, boolean>;
  /** Cached LangChain tools for each configured server. */
  readonly serverTools: Record<string, StructuredToolInterface[]>;
  /** MCP client that owns the configured servers and sessions. */
  readonly client: MCPClient;
  /** Adapter used to convert MCP capabilities into LangChain tools. */
  readonly adapter: LangChainAdapter;
  /** Server whose tools are currently exposed to the model. */
  activeServer: string | null;

  /** Replaces the default management tools. */
  setManagementTools(tools: StructuredToolInterface[]): void;
  /** Loads and caches tools for configured servers. */
  prefetchServerTools(): Promise<void>;
  /** Management tools plus tools from the active server. */
  get tools(): StructuredToolInterface[];
}
