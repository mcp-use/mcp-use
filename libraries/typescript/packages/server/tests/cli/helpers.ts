/** Shared test helpers: fixture copying, raw 2026-07-28 MCP requests, polling. */
import { randomBytes } from "node:crypto";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the committed basic fixture project. */
export const FIXTURE_BASIC = join(here, "fixtures", "basic");

/** Absolute path to the views fixture project. */
export const FIXTURE_VIEWS = join(here, "fixtures", "views");

/**
 * Scratch root for mutable fixture copies. Lives inside the package (not the
 * OS tmpdir) so node resolution of externalized bare imports still walks up
 * into `packages/server/node_modules` — where `mcp-use` declares
 * itself as a `devDependency` (see package.json) purely so pnpm links a real
 * `node_modules/mcp-use` → package-root symlink there. That entry is
 * what lets the fixture's own `import "mcp-use"` (and this package's
 * `runBuild`/`runDev`, which build/serve the fixture as if it were an
 * ordinary user project) resolve during both Vite/Rolldown bundling and
 * `tsc` typechecking of `tests/cli/fixtures/basic/`, neither of which
 * implements Node's own package self-reference algorithm.
 */
export const TMP_ROOT = join(here, ".tmp");

/** Copy a committed fixture into a fresh scratch dir; returns its path. */
export function copyFixture(
  label: string,
  fixture: "basic" | "views" = "basic"
): string {
  const source = fixture === "views" ? FIXTURE_VIEWS : FIXTURE_BASIC;
  const dest = join(TMP_ROOT, `${label}-${randomBytes(4).toString("hex")}`);
  mkdirSync(dest, { recursive: true });
  cpSync(source, dest, { recursive: true });
  return dest;
}

/** Remove a scratch dir, ignoring failures. */
export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
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

/** Poll `probe` until it resolves truthy or the timeout elapses. */
export async function waitFor<T>(
  probe: () => Promise<T | undefined>,
  { timeout = 15000, interval = 200 } = {}
): Promise<T> {
  const deadline = Date.now() + timeout;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value !== undefined) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(
    `waitFor timed out after ${timeout}ms` +
      (lastError !== undefined ? `; last error: ${String(lastError)}` : "")
  );
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
