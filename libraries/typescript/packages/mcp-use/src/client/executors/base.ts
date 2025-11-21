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

export type SearchToolsFunction = (
  query?: string,
  detailLevel?: "names" | "descriptions" | "full"
) => Promise<ToolSearchResult[]>;

export interface ToolNamespaceInfo {
  serverName: string;
  tools: Tool[];
  session: any;
}

type EmbeddingModel = any;
type EmbeddingFunction = (texts: string[]) => Promise<number[][]>;

/**
 * Abstract base class for code executors.
 * Provides shared functionality for connecting to MCP servers and building tool contexts.
 */
export abstract class BaseCodeExecutor {
  protected client: MCPClient;
  protected _connecting: boolean = false;
  // Semantic search state
  protected _embeddingModel: EmbeddingModel | null = null;
  protected _embeddingFunction: EmbeddingFunction | null = null;
  protected _toolEmbeddings: Map<string, number[]> = new Map(); // Maps "server:toolName" to embedding
  protected _toolsByKey: Map<string, Tool> = new Map(); // Maps "server:toolName" to tool
  protected _isIndexed: boolean = false;

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
   * Load the embedding model for semantic search if not already loaded.
   * Uses @xenova/transformers as an optional dependency.
   */
  protected async loadEmbeddingModel(): Promise<boolean> {
    if (this._embeddingFunction !== null) {
      return true;
    }

    try {
      // Dynamic import to handle optional dependency
      const { pipeline } = await import("@xenova/transformers");
      const model = await pipeline(
        "feature-extraction",
        "Xenova/bge-small-en-v1.5"
      );

      this._embeddingModel = model;
      this._embeddingFunction = async (texts: string[]) => {
        const results = await model(texts, {
          pooling: "mean",
          normalize: true,
        });
        // @xenova/transformers returns tensors, convert to arrays
        if (Array.isArray(results)) {
          return results.map((r: any) =>
            Array.isArray(r) ? r : r.data || Array.from(r)
          );
        }
        // Single result
        const result = results as any;
        return [Array.isArray(result) ? result : result.data || Array.from(result)];
      };
      return true;
    } catch (error: any) {
      logger.debug(
        "The '@xenova/transformers' library is not installed or failed to load. " +
          "Falling back to naive search. To use semantic search, install: " +
          "yarn add @xenova/transformers"
      );
      return false;
    }
  }

  /**
   * Index all tools from all sessions for semantic search.
   */
  protected async indexToolsForSearch(): Promise<void> {
    if (!(await this.loadEmbeddingModel())) {
      return;
    }

    // Clear previous index
    this._toolEmbeddings.clear();
    this._toolsByKey.clear();
    this._isIndexed = false;

    const toolKeys: string[] = [];
    const toolTexts: string[] = [];
    const activeSessions = this.client.getAllActiveSessions();

    for (const [serverName, session] of Object.entries(activeSessions)) {
      if (serverName === "code_mode") continue;

      try {
        const tools = session.connector.tools;
        for (const tool of tools) {
          const toolKey = `${serverName}:${tool.name}`;
          const toolDescription = tool.description || "";
          const toolText = `${tool.name}: ${toolDescription}`.toLowerCase();

          this._toolsByKey.set(toolKey, tool);
          toolKeys.push(toolKey);
          toolTexts.push(toolText);
        }
      } catch (e) {
        logger.warn(`Failed to index tools for server ${serverName}: ${e}`);
      }
    }

    if (toolTexts.length === 0) {
      return;
    }

    // Generate embeddings
    try {
      if (!this._embeddingFunction) {
        return;
      }

      const embeddings = await this._embeddingFunction(toolTexts);
      for (let i = 0; i < toolKeys.length; i++) {
        const toolKey = toolKeys[i];
        const embedding = embeddings[i];
        // Ensure embedding is a number array
        const embeddingArray = Array.isArray(embedding)
          ? embedding
          : (embedding as any).data
            ? Array.from((embedding as any).data)
            : Array.from(embedding as any);
        this._toolEmbeddings.set(toolKey, embeddingArray as number[]);
      }

      this._isIndexed = this._toolEmbeddings.size > 0;
      logger.debug(
        `Indexed ${this._toolEmbeddings.size} tools for semantic search`
      );
    } catch (e: any) {
      logger.warn(
        `Failed to generate embeddings: ${e.message}. Falling back to naive search.`
      );
      this._isIndexed = false;
    }
  }

  /**
   * Calculate cosine similarity between two vectors.
   */
  protected cosineSimilarity(vec1: number[], vec2: number[]): number {
    // Calculate dot product
    let dotProduct = 0;
    for (let i = 0; i < Math.min(vec1.length, vec2.length); i++) {
      dotProduct += vec1[i] * vec2[i];
    }

    // Calculate magnitudes
    let magnitude1 = 0;
    for (const val of vec1) {
      magnitude1 += val * val;
    }
    magnitude1 = Math.sqrt(magnitude1);

    let magnitude2 = 0;
    for (const val of vec2) {
      magnitude2 += val * val;
    }
    magnitude2 = Math.sqrt(magnitude2);

    // Avoid division by zero
    if (magnitude1 === 0 || magnitude2 === 0) {
      return 0.0;
    }

    // Calculate cosine similarity
    return dotProduct / (magnitude1 * magnitude2);
  }

  /**
   * Perform semantic search on indexed tools.
   */
  protected async semanticSearch(
    query: string,
    topK: number = 100
  ): Promise<Array<[string, number]>> {
    if (!this._isIndexed || !this._embeddingFunction) {
      return [];
    }

    // Generate embedding for the query
    let queryEmbedding: number[];
    try {
      const embeddings = await this._embeddingFunction([query]);
      const embedding = embeddings[0];
      // Ensure embedding is a number array
      queryEmbedding = Array.isArray(embedding)
        ? embedding
        : (embedding as any).data
          ? Array.from((embedding as any).data)
          : Array.from(embedding as any);
    } catch {
      return [];
    }

    // Calculate similarity scores
    const scores: Array<[string, number]> = [];
    for (const [toolKey, embedding] of this._toolEmbeddings.entries()) {
      const similarity = this.cosineSimilarity(queryEmbedding, embedding);
      scores.push([toolKey, similarity]);
    }

    // Sort by score and get top_k results
    scores.sort((a, b) => b[1] - a[1]);
    return scores.slice(0, topK);
  }

  /**
   * Perform naive substring search on tools.
   */
  protected async naiveSearch(
    query: string
  ): Promise<Array<{ server: string; tool: Tool }>> {
    const queryLower = query.toLowerCase();
    const results: Array<{ server: string; tool: Tool }> = [];
    const activeSessions = this.client.getAllActiveSessions();

    for (const [serverName, session] of Object.entries(activeSessions)) {
      if (serverName === "code_mode") continue;

      try {
        const tools = session.connector.tools;
        for (const tool of tools) {
          const nameMatch = tool.name.toLowerCase().includes(queryLower);
          const descMatch = tool.description
            ?.toLowerCase()
            .includes(queryLower);

          if (nameMatch || descMatch) {
            results.push({ server: serverName, tool });
          }
        }
      } catch (e) {
        logger.warn(`Failed to search tools in server ${serverName}: ${e}`);
      }
    }

    return results;
  }

  /**
   * Create a search function for discovering available MCP tools using semantic search.
   * Used by code execution environments to find tools at runtime.
   */
  public createSearchToolsFunction(): SearchToolsFunction {
    return async (
      query = "",
      detailLevel: "names" | "descriptions" | "full" = "full"
    ) => {
      // Ensure tools are indexed for semantic search
      if (!this._isIndexed) {
        await this.indexToolsForSearch();
      }

      const allTools: ToolSearchResult[] = [];

      if (query) {
        // Try semantic search first if available
        if (this._isIndexed) {
          const semanticResults = await this.semanticSearch(query, 100);
          for (const [toolKey, score] of semanticResults) {
            const tool = this._toolsByKey.get(toolKey);
            if (tool) {
              const [serverName] = toolKey.split(":");
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
          }
        } else {
          // Fallback to naive search if embeddings not available
          const naiveResults = await this.naiveSearch(query);
          for (const { server: serverName, tool } of naiveResults) {
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
        }
      } else {
        // No query - return all tools
        const activeSessions = this.client.getAllActiveSessions();
        for (const [serverName, session] of Object.entries(activeSessions)) {
          if (serverName === "code_mode") continue;

          try {
            const tools = session.connector.tools;
            for (const tool of tools) {
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
      }

      return allTools;
    };
  }
}
