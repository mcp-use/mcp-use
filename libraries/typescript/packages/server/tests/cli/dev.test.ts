/**
 * e2e tests for runDev: a real Vite dev server + module runner serving the
 * fixture over HTTP, including edit-triggered reload and error resilience.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runDev } from "../../src/cli/index.js";
import {
  copyFixture,
  getFreePort,
  listToolNames,
  occupyPort,
  removeDir,
  waitFor,
} from "./helpers.js";

interface DevHandle {
  url: string;
  logs: readonly string[];
  stop: () => Promise<void>;
}

const cleanups: (() => Promise<void> | void)[] = [];
let originalMcpUrl: string | undefined;
let originalPort: string | undefined;

beforeEach(() => {
  originalMcpUrl = process.env["MCP_URL"];
  originalPort = process.env["PORT"];
});

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
  if (originalMcpUrl === undefined) {
    delete process.env["MCP_URL"];
  } else {
    process.env["MCP_URL"] = originalMcpUrl;
  }
  if (originalPort === undefined) {
    delete process.env["PORT"];
  } else {
    process.env["PORT"] = originalPort;
  }
});

/** Start runDev in-process and wait for the ready log to learn the URL. */
async function startDev(
  cwd: string,
  port: number,
  host?: string
): Promise<DevHandle> {
  const lines: string[] = [];
  const logSpy = vi
    .spyOn(console, "log")
    .mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });

  const controller = new AbortController();
  const done = runDev({
    cwd,
    port,
    ...(host !== undefined && { host }),
    signal: controller.signal,
  });
  // Surface startup failures instead of hanging in waitFor.
  let startupError: unknown;
  done.catch((error: unknown) => (startupError = error));

  try {
    const endpointLine = await waitFor(async () => {
      if (startupError !== undefined) throw startupError;
      return lines.find((l) => l.includes("MCP endpoint"));
    });
    const url = /(http:\/\/\S+)/.exec(endpointLine)?.[1];
    if (url === undefined) throw new Error(`no URL in: ${endpointLine}`);
    return {
      url,
      logs: lines,
      stop: async () => {
        controller.abort();
        await done;
        logSpy.mockRestore();
      },
    };
  } catch (error) {
    logSpy.mockRestore();
    controller.abort();
    await done.catch(() => {});
    throw error;
  }
}

function writeOAuthEntry(cwd: string, basePath = "/mcp"): void {
  writeFileSync(
    join(cwd, "src", "index.ts"),
    `import { MCPServer } from "@mcp-use/server";
import { oauthCustomProvider } from "@mcp-use/server/oauth";

const oauth = oauthCustomProvider({
  tokenVerifier: {
    verifyAccessToken: async (token) => ({
      token,
      clientId: "cli-dev-test",
      scopes: [],
      expiresAt: Date.now() / 1000 + 60,
    }),
  },
  oauthMetadata: { issuer: "https://issuer.example.test" },
  mapAuthInfo: () => ({
    user: { id: "user-1" },
    payload: { sub: "user-1" },
    permissions: [],
  }),
});

export default new MCPServer({
  name: "oauth-cli-dev-test",
  version: "1.0.0",
  basePath: "${basePath}",
  oauth,
});
`
  );
}

describe("runDev", () => {
  it("serves the MCP endpoint and reloads on file change", async () => {
    const cwd = copyFixture("dev");
    cleanups.push(() => removeDir(cwd));

    const port = await getFreePort();
    const dev = await startDev(cwd, port);
    cleanups.push(dev.stop);

    expect(dev.url).toBe(`http://localhost:${port}/mcp`);
    expect(await listToolNames(dev.url)).toEqual(["add"]);

    // --- Edit-triggered reload: add a tool, poll until tools/list shows it.
    const entry = join(cwd, "src", "index.ts");
    const source = readFileSync(entry, "utf8");
    writeFileSync(
      entry,
      source.replace(
        "export default server;",
        `server.tool(
  { name: "subtract", description: "Subtract", schema: z.object({ a: z.number(), b: z.number() }) },
  async ({ a, b }) => ({ content: [{ type: "text", text: String(a - b) }] })
);
export default server;`
      )
    );
    await waitFor(async () =>
      (await listToolNames(dev.url)).includes("subtract") ? true : undefined
    );
    expect(await listToolNames(dev.url)).toEqual(["add", "subtract"]);

    // --- A broken save keeps the previous handler alive (never crashes).
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    cleanups.push(() => errorSpy.mockRestore());
    writeFileSync(entry, "this is not valid typescript {{{\n");
    await waitFor(async () =>
      errorSpy.mock.calls.some((call) =>
        String(call[0]).includes("reload failed")
      )
        ? true
        : undefined
    );
    expect(await listToolNames(dev.url)).toEqual(["add", "subtract"]);
  });

  it("probes upward when the requested port is taken", async () => {
    const cwd = copyFixture("dev-port");
    cleanups.push(() => removeDir(cwd));

    const port = await getFreePort();
    const blocker = await occupyPort(port);
    cleanups.push(() => new Promise<void>((r) => blocker.close(() => r())));

    const dev = await startDev(cwd, port);
    cleanups.push(dev.stop);

    const boundPort = Number(new URL(dev.url).port);
    expect(boundPort).toBeGreaterThan(port);
    expect(await listToolNames(dev.url)).toEqual(["add"]);
  });

  it("uses the actual local listener origin for OAuth entries", async () => {
    delete process.env["MCP_URL"];
    const cwd = copyFixture("dev-oauth");
    cleanups.push(() => removeDir(cwd));
    writeOAuthEntry(cwd, "/api/mcp");

    const port = await getFreePort();
    const dev = await startDev(cwd, port);
    cleanups.push(dev.stop);

    const metadata = await fetch(
      `http://localhost:${port}/.well-known/oauth-protected-resource/api/mcp`
    );
    expect(metadata.status).toBe(200);
    expect(((await metadata.json()) as { resource: string }).resource).toBe(
      `http://localhost:${port}/api/mcp`
    );
    expect(process.env["MCP_URL"]).toBeUndefined();
    expect(process.env["PORT"]).toBe(String(port));
  });

  it("uses the probed local port as the OAuth resource", async () => {
    delete process.env["MCP_URL"];
    const cwd = copyFixture("dev-oauth-port");
    cleanups.push(() => removeDir(cwd));
    writeOAuthEntry(cwd);

    const requestedPort = await getFreePort();
    const blocker = await occupyPort(requestedPort);
    cleanups.push(
      () => new Promise<void>((resolve) => blocker.close(() => resolve()))
    );

    const dev = await startDev(cwd, requestedPort);
    cleanups.push(dev.stop);
    const actualPort = Number(new URL(dev.url).port);

    expect(actualPort).toBeGreaterThan(requestedPort);
    const metadata = await fetch(
      `http://localhost:${actualPort}/.well-known/oauth-protected-resource/mcp`
    );
    expect(((await metadata.json()) as { resource: string }).resource).toBe(
      `http://localhost:${actualPort}/mcp`
    );
    expect(process.env["MCP_URL"]).toBeUndefined();
  });

  it("preserves an explicit MCP_URL for OAuth entries", async () => {
    process.env["MCP_URL"] = "https://configured.example.test";
    const cwd = copyFixture("dev-oauth-explicit-resource");
    cleanups.push(() => removeDir(cwd));
    writeOAuthEntry(cwd);

    const port = await getFreePort();
    const dev = await startDev(cwd, port);
    cleanups.push(dev.stop);

    const metadata = await fetch(
      `http://localhost:${port}/.well-known/oauth-protected-resource/mcp`
    );
    expect(((await metadata.json()) as { resource: string }).resource).toBe(
      "https://configured.example.test/mcp"
    );
    expect(process.env["MCP_URL"]).toBe("https://configured.example.test");
  });

  it("does not leak a synthetic MCP_URL when startup fails", async () => {
    delete process.env["MCP_URL"];
    const cwd = copyFixture("dev-oauth-startup-failure");
    cleanups.push(() => removeDir(cwd));
    writeOAuthEntry(cwd);
    writeFileSync(
      join(cwd, "src", "index.ts"),
      `${readFileSync(join(cwd, "src", "index.ts"), "utf8")}
throw new Error("startup failure after MCPServer construction");
`
    );

    await expect(runDev({ cwd, port: await getFreePort() })).rejects.toThrow(
      "startup failure after MCPServer construction"
    );
    expect(process.env["MCP_URL"]).toBeUndefined();
  });

  it("does not reuse a prior run's local OAuth identity", async () => {
    delete process.env["MCP_URL"];
    const cwd = copyFixture("dev-oauth-sequential-runs");
    cleanups.push(() => removeDir(cwd));
    writeOAuthEntry(cwd);

    const firstPort = await getFreePort();
    const first = await startDev(cwd, firstPort);
    const firstMetadata = await fetch(
      `http://localhost:${firstPort}/.well-known/oauth-protected-resource/mcp`
    );
    expect(
      ((await firstMetadata.json()) as { resource: string }).resource
    ).toBe(`http://localhost:${firstPort}/mcp`);
    await first.stop();
    expect(process.env["MCP_URL"]).toBeUndefined();

    const secondPort = await getFreePort();
    const second = await startDev(cwd, secondPort);
    cleanups.push(second.stop);
    const secondMetadata = await fetch(
      `http://localhost:${secondPort}/.well-known/oauth-protected-resource/mcp`
    );
    expect(
      ((await secondMetadata.json()) as { resource: string }).resource
    ).toBe(`http://localhost:${secondPort}/mcp`);
    expect(process.env["MCP_URL"]).toBeUndefined();
  });

  it("uses the same canonical local resource after reload", async () => {
    delete process.env["MCP_URL"];
    const cwd = copyFixture("dev-oauth-reload");
    cleanups.push(() => removeDir(cwd));
    writeOAuthEntry(cwd, "/api/mcp");

    const port = await getFreePort();
    const dev = await startDev(cwd, port);
    cleanups.push(dev.stop);
    const entry = join(cwd, "src", "index.ts");
    writeFileSync(entry, `${readFileSync(entry, "utf8")}\n// reload\n`);
    await waitFor(async () =>
      dev.logs.includes("[mcp-use] reloaded server entry") ? true : undefined
    );

    const metadata = await fetch(
      `http://localhost:${port}/.well-known/oauth-protected-resource/api/mcp`
    );
    expect(((await metadata.json()) as { resource: string }).resource).toBe(
      `http://localhost:${port}/api/mcp`
    );
    expect(process.env["MCP_URL"]).toBeUndefined();
  });

  it("does not configure OAuth from a public listener or request Host", async () => {
    delete process.env["MCP_URL"];
    const cwd = copyFixture("dev-oauth-public");
    cleanups.push(() => removeDir(cwd));
    writeOAuthEntry(cwd);

    await expect(
      runDev({ cwd, port: await getFreePort("0.0.0.0"), host: "0.0.0.0" })
    ).rejects.toThrow("OAuth requires an explicit resource or MCP_URL");
    expect(process.env["MCP_URL"]).toBeUndefined();
  });

  it("rejects an entry without a default MCPServer export", async () => {
    const cwd = copyFixture("dev-bad");
    cleanups.push(() => removeDir(cwd));
    writeFileSync(join(cwd, "src", "index.ts"), "export const nope = 1;\n");

    const port = await getFreePort();
    await expect(runDev({ cwd, port })).rejects.toThrow(
      /export default server/
    );
  });
});
