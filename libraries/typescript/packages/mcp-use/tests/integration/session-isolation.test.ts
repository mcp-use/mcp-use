/**
 * Integration test: ctx.client session isolation across concurrent HTTP sessions
 *
 * Regression test for the bug where the tool handler resolved the wrong session
 * (first in Map insertion order via findSessionContext fallback), causing
 * ctx.client.info() / ctx.client.capabilities() to return the first-connected
 * client's data to all subsequent clients.
 *
 * Fix: getServerForSession(sessionId) now uses sessions.get(sessionId) directly
 * instead of scanning the Map. This test connects two clients with distinct
 * identities and verifies each sees only its own data — sequentially and
 * concurrently.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { z } from "zod";
import { MCPServer } from "../../src/server/index.js";
import { object } from "../../src/server/utils/response-helpers.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const TEST_PORT = 3096;
const SERVER_URL = `http://localhost:${TEST_PORT}/mcp`;

// ---------------------------------------------------------------------------
// Helper: parse the structured JSON content returned by the "who-am-i" tool
// ---------------------------------------------------------------------------

function parseResult(result: Awaited<ReturnType<Client["callTool"]>>): {
  info: { name?: string; version?: string };
  caps: Record<string, unknown>;
} {
  const content = result.content as Array<{ type: string; text?: string }>;
  const textItem = content.find((c) => c.type === "text");
  if (!textItem?.text) throw new Error("No text content in result");
  return JSON.parse(textItem.text);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("Session Isolation — ctx.client does not bleed across sessions", () => {
  let server: MCPServer;
  let clientAlpha: Client;
  let transportAlpha: StreamableHTTPClientTransport;
  let clientBeta: Client;
  let transportBeta: StreamableHTTPClientTransport;

  beforeAll(async () => {
    server = new MCPServer({
      name: "test-session-isolation-server",
      version: "1.0.0",
    });

    // Single tool that returns the calling client's own identity.
    // The session mixing bug caused this to return the FIRST client's data
    // regardless of which client actually made the call.
    server.tool(
      {
        name: "who-am-i",
        description:
          "Returns ctx.client.info() and ctx.client.capabilities() for the calling session",
        schema: z.object({}),
      },
      async (_params, ctx) => {
        return object({
          info: ctx.client.info(),
          caps: ctx.client.capabilities(),
        });
      }
    );

    await server.listen(TEST_PORT);
    // Allow the server to fully start before connecting clients
    await new Promise((resolve) => setTimeout(resolve, 100));

    // client-alpha: advertises sampling capability
    transportAlpha = new StreamableHTTPClientTransport(new URL(SERVER_URL));
    clientAlpha = new Client(
      { name: "client-alpha", version: "1.0.0" },
      { capabilities: { sampling: {} } }
    );
    await clientAlpha.connect(transportAlpha);

    // client-beta: advertises roots capability — deliberately different from alpha
    transportBeta = new StreamableHTTPClientTransport(new URL(SERVER_URL));
    clientBeta = new Client(
      { name: "client-beta", version: "2.0.0" },
      { capabilities: { roots: { listChanged: true } } }
    );
    await clientBeta.connect(transportBeta);
  });

  afterAll(async () => {
    await clientAlpha.close();
    await clientBeta.close();
    await (server as any).close?.();
  });

  // -------------------------------------------------------------------------
  // Sequential isolation
  // -------------------------------------------------------------------------

  describe("Sequential calls — each client sees its own identity", () => {
    it("client-alpha sees its own name", async () => {
      const result = await clientAlpha.callTool({
        name: "who-am-i",
        arguments: {},
      });
      const { info } = parseResult(result);
      expect(info.name).toBe("client-alpha");
    });

    it("client-alpha sees its own version", async () => {
      const result = await clientAlpha.callTool({
        name: "who-am-i",
        arguments: {},
      });
      const { info } = parseResult(result);
      expect(info.version).toBe("1.0.0");
    });

    it("client-alpha sees sampling in its capabilities", async () => {
      const result = await clientAlpha.callTool({
        name: "who-am-i",
        arguments: {},
      });
      const { caps } = parseResult(result);
      expect(caps).toHaveProperty("sampling");
      expect(caps).not.toHaveProperty("roots");
    });

    it("client-beta sees its own name", async () => {
      const result = await clientBeta.callTool({
        name: "who-am-i",
        arguments: {},
      });
      const { info } = parseResult(result);
      expect(info.name).toBe("client-beta");
    });

    it("client-beta sees its own version", async () => {
      const result = await clientBeta.callTool({
        name: "who-am-i",
        arguments: {},
      });
      const { info } = parseResult(result);
      expect(info.version).toBe("2.0.0");
    });

    it("client-beta sees roots in its capabilities", async () => {
      const result = await clientBeta.callTool({
        name: "who-am-i",
        arguments: {},
      });
      const { caps } = parseResult(result);
      expect(caps).toHaveProperty("roots");
      expect(caps).not.toHaveProperty("sampling");
    });
  });

  // -------------------------------------------------------------------------
  // Concurrent isolation
  // Direct reproduction of the race condition: before the fix, the second
  // client's call would resolve the FIRST session in the Map and return
  // client-alpha's data for both calls.
  // -------------------------------------------------------------------------

  describe("Concurrent calls — no session bleeding under parallel requests", () => {
    it("both clients get their own name when calling simultaneously", async () => {
      const [alphaResult, betaResult] = await Promise.all([
        clientAlpha.callTool({ name: "who-am-i", arguments: {} }),
        clientBeta.callTool({ name: "who-am-i", arguments: {} }),
      ]);

      const alpha = parseResult(alphaResult);
      const beta = parseResult(betaResult);

      expect(alpha.info.name).toBe("client-alpha");
      expect(beta.info.name).toBe("client-beta");
    });

    it("both clients get their own capabilities when calling simultaneously", async () => {
      const [alphaResult, betaResult] = await Promise.all([
        clientAlpha.callTool({ name: "who-am-i", arguments: {} }),
        clientBeta.callTool({ name: "who-am-i", arguments: {} }),
      ]);

      const alpha = parseResult(alphaResult);
      const beta = parseResult(betaResult);

      expect(alpha.caps).toHaveProperty("sampling");
      expect(alpha.caps).not.toHaveProperty("roots");

      expect(beta.caps).toHaveProperty("roots");
      expect(beta.caps).not.toHaveProperty("sampling");
    });

    it("repeated concurrent calls remain stable across multiple rounds", async () => {
      for (let i = 0; i < 5; i++) {
        const [alphaResult, betaResult] = await Promise.all([
          clientAlpha.callTool({ name: "who-am-i", arguments: {} }),
          clientBeta.callTool({ name: "who-am-i", arguments: {} }),
        ]);

        const alpha = parseResult(alphaResult);
        const beta = parseResult(betaResult);

        expect(alpha.info.name).toBe("client-alpha");
        expect(beta.info.name).toBe("client-beta");
      }
    });
  });
});
