/**
 * Integration test: ctx.client capability access through a real MCPServer + SDK Client
 *
 * Verifies the full pipeline:
 *   SDK Client initialize (with capabilities) →
 *   oninitialized stores clientInfo + clientCapabilities →
 *   ctx.client.* returns correct values inside tool, resource, and prompt callbacks
 *
 * NOTE on SDK limitations:
 *   The MCP SDK's `ClientCapabilitiesSchema` (Zod) does not include an `extensions`
 *   field and strips unknown keys by default. This means `extensions` sent via the
 *   SDK Client constructor are stripped before reaching the server. As a result,
 *   `ctx.client.extension()` and `ctx.client.supportsApps()` can only be tested
 *   for the "not supported" path via the SDK transport.
 *   Full `extension()`/`supportsApps()` behaviour (both true/false paths) is covered
 *   in tests/unit/server/client-capability-checker.test.ts.
 *
 *   To test the "supports MCP Apps" path end-to-end, this file injects the extension
 *   capability directly into the session after the handshake.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { z } from "zod";
import { MCPServer } from "../../src/server/index.js";
import { text, object } from "../../src/server/utils/response-helpers.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const MCP_UI_EXTENSION = "io.modelcontextprotocol/ui";
const MCP_UI_MIME = "text/html;profile=mcp-app";

const TEST_PORT = 3097;
const SERVER_URL = `http://localhost:${TEST_PORT}/mcp`;

// ---------------------------------------------------------------------------
// Captured values written inside callbacks, read by assertions
// ---------------------------------------------------------------------------

type CapturedClientContext = {
  info: { name?: string; version?: string };
  can_sampling: boolean;
  supportsApps: boolean;
  extension: Record<string, any> | undefined;
};

let capturedFromTool: CapturedClientContext | undefined;
let capturedFromResource: CapturedClientContext | undefined;
let capturedFromPrompt: CapturedClientContext | undefined;

// ---------------------------------------------------------------------------
// Shared server setup
// ---------------------------------------------------------------------------

describe("Client Capabilities Integration Tests", () => {
  let server: MCPServer;
  let client: Client;
  let transport: StreamableHTTPClientTransport;

  beforeAll(async () => {
    server = new MCPServer({
      name: "test-capabilities-server",
      version: "1.0.0",
    });

    // Tool that captures ctx.client values
    server.tool(
      {
        name: "echo-client-info",
        description: "Captures ctx.client values for assertions",
        schema: z.object({}),
      },
      async (_params, ctx) => {
        capturedFromTool = {
          info: ctx.client.info(),
          can_sampling: ctx.client.can("sampling"),
          supportsApps: ctx.client.supportsApps(),
          extension: ctx.client.extension(MCP_UI_EXTENSION),
        };
        return text("ok");
      }
    );

    // Resource that captures ctx.client values
    server.resource(
      {
        uri: "test://client-info",
        name: "client-info",
        description: "Captures ctx.client from a resource callback",
        mimeType: "application/json",
      },
      async (ctx) => {
        capturedFromResource = {
          info: ctx.client.info(),
          can_sampling: ctx.client.can("sampling"),
          supportsApps: ctx.client.supportsApps(),
          extension: ctx.client.extension(MCP_UI_EXTENSION),
        };
        return object({ captured: true });
      }
    );

    // Prompt that captures ctx.client values
    server.prompt({
      name: "client-info-prompt",
      description: "Captures ctx.client from a prompt callback",
      schema: z.object({}),
      cb: async (_params, ctx) => {
        capturedFromPrompt = {
          info: ctx.client.info(),
          can_sampling: ctx.client.can("sampling"),
          supportsApps: ctx.client.supportsApps(),
          extension: ctx.client.extension(MCP_UI_EXTENSION),
        };
        return {
          messages: [{ role: "user", content: { type: "text", text: "ok" } }],
        };
      },
    });

    await server.listen(TEST_PORT);
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Connect a client with standard SDK capabilities (sampling)
    transport = new StreamableHTTPClientTransport(new URL(SERVER_URL));
    client = new Client(
      { name: "test-client", version: "3.0.0" },
      { capabilities: { sampling: {} } }
    );
    await client.connect(transport);
  });

  afterAll(async () => {
    await client.close();
    await server.close?.();
  });

  // -----------------------------------------------------------------------
  // ctx.client.info() — populated from clientInfo in initialize handshake
  // -----------------------------------------------------------------------

  describe("ctx.client.info()", () => {
    it("returns the connecting client name from the initialize handshake", async () => {
      capturedFromTool = undefined;
      await client.callTool({ name: "echo-client-info", arguments: {} });
      expect(capturedFromTool!.info.name).toBe("test-client");
    });

    it("returns the connecting client version from the initialize handshake", async () => {
      capturedFromTool = undefined;
      await client.callTool({ name: "echo-client-info", arguments: {} });
      expect(capturedFromTool!.info.version).toBe("3.0.0");
    });
  });

  // -----------------------------------------------------------------------
  // ctx.client.can() — standard SDK capabilities pass through correctly
  // -----------------------------------------------------------------------

  describe("ctx.client.can()", () => {
    it("returns true for a capability the client advertised (sampling)", async () => {
      capturedFromTool = undefined;
      await client.callTool({ name: "echo-client-info", arguments: {} });
      expect(capturedFromTool!.can_sampling).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // ctx.client.supportsApps() / extension() — injected via session store
  //
  // The SDK Zod schema strips 'extensions' from ClientCapabilities before the
  // server stores them, so we cannot pass extensions through the SDK Client
  // constructor. Instead, we inject the capability directly into the session
  // to test the server-side ctx.client logic end-to-end.
  // -----------------------------------------------------------------------

  describe("ctx.client.supportsApps() — injected capability", () => {
    it("returns false when session has no extensions (default state)", async () => {
      capturedFromTool = undefined;
      await client.callTool({ name: "echo-client-info", arguments: {} });
      expect(capturedFromTool!.supportsApps).toBe(false);
    });

    it("returns true after injecting the MCP Apps extension into the session", async () => {
      // Inject MCP Apps extension capability into all active sessions
      const sessions: Map<string, any> = (server as any).sessions;
      for (const [, session] of sessions) {
        session.clientCapabilities = {
          ...(session.clientCapabilities || {}),
          extensions: {
            [MCP_UI_EXTENSION]: { mimeTypes: [MCP_UI_MIME] },
          },
        };
      }

      capturedFromTool = undefined;
      await client.callTool({ name: "echo-client-info", arguments: {} });
      expect(capturedFromTool!.supportsApps).toBe(true);
      expect(capturedFromTool!.extension).toEqual({ mimeTypes: [MCP_UI_MIME] });
    });

    it("restores to false after removing the injected extension", async () => {
      // Remove only the injected extension, preserving other capabilities (e.g. sampling)
      const sessions: Map<string, any> = (server as any).sessions;
      for (const [, session] of sessions) {
        const { extensions: _removed, ...rest } =
          session.clientCapabilities || {};
        session.clientCapabilities = rest;
      }

      capturedFromTool = undefined;
      await client.callTool({ name: "echo-client-info", arguments: {} });
      expect(capturedFromTool!.supportsApps).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Resource callbacks — ctx.client is available
  // -----------------------------------------------------------------------

  describe("Resource callbacks — ctx.client is available", () => {
    it("ctx.client.info().name is populated in a resource callback", async () => {
      capturedFromResource = undefined;
      await client.readResource({ uri: "test://client-info" });
      expect(capturedFromResource!.info.name).toBe("test-client");
    });

    it("ctx.client.can() returns correct value in a resource callback", async () => {
      capturedFromResource = undefined;
      await client.readResource({ uri: "test://client-info" });
      expect(capturedFromResource!.can_sampling).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Prompt callbacks — ctx.client is available
  // -----------------------------------------------------------------------

  describe("Prompt callbacks — ctx.client is available", () => {
    it("ctx.client.info().name is populated in a prompt callback", async () => {
      capturedFromPrompt = undefined;
      await client.getPrompt({ name: "client-info-prompt", arguments: {} });
      expect(capturedFromPrompt!.info.name).toBe("test-client");
    });

    it("ctx.client.can() returns correct value in a prompt callback", async () => {
      capturedFromPrompt = undefined;
      await client.getPrompt({ name: "client-info-prompt", arguments: {} });
      expect(capturedFromPrompt!.can_sampling).toBe(true);
    });
  });
});
