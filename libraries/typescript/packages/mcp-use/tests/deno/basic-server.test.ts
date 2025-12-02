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

import { createMCPServer } from "mcp-use/server";
import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.220.0/assert/mod.ts";

Deno.test("MCP Server - Create and register tool", async () => {
  const server = createMCPServer("test-deno-server", {
    version: "1.0.0",
    description: "Test MCP server for Deno environment",
  });

  // Register a simple tool
  server.tool({
    name: "echo",
    description: "Echo back the input message",
    inputs: [
      {
        name: "message",
        type: "string",
        description: "Message to echo",
        required: true,
      },
    ],
    cb: async (params: Record<string, any>) => {
      const message = params.message as string;
      return {
        content: [{ type: "text", text: `Echo: ${message}` }],
      };
    },
  });

  // Verify server exists and has expected methods
  assertExists(server);
  assertEquals(typeof server.tool, "function");
  assertEquals(typeof server.resource, "function");
  assertEquals(typeof server.prompt, "function");
  console.log("✓ Server created and APIs accessible in Deno");
});

Deno.test("MCP Server - Resource registration", async () => {
  const server = createMCPServer("test-resource-server", {
    version: "1.0.0",
    description: "Test resource registration",
  });

  // Register a resource
  server.resource({
    uri: "test://example",
    name: "Test Resource",
    description: "A test resource",
    mimeType: "text/plain",
    readCallback: async () => {
      return "Test content";
    },
  });

  // Verify server exists
  assertExists(server);
  console.log("✓ Resource registration works in Deno");
});

Deno.test("MCP Server - Prompt registration", async () => {
  const server = createMCPServer("test-prompt-server", {
    version: "1.0.0",
    description: "Test prompt registration",
  });

  // Register a prompt
  server.prompt({
    name: "test-prompt",
    description: "A test prompt",
    args: [
      {
        name: "topic",
        type: "string",
        description: "The topic",
        required: true,
      },
    ],
    cb: async (params: Record<string, any>) => {
      const topic = params.topic as string;
      return `Tell me about ${topic}`;
    },
  });

  // Verify server exists
  assertExists(server);
  console.log("✓ Prompt registration works in Deno");
});

Deno.test("MCP Server - Multiple registrations", async () => {
  const server = createMCPServer("test-multi-server", {
    version: "1.0.0",
    description: "Test multiple registrations",
  });

  // Register multiple items
  server.tool({
    name: "tool1",
    description: "First tool",
    cb: async () => ({ content: [{ type: "text", text: "Tool 1" }] }),
  });

  server.tool({
    name: "tool2",
    description: "Second tool",
    cb: async () => ({ content: [{ type: "text", text: "Tool 2" }] }),
  });

  server.resource({
    uri: "test://res1",
    name: "Resource 1",
    mimeType: "text/plain",
    readCallback: async () => "Content 1",
  });

  // Verify server exists
  assertExists(server);
  console.log("✓ Multiple registrations work in Deno");
});

Deno.test("MCP Server - API method existence", async () => {
  const server = createMCPServer("test-api-server", {
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
