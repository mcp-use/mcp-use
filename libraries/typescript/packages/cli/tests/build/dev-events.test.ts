/**
 * Events parts of `mcp-use dev` (WP-27): the plain-data dev-runtime handoff
 * per generation and per tunnel change, and the tunnel path rules, observed
 * through a real `runDev` serving a fixture over HTTP.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runDev } from "../../src/toolchain/index.js";
import { tunnelPathDecision } from "../../src/toolchain/dev-events.js";
import { copyFixture, getFreePort, removeDir, waitFor } from "./helpers.js";

const tunnelState = vi.hoisted(() => ({ url: null as string | null }));
vi.mock("@mcp-use/tunnel", () => ({
  createTunnelManager: () => ({
    start: async () => {
      tunnelState.url = "https://fake.local.mcp-use.run";
      return { url: tunnelState.url, subdomain: "fake" };
    },
    stop: async () => {
      tunnelState.url = null;
    },
    status: () => ({ url: tunnelState.url }),
  }),
}));

const HANDOFFS = "__mcpUseEventsDevHandoffs";
type Handoff = Record<string, unknown>;
const handoffs = (): Handoff[] =>
  ((globalThis as Record<string, unknown>)[HANDOFFS] as Handoff[]) ?? [];

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  tunnelState.url = null;
  delete (globalThis as Record<string, unknown>)[HANDOFFS];
  while (cleanups.length > 0) await cleanups.pop()?.();
  vi.restoreAllMocks();
});

/** A fixture whose server records every `__setEventsDev` handoff. */
function eventsFixture(): string {
  const cwd = copyFixture("dev-events");
  cleanups.push(() => removeDir(cwd));
  const entry = join(cwd, "src", "index.ts");
  writeFileSync(
    entry,
    readFileSync(entry, "utf8").replace(
      "export default server;",
      `const handoffs = ((globalThis as any).${HANDOFFS} ??= []);
(server as any).__setEventsDev = (options: unknown) => {
  handoffs.push(structuredClone(options));
};
export default server;`
    )
  );
  // A minimal Inspector that answers every path under its mount with 200.
  const manifestPath = join(cwd, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.devDependencies = {
    ...manifest.devDependencies,
    "@mcp-use/inspector": "test",
  };
  writeFileSync(manifestPath, JSON.stringify(manifest));
  const inspectorRoot = join(cwd, "node_modules", "@mcp-use", "inspector");
  mkdirSync(inspectorRoot, { recursive: true });
  writeFileSync(
    join(inspectorRoot, "package.json"),
    JSON.stringify({
      name: "@mcp-use/inspector",
      type: "module",
      exports: { ".": "./index.js" },
    })
  );
  writeFileSync(
    join(inspectorRoot, "index.js"),
    `export function mountInspector() {
  return async () => new Response("inspector", { status: 200 });
}
`
  );
  return cwd;
}

async function startDev(cwd: string, port: number): Promise<string> {
  const lines: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const controller = new AbortController();
  const done = runDev({ cwd, port, signal: controller.signal });
  let startupError: unknown;
  done.catch((error: unknown) => (startupError = error));
  cleanups.push(async () => {
    controller.abort();
    await done.catch(() => {});
  });
  const line = await waitFor(async () => {
    if (startupError !== undefined) throw startupError;
    return lines.find((l) => l.includes("MCP endpoint"));
  });
  return /(https?:\/\/\S+)/.exec(line)![1]!;
}

/** Raw request with an explicit Host header; resolves with the status. */
function status(
  target: string,
  method: "GET" | "POST",
  host?: string
): Promise<number> {
  const body =
    method === "POST"
      ? JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
      : undefined;
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      target,
      {
        method,
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(host !== undefined && { host }),
        },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      }
    );
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

describe("tunnel path rules", () => {
  it.each([
    ["POST", "/mcp/inspector/api/events/hooks/h1", "/mcp", "allow"],
    ["post", "/mcp/inspector/api/events/hooks/h1/x", "/mcp", "allow"],
    ["GET", "/mcp/inspector/api/events/hooks/h1", "/mcp", "block"],
    ["POST", "/mcp/inspector/api/events/hooks/", "/mcp", "block"],
    ["POST", "/mcp/inspector/api/dev/events", "/mcp", "block"],
    ["GET", "/mcp/inspector", "/mcp", "block"],
    ["POST", "/mcp/_mcp-use/events", "/mcp", "block"],
    ["POST", "/mcp/_mcp-use/events/wake", "/mcp", "block"],
    ["POST", "/mcp/_mcp-use/eventsx", "/mcp", "allow"],
    ["POST", "/mcp", "/mcp", "allow"],
    ["POST", "/api/inspector/api/events/hooks/h1", "/api", "allow"],
    ["POST", "/api/_mcp-use/events/wake", "/api", "block"],
    ["POST", "/inspector/api/events/hooks/h1", "/", "allow"],
    ["POST", "/_mcp-use/events/wake", "/", "block"],
  ])("%s %s (base %s) → %s", (method, path, base, expected) => {
    expect(tunnelPathDecision(method, path, base)).toBe(expected);
  });
});

describe("mcp-use dev events handoff", () => {
  it("hands plain data per generation and per tunnel change, and applies the tunnel rules", async () => {
    const cwd = eventsFixture();
    const port = await getFreePort();
    const url = await startDev(cwd, port);
    const stateDir = join(cwd, ".mcp-use", "state");

    expect(handoffs()).toHaveLength(1);
    const first = handoffs()[0]!;
    expect(first["token"]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first).toEqual({
      stateDir,
      devPort: port,
      basePath: "/mcp",
      token: first["token"],
      reason: "generation",
    });

    // A hot reload is a new generation with the same per-process token.
    const entry = join(cwd, "src", "index.ts");
    writeFileSync(
      entry,
      readFileSync(entry, "utf8").replace("Add two numbers", "Add numbers")
    );
    await waitFor(async () => (handoffs().length >= 2 ? true : undefined));
    expect(handoffs()[1]).toEqual({
      stateDir,
      devPort: port,
      basePath: "/mcp",
      token: first["token"],
      reason: "generation",
    });

    // A tunnel started from the Inspector updates the public origin only.
    const started = await fetch(`${url}/inspector/api/dev/start-tunnel`, {
      method: "POST",
    });
    expect(started.status).toBe(200);
    expect(handoffs().at(-1)).toEqual({
      stateDir,
      devPort: port,
      basePath: "/mcp",
      publicOrigin: "https://fake.local.mcp-use.run",
      token: first["token"],
      reason: "tunnel",
    });

    const tunnelHost = "fake.local.mcp-use.run";
    const hook = `${url}/inspector/api/events/hooks/h1`;
    expect(await status(hook, "POST", tunnelHost)).toBe(200);
    expect(await status(hook, "GET", tunnelHost)).toBe(404);
    expect(
      await status(`${url}/inspector/api/dev/events`, "GET", tunnelHost)
    ).toBe(404);
    expect(
      await status(`${url}/_mcp-use/events/wake`, "POST", tunnelHost)
    ).toBe(404);
    expect(await status(url, "POST", tunnelHost)).toBe(200);
    // Locally the Inspector stays reachable.
    expect(await status(hook, "GET")).toBe(200);

    const stopped = await fetch(`${url}/inspector/api/dev/stop-tunnel`, {
      method: "POST",
    });
    expect(stopped.status).toBe(200);
    expect(handoffs().at(-1)).toEqual({
      stateDir,
      devPort: port,
      basePath: "/mcp",
      token: first["token"],
      reason: "tunnel",
    });
  }, 60_000);
});
