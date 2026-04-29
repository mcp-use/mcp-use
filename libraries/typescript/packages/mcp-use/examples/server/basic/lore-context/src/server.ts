import { MCPServer, text } from "mcp-use/server";
import z from "zod";

const LORE_API_URL = process.env.LORE_API_URL || "http://localhost:3000";
const LORE_API_KEY = process.env.LORE_API_KEY;

function loreHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (LORE_API_KEY) headers["Authorization"] = `Bearer ${LORE_API_KEY}`;
  return headers;
}

async function lorePost(path: string, body: unknown) {
  const resp = await fetch(`${LORE_API_URL}${path}`, {
    method: "POST",
    headers: loreHeaders(),
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Lore API error ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

async function loreGet(path: string) {
  const resp = await fetch(`${LORE_API_URL}${path}`, { headers: loreHeaders() });
  if (!resp.ok) throw new Error(`Lore API error ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

const server = new MCPServer({
  name: "lore-context",
  version: "0.5.0",
  description: "Lore Context — semantic memory for AI agents",
});

// Search memories
server.tool(
  {
    name: "memory_search",
    description:
      "Semantic search across stored memories. Use natural language queries to find relevant past context, decisions, and patterns.",
    schema: z.object({
      query: z.string().describe("Natural language search query"),
      top_k: z.number().optional().describe("Max results to return (default 10)"),
    }),
  },
  async ({ query, top_k }) => {
    const result = await lorePost("/v1/memory/search", { query, top_k: top_k ?? 10 });
    return text(JSON.stringify(result, null, 2));
  }
);

// Write a memory
server.tool(
  {
    name: "memory_write",
    description:
      "Store a new memory with metadata. Use for persisting important decisions, patterns, preferences, or facts.",
    schema: z.object({
      content: z.string().describe("The memory content to store"),
      memory_type: z.string().optional().describe("Type: pattern, preference, architecture, bug, workflow, fact"),
      scope: z.string().optional().describe("Scope: user, project, repo, team, org"),
      project_id: z.string().optional().describe("Project ID for scoped memories"),
    }),
  },
  async ({ content, memory_type, scope, project_id }) => {
    const result = await lorePost("/v1/memory/write", {
      content,
      memory_type: memory_type ?? "fact",
      scope: scope ?? "project",
      project_id,
    });
    return text(JSON.stringify(result, null, 2));
  }
);

// Get a memory by ID
server.tool(
  {
    name: "memory_get",
    description: "Read a specific memory by its ID.",
    schema: z.object({
      memory_id: z.string().describe("The memory ID to retrieve"),
    }),
  },
  async ({ memory_id }) => {
    const result = await loreGet(`/v1/memory/${memory_id}`);
    return text(JSON.stringify(result, null, 2));
  }
);

// List memories
server.tool(
  {
    name: "memory_list",
    description: "List memories with optional filters.",
    schema: z.object({
      project_id: z.string().optional(),
      memory_type: z.string().optional(),
      limit: z.number().optional(),
    }),
  },
  async ({ project_id, memory_type, limit }) => {
    const params = new URLSearchParams();
    if (project_id) params.set("project_id", project_id);
    if (memory_type) params.set("memory_type", memory_type);
    if (limit) params.set("limit", String(limit));
    const qs = params.toString();
    const result = await loreGet(`/v1/memory/list${qs ? `?${qs}` : ""}`);
    return text(JSON.stringify(result, null, 2));
  }
);

// Forget a memory
server.tool(
  {
    name: "memory_forget",
    description: "Soft-delete a memory. Provide a reason for the audit log.",
    schema: z.object({
      memory_id: z.string().describe("The memory ID to forget"),
      reason: z.string().describe("Why this memory should be forgotten"),
    }),
  },
  async ({ memory_id, reason }) => {
    const result = await lorePost("/v1/memory/forget", { memory_ids: [memory_id], reason });
    return text(JSON.stringify(result, null, 2));
  }
);

// Context query — get agent-ready context
server.tool(
  {
    name: "context_query",
    description:
      "Get agent-ready context from memory, web search, repo evidence, and tool traces. Combines multiple sources into a single context window.",
    schema: z.object({
      query: z.string().describe("What context you need"),
      project_id: z.string().optional(),
    }),
  },
  async ({ query, project_id }) => {
    const result = await lorePost("/v1/context/query", { query, project_id });
    return text(JSON.stringify(result, null, 2));
  }
);

await server.listen();
