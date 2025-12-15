/**
 * Deno Runtime Tests for MCP Server (Current Commit)
 *
 * Tests that the LOCALLY BUILT mcp-use package works correctly in Deno
 * environment including Deno Deploy and Supabase Edge Functions compatibility.
 *
 * These tests use npm: specifier to import the locally installed package,
 * which matches real-world usage in Supabase Edge Functions and Deno Deploy.
 *
 * Run from CI with the local package installed in node_modules.
 */

/* globals Deno */

import { MCPServer, text } from "mcp-use/server";
import z from "zod/v4";
import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.220.0/assert/mod.ts";

Deno.test("MCP Server - Create and register tool", async () => {
  const server = new MCPServer({
    name: "test-deno-server",
    version: "1.0.0",
    description: "Test MCP server for Deno environment",
  });

  // Register a simple tool
  server.tool(
    {
      name: "echo",
      description: "Echo back the input message",
      schema: z.object({
        message: z.string(),
      }),
    },
    async ({ message }) => {
      return text(`Echo: ${message}`);
    }
  );

  // Verify server exists and has expected methods
  assertExists(server);
  assertEquals(typeof server.tool, "function");
  assertEquals(typeof server.resource, "function");
  assertEquals(typeof server.prompt, "function");
  console.log("✓ Server created and APIs accessible in Deno");
});

Deno.test("MCP Server - Resource registration", async () => {
  const server = new MCPServer({
    name: "test-resource-server",
    version: "1.0.0",
    description: "Test resource registration",
  });

  // Register a resource
  server.resource(
    {
      uri: "test://example",
      name: "Test Resource",
      description: "A test resource",
    },
    async () => text("Test content")
  );

  // Verify server exists
  assertExists(server);
  console.log("✓ Resource registration works in Deno");
});

Deno.test("MCP Server - Prompt registration", async () => {
  const server = new MCPServer({
    name: "test-prompt-server",
    version: "1.0.0",
    description: "Test prompt registration",
  });

  // Register a prompt
  server.prompt(
    {
      name: "test-prompt",
      description: "A test prompt",
      schema: z.object({
        topic: z.string(),
      }),
    },
    async ({ topic }) => {
      return text(`Tell me about ${topic}`);
    }
  );

  // Verify server exists
  assertExists(server);
  console.log("✓ Prompt registration works in Deno");
});

Deno.test("MCP Server - Multiple registrations", async () => {
  const server = new MCPServer({
    name: "test-multi-server",
    version: "1.0.0",
    description: "Test multiple registrations",
  });

  // Register multiple items
  server.tool(
    {
      name: "tool1",
      description: "First tool",
    },
    async () => text("Tool 1")
  );

  server.tool(
    {
      name: "tool2",
      description: "Second tool",
    },
    async () => text("Tool 2")
  );

  server.resource(
    {
      uri: "test://res1",
      name: "Resource 1",
    },
    async () => text("Content 1")
  );

  // Verify server exists
  assertExists(server);
  console.log("✓ Multiple registrations work in Deno");
});

Deno.test("MCP Server - API method existence", async () => {
  const server = new MCPServer({
    name: "test-api-server",
    version: "1.0.0",
    description: "Test API methods exist",
  });

  // Verify all expected methods exist
  assertEquals(
    typeof server.tool,
    "function",
    "server.tool should be a function"
  );
  assertEquals(
    typeof server.resource,
    "function",
    "server.resource should be a function"
  );
  assertEquals(
    typeof server.prompt,
    "function",
    "server.prompt should be a function"
  );
  assertEquals(
    typeof server.getHandler,
    "function",
    "server.getHandler should be a function"
  );
  assertEquals(
    typeof server.listen,
    "function",
    "server.listen should be a function"
  );

  console.log("✓ All expected API methods exist in Deno environment");
  console.log("✅ Deno compatibility verified - mcp-use works in Deno runtime");
});
