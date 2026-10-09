import { describe, expect, it, vi } from "vitest";
import { MCPAgent } from "../../src/agents/mcp_agent.js";
import type { McpConnectionLike } from "../../src/agents/agent_options.js";
import type { LlmDriver } from "../../src/llm/driver.js";
import type { ProviderTool } from "../../src/llm/types.js";

function createCatalogConnection(): McpConnectionLike {
  return {
    tools: [
      {
        name: "postgres_execute_sql",
        description:
          "Execute a read-only SQL query against the PostgreSQL relational database and return rows",
        inputSchema: {
          type: "object",
          properties: {
            sql: {
              type: "string",
              description: "SQL SELECT statement to run on postgres",
            },
          },
          required: ["sql"],
        },
      },
      {
        name: "postgres_list_tables",
        description:
          "List database tables and schemas in the PostgreSQL database",
        inputSchema: {
          type: "object",
          properties: {
            schema: { type: "string", description: "Database schema name" },
          },
        },
      },
      {
        name: "github_create_issue",
        description:
          "Create a new bug report or feature request issue in a GitHub repository",
        inputSchema: {
          type: "object",
          properties: {
            owner: { type: "string" },
            repo: { type: "string" },
            title: { type: "string" },
            body: { type: "string" },
          },
          required: ["owner", "repo", "title"],
        },
      },
      {
        name: "github_create_pull_request",
        description:
          "Open a GitHub pull request merging a head branch into a base branch",
        inputSchema: {
          type: "object",
          properties: {
            owner: { type: "string" },
            repo: { type: "string" },
            title: { type: "string" },
            head: { type: "string" },
            base: { type: "string" },
          },
        },
      },
      {
        name: "slack_post_message",
        description:
          "Send a chat notification message to a Slack workspace channel",
        inputSchema: {
          type: "object",
          properties: {
            channel: { type: "string" },
            text: { type: "string" },
          },
        },
      },
      {
        name: "stripe_create_refund",
        description:
          "Issue a payment refund for a Stripe charge or payment intent",
        inputSchema: {
          type: "object",
          properties: {
            chargeId: { type: "string" },
            amountCents: { type: "number" },
          },
        },
      },
      {
        name: "kubernetes_get_pods",
        description:
          "List running Kubernetes pods and container statuses in a namespace",
        inputSchema: {
          type: "object",
          properties: {
            namespace: { type: "string" },
          },
        },
      },
      {
        name: "s3_upload_object",
        description: "Upload a file object to an Amazon S3 storage bucket",
        inputSchema: {
          type: "object",
          properties: {
            bucket: { type: "string" },
            key: { type: "string" },
          },
        },
      },
    ],
    callTool: vi.fn().mockImplementation(async (name, args) => ({
      tool: name,
      args,
      ok: true,
    })),
  };
}

function attachMockDriver(agent: MCPAgent): {
  capturedTools: ProviderTool[][];
  driver: LlmDriver;
} {
  const capturedTools: ProviderTool[][] = [];
  const driver: LlmDriver = {
    complete: vi.fn().mockImplementation(async (params) => {
      capturedTools.push(params.tools);
      return {
        text: "completed",
        toolCalls: [],
      };
    }),
    stream: vi.fn().mockImplementation(async function* (params) {
      capturedTools.push(params.tools);
      yield { type: "text-delta", text: "streamed" };
      yield { type: "done", text: "streamed" };
    }),
  };
  (agent as unknown as { driver: LlmDriver }).driver = driver;
  return { capturedTools, driver };
}

describe("MCPAgent tool pruning (tool-prune)", () => {
  it("passes all tools by default when pruneTools is not enabled", async () => {
    const connection = createCatalogConnection();
    const agent = new MCPAgent({
      llm: { provider: "openai", model: "gpt-4o", apiKey: "test-key" },
      mcpServers: [connection],
    });
    const { capturedTools } = attachMockDriver(agent);

    await agent.run({
      prompt: "Run a SQL SELECT query on PostgreSQL to count active users",
    });

    expect(capturedTools).toHaveLength(1);
    expect(capturedTools[0]).toHaveLength(8);
  });

  it("prunes model-visible tools via pruneTools option while keeping all tools callable", async () => {
    const connection = createCatalogConnection();
    const agent = new MCPAgent({
      llm: { provider: "openai", model: "gpt-4o", apiKey: "test-key" },
      mcpServers: [connection],
      pruneTools: { topK: 2, engine: "turboquant" },
    });
    const { capturedTools } = attachMockDriver(agent);

    await agent.run({
      prompt: "Execute a SQL query on the PostgreSQL database",
    });

    expect(capturedTools).toHaveLength(1);
    expect(capturedTools[0]).toHaveLength(2);
    const exposedNames = capturedTools[0]!.map((t) => t.name);
    expect(exposedNames).toContain("postgres_execute_sql");

    // Verify all registered tools remain callable via callTool even when pruned from prompt
    const callTool = (
      agent as unknown as {
        callTool: (
          name: string,
          args: Record<string, unknown>
        ) => Promise<unknown>;
      }
    ).callTool;
    await callTool("s3_upload_object", { bucket: "logs", key: "app.log" });
    expect(connection.callTool).toHaveBeenCalledWith("s3_upload_object", {
      bucket: "logs",
      key: "app.log",
    });
  });

  it("supports per-run pruneTools overrides and disabling pruning per run", async () => {
    const connection = createCatalogConnection();
    const agent = new MCPAgent({
      llm: { provider: "openai", model: "gpt-4o", apiKey: "test-key" },
      mcpServers: [connection],
      pruneTools: { topK: 2, engine: "turboquant" },
    });
    const { capturedTools } = attachMockDriver(agent);

    await agent.run({
      prompt: "Send a chat notification message to Slack channel #general",
      pruneTools: { topK: 1, engine: "turboquant" },
    });

    expect(capturedTools[0]).toHaveLength(1);
    expect(capturedTools[0]![0]?.name).toBe("slack_post_message");

    await agent.run({
      prompt: "Send a chat notification message to Slack channel #general",
      pruneTools: false,
    });

    expect(capturedTools[1]).toHaveLength(8);
  });

  it("extracts pruning query from messages when prompt is omitted", async () => {
    const connection = createCatalogConnection();
    const agent = new MCPAgent({
      llm: { provider: "openai", model: "gpt-4o", apiKey: "test-key" },
      mcpServers: [connection],
      pruneTools: { topK: 2, engine: "turboquant" },
    });
    const { capturedTools } = attachMockDriver(agent);

    await agent.run({
      messages: [
        {
          role: "user",
          content: "Issue a payment refund for a Stripe charge",
        },
      ],
    });

    expect(capturedTools[0]).toHaveLength(2);
    expect(capturedTools[0]!.map((t) => t.name)).toContain(
      "stripe_create_refund"
    );
  });

  it("extracts pruning query from externalHistory when prompt and messages are omitted", async () => {
    const connection = createCatalogConnection();
    const agent = new MCPAgent({
      llm: { provider: "openai", model: "gpt-4o", apiKey: "test-key" },
      mcpServers: [connection],
      pruneTools: { topK: 2, engine: "turboquant" },
    });
    const { capturedTools } = attachMockDriver(agent);

    await agent.run({
      externalHistory: [
        {
          type: "human",
          content: "List running Kubernetes pods in the production namespace",
        } as unknown as import("../../src/agents/types.js").BaseMessage,
      ],
    });

    expect(capturedTools[0]).toHaveLength(2);
    expect(capturedTools[0]!.map((t) => t.name)).toContain(
      "kubernetes_get_pods"
    );
  });

  it("applies per-run endpoint overrides even after the pruner is cached", async () => {
    const connection = createCatalogConnection();
    const agent = new MCPAgent({
      llm: { provider: "openai", model: "gpt-4o", apiKey: "test-key" },
      mcpServers: [connection],
      pruneTools: { topK: 1, engine: "turboquant" },
    });
    const { capturedTools } = attachMockDriver(agent);

    // Warm up the cached pruner instance
    await agent.run({
      prompt: "Execute a SQL query on the PostgreSQL database",
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          answers: {
            tool: {
              choice: "stripe_create_refund",
              confidence: 0.99,
              probabilities: { stripe_create_refund: 0.99 },
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    try {
      await agent.run({
        prompt: "Refund this Stripe charge",
        pruneTools: {
          topK: 1,
          engine: "typesafe",
          apiKey: "ts-test-key",
          endpoint: "https://custom.typesafe.example/v1/systemone",
        },
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://custom.typesafe.example/v1/systemone",
        expect.objectContaining({ method: "POST" })
      );
      expect(capturedTools[1]).toHaveLength(1);
      expect(capturedTools[1]![0]?.name).toBe("stripe_create_refund");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("rejects pruneTools on remote agents", async () => {
    expect(
      () =>
        new MCPAgent({
          llm: "openai/gpt-4o",
          agentId: "remote-agent-123",
          apiKey: "remote-key",
          pruneTools: true,
        })
    ).toThrow(/pruneTools is not supported for remote agents/);

    const remoteAgent = new MCPAgent({
      llm: "openai/gpt-4o",
      agentId: "remote-agent-123",
      apiKey: "remote-key",
    });

    await expect(
      remoteAgent.run({
        prompt: "Hello",
        pruneTools: true,
      })
    ).rejects.toThrow(/pruneTools is not supported for remote agents/);
  });

  it("fails open to the full toolset when prompt and messages are empty", async () => {
    const connection = createCatalogConnection();
    const agent = new MCPAgent({
      llm: { provider: "openai", model: "gpt-4o", apiKey: "test-key" },
      mcpServers: [connection],
      pruneTools: true,
    });
    const { capturedTools } = attachMockDriver(agent);

    await agent.run({ prompt: "   " });

    expect(capturedTools[0]).toHaveLength(8);
  });
});
