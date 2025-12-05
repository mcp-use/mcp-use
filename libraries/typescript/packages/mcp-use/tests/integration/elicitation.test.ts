/**
 * Integration tests for elicitation
 * Tests the full client-server elicitation flow
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { z } from "zod";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import { MCPServer } from "../../src/server/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  ElicitRequestFormParams,
  ElicitRequestURLParams,
  ElicitResult,
} from "@modelcontextprotocol/sdk/types.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";

describe("Elicitation Integration Tests", () => {
  let server: any;
  let client: Client;
  let transport: StreamableHTTPClientTransport;
  const TEST_PORT = 3099;
  const SERVER_URL = `http://localhost:${TEST_PORT}/mcp`;

  beforeAll(async () => {
    // Create test server
    server = new MCPServer({
      name: "test-elicitation-server",
      version: "1.0.0",
    });

    // Add test tools
    server.tool(
      {
        name: "form-mode-simple",
        description: "Simple form mode elicitation",
        inputs: [],
      },
      async (_: any, ctx: any) => {
        const result = await ctx.elicit(
          "Enter your name",
          z.object({
            name: z.string().default("Anonymous"),
          })
        );

        if (result.action === "accept") {
          return {
            content: [{ type: "text", text: `Hello, ${result.data.name}!` }],
          };
        }

        return {
          content: [{ type: "text", text: "No name provided" }],
        };
      }
    );

    server.tool(
      {
        name: "form-mode-validation",
        description: "Form mode with validation",
        inputs: [],
      },
      async (_: any, ctx: any) => {
        const result = await ctx.elicit(
          "Enter user details",
          z.object({
            name: z.string().min(2),
            age: z.number().min(0).max(150),
            email: z.string().email(),
          })
        );

        if (result.action === "accept") {
          return {
            content: [
              {
                type: "text",
                text: `User: ${result.data.name}, ${result.data.age}`,
              },
            ],
          };
        }

        return {
          content: [{ type: "text", text: "Cancelled" }],
        };
      }
    );

    server.tool(
      {
        name: "url-mode-test",
        description: "URL mode elicitation",
        inputs: [],
      },
      async (_: any, ctx: any) => {
        const result = await ctx.elicit(
          "Please authorize",
          "https://example.com/oauth"
        );

        if (result.action === "accept") {
          return {
            content: [{ type: "text", text: "Authorization successful" }],
          };
        }

        return {
          content: [{ type: "text", text: "Authorization failed" }],
        };
      }
    );

    server.tool(
      {
        name: "with-timeout",
        description: "Elicitation with timeout",
        inputs: [],
      },
      async (_: any, ctx: any) => {
        const result = await ctx.elicit(
          "Quick response",
          z.object({ answer: z.string() }),
          { timeout: 5000 } // 5 seconds
        );

        if (result.action === "accept") {
          return {
            content: [{ type: "text", text: `Answer: ${result.data.answer}` }],
          };
        }

        return {
          content: [{ type: "text", text: "No answer" }],
        };
      }
    );

    // Start server
    await server.listen(TEST_PORT);

    // Create client
    transport = new StreamableHTTPClientTransport(new URL(SERVER_URL));
    client = new Client(
      { name: "test-client", version: "1.0.0" },
      {
        capabilities: {
          roots: { listChanged: true },
          elicitation: { form: {}, url: {} },
        },
      }
    );

    await client.connect(transport);
  });

  afterAll(async () => {
    await client.close();
    // Server cleanup if needed
  });

  describe("Form Mode", () => {
    it("handles simple form mode elicitation", async () => {
      // Set up handler to accept with data
      client.setRequestHandler(ElicitRequestSchema, async (request: any) => {
        expect(request.params.mode).toBe("form");
        expect(request.params.message).toBe("Enter your name");
        expect(request.params.requestedSchema).toHaveProperty("properties");

        return {
          action: "accept",
          data: { name: "Test User" },
        } as ElicitResult;
      });

      const result = await client.callTool({
        name: "form-mode-simple",
        arguments: {},
      });

      expect(result.content[0].text).toContain("Hello, Test User!");
    });

    it("uses default values when field missing", async () => {
      client.setRequestHandler(ElicitRequestSchema, async (request: any) => {
        return {
          action: "accept",
          data: {}, // Empty - should use default
        } as ElicitResult;
      });

      const result = await client.callTool({
        name: "form-mode-simple",
        arguments: {},
      });

      expect(result.content[0].text).toContain("Anonymous");
    });

    it("handles user decline", async () => {
      client.setRequestHandler(ElicitRequestSchema, async (request: any) => {
        return {
          action: "decline",
        } as ElicitResult;
      });

      const result = await client.callTool({
        name: "form-mode-simple",
        arguments: {},
      });

      expect(result.content[0].text).toBe("No name provided");
    });

    it("handles user cancel", async () => {
      client.setRequestHandler(ElicitRequestSchema, async (request: any) => {
        return {
          action: "cancel",
        } as ElicitResult;
      });

      const result = await client.callTool({
        name: "form-mode-simple",
        arguments: {},
      });

      expect(result.content[0].text).toBe("No name provided");
    });
  });

  describe("Server-Side Validation", () => {
    it("accepts valid data", async () => {
      client.setRequestHandler(ElicitRequestSchema, async (request: any) => {
        return {
          action: "accept",
          data: {
            name: "Valid User",
            age: 30,
            email: "valid@example.com",
          },
        } as ElicitResult;
      });

      const result = await client.callTool({
        name: "form-mode-validation",
        arguments: {},
      });

      expect(result.content[0].text).toContain("Valid User");
      expect(result.isError).toBeFalsy();
    });

    it("rejects invalid age (out of range)", async () => {
      client.setRequestHandler(ElicitRequestSchema, async (request: any) => {
        return {
          action: "accept",
          data: {
            name: "Test User",
            age: 200, // Exceeds max of 150
            email: "test@example.com",
          },
        } as ElicitResult;
      });

      const result = await client.callTool({
        name: "form-mode-validation",
        arguments: {},
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("validation failed");
      expect(result.content[0].text).toContain("too_big");
    });

    it("rejects invalid email format", async () => {
      client.setRequestHandler(ElicitRequestSchema, async (request: any) => {
        return {
          action: "accept",
          data: {
            name: "Test User",
            age: 25,
            email: "not-an-email",
          },
        } as ElicitResult;
      });

      const result = await client.callTool({
        name: "form-mode-validation",
        arguments: {},
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("validation failed");
      expect(result.content[0].text).toContain("email");
    });

    it("rejects wrong data types", async () => {
      client.setRequestHandler(ElicitRequestSchema, async (request: any) => {
        return {
          action: "accept",
          data: {
            name: "Test User",
            age: "not a number",
            email: "test@example.com",
          },
        } as ElicitResult;
      });

      const result = await client.callTool({
        name: "form-mode-validation",
        arguments: {},
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("validation failed");
      expect(result.content[0].text).toContain("invalid_type");
    });

    it("rejects missing required fields", async () => {
      client.setRequestHandler(ElicitRequestSchema, async (request: any) => {
        return {
          action: "accept",
          data: {
            age: 25,
            // name is missing
          },
        } as ElicitResult;
      });

      const result = await client.callTool({
        name: "form-mode-validation",
        arguments: {},
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("validation failed");
    });
  });

  describe("URL Mode", () => {
    it("handles URL mode elicitation", async () => {
      client.setRequestHandler(ElicitRequestSchema, async (request: any) => {
        expect(request.params.mode).toBe("url");
        expect(request.params.url).toBe("https://example.com/oauth");
        expect(request.params.elicitationId).toBeTruthy();

        return {
          action: "accept",
        } as ElicitResult;
      });

      const result = await client.callTool({
        name: "url-mode-test",
        arguments: {},
      });

      expect(result.content[0].text).toBe("Authorization successful");
    });

    it("handles URL mode decline", async () => {
      client.setRequestHandler(ElicitRequestSchema, async (request: any) => {
        return {
          action: "decline",
        } as ElicitResult;
      });

      const result = await client.callTool({
        name: "url-mode-test",
        arguments: {},
      });

      expect(result.content[0].text).toBe("Authorization failed");
    });

    it("generates unique elicitation IDs", async () => {
      const ids: string[] = [];

      client.setRequestHandler(ElicitRequestSchema, async (request: any) => {
        ids.push(request.params.elicitationId);
        return { action: "accept" } as ElicitResult;
      });

      // Call multiple times
      await client.callTool({ name: "url-mode-test", arguments: {} });
      await client.callTool({ name: "url-mode-test", arguments: {} });
      await client.callTool({ name: "url-mode-test", arguments: {} });

      // All IDs should be unique
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  describe("Timeout Handling", () => {
    it("supports timeout option", async () => {
      client.setRequestHandler(ElicitRequestSchema, async (request: any) => {
        return {
          action: "accept",
          data: { answer: "Quick response" },
        } as ElicitResult;
      });

      const result = await client.callTool({
        name: "with-timeout",
        arguments: {},
      });

      expect(result.content[0].text).toContain("Quick response");
    });
  });

  describe("Type Safety", () => {
    it("schema conversion produces valid JSON schema", () => {
      const schema = z.object({
        stringField: z.string(),
        numberField: z.number(),
        boolField: z.boolean(),
        enumField: z.enum(["a", "b", "c"]),
        optionalField: z.string().optional(),
        defaultField: z.string().default("default"),
      });

      const jsonSchema = toJsonSchemaCompat(schema);

      expect(jsonSchema.type).toBe("object");
      expect(jsonSchema.properties.stringField.type).toBe("string");
      expect(jsonSchema.properties.numberField.type).toBe("number");
      expect(jsonSchema.properties.boolField.type).toBe("boolean");
      expect(jsonSchema.properties.enumField.enum).toEqual(["a", "b", "c"]);
      expect(jsonSchema.properties.defaultField.default).toBe("default");
      expect(jsonSchema.required).toContain("stringField");
      expect(jsonSchema.required).not.toContain("optionalField");
    });
  });
});
