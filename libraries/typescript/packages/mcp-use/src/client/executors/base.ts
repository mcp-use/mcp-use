import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { MCPClient } from "../../client.js";
import { logger } from "../../logging.js";

export interface ExecutionResult {
  result: unknown;
  logs: string[];
  error: string | null;
  execution_time: number;
}

export interface ToolSearchResult {
  name: string;
  server: string;
  description?: string;
  input_schema?: Tool["inputSchema"];
}

export interface ToolSearchMeta {
  total_tools: number;
  namespaces: string[];
  result_count: number;
}

export interface ToolSearchResponse {
  meta: ToolSearchMeta;
  results: ToolSearchResult[];
}

export type SearchToolsFunction = (
  query?: string,
  detailLevel?: "names" | "descriptions" | "full"
) => Promise<ToolSearchResponse>;

export interface ToolNamespaceInfo {
  serverName: string;
  tools: Tool[];
  session: any;
}

/**
 * Abstract base class for code executors.
 * Provides shared functionality for connecting to MCP servers and building tool contexts.
 */
export abstract class BaseCodeExecutor {
  protected client: MCPClient;
  protected _connecting: boolean = false;

  constructor(client: MCPClient) {
    this.client = client;
  }

  /**
   * Execute code with access to MCP tools.
   * @param code - The code to execute
   * @param timeout - Execution timeout in milliseconds
   */
  abstract execute(code: string, timeout?: number): Promise<ExecutionResult>;

  /**
   * Clean up resources used by the executor.
   * Should be called when the executor is no longer needed.
   */
  abstract cleanup(): Promise<void>;

  /**
   * Ensure all configured MCP servers are connected before execution.
   * Prevents race conditions with a connection lock.
   */
  protected async ensureServersConnected(): Promise<void> {
    const configuredServers = this.client.getServerNames();
    const activeSessions = Object.keys(this.client.getAllActiveSessions());

    // Check if we need to connect to any servers
    const missingServers = configuredServers.filter(
      (s) => !activeSessions.includes(s)
    );

    // Prevent race conditions with a lock
    if (missingServers.length > 0 && !this._connecting) {
      this._connecting = true;
      try {
        logger.debug(
          `Connecting to configured servers for code execution: ${missingServers.join(", ")}`
        );
        await this.client.createAllSessions();
      } finally {
        this._connecting = false;
      }
    } else if (missingServers.length > 0 && this._connecting) {
      // Wait for connection to complete if already in progress
      logger.debug("Waiting for ongoing server connection...");
      // Simple polling for now
      const startWait = Date.now();
      while (this._connecting && Date.now() - startWait < 5000) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }

  /**
   * Get tool namespace information from all active MCP sessions.
   * Filters out the internal code_mode server.
   */
  protected getToolNamespaces(): ToolNamespaceInfo[] {
    const namespaces: ToolNamespaceInfo[] = [];
    const activeSessions = this.client.getAllActiveSessions();

    for (const [serverName, session] of Object.entries(activeSessions)) {
      // Skip internal code_mode server to avoid recursion
      if (serverName === "code_mode") continue;

      try {
        const connector = session.connector;
        let tools;
        try {
          tools = connector.tools;
        } catch (e) {
          logger.warn(`Tools not available for server ${serverName}: ${e}`);
          continue;
        }

        if (!tools || tools.length === 0) continue;

        namespaces.push({ serverName, tools, session });
      } catch (e) {
        logger.warn(`Failed to load tools for server ${serverName}: ${e}`);
      }
    }

    return namespaces;
  }

  /**
   * Create a search function for discovering available MCP tools.
   * Used by code execution environments to find tools at runtime.
   */
  public createSearchToolsFunction(): SearchToolsFunction {
    return async (
      query = "",
      detailLevel: "names" | "descriptions" | "full" = "full"
    ) => {
      const allTools: ToolSearchResult[] = [];
      const allNamespaces = new Set<string>();
      const queryLower = query.toLowerCase();
      const activeSessions = this.client.getAllActiveSessions();

      // First pass: collect all tools and namespaces
      for (const [serverName, session] of Object.entries(activeSessions)) {
        if (serverName === "code_mode") continue;

        try {
          const tools = session.connector.tools;
          if (tools && tools.length > 0) {
            allNamespaces.add(serverName);
          }

          for (const tool of tools) {
            // Build tool info based on detail level (before filtering)
            if (detailLevel === "names") {
              allTools.push({ name: tool.name, server: serverName });
            } else if (detailLevel === "descriptions") {
              allTools.push({
                name: tool.name,
                server: serverName,
                description: tool.description,
              });
            } else {
              allTools.push({
                name: tool.name,
                server: serverName,
                description: tool.description,
                input_schema: tool.inputSchema,
              });
            }
          }
        } catch (e) {
          logger.warn(`Failed to search tools in server ${serverName}: ${e}`);
        }
      }

      // Filter by query if provided
      let filteredTools = allTools;
      if (query) {
        filteredTools = allTools.filter((tool) => {
          const nameMatch = tool.name.toLowerCase().includes(queryLower);
          const descMatch = tool.description
            ?.toLowerCase()
            .includes(queryLower);
          const serverMatch = tool.server.toLowerCase().includes(queryLower);
          return nameMatch || descMatch || serverMatch;
        });
      }

      // Return metadata along with results
      return {
        meta: {
          total_tools: allTools.length,
          namespaces: Array.from(allNamespaces).sort(),
          result_count: filteredTools.length,
        },
        results: filteredTools,
      };
    };
  }
}
