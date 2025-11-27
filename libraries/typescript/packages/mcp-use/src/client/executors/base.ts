import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { MCPClient, SemanticSearchConfig } from "../../client.js";
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
  protected semanticConfig?: SemanticSearchConfig;

  constructor(client: MCPClient, semanticConfig?: SemanticSearchConfig) {
    this.client = client;
    this.semanticConfig = semanticConfig;
  }

  /**
   * Set semantic search configuration (for executors created before config is available)
   */
  public setSemanticConfig(config: SemanticSearchConfig): void {
    this.semanticConfig = config;
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
    const searchMode = this.semanticConfig?.mode || "string_match";
    
    return async (
      query = "",
      detailLevel: "names" | "descriptions" | "full" = "full"
    ) => {
      const allTools: ToolSearchResult[] = [];
      const allNamespaces = new Set<string>();
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

      // Filter by query using the configured search mode
      let filteredTools = allTools;
      if (query) {
        if (searchMode === "fuzzy") {
          filteredTools = await this._fuzzySearch(allTools, query);
        } else if (searchMode === "embeddings") {
          filteredTools = await this._embeddingsSearch(allTools, query);
        } else {
          // string_match (default)
          filteredTools = this._stringMatchSearch(allTools, query);
        }
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

  /**
   * String match search (default, naive search)
   */
  private _stringMatchSearch(
    tools: ToolSearchResult[],
    query: string
  ): ToolSearchResult[] {
    const queryLower = query.toLowerCase();
    return tools.filter((tool) => {
      const nameMatch = tool.name.toLowerCase().includes(queryLower);
      const descMatch = tool.description?.toLowerCase().includes(queryLower);
      const serverMatch = tool.server.toLowerCase().includes(queryLower);
      return nameMatch || descMatch || serverMatch;
    });
  }

  /**
   * Fuzzy search using fuse.js
   */
  private async _fuzzySearch(
    tools: ToolSearchResult[],
    query: string
  ): Promise<ToolSearchResult[]> {
    try {
      // Dynamic import to avoid requiring fuse.js as a hard dependency
      const Fuse = (await import("fuse.js")).default;
      
      const fuse = new Fuse(tools, {
        keys: ["name", "description", "server"],
        threshold: 0.4, // Lower = more strict matching
        includeScore: true,
      });

      const results = fuse.search(query);
      return results.map((result) => result.item);
    } catch (error: any) {
      if (error.code === "ERR_MODULE_NOT_FOUND" || error.message?.includes("fuse.js")) {
        throw new Error(
          "fuse.js is required for fuzzy search mode. Install it with: yarn add fuse.js"
        );
      }
      throw error;
    }
  }

  /**
   * Embeddings-based semantic search
   */
  private async _embeddingsSearch(
    tools: ToolSearchResult[],
    query: string
  ): Promise<ToolSearchResult[]> {
    // Check for OpenAI or Anthropic API keys
    const openaiApiKey = process.env.OPENAI_API_KEY;
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    const embeddingsUrl = this.semanticConfig?.embeddingsUrl;

    if (!openaiApiKey && !anthropicApiKey && !embeddingsUrl) {
      throw new Error(
        "Embeddings search mode requires either:\n" +
        "  - OPENAI_API_KEY environment variable, or\n" +
        "  - ANTHROPIC_API_KEY environment variable, or\n" +
        "  - embeddingsUrl in semantic config"
      );
    }

    // Get query embedding
    let queryEmbedding: number[];
    if (openaiApiKey) {
      queryEmbedding = await this._getOpenAIEmbedding(query, openaiApiKey);
    } else if (anthropicApiKey) {
      queryEmbedding = await this._getAnthropicEmbedding(query, anthropicApiKey);
    } else if (embeddingsUrl) {
      queryEmbedding = await this._getCustomEmbedding(query, embeddingsUrl);
    } else {
      throw new Error("No embedding provider available");
    }

    // Get or compute tool embeddings
    const toolEmbeddings = await this._getToolEmbeddings(tools, {
      openaiApiKey,
      anthropicApiKey,
      embeddingsUrl,
    });

    // Calculate cosine similarity and sort
    const scoredTools = tools.map((tool, index) => {
      const toolEmbedding = toolEmbeddings[index];
      const similarity = this._cosineSimilarity(queryEmbedding, toolEmbedding);
      return { tool, similarity };
    });

    // Sort by similarity (highest first) and return top results
    scoredTools.sort((a, b) => b.similarity - a.similarity);
    
    // Return tools with similarity > 0.3 (threshold)
    return scoredTools
      .filter((item) => item.similarity > 0.3)
      .map((item) => item.tool);
  }

  /**
   * Get OpenAI embedding
   */
  private async _getOpenAIEmbedding(
    text: string,
    apiKey: string
  ): Promise<number[]> {
    try {
      const response = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: text,
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.statusText}`);
      }

      const data = await response.json();
      return data.data[0].embedding;
    } catch (error: any) {
      throw new Error(`Failed to get OpenAI embedding: ${error.message}`);
    }
  }

  /**
   * Get Anthropic embedding (using messages API with embedding extraction)
   * Note: Anthropic doesn't have a direct embeddings API, so we'll use a workaround
   * or require embeddingsUrl for Anthropic
   */
  private async _getAnthropicEmbedding(
    text: string,
    apiKey: string
  ): Promise<number[]> {
    // Anthropic doesn't have a direct embeddings API
    // For now, throw an error suggesting to use embeddingsUrl
    throw new Error(
      "Anthropic API doesn't provide direct embeddings. " +
      "Please use embeddingsUrl in semantic config with an OpenAI-compatible embeddings API."
    );
  }

  /**
   * Get embedding from custom OpenAI-compatible API
   */
  private async _getCustomEmbedding(
    text: string,
    url: string
  ): Promise<number[]> {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "text-embedding-3-small", // Default, can be overridden
          input: text,
        }),
      });

      if (!response.ok) {
        throw new Error(`Embeddings API error: ${response.statusText}`);
      }

      const data = await response.json();
      // Support both OpenAI format and direct array format
      if (data.data && Array.isArray(data.data) && data.data[0]?.embedding) {
        return data.data[0].embedding;
      } else if (Array.isArray(data.embedding)) {
        return data.embedding;
      } else if (Array.isArray(data)) {
        return data;
      }
      throw new Error("Unexpected embeddings API response format");
    } catch (error: any) {
      throw new Error(`Failed to get custom embedding: ${error.message}`);
    }
  }

  /**
   * Get embeddings for all tools (with caching)
   */
  private _toolEmbeddingsCache: Map<string, number[]> = new Map();

  private async _getToolEmbeddings(
    tools: ToolSearchResult[],
    config: {
      openaiApiKey?: string;
      anthropicApiKey?: string;
      embeddingsUrl?: string;
    }
  ): Promise<number[][]> {
    const embeddings: number[][] = [];

    for (const tool of tools) {
      // Create cache key from tool name and description
      const cacheKey = `${tool.name}:${tool.description || ""}`;
      
      if (this._toolEmbeddingsCache.has(cacheKey)) {
        embeddings.push(this._toolEmbeddingsCache.get(cacheKey)!);
        continue;
      }

      // Create text representation for embedding
      const toolText = `${tool.name} ${tool.description || ""} ${tool.server}`.trim();

      let embedding: number[];
      if (config.openaiApiKey) {
        embedding = await this._getOpenAIEmbedding(toolText, config.openaiApiKey);
      } else if (config.embeddingsUrl) {
        embedding = await this._getCustomEmbedding(toolText, config.embeddingsUrl);
      } else {
        throw new Error("No embedding provider available");
      }

      this._toolEmbeddingsCache.set(cacheKey, embedding);
      embeddings.push(embedding);
    }

    return embeddings;
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private _cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error("Vectors must have the same length");
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;

    return dotProduct / denominator;
  }
}
