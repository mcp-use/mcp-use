/**
 * e2e tests for runDev: a real Vite dev server + module runner serving the
 * fixture over HTTP, including edit-triggered reload and error resilience.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runDev } from "../../src/cli/index.js";
import {
  bindBasicToolToView,
  copyFixture,
  getFreePort,
  listToolNames,
  mcpRequest,
  occupyPort,
  removeDir,
  waitFor,
} from "./helpers.js";

// Controllable tunnel state. Tests flip `url` to pin the tunnel-gated CORS
// contract on Vite module URLs.
const tunnelState = vi.hoisted(() => ({ url: null as string | null }));
vi.mock("@mcp-use/tunnel", () => ({
  createTunnelManager: () => ({
    start: async (port: number) => {
      tunnelState.url = `https://fake.local.mcp-use.run`;
      void port;
      return { url: tunnelState.url, subdomain: "fake" };
    },
    stop: async () => {
      tunnelState.url = null;
    },
    status: () => ({ url: tunnelState.url }),
  }),
}));

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
  tunnelState.url = null;
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
  host?: string,
  inspector?: boolean
): Promise<DevHandle> {
  const lines: string[] = [];
  const logSpy = vi
    .spyOn(console, "log")
    .mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
  const warnSpy = vi
    .spyOn(console, "warn")
    .mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });

  const controller = new AbortController();
  const done = runDev({
    cwd,
    port,
    ...(host !== undefined && { host }),
    ...(inspector !== undefined && { inspector }),
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
        warnSpy.mockRestore();
      },
    };
  } catch (error) {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    controller.abort();
    await done.catch(() => {});
    throw error;
  }
}

function installFakeInspector(cwd: string): void {
  const projectManifestPath = join(cwd, "package.json");
  const projectManifest = JSON.parse(readFileSync(projectManifestPath, "utf8"));
  projectManifest.devDependencies = {
    ...projectManifest.devDependencies,
    "@mcp-use/inspector": "test",
  };
  writeFileSync(projectManifestPath, JSON.stringify(projectManifest));
  const packageRoot = join(cwd, "node_modules", "@mcp-use", "inspector");
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(
    join(packageRoot, "package.json"),
    JSON.stringify({
      name: "@mcp-use/inspector",
      type: "module",
      exports: { ".": "./index.js" },
    })
  );
  writeFileSync(
    join(packageRoot, "index.js"),
    `export function mountInspector(options) {
  return async (request) => {
    const url = new URL(request.url);
    const prefix = options.basePath + "/inspector";
    if (url.pathname === prefix + "/config.json") {
      return Response.json({ autoConnectUrl: options.autoConnectUrl });
    }
    if (url.pathname === prefix || url.pathname.startsWith(prefix + "/")) {
      return new Response("mounted:" + options.basePath, {
        headers: { "content-type": "text/html" },
      });
    }
    return new Response("Not Found", { status: 404 });
  };
}
`
  );
}

function writeOAuthEntry(cwd: string, basePath = "/mcp"): void {
  writeFileSync(
    join(cwd, "src", "index.ts"),
    `import { MCPServer } from "mcp-use";
import { oauthCustomProvider } from "mcp-use/oauth";

const oauth = oauthCustomProvider({
  createTokenVerifier: (resource) => ({
    verifyAccessToken: async (token) => ({
      token,
      clientId: "cli-dev-test",
      scopes: [],
      expiresAt: Date.now() / 1000 + 60,
      resource,
    }),
  }),
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
  it("ignores duplicate shutdown signals until async teardown finishes", async () => {
    const cwd = copyFixture("dev-duplicate-shutdown-signal");
    cleanups.push(() => removeDir(cwd));

    const existingSigint = new Set(process.listeners("SIGINT"));
    const dev = await startDev(cwd, await getFreePort());
    cleanups.push(dev.stop);
    const sigint = process
      .listeners("SIGINT")
      .find((listener) => !existingSigint.has(listener));
    expect(sigint).toBeDefined();

    sigint?.("SIGINT");
    expect(process.listeners("SIGINT")).toContain(sigint);
    sigint?.("SIGINT");

    await dev.stop();
    expect(process.listeners("SIGINT")).not.toContain(sigint);
  });

  it("reloads skill edits and keeps the last valid snapshot", async () => {
    const cwd = copyFixture("dev-skills");
    const skillDir = join(cwd, "skills", "refunds");
    mkdirSync(skillDir, { recursive: true });
    const skillFile = join(skillDir, "SKILL.md");
    writeFileSync(
      skillFile,
      "---\nname: refunds\ndescription: Process refunds\n---\n# v1\n"
    );
    const dev = await startDev(cwd, await getFreePort(), undefined, false);
    cleanups.push(dev.stop, () => removeDir(cwd));

    expect(await mcpRequest(dev.url, "skills/list")).toMatchObject({
      result: { skills: [{ uri: "skill://refunds/SKILL.md" }] },
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    cleanups.push(() => errorSpy.mockRestore());
    writeFileSync(skillFile, "---\nname: wrong\ndescription: Invalid\n---\n");
    await waitFor(async () =>
      errorSpy.mock.calls.some((call) =>
        String(call[0]).includes("reload failed")
      )
        ? true
        : undefined
    );
    expect(await mcpRequest(dev.url, "skills/list")).toMatchObject({
      result: { skills: [{ frontmatter: { name: "refunds" } }] },
    });

    writeFileSync(
      skillFile,
      "---\nname: refunds\ndescription: Updated refunds\n---\n# v2\n"
    );
    await waitFor(async () => {
      const body = await mcpRequest(dev.url, "skills/list");
      const result = body["result"] as {
        skills?: Array<{ frontmatter?: { description?: string } }>;
      };
      return result.skills?.[0]?.frontmatter?.description === "Updated refunds"
        ? true
        : undefined;
    });
  });

  it("watches supporting files in a configured skills directory", async () => {
    const cwd = copyFixture("dev-custom-skills");
    const entry = join(cwd, "src", "index.ts");
    writeFileSync(
      entry,
      readFileSync(entry, "utf8").replace(
        'name: "fixture-basic", version: "1.0.0"',
        'name: "fixture-basic", version: "1.0.0", skills: { directory: "manuals" }'
      )
    );
    const skillDir = join(cwd, "manuals", "refunds");
    mkdirSync(join(skillDir, "references"), { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      "---\nname: refunds\ndescription: Process refunds\n---\n"
    );
    const policy = join(skillDir, "references", "policy.md");
    writeFileSync(policy, "Policy v1\n");

    const dev = await startDev(cwd, await getFreePort(), undefined, false);
    cleanups.push(dev.stop, () => removeDir(cwd));
    expect(
      await mcpRequest(dev.url, "resources/read", {
        uri: "skill://refunds/references/policy.md",
      })
    ).toMatchObject({ result: { contents: [{ text: "Policy v1\n" }] } });

    writeFileSync(policy, "Policy v2\n");
    await waitFor(async () => {
      const body = await mcpRequest(dev.url, "resources/read", {
        uri: "skill://refunds/references/policy.md",
      });
      const result = body["result"] as {
        contents?: Array<{ text?: string }>;
      };
      return result.contents?.[0]?.text === "Policy v2\n" ? true : undefined;
    });
  });

  it("mounts the project-local Inspector on the existing dev listener", async () => {
    const cwd = copyFixture("dev-inspector-installed");
    cleanups.push(() => removeDir(cwd));
    installFakeInspector(cwd);

    const port = await getFreePort();
    const dev = await startDev(cwd, port);
    cleanups.push(dev.stop);

    const origin = dev.url.replace(/\/mcp$/, "");
    const shell = await fetch(`${origin}/mcp/inspector`);
    expect(shell.status).toBe(200);
    expect(await shell.text()).toBe("mounted:/mcp");
    expect(
      await (await fetch(`${origin}/mcp/inspector/config.json`)).json()
    ).toEqual({ autoConnectUrl: `${origin}/mcp` });
    expect(dev.logs.some((line) => line.includes("➜ Inspector:"))).toBe(true);

    const entry = join(cwd, "src", "index.ts");
    writeFileSync(
      entry,
      readFileSync(entry, "utf8").replace(
        'version: "1.0.0"',
        'version: "1.0.0", basePath: "/api/mcp"'
      )
    );
    await waitFor(async () =>
      (await fetch(`${origin}/api/mcp/inspector`)).status === 200
        ? true
        : undefined
    );
    expect((await fetch(`${origin}/mcp/inspector`)).status).toBe(404);
    expect(
      await (await fetch(`${origin}/api/mcp/inspector/config.json`)).json()
    ).toEqual({ autoConnectUrl: `${origin}/api/mcp` });
  });

  it("serves the built-in Inspector without a project dependency", async () => {
    const cwd = copyFixture("dev-inspector-missing");
    cleanups.push(() => removeDir(cwd));

    const port = await getFreePort();
    const dev = await startDev(cwd, port);
    cleanups.push(dev.stop);

    await waitFor(async () =>
      (await fetch(`${dev.url}/inspector`)).status === 200 ? true : undefined
    );
    expect(await listToolNames(dev.url)).toEqual(["add"]);
    expect(dev.logs.join("\n")).not.toContain(
      "Built-in Inspector is unavailable"
    );
  });

  it("supports an intentional headless dev run", async () => {
    const cwd = copyFixture("dev-inspector-disabled");
    cleanups.push(() => removeDir(cwd));
    installFakeInspector(cwd);

    const port = await getFreePort();
    const dev = await startDev(cwd, port, undefined, false);
    cleanups.push(dev.stop);

    expect((await fetch(`${dev.url}/inspector`)).status).toBe(404);
    expect(dev.logs.join("\n")).not.toContain("Inspector is not installed");
    expect(dev.logs.some((line) => line.includes("➜ Inspector:"))).toBe(false);
  });

  it("creates a missing root mcp-env.d.ts", async () => {
    const cwd = copyFixture("dev-tools-declaration");
    cleanups.push(() => removeDir(cwd));

    const port = await getFreePort();
    const dev = await startDev(cwd, port);
    cleanups.push(dev.stop);

    expect(existsSync(join(cwd, "mcp-env.d.ts"))).toBe(true);
    expect(readFileSync(join(cwd, "mcp-env.d.ts"), "utf8")).toContain(
      'tools: typeof import("./src/index.js")'
    );
    expect(readFileSync(join(cwd, "mcp-env.d.ts"), "utf8")).toContain(
      'import "mcp-use/vite-client"'
    );
  });

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
  { name: "subtract", description: "Subtract", inputSchema: z.object({ a: z.number(), b: z.number() }) },
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

  it("runs a tool-only server without a views directory", async () => {
    const cwd = copyFixture("dev-zero-views-missing");
    cleanups.push(() => removeDir(cwd));

    const dev = await startDev(cwd, await getFreePort(), undefined, false);
    cleanups.push(dev.stop);
    expect(await listToolNames(dev.url)).toEqual(["add"]);
    expect(dev.logs).toContain("[mcp-use] views directory not configured.");
    expect(dev.logs.join("\n")).not.toContain("no views were primed");
  });

  it.each([
    ["an empty views directory", false],
    ["a view directory without a React component", true],
  ])("runs a tool-only server with %s", async (_label, nestedDirectory) => {
    const cwd = copyFixture(`dev-zero-views-${String(nestedDirectory)}`);
    cleanups.push(() => removeDir(cwd));
    const viewsDir = nestedDirectory
      ? join(cwd, "views", "unfinished")
      : join(cwd, "views");
    mkdirSync(viewsDir, { recursive: true });

    const dev = await startDev(cwd, await getFreePort(), undefined, false);
    cleanups.push(dev.stop);
    expect(await listToolNames(dev.url)).toEqual(["add"]);
    expect(dev.logs).not.toContain("[mcp-use] views directory not configured.");
    expect(dev.logs.join("\n")).not.toContain("no views were primed");
  });

  it("fails precisely when a tool binds a view and no view component exists", async () => {
    const cwd = copyFixture("dev-zero-views-bound");
    cleanups.push(() => removeDir(cwd));
    mkdirSync(join(cwd, "views", "unfinished"), { recursive: true });
    bindBasicToolToView(cwd, "does-not-exist");

    await expect(runDev({ cwd, port: await getFreePort() })).rejects.toThrow(
      'Tool "add" is bound to view "does-not-exist" which is not in the primed views registry.'
    );
  });

  it("notifies connected clients after server catalog reloads", async () => {
    const cwd = copyFixture("dev-list-changed");
    cleanups.push(() => removeDir(cwd));

    const port = await getFreePort();
    const dev = await startDev(cwd, port);
    cleanups.push(dev.stop);

    const changes = { tools: 0, prompts: 0, resources: 0 };
    const catalogs: {
      tools: { name: string; description?: string | undefined }[];
      prompts: { name: string }[];
      resources: { name: string }[];
    } = { tools: [], prompts: [], resources: [] };
    const errors: Error[] = [];
    const client = new Client(
      { name: "dev-list-changed-test", version: "1.0.0" },
      {
        versionNegotiation: { mode: { pin: "2026-07-28" } },
        listChanged: {
          tools: {
            autoRefresh: true,
            debounceMs: 0,
            onChanged: (error, tools) => {
              if (error !== null) errors.push(error);
              changes.tools += 1;
              catalogs.tools = tools ?? [];
            },
          },
          prompts: {
            autoRefresh: true,
            debounceMs: 0,
            onChanged: (error, prompts) => {
              if (error !== null) errors.push(error);
              changes.prompts += 1;
              catalogs.prompts = prompts ?? [];
            },
          },
          resources: {
            autoRefresh: true,
            debounceMs: 0,
            onChanged: (error, resources) => {
              if (error !== null) errors.push(error);
              changes.resources += 1;
              catalogs.resources = resources ?? [];
            },
          },
        },
      }
    );
    await client.connect(new StreamableHTTPClientTransport(new URL(dev.url)));
    cleanups.push(() => client.close());
    await Promise.all([
      client.listTools(),
      client.listPrompts(),
      client.listResources(),
    ]);

    const entry = join(cwd, "src", "index.ts");
    const source = readFileSync(entry, "utf8");
    const withCatalog = source
      .replace("Add two numbers", "Add numbers after reload")
      .replace(
        "export default server;",
        `server.tool(
  { name: "subtract", description: "Subtract two numbers", inputSchema: z.object({ a: z.number(), b: z.number() }) },
  async ({ a, b }) => ({ content: [{ type: "text", text: String(a - b) }] })
);
server.prompt(
  { name: "hello", description: "Say hello" },
  async () => ({ messages: [{ role: "user", content: { type: "text", text: "Hello" } }] })
);
server.resource(
  { name: "status", uri: "status://dev" },
  async (uri) => ({ contents: [{ uri: uri.href, text: "ok" }] })
);
export default server;`
      );
    writeFileSync(entry, withCatalog);

    await waitFor(async () =>
      changes.tools > 0 && changes.prompts > 0 && changes.resources > 0
        ? true
        : undefined
    );
    expect(errors).toEqual([]);
    expect(catalogs.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "add",
          description: "Add numbers after reload",
        }),
        expect.objectContaining({ name: "subtract" }),
      ])
    );
    expect(catalogs.prompts.map((prompt) => prompt.name)).toContain("hello");
    expect(catalogs.resources.map((resource) => resource.name)).toContain(
      "status"
    );

    const firstToolChange = changes.tools;
    writeFileSync(
      entry,
      withCatalog.replace(
        /server\.tool\(\n {2}\{ name: "subtract"[\s\S]*?\n\);\nserver\.prompt\(/,
        "server.prompt("
      )
    );
    await waitFor(async () =>
      changes.tools > firstToolChange &&
      !catalogs.tools.some((tool) => tool.name === "subtract")
        ? true
        : undefined
    );
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

  it("probes upward when a wildcard listener already owns the port on loopback", async () => {
    const cwd = copyFixture("dev-port-wildcard");
    cleanups.push(() => removeDir(cwd));

    const port = await getFreePort();
    const blocker = await occupyPort(port, "::");
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

  // DNS-rebinding protection: the dev listener validates Host on localhost
  // binds before any routing — same posture as MCPServer.listen() (CLI_SPEC.md
  // § dev). Origin is not validated unless the server sets allowedOrigins.
  // Raw node:http requests because fetch() sanitizes Host/Origin headers.
  it("rejects non-localhost Host but accepts foreign Origin (DNS rebinding)", async () => {
    const cwd = copyFixture("dev-rebind");
    cleanups.push(() => removeDir(cwd));

    const port = await getFreePort();
    const dev = await startDev(cwd, port);
    cleanups.push(dev.stop);

    // MCP endpoint: rebound Host is rejected; foreign Origin is allowed.
    expect(await rawStatus(dev.url, { host: "evil.example.com" })).toBe(403);
    expect(
      await rawStatus(dev.url, { origin: "https://inspector.manufact.com" })
    ).not.toBe(403);
    expect(
      await rawStatus(dev.url, { origin: `http://localhost:${port}` })
    ).not.toBe(403);

    // Dev API routes sit in front of the MCP handler and must be covered by
    // the same Host check (starting a tunnel would expose the server publicly).
    const infoUrl = `${dev.url}/inspector/api/dev/info`;
    expect(await rawStatus(infoUrl, { host: "evil.example.com" }, "GET")).toBe(
      403
    );
    expect(await rawStatus(infoUrl, {}, "GET")).toBe(200);

    expect(await rawStatus(infoUrl, { origin: "null" }, "GET")).toBe(200);
    expect(await rawStatus(dev.url, { origin: "null" })).not.toBe(403);
  });

  it("keeps the loopback-capable Inspector off the public tunnel host", async () => {
    const cwd = copyFixture("dev-inspector-tunnel-policy");
    cleanups.push(() => removeDir(cwd));
    installFakeInspector(cwd);

    const port = await getFreePort();
    const dev = await startDev(cwd, port);
    cleanups.push(dev.stop);

    const startTunnel = await fetch(
      `${dev.url}/inspector/api/dev/start-tunnel`,
      { method: "POST" }
    );
    expect(startTunnel.status).toBe(200);
    const tunnelHost = "fake.local.mcp-use.run";
    expect(await rawStatus(dev.url, { host: tunnelHost })).toBe(200);
    expect(
      await rawStatus(`${dev.url}/inspector`, { host: tunnelHost }, "GET")
    ).toBe(404);
  });
});

/** Issue a raw request with unsanitized headers; resolves with the status. */
async function rawStatus(
  target: string,
  headers: Record<string, string>,
  method: "POST" | "GET" = "POST"
): Promise<number> {
  const { request } = await import("node:http");
  const body =
    method === "POST"
      ? JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {},
        })
      : undefined;
  return new Promise((resolve, reject) => {
    const req = request(
      target,
      {
        method,
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(body !== undefined && {
            "content-length": Buffer.byteLength(body),
          }),
          ...headers,
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

/** Issue a raw GET with an explicit Host header and return its body. */
async function rawGetBody(
  target: string,
  headers: Record<string, string>
): Promise<string> {
  const { request } = await import("node:http");
  return new Promise((resolve, reject) => {
    const req = request(target, { method: "GET", headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("runDev (views)", () => {
  it("shuts down with active MCP subscriptions and HMR WebSockets", async () => {
    const cwd = copyFixture("dev-active-connections-shutdown", "views");
    cleanups.push(() => removeDir(cwd));

    const port = await getFreePort();
    const dev = await startDev(cwd, port);
    cleanups.push(dev.stop);

    const client = new Client(
      { name: "dev-shutdown-test", version: "1.0.0" },
      {
        versionNegotiation: { mode: { pin: "2026-07-28" } },
        listChanged: {
          tools: {
            autoRefresh: true,
            debounceMs: 0,
            onChanged: () => {},
          },
        },
      }
    );
    await client.connect(new StreamableHTTPClientTransport(new URL(dev.url)));
    cleanups.push(() => client.close().catch(() => {}));
    await waitFor(async () =>
      dev.logs.some((line) => line.includes("subscriptions/listen"))
        ? true
        : undefined
    );

    const ws = new WebSocket(`ws://127.0.0.1:${port}/`, "vite-hmr");
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener(
        "error",
        () => reject(new Error("HMR websocket failed to connect")),
        { once: true }
      );
    });
    cleanups.push(() => ws.close());
    const wsClosed = new Promise<void>((resolve) => {
      ws.addEventListener("close", () => resolve(), { once: true });
    });

    const shutdown = await Promise.race([
      dev.stop().then(() => "stopped" as const),
      new Promise<"timed-out">((resolve) => {
        setTimeout(() => resolve("timed-out"), 5_000);
      }),
    ]);

    expect(shutdown).toBe("stopped");
    await expect(wsClosed).resolves.toBeUndefined();

    const rebound = await occupyPort(port);
    await new Promise<void>((resolve) => rebound.close(() => resolve()));
  }, 30_000);

  it("serves view documents, virtual entries, and reloads on view add", async () => {
    const cwd = copyFixture("dev-views", "views");
    cleanups.push(() => removeDir(cwd));

    const port = await getFreePort();
    const dev = await startDev(cwd, port);
    cleanups.push(dev.stop);

    const base = dev.url.replace(/\/mcp$/, "");

    const readBody = await mcpRequest(
      dev.url,
      "resources/read",
      {
        uri: "ui://views/product-search-result.html",
      },
      { ui: true }
    );
    const docHtml = (readBody["result"] as { contents: { text: string }[] })
      .contents[0]!.text;
    expect(docHtml).toContain('id="root"');
    expect(docHtml).toContain("/@vite/client");
    expect(docHtml).toMatch(/virtual:mcp-use\/views\/product-search-result/);

    const virtualMatch =
      /src="([^"]+virtual:mcp-use\/views\/product-search-result[^"]*)"/.exec(
        docHtml
      );
    expect(virtualMatch).not.toBeNull();
    const virtualUrl = new URL(virtualMatch![1]!, base).href;
    const virtualResponse = await fetch(virtualUrl);
    expect(virtualResponse.status).toBe(200);
    const virtualJs = await virtualResponse.text();
    expect(virtualJs).toMatch(/bootstrapView/);
    expect(virtualJs).toContain("import * as viewModule from");
    expect(virtualJs).toContain("bootstrapView(viewModule)");

    // The tunnel hostname becomes known after Vite starts. The framework's
    // dynamic Host validator authorizes it, then presents it to Vite as the
    // already-allowed localhost host so module requests are not blocked by
    // Vite's static allowlist.
    tunnelState.url = "https://fake.local.mcp-use.run";
    const tunnelViteClient = await rawGetBody(`${base}/@vite/client`, {
      host: "fake.local.mcp-use.run",
      origin: "null",
    });
    expect(tunnelViteClient).toContain("createHotContext");
    expect(tunnelViteClient).toContain("updateStyle");
    expect(tunnelViteClient).toContain("new WebSocket");
    tunnelState.url = null;

    // Vite module CORS (CLI_SPEC.md § DNS-rebinding protection):
    // without a tunnel, a validated loopback Origin is reflected exactly
    // (with Vary: Origin) so a local MCP host can load the module graph…
    const loopbackOrigin = "http://localhost:6274";
    const loopbackResponse = await fetch(virtualUrl, {
      headers: { origin: loopbackOrigin },
    });
    expect(loopbackResponse.status).toBe(200);
    expect(loopbackResponse.headers.get("access-control-allow-origin")).toBe(
      loopbackOrigin
    );
    expect(loopbackResponse.headers.get("vary")).toMatch(/Origin/i);

    // …while foreign and missing Origin get no ACAO…
    const foreignResponse = await fetch(virtualUrl, {
      headers: { origin: "https://host.example" },
    });
    expect(foreignResponse.status).toBe(200);
    expect(
      foreignResponse.headers.get("access-control-allow-origin")
    ).toBeNull();

    // …opaque sandbox iframes (`Origin: null`) get `null` so dev widgets load.
    const nullOriginResponse = await fetch(virtualUrl, {
      headers: { origin: "null" },
    });
    expect(nullOriginResponse.status).toBe(200);
    expect(nullOriginResponse.headers.get("access-control-allow-origin")).toBe(
      "null"
    );

    const noOriginResponse = await fetch(virtualUrl);
    expect(noOriginResponse.status).toBe(200);
    expect(
      noOriginResponse.headers.get("access-control-allow-origin")
    ).toBeNull();

    // …and `*` while a tunnel is active, since hosts rendering through it
    // fetch modules in CORS mode from their own (or opaque) origins.
    tunnelState.url = "https://fake.local.mcp-use.run";
    const tunneledResponse = await fetch(virtualUrl, {
      headers: { origin: "https://host.example" },
    });
    expect(tunneledResponse.status).toBe(200);
    expect(tunneledResponse.headers.get("access-control-allow-origin")).toBe(
      "*"
    );

    const viewModuleResponse = await fetch(
      `${base}/views/product-search-result/view.tsx`
    );
    expect(viewModuleResponse.status).toBe(200);

    const assetImportResponse = await fetch(
      `${base}/views/product-search-result/badge.png?import`
    );
    expect(assetImportResponse.status).toBe(200);
    const assetImportJs = await assetImportResponse.text();
    // Vite `server.origin` is the browsable origin: `localhost`, not the
    // 127.0.0.1 bind address (VIEWS_SPEC.md § Dev).
    expect(assetImportJs).toMatch(
      new RegExp(
        `http://localhost:${port}/views/product-search-result/badge\\.png`
      )
    );

    const publicResponse = await fetch(`${base}/mcp/_mcp-use/public/test.txt`);
    expect(publicResponse.status).toBe(200);
    expect(publicResponse.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate"
    );
    expect(await publicResponse.text()).toBe("public-fixture\n");

    const docConfigMatch =
      /__mcpUseViewConfig=\{[^}]*"publicBase":"([^"]+)"/.exec(docHtml);
    expect(docConfigMatch).not.toBeNull();
    expect(docConfigMatch![1]).toBe(
      `http://localhost:${port}/mcp/_mcp-use/public/`
    );

    const toolsBody = await mcpRequest(dev.url, "tools/list", {}, { ui: true });
    const searchTool = (
      toolsBody["result"] as {
        tools: { name: string; _meta?: Record<string, unknown> }[];
      }
    ).tools.find((t) => t.name === "search-products");
    expect(searchTool?._meta?.["ui"]).toMatchObject({
      resourceUri: "ui://views/product-search-result.html",
    });

    const resourcesBody = await mcpRequest(
      dev.url,
      "resources/list",
      {},
      { ui: true }
    );
    const viewResource = (
      resourcesBody["result"] as {
        resources: {
          uri: string;
          _meta?: Record<string, unknown>;
        }[];
      }
    ).resources.find((r) => r.uri === "ui://views/product-search-result.html");
    const connectDomains = (
      viewResource?._meta?.["ui"] as
        | { csp?: { connectDomains?: string[] } }
        | undefined
    )?.csp?.connectDomains;
    expect(connectDomains).toEqual(
      expect.arrayContaining([`ws://localhost:${port}`])
    );

    mkdirSync(join(cwd, "views", "extra-view"), { recursive: true });
    writeFileSync(
      join(cwd, "views", "extra-view", "view.tsx"),
      `export default function Extra() { return <div>extra</div>; }\n`
    );

    await waitFor(async () => {
      const list = await mcpRequest(
        dev.url,
        "resources/list",
        {},
        { ui: true }
      );
      const uris = (
        list["result"] as { resources: { uri: string }[] }
      ).resources.map((r) => r.uri);
      return uris.includes("ui://views/extra-view.html") ? true : undefined;
    });
  }, 60_000);

  it("hot-updates a view.tsx edit without a full document reload", async () => {
    // Regression: without React Fast Refresh (auto-injected
    // @vitejs/plugin-react + the refresh preamble in the virtual entry),
    // every view.tsx edit fell back to Vite `full-reload` — reloading the
    // srcdoc iframe document and wiping all view state.
    const cwd = copyFixture("dev-views-hmr", "views");
    cleanups.push(() => removeDir(cwd));

    const port = await getFreePort();
    const dev = await startDev(cwd, port);
    cleanups.push(dev.stop);
    const base = dev.url.replace(/\/mcp$/, "");

    // The virtual entry pins the Fast Refresh contract: preamble first,
    // self-accept last.
    const entryResponse = await fetch(
      `${base}/@id/__x00__virtual:mcp-use/views/product-search-result`
    );
    expect(entryResponse.status).toBe(200);
    const entryJs = await entryResponse.text();
    expect(entryJs).toContain("@vitejs/plugin-react/preamble");
    expect(entryJs).toContain("import.meta.hot.accept()");
    expect(entryJs).toContain("import * as viewModule from");
    expect(entryJs).toContain("bootstrapView(viewModule)");

    // Populate the client module graph the way a browser loading the view
    // document would: fetch each module and, recursively, its static
    // imports. A 504 is Vite's "outdated optimize dep" — retry like a
    // browser reload of the request would.
    const seen = new Set<string>();
    const loadModule = async (url: string): Promise<void> => {
      const abs = url.startsWith("http") ? url : `${base}${url}`;
      if (seen.has(abs) || seen.size > 60) return;
      seen.add(abs);
      let response = await fetch(abs);
      if (response.status === 504) {
        response = await fetch(abs);
      }
      if (!response.ok) return;
      const js = await response.text();
      const imports = [...js.matchAll(/from\s+"([^"]+)"|import\s+"([^"]+)"/g)]
        .map((m) => m[1] ?? m[2])
        .filter((s): s is string => s !== undefined && s.startsWith("/"));
      for (const specifier of imports) {
        await loadModule(specifier);
      }
    };
    await loadModule("/@id/__x00__virtual:mcp-use/views/product-search-result");
    const viewModule = await fetch(
      `${base}/views/product-search-result/view.tsx`
    );
    // Fast Refresh wrapped the view component module.
    expect(await viewModule.text()).toContain("RefreshRuntime");

    const messages: { type: string; updates?: { path: string }[] }[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`, "vite-hmr");
    ws.addEventListener("message", (event) => {
      messages.push(
        JSON.parse(String(event.data)) as (typeof messages)[number]
      );
    });
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", () =>
        reject(new Error("HMR websocket failed to connect"))
      );
    });
    cleanups.push(() => ws.close());

    // Let any dep-optimizer churn from the initial module loads settle so
    // the assertion window only contains the edit's own messages.
    await new Promise((r) => setTimeout(r, 1000));
    messages.length = 0;

    const viewPath = join(cwd, "views", "product-search-result", "view.tsx");
    const viewSource = readFileSync(viewPath, "utf8");
    writeFileSync(viewPath, viewSource.replace("results", "hot-results"));

    const update = await waitFor(async () =>
      messages.find(
        (m) =>
          m.type === "update" &&
          m.updates?.some((u) => u.path.endsWith("/view.tsx"))
      )
    );
    expect(update).toBeDefined();
    expect(messages.filter((m) => m.type === "full-reload")).toEqual([]);
  }, 60_000);

  it("runs two dev servers concurrently with HMR on each main port", async () => {
    // Regression: the HMR websocket must ride the main HTTP listener
    // (server.hmr.server), not a fixed side port — a hardcoded HMR port made
    // the second concurrent `mcp-use dev` process fail to bind.
    const cwdA = copyFixture("dev-views-a", "views");
    const cwdB = copyFixture("dev-views-b", "views");
    cleanups.push(
      () => removeDir(cwdA),
      () => removeDir(cwdB)
    );

    const portA = await getFreePort();
    const devA = await startDev(cwdA, portA);
    cleanups.push(devA.stop);
    const portB = await getFreePort();
    const devB = await startDev(cwdB, portB);
    cleanups.push(devB.stop);

    // Vite's HMR client speaks the `vite-hmr` subprotocol and greets with a
    // `connected` message; an upgrade succeeding on the MAIN port proves the
    // websocket shares the one listener.
    const probeHmr = async (port: number): Promise<string> =>
      new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/`, "vite-hmr");
        const timer = setTimeout(() => {
          ws.close();
          reject(new Error(`no HMR greeting on port ${port}`));
        }, 10_000);
        ws.addEventListener("message", (event) => {
          clearTimeout(timer);
          ws.close();
          resolve(String(event.data));
        });
        ws.addEventListener("error", () => {
          clearTimeout(timer);
          reject(new Error(`websocket upgrade failed on port ${port}`));
        });
      });

    expect(await probeHmr(portA)).toContain("connected");
    expect(await probeHmr(portB)).toContain("connected");

    // Both servers keep serving MCP + view documents side by side.
    for (const dev of [devA, devB]) {
      const readBody = await mcpRequest(
        dev.url,
        "resources/read",
        {
          uri: "ui://views/product-search-result.html",
        },
        { ui: true }
      );
      const docHtml = (readBody["result"] as { contents: { text: string }[] })
        .contents[0]!.text;
      expect(docHtml).toContain("/@vite/client");
    }
  }, 90_000);
});
