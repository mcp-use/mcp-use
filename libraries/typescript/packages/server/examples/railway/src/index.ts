/**
 * @mcp-use/server on a long-lived Node server (Railway-style).
 *
 * `MCPServer.listen()` starts a persistent `node:http` listener, but the MCP
 * protocol layer underneath stays stateless: every request builds a fresh SDK
 * server from the tool/resource registry (see ../../../SPEC.md). The process
 * living across requests is purely a deployment convenience — no MCP session
 * state lives in it, so any replica behind a load balancer can serve any
 * request with no session affinity.
 */
import { MCPServer } from "@mcp-use/server";
import { z } from "zod";

const BASE_PATH = "/mcp";

// Railway injects RAILWAY_PUBLIC_DOMAIN — a bare hostname, e.g.
// "my-app.up.railway.app" (no scheme, no port) — for the service's public
// route, and PORT for the port to bind. The framework binds 127.0.0.1 with
// Host validation locked to localhost by default (DNS-rebinding protection);
// serving publicly is an explicit `host: "0.0.0.0"` + `allowedHosts` opt-in.
// Locally (no Railway env), fall back to that secure-by-default localhost bind.
const publicDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
const networking = publicDomain
  ? { host: "0.0.0.0", allowedHosts: [publicDomain] }
  : {};

const server = new MCPServer({
  name: "railway-example",
  version: "1.0.0",
  title: "Railway Example Server",
  description:
    "Demonstrates @mcp-use/server deployed as a long-lived Node process.",
  basePath: BASE_PATH,
  ...networking,
});

// Module-scope state: survives across requests because the Node process is
// long-lived, even though the MCP protocol layer is rebuilt fresh per request
// (see server-status below — it reads this to make that distinction visible).
let requestsHandled = 0;

server.tool(
  {
    name: "roll-dice",
    title: "Roll dice",
    description: "Roll one or more dice and report each result plus the total.",
    schema: z.object({
      sides: z.number().int().min(2).max(1000).default(6).describe("Sides per die"),
      count: z.number().int().min(1).max(20).default(1).describe("Number of dice to roll"),
    }),
    outputSchema: z.object({
      rolls: z.array(z.number().int()),
      total: z.number().int(),
    }),
    annotations: { readOnlyHint: true },
  },
  async ({ sides, count }) => {
    const rolls = Array.from(
      { length: count },
      () => 1 + Math.floor(Math.random() * sides)
    );
    const total = rolls.reduce((sum, roll) => sum + roll, 0);
    const data = { rolls, total };
    // Tools with an outputSchema return the payload twice: machine-readable
    // structuredContent plus a text serialization for content-only clients.
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: data,
    };
  }
);

server.tool(
  {
    name: "server-status",
    title: "Server status",
    description:
      "Report this process's uptime and request count — the one kind of " +
      "state a long-lived listener adds. It is process-level, not " +
      "MCP-session-level: the protocol handshake itself carries none of it.",
    outputSchema: z.object({
      uptimeSeconds: z.number(),
      requestsHandled: z.number().int(),
      pid: z.number().int(),
    }),
    annotations: { readOnlyHint: true },
  },
  async () => {
    requestsHandled += 1;
    const data = {
      uptimeSeconds: Math.round(process.uptime()),
      requestsHandled,
      pid: process.pid,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: data,
    };
  }
);

server.resource(
  {
    name: "about",
    uri: "config://about",
    description: "Static metadata about this example server",
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify({
          name: "railway-example",
          transport: "streamable-http",
          basePath: BASE_PATH,
        }),
      },
    ],
  })
);

const port = Number(process.env.PORT ?? 3000);
const started = await server.listen(port);

// `listen()`'s returned url is always a localhost label, even when bound to
// 0.0.0.0 for public serving — reconstruct the real public URL ourselves.
const publicUrl = publicDomain ? `https://${publicDomain}${BASE_PATH}` : started.url;
console.log(`MCP server listening on port ${started.port}`);
console.log(`MCP endpoint: ${publicUrl}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`Received ${signal}, closing server...`);
    server
      .close()
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        console.error("Error during shutdown:", err);
        process.exit(1);
      });
  });
}
