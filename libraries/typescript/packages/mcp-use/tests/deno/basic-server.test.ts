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

import { createMCPServer } from "npm:mcp-use/server";
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
    cb: async ({ message }: { message: string }) => {
      return {
        content: [{ type: "text", text: `Echo: ${message}` }],
      };
    },
  });

  // Verify server exists
  assertExists(server);
});

Deno.test("MCP Server - getHandler returns fetch handler", async () => {
  const server = createMCPServer("test-handler-server", {
    version: "1.0.0",
    description: "Test handler generation",
  });

  server.tool({
    name: "test-tool",
    description: "A test tool",
    cb: async () => {
      return { content: [{ type: "text", text: "Success" }] };
    },
  });

  // Get the handler
  const handler = await server.getHandler({ provider: "deno-deploy" });

  // Verify handler is a function
  assertEquals(typeof handler, "function");
});

Deno.test("MCP Server - Handler responds to requests", async () => {
  const server = createMCPServer("test-response-server", {
    version: "1.0.0",
    description: "Test request handling",
  });

  server.tool({
    name: "greet",
    description: "Greet a person",
    inputs: [
      {
        name: "name",
        type: "string",
        description: "Name to greet",
        required: true,
      },
    ],
    cb: async ({ name }: { name: string }) => {
      return {
        content: [{ type: "text", text: `Hello, ${name}!` }],
      };
    },
  });

  const handler = await server.getHandler({ provider: "deno-deploy" });

  // Create a test request to the health endpoint
  const request = new Request("http://localhost:3000/health", {
    method: "GET",
  });

  const response = await handler(request);

  // Verify response
  assertExists(response);
  assertEquals(response instanceof Response, true);
});

Deno.test("MCP Server - Supabase provider path handling", async () => {
  const server = createMCPServer("test-supabase-server", {
    version: "1.0.0",
    description: "Test Supabase path handling",
  });

  const handler = await server.getHandler({ provider: "supabase" });

  // Test that handler works with Supabase-style paths
  const request = new Request(
    "http://localhost:3000/functions/v1/mcp-server/health",
    {
      method: "GET",
    }
  );

  const response = await handler(request);

  // Verify response
  assertExists(response);
  assertEquals(response instanceof Response, true);
});

Deno.test("MCP Server - CORS headers for Deno", async () => {
  const server = createMCPServer("test-cors-server", {
    version: "1.0.0",
    description: "Test CORS headers",
  });

  const handler = await server.getHandler({ provider: "deno-deploy" });

  // Create an OPTIONS request (CORS preflight)
  const request = new Request("http://localhost:3000/mcp", {
    method: "OPTIONS",
    headers: {
      Origin: "https://example.com",
      "Access-Control-Request-Method": "POST",
    },
  });

  const response = await handler(request);

  // Verify CORS headers are present
  assertExists(response);
  assertEquals(response instanceof Response, true);

  // Check for CORS headers
  const corsHeader = response.headers.get("Access-Control-Allow-Origin");
  assertExists(corsHeader);
});
