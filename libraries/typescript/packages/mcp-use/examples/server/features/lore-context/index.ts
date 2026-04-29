import { MCPServer, text, object, error } from "mcp-use/server";
import { z } from "zod";

// ============================================================================
// CONFIGURATION
// ============================================================================

const LORE_API_BASE =
  process.env.LORE_API_BASE_URL || "https://api.lorecontext.com/v1";
const LORE_API_KEY = process.env.LORE_API_KEY || "";

// ============================================================================
// LORE CONTEXT REST API CLIENT
// ============================================================================

interface LoreMemory {
  id: string;
  content: string;
  scope: string;
  memory_type?: string;
  project_id?: string;
  confidence?: number;
  created_at: string;
  updated_at: string;
}

interface SearchResult {
  memories: LoreMemory[];
  total: number;
}

async function loreFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${LORE_API_BASE}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(LORE_API_KEY ? { Authorization: `Bearer ${LORE_API_KEY}` } : {}),
    ...((options.headers as Record<string, string>) || {}),
  };

  const response = await fetch(url, { ...options, headers });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Lore API error ${response.status}: ${body || response.statusText}`
    );
  }

  return response.json() as Promise<T>;
}

// ============================================================================
// SERVER
// ============================================================================

const server = new MCPServer({
  name: "lore-context-server",
  title: "Lore Context Memory Server",
  version: "1.0.0",
  description:
    "MCP server that wraps the Lore Context REST API, providing tools " +
    "to search, write, and retrieve persistent agent memories.",
});

// ============================================================================
// TOOL: memory_search
// ============================================================================

server.tool(
  {
    name: "memory_search",
    description:
      "Search Lore Context memories by semantic query. Returns the most " +
      "relevant memories matching the query string. Use this to recall " +
      "past decisions, patterns, or facts stored in long-term memory.",
    schema: z.object({
      query: z.string().describe("Natural language search query"),
      project_id: z
        .string()
        .optional()
        .describe("Optional project ID to scope the search"),
      top_k: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .default(10)
        .describe("Maximum number of results to return (1-50)"),
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
      destructiveHint: false,
    },
  },
  async ({ query, project_id, top_k }) => {
    try {
      const params = new URLSearchParams({ query, top_k: String(top_k) });
      if (project_id) params.set("project_id", project_id);

      const result = await loreFetch<SearchResult>(
        `/memories/search?${params.toString()}`
      );

      if (result.memories.length === 0) {
        return text(`No memories found for query: "${query}"`);
      }

      const formatted = result.memories
        .map(
          (m, i) =>
            `[${i + 1}] (${m.id}) [${m.scope}${m.memory_type ? "/" + m.memory_type : ""}]\n${m.content}`
        )
        .join("\n\n");

      return text(
        `Found ${result.memories.length} memory(ies) for "${query}":\n\n${formatted}`
      );
    } catch (err) {
      return error(
        `Failed to search memories: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
);

// ============================================================================
// TOOL: memory_write
// ============================================================================

server.tool(
  {
    name: "memory_write",
    description:
      "Write a new memory to Lore Context. Use this to persist important " +
      "insights, decisions, architectural patterns, bugs, or workflow " +
      "knowledge so they can be recalled in future sessions.",
    schema: z.object({
      content: z.string().describe("The memory content to store"),
      scope: z
        .enum(["user", "project", "repo", "team", "org"])
        .describe("Visibility scope for this memory"),
      memory_type: z
        .enum([
          "pattern",
          "preference",
          "architecture",
          "bug",
          "workflow",
          "fact",
        ])
        .optional()
        .describe("Optional category for the memory"),
      project_id: z
        .string()
        .optional()
        .describe("Optional project ID to associate with this memory"),
    }),
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: false,
    },
  },
  async ({ content, scope, memory_type, project_id }) => {
    try {
      const body: Record<string, unknown> = { content, scope };
      if (memory_type) body.memory_type = memory_type;
      if (project_id) body.project_id = project_id;

      const result = await loreFetch<LoreMemory>("/memories", {
        method: "POST",
        body: JSON.stringify(body),
      });

      return object({
        success: true,
        memory_id: result.id,
        message: `Memory saved (id: ${result.id}, scope: ${scope})`,
      });
    } catch (err) {
      return error(
        `Failed to write memory: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
);

// ============================================================================
// TOOL: memory_get
// ============================================================================

server.tool(
  {
    name: "memory_get",
    description:
      "Retrieve a single Lore Context memory by its ID. Use this when " +
      "you have a specific memory ID and need to read its full content.",
    schema: z.object({
      memory_id: z.string().describe("The memory ID to retrieve"),
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: true,
      destructiveHint: false,
    },
  },
  async ({ memory_id }) => {
    try {
      const result = await loreFetch<LoreMemory>(
        `/memories/${encodeURIComponent(memory_id)}`
      );

      return object({
        id: result.id,
        content: result.content,
        scope: result.scope,
        memory_type: result.memory_type,
        project_id: result.project_id,
        confidence: result.confidence,
        created_at: result.created_at,
        updated_at: result.updated_at,
      });
    } catch (err) {
      return error(
        `Failed to get memory: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
);

// ============================================================================
// START
// ============================================================================

const port = Number(process.env.PORT) || 3000;

await server.listen(port);
console.log(
  `Lore Context MCP server running at http://localhost:${port}/mcp\n` +
    `Inspector:          http://localhost:${port}/inspector\n` +
    `LORE_API_BASE_URL:  ${LORE_API_BASE}\n` +
    `LORE_API_KEY:       ${LORE_API_KEY ? "••••" + LORE_API_KEY.slice(-4) : "(not set)"}`
);
