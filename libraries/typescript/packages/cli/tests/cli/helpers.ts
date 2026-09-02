/** Shared test helpers: fixture copying, raw 2026-07-28 MCP requests, polling. */
import { randomBytes } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  realpathSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const serverPackageRoot = join(here, "..", "..", "..", "server");
const cliPackageModules = join(here, "..", "..", "node_modules");

/** Absolute path to the committed basic fixture project. */
export const FIXTURE_BASIC = join(here, "fixtures", "basic");

/** Absolute path to the views fixture project. */
export const FIXTURE_VIEWS = join(here, "fixtures", "views");

/**
 * Scratch root for mutable fixture copies, under the OS temp directory like
 * the rest of the suite.
 *
 * Resolved through `realpathSync.native` because the OS temp path is not the
 * real one: macOS hands out `/var/folders/...` for a directory that lives at
 * `/private/var/folders/...`, and Windows hands out an 8.3 short path. Vite
 * compares the project root against resolved file paths and serves anything it
 * thinks is outside the root through `/@fs/`, so a fixture's own assets come
 * back with the wrong URL if the root keeps the unresolved form.
 */
export const TMP_ROOT = createTmpRoot();

function createTmpRoot(): string {
  const root = join(tmpdir(), "mcp-use-cli-tests");
  mkdirSync(root, { recursive: true });
  // .native so Windows returns the long form too, not C:\Users\RUNNER~1\...
  return realpathSync.native(root);
}

/**
 * Packages a fixture project resolves from its own `node_modules`: the sources
 * import `zod`, `typecheck` resolves `typescript` from the project being
 * checked, and the views fixture declares React.
 */
const FIXTURE_DEPENDENCIES = ["zod", "typescript", "react", "react-dom"];

/**
 * Give a scratch copy the dependencies it used to inherit from the repo.
 *
 * While the copies lived under `tests/cli` these resolved by walking up into
 * the CLI package's own `node_modules`. From the OS temp directory there is
 * nothing to walk up into, and on Windows the temp directory is not even on
 * the same volume as the checkout, so each copy gets its own links instead of
 * one shared link higher up. Targets go through `realpathSync` because the
 * entries in the CLI package are pnpm links into `.pnpm`; pointing at the real
 * directory keeps each package beside the peers pnpm installed for it.
 */
function linkDependencies(nodeModules: string): void {
  for (const name of FIXTURE_DEPENDENCIES) {
    symlinkSync(
      realpathSync.native(join(cliPackageModules, name)),
      join(nodeModules, name),
      "junction"
    );
  }
}

/** Copy a committed fixture into a fresh scratch dir; returns its path. */
export function copyFixture(
  label: string,
  fixture: "basic" | "views" = "basic"
): string {
  const source = fixture === "views" ? FIXTURE_VIEWS : FIXTURE_BASIC;
  const dest = join(TMP_ROOT, `${label}-${randomBytes(4).toString("hex")}`);
  mkdirSync(dest, { recursive: true });
  cpSync(source, dest, { recursive: true });
  const nodeModules = join(dest, "node_modules");
  mkdirSync(nodeModules, { recursive: true });
  symlinkSync(serverPackageRoot, join(nodeModules, "mcp-use"), "junction");
  linkDependencies(nodeModules);
  return dest;
}

/** Remove a scratch dir, ignoring failures. */
export function removeDir(dir: string): void {
  try {
    rmSync(dir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  } catch {
    // best effort: Vite may still be finishing optimizer temp cleanup.
  }
}

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
