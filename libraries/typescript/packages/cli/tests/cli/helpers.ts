/** Shared test helpers: fixture copying, raw 2026-07-28 MCP requests, polling. */
import { randomBytes } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { templateEnvVar, type FixtureKind } from "./fixture-projects.js";

/**
 * Scratch root for mutable fixture copies, under the OS temp directory.
 *
 * Resolved through `realpathSync.native` because the temp path the OS reports
 * is not the real one: macOS hands out `/var/folders/...` for a directory that
 * lives at `/private/var/folders/...`, and Windows hands out an 8.3 short
 * path. Vite compares the project root against resolved file paths and serves
 * anything it believes is outside the root through `/@fs/`, which changes the
 * asset URLs a fixture's own views are served under.
 */
export const TMP_ROOT = createTmpRoot();

function createTmpRoot(): string {
  const root = join(tmpdir(), "mcp-use-cli-tests");
  mkdirSync(root, { recursive: true });
  return realpathSync.native(root);
}

/** Path to the installed template project prepared in `globalSetup`. */
function templateFor(kind: FixtureKind): string {
  const template = process.env[templateEnvVar(kind)];
  if (template === undefined) {
    throw new Error(
      `Fixture template for "${kind}" is missing. These tests need the ` +
        `globalSetup in vitest.config.ts to install the fixture projects.`
    );
  }
  return template;
}

/**
 * Copy a prepared fixture into a fresh scratch dir; returns its path.
 *
 * Sources are copied so each test owns its mutable state, while the installed
 * packages are linked in one by one. Linking rather than copying keeps this at
 * a few milliseconds instead of duplicating a ~100MB install per test, and
 * linking the entries rather than the whole directory leaves `node_modules`
 * itself writable, which is where Vite puts its optimizer cache.
 */
export function copyFixture(
  label: string,
  fixture: FixtureKind = "basic"
): string {
  const template = templateFor(fixture);
  const dest = join(TMP_ROOT, `${label}-${randomBytes(4).toString("hex")}`);
  mkdirSync(dest, { recursive: true });
  cpSync(template, dest, {
    recursive: true,
    filter: (source) => !source.startsWith(join(template, "node_modules")),
  });

  const installed = join(template, "node_modules");
  const nodeModules = join(dest, "node_modules");
  mkdirSync(nodeModules, { recursive: true });
  for (const entry of readdirSync(installed)) {
    symlinkSync(join(installed, entry), join(nodeModules, entry), "junction");
  }
  return dest;
}

const pendingRemovals: string[] = [];

/**
 * Remove a scratch path, ignoring failures.
 *
 * Whole fixture copies wait until the worker exits. Vite's dependency
 * optimizer keeps writing into `.mcp-use/cache/deps_temp_*` after the dev
 * server is told to close, and deleting the project out from under it
 * surfaces as an unhandled rejection that fails the run even when every test
 * passed. Copies are sources and symlinks, so holding them costs little.
 * Paths inside a copy, which tests delete to set up missing-file cases, still
 * go immediately.
 */
export function removeDir(dir: string): void {
  if (dirname(dir) === TMP_ROOT) {
    pendingRemovals.push(dir);
    return;
  }
  removeNow(dir);
}

function removeNow(dir: string): void {
  try {
    rmSync(dir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  } catch {
    // best effort: the OS temp directory is cleaned up regardless.
  }
}

process.once("exit", () => {
  for (const dir of pendingRemovals) removeNow(dir);
});

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
