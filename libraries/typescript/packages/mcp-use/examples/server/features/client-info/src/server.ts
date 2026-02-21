/**
 * Client Info & Capability Access Example
 *
 * Demonstrates ctx.client — the per-connection client information object
 * available in every tool, resource, and prompt callback.
 *
 * Methods shown:
 *   ctx.client.info()          — { name?, version? } from the initialize handshake
 *   ctx.client.capabilities()  — full capabilities object advertised by the client
 *   ctx.client.can(cap)        — check a top-level capability (sampling, elicitation, …)
 *   ctx.client.extension(id)   — raw settings object for an MCP extension (SEP-1724)
 *   ctx.client.supportsApps()  — convenience check for MCP Apps (SEP-1865)
 */

import { MCPServer, object, text, widget } from "mcp-use/server";
import z from "zod";

const server = new MCPServer({
  name: "client-info-example-server",
  version: "1.0.0",
  description:
    "Demonstrates ctx.client — access client identity and capabilities from any tool, resource, or prompt callback.",
});

// ---------------------------------------------------------------------------
// Tool 1: who-is-connected
// Returns a human-readable summary of the connecting client.
// ---------------------------------------------------------------------------

server.tool(
  {
    name: "who-is-connected",
    description:
      "Returns a formatted summary of the MCP client currently connected to this server: name, version, advertised capabilities, and MCP Apps support.",
    schema: z.object({}),
  },
  async (_params, ctx) => {
    // console.log("[who-is-connected] ctx.client", ctx.req.raw.headers);
    const { name, version } = ctx.client.info();
    const caps = ctx.client.capabilities();
    const capKeys = Object.keys(caps);

    const lines = [
      `Client: ${[name, version].filter(Boolean).join(" ") || "unknown"}`,
      `Capabilities: ${capKeys.length ? capKeys.join(", ") : "none advertised"}`,
      `MCP Apps support (SEP-1865): ${ctx.client.supportsApps() ? "yes ✓" : "no"}`,
    ];

    const response = lines.join("\n");
    console.log("[who-is-connected]\n" + response);
    return text(response);
  }
);

// ---------------------------------------------------------------------------
// Tool 2: get-capabilities
// Returns the full capabilities as structured JSON — useful for inspection
// by a model or the MCP Inspector UI.
// ---------------------------------------------------------------------------

server.tool(
  {
    name: "get-capabilities",
    description:
      "Returns the full capabilities object advertised by the connected client, including any MCP extensions such as io.modelcontextprotocol/ui (SEP-1865).",
    schema: z.object({}),
  },
  async (_params, ctx) => {
    const info = ctx.client.info();
    const caps = ctx.client.capabilities();

    const response = {
      clientInfo: {
        name: info.name ?? null,
        version: info.version ?? null,
      },
      capabilities: caps,
      supportsApps: ctx.client.supportsApps(),
      // The raw SEP-1865 extension settings, or null if the client does not advertise it
      mcpAppsExtension:
        ctx.client.extension("io.modelcontextprotocol/ui") ?? null,
    };

    console.log("[get-capabilities]", JSON.stringify(response, null, 2));
    return object(response);
  }
);

// ---------------------------------------------------------------------------
// Tool 3: adaptive-greeting
// The primary use-case pattern: return a widget for MCP Apps clients and
// plain text for all other clients.
// ---------------------------------------------------------------------------

server.tool(
  {
    name: "adaptive-greeting",
    description:
      "Greets the user. Returns a rich widget for MCP Apps-capable clients (Claude, Goose, …) and plain text for all other clients.",
    schema: z.object({
      name: z.string().describe("The name to greet"),
    }),
  },
  async ({ name }, ctx) => {
    const { name: clientName, version: clientVersion } = ctx.client.info();
    const clientLabel =
      [clientName, clientVersion].filter(Boolean).join(" ") || "unknown client";

    if (ctx.client.supportsApps()) {
      // MCP Apps path — return a widget; the host renders it as an interactive UI.
      // The output field is the text-only fallback that the model sees.
      const summary = `Hello, ${name}! (rendered as MCP Apps widget via ${clientLabel})`;
      console.log(`[adaptive-greeting] MCP Apps path → widget | ${summary}`);
      return widget({
        props: {
          greeting: `Hello, ${name}!`,
          clientName: clientLabel,
          protocol: "mcp-apps",
        },
        output: text(summary),
      });
    }

    // Plain-text path — works with any MCP client.
    const summary = `Hello, ${name}! You are connected via ${clientLabel}, which does not advertise MCP Apps support.`;
    console.log(`[adaptive-greeting] plain-text path → "${summary}"`);
    return text(summary);
  }
);

// ---------------------------------------------------------------------------
// Start the server
// ---------------------------------------------------------------------------

await server.listen();
