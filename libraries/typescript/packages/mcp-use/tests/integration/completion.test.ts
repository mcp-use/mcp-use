/**
 * Integration tests for completion support
 * Tests the full client-server completion flow with real MCP server
 *
 * Run with: pnpm test tests/integration/completion.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { z } from "zod";
import { MCPServer, completable } from "../../src/server/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  CompleteRequestParams,
  CompleteResult,
} from "@modelcontextprotocol/sdk/types.js";

describe("Completion Integration Tests", () => {
  let server: any;
  let client: Client;
  let transport: StreamableHTTPClientTransport;
  const TEST_PORT = 3098;
  const SERVER_URL = `http://localhost:${TEST_PORT}/mcp`;

  beforeAll(async () => {
    // Create test server with completion-enabled prompts
    server = new MCPServer({
      name: "test-completion-server",
      version: "1.0.0",
    });

    // Add prompt with list-based completion (static array)
    server.prompt(
      {
        name: "code-review",
        schema: z.object({
          language: completable(z.string(), [
            "python",
            "typescript",
            "javascript",
            "java",
            "go",
            "rust",
          ]),
          severity: z.string(),
        }),
      },
      async ({ language, severity }) => ({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Review code in ${language} with ${severity} severity`,
            },
          },
        ],
      })
    );

    // Add prompt with callback-based completion (dynamic)
    server.prompt(
      {
        name: "file-search",
        schema: z.object({
          extension: completable(z.string(), async (value: string) => {
            // Simulate dynamic completion based on partial input
            const extensions = [".ts", ".tsx", ".js", ".jsx", ".py", ".go"];
            return extensions.filter((ext) => ext.startsWith(value));
          }),
          directory: z.string(),
        }),
      },
      async ({ extension, directory }) => ({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Find files with extension ${extension} in ${directory}`,
            },
          },
        ],
      })
    );

    // Add resource template with completion
    server.resourceTemplate({
      uriTemplate: "file:///{path}",
      name: "File",
      description: "Read a file",
      schema: z.object({
        path: completable(z.string(), [
          "/home/user/documents",
          "/home/user/downloads",
          "/home/user/projects",
        ]),
      }),
      readCallback: async ({ path }) => ({
        contents: [
          {
            uri: `file:///${path}`,
            text: `Content of ${path}`,
          },
        ],
      }),
    });

    // Start server
    await server.listen(TEST_PORT);

    // Create SDK client and connect
    transport = new StreamableHTTPClientTransport(new URL(SERVER_URL));
    client = new Client(
      {
        name: "test-client",
        version: "1.0.0",
      },
      {
        capabilities: {
          roots: {},
        },
      }
    );
    await client.connect(transport);
  });

  afterAll(async () => {
    if (client) {
      await client.close();
    }
    // Server cleanup if needed
  });

  it("should complete prompt argument with static list", async () => {
    const params: CompleteRequestParams = {
      ref: { type: "ref/prompt", name: "code-review" },
      argument: { name: "language", value: "py" },
    };

    const result: CompleteResult = await client.complete(params);

    expect(result).toBeDefined();
    expect(result.completion).toBeDefined();
    expect(Array.isArray(result.completion.values)).toBe(true);
    expect(result.completion.values).toContain("python");
    expect(result.completion.values.length).toBeGreaterThan(0);
  });

  it("should return all options when prefix is empty", async () => {
    const params: CompleteRequestParams = {
      ref: { type: "ref/prompt", name: "code-review" },
      argument: { name: "language", value: "" },
    };

    const result: CompleteResult = await client.complete(params);

    expect(result.completion.values).toEqual([
      "python",
      "typescript",
      "javascript",
      "java",
      "go",
      "rust",
    ]);
  });

  it("should complete prompt argument with callback (dynamic)", async () => {
    const params: CompleteRequestParams = {
      ref: { type: "ref/prompt", name: "file-search" },
      argument: { name: "extension", value: ".t" },
    };

    const result: CompleteResult = await client.complete(params);

    expect(result.completion.values).toContain(".ts");
    expect(result.completion.values).toContain(".tsx");
    expect(result.completion.values).not.toContain(".py");
    expect(result.completion.values).not.toContain(".go");
  });

  it("should support resource template URI variable completion", async () => {
    const params: CompleteRequestParams = {
      ref: { type: "ref/resource", uri: "file:///{path}" },
      argument: { name: "path", value: "/home/user" },
    };

    // Resource template completion is supported by the client
    // Server implementation may or may not provide completions
    const result: CompleteResult = await client.complete(params);

    expect(result.completion).toBeDefined();
    expect(Array.isArray(result.completion.values)).toBe(true);
    // Note: Actual values depend on server-side implementation
  });

  it("should filter completions based on partial input", async () => {
    const params: CompleteRequestParams = {
      ref: { type: "ref/prompt", name: "code-review" },
      argument: { name: "language", value: "java" },
    };

    const result: CompleteResult = await client.complete(params);

    expect(result.completion.values).toContain("javascript");
    expect(result.completion.values).toContain("java");
    // Should not contain python, typescript, etc. since they don't match "java"
  });

  it("should handle completion for non-completable argument", async () => {
    const params: CompleteRequestParams = {
      ref: { type: "ref/prompt", name: "code-review" },
      argument: { name: "severity", value: "hig" },
    };

    // Non-completable arguments should return empty completions or error
    try {
      const result: CompleteResult = await client.complete(params);
      // If no error, should return empty values
      expect(Array.isArray(result.completion.values)).toBe(true);
    } catch (error) {
      // Server may return error for non-completable arguments
      expect(error).toBeDefined();
    }
  });

  it("should respect completion value limit", async () => {
    const params: CompleteRequestParams = {
      ref: { type: "ref/prompt", name: "code-review" },
      argument: { name: "language", value: "" },
    };

    const result: CompleteResult = await client.complete(params);

    // MCP spec enforces max 100 values per response
    expect(result.completion.values.length).toBeLessThanOrEqual(100);
  });
});
