/** Shared CLI assertions, raw MCP requests, and polling. */
import { readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { fetchWithTimeout as fetch } from "../support/requests.js";
export { waitFor } from "../support/requests.js";

/** Bind the basic fixture's add tool to a named view for CLI error tests. */
export function bindBasicToolToView(cwd: string, viewName: string): void {
  const entry = join(cwd, "src", "index.ts");
  const source = readFileSync(entry, "utf8");
  writeFileSync(
    entry,
    source.replace(
      'description: "Add two numbers",',
      [
        'description: "Add two numbers",',
        "    outputSchema: z.object({ result: z.number() }),",
        `    view: { name: ${JSON.stringify(viewName)} },`,
      ].join("\n")
    )
  );
}

/** The per-request _meta envelope required by the stateless 2026-07-28 wire. */
const META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": { name: "cli-test", version: "0.0.0" },
  "io.modelcontextprotocol/clientCapabilities": {},
};

/** `_meta` envelope with MCP Apps UI extension advertised. */
const META_UI = {
  ...META,
  "io.modelcontextprotocol/clientCapabilities": {
    extensions: {
      "io.modelcontextprotocol/ui": {
        mimeTypes: ["text/html;profile=mcp-app"],
      },
    },
  },
};

/**
 * Issue a raw 2026-07-28 MCP request against a dev/built server and return
 * the parsed JSON-RPC response body.
 */
export async function mcpRequest(
  baseUrl: string,
  method: string,
  params: Record<string, unknown> = {},
  options?: { ui?: boolean }
): Promise<Record<string, unknown>> {
  const meta = options?.ui === true ? META_UI : META;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": "2026-07-28",
    "mcp-method": method,
  };
  if (typeof params["name"] === "string") {
    headers["mcp-name"] = params["name"];
  } else if (typeof params["uri"] === "string") {
    headers["mcp-name"] = params["uri"];
  }
  const response = await fetch(baseUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: { ...params, _meta: meta },
    }),
  });
  if (!response.ok) {
    throw new Error(`${method} → HTTP ${response.status}`);
  }
  return (await response.json()) as Record<string, unknown>;
}

/** List tool names via a raw tools/list request. */
export async function listToolNames(baseUrl: string): Promise<string[]> {
  const body = await mcpRequest(baseUrl, "tools/list");
  const result = body["result"] as { tools: { name: string }[] };
  return result.tools.map((t) => t.name).sort();
}

/**
 * Find a free port OUTSIDE the OS ephemeral range (binding port 0 hands out
 * ephemeral ports, and a loopback fetch to an ephemeral port can TCP
 * self-connect — the kernel picks source port == destination port — echoing
 * the request back as the "response").
 */
export async function getFreePort(host = "127.0.0.1"): Promise<number> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = 20000 + Math.floor(Math.random() * 20000);
    const free = await new Promise<boolean>((resolve) => {
      const server = createServer();
      server.once("error", () => resolve(false));
      server.listen({ port: candidate, host }, () => {
        server.close(() => resolve(true));
      });
    });
    if (free) return candidate;
  }
  throw new Error("no free non-ephemeral port found");
}

/** Occupy a port with a bare TCP server; returns the server (call close()). */
export async function occupyPort(
  port: number,
  host = "127.0.0.1"
): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen({ port, host }, () => resolve(server));
  });
}
