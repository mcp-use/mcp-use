/**
 * Tests for the `mcp-use` bin: argv parsing, port precedence, and the inline
 * `start` command run against real on-disk fixtures — a temp project with a
 * `.mcp-use/build/` workspace containing a manifest and a built entry, with
 * zero mocks of the filesystem or module loader.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { parseArgs, resolveHost, resolvePort } from "../src/bin/args.js";
import { main } from "../src/bin/main.js";
import { runStart } from "../src/bin/start.js";

const { mountInspector } = vi.hoisted(() => ({
  mountInspector: vi.fn(),
}));

vi.mock("@mcp-use/inspector", () => ({ mountInspector }));

/** An entry that echoes back the port it was asked to listen on (no bind). */
const ECHO_ENTRY = `
const server = {
  async listen(port = 3000) {
    return { port, url: \`http://localhost:\${port}/mcp\` };
  },
  async close() {},
};
export default server;
`;

/** An entry that exposes configured address defaults without binding. */
const ADDRESS_ENTRY = `
const server = {
  host: "configured-host",
  port: 4321,
  async listen(port = 3000, options) {
    return { port, url: \`http://\${options?.host}:\${port}/mcp\` };
  },
  async close() {},
};
export default server;
`;

/** An entry that binds a real HTTP server so the started URL can be fetched. */
const HTTP_ENTRY = `
import { createServer } from "node:http";
let http;
const server = {
  async listen(port = 3000) {
    http = createServer((req, res) => { res.end("hello from built server"); });
    await new Promise((resolve) => http.listen(port, "127.0.0.1", resolve));
    const bound = http.address().port;
    return { port: bound, url: \`http://127.0.0.1:\${bound}/mcp\` };
  },
  async close() {
    await new Promise((resolve) => http.close(resolve));
  },
};
export default server;
`;

/** A built entry that verifies the production Inspector route contract. */
const INSPECTOR_ENTRY = `
const server = {
  basePath: "/api/mcp",
  async listen(port = 3000, options) {
    if (!Array.isArray(options?.routes) || options.routes.length !== 1) {
      throw new Error("expected one Inspector route");
    }
    const [route] = options.routes;
    const inspector = new Request("http://localhost/api/mcp/inspector");
    if (!route.match(inspector)) {
      throw new Error("Inspector route did not match");
    }
    const inspectorResponse = await route.handler(inspector);
    if (route.match(new Request("http://localhost/api/mcp"))) {
      throw new Error("Inspector route intercepted MCP");
    }
    if ((await inspectorResponse.text()) !== "inspector") {
      throw new Error("Inspector route was not dispatched");
    }
    return { port, url: \`http://localhost:\${port}/api/mcp\` };
  },
  async close() {},
};
export default server;
`;

const tempDirs: string[] = [];

/** Create a temp project with a `.mcp-use/build/` workspace fixture. */
async function makeProject(options?: {
  entrySource?: string;
  manifest?: string;
}): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "mcp-use-bin-"));
  tempDirs.push(cwd);
  const buildDir = join(cwd, ".mcp-use", "build");
  await mkdir(buildDir, { recursive: true });
  await writeFile(
    join(buildDir, "manifest.json"),
    options?.manifest ??
      JSON.stringify({
        buildId: "test",
        entryPoint: "index.js",
        createdAt: new Date().toISOString(),
      })
  );
  if (options?.entrySource !== undefined) {
    await writeFile(join(buildDir, "index.js"), options.entrySource);
  }
  return cwd;
}

afterAll(async () => {
  await Promise.all(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  mountInspector.mockReset();
});

describe("parseArgs", () => {
  it("extracts the subcommand", () => {
    expect(parseArgs(["start"]).command).toBe("start");
    expect(parseArgs([]).command).toBeUndefined();
  });

  it("parses --port, -p, and --port=<n>", () => {
    expect(parseArgs(["start", "--port", "8080"]).port).toBe(8080);
    expect(parseArgs(["start", "-p", "8080"]).port).toBe(8080);
    expect(parseArgs(["start", "--port=8080"]).port).toBe(8080);
  });

  it("parses --entry and --host", () => {
    const args = parseArgs(["dev", "--entry", "src/app.ts", "--host", "::1"]);
    expect(args.entry).toBe("src/app.ts");
    expect(args.host).toBe("::1");
  });

  it("parses standalone project and source layout options", () => {
    const args = parseArgs([
      "dev",
      "--path",
      "apps/web",
      "--mcp-dir=src/mcp",
      "--views-dir",
      "../mcp/views",
    ]);
    expect(args.path).toBe("apps/web");
    expect(args.mcpDir).toBe("src/mcp");
    expect(args.viewsDir).toBe("../mcp/views");
  });

  it("parses --tunnel", () => {
    expect(parseArgs(["dev", "--tunnel"]).tunnel).toBe(true);
    expect(parseArgs(["dev"]).tunnel).toBe(false);
  });

  it("parses --no-open (auto-open defaults to on)", () => {
    expect(parseArgs(["dev", "--no-open"]).open).toBe(false);
    expect(parseArgs(["dev"]).open).toBe(true);
  });

  it("parses --no-inspector (dev inspector defaults to on)", () => {
    expect(parseArgs(["dev", "--no-inspector"]).inspector).toBe(false);
    expect(parseArgs(["dev"]).inspector).toBe(true);
  });

  it("parses --with-inspector for production start", () => {
    expect(parseArgs(["start", "--with-inspector"]).withInspector).toBe(true);
    expect(parseArgs(["start"]).withInspector).toBe(false);
  });

  it("parses --source-maps for build", () => {
    expect(parseArgs(["build", "--source-maps"]).sourceMaps).toBe(true);
    expect(parseArgs(["build"]).sourceMaps).toBe(false);
  });

  it("parses --inline for build without changing the default", () => {
    expect(parseArgs(["build", "--inline"]).inline).toBe(true);
    expect(parseArgs(["build"]).inline).toBe(false);
    expect(() => parseArgs(["build", "--no-inline"])).toThrow(
      /Unknown option: --no-inline/
    );
  });

  it("documents --inline in command help", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(main(["build", "--help"])).resolves.toBe(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("--inline"));
  });

  it("parses help and version flags", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
    expect(parseArgs(["--version"]).version).toBe(true);
    expect(parseArgs(["-v"]).version).toBe(true);
  });

  it("rejects invalid ports", () => {
    expect(() => parseArgs(["start", "--port", "nope"])).toThrow(
      /invalid port/i
    );
    expect(() => parseArgs(["start", "--port", "70000"])).toThrow(
      /invalid port/i
    );
  });

  it("rejects a flag with a missing value", () => {
    expect(() => parseArgs(["start", "--port"])).toThrow(/missing value/i);
    expect(() => parseArgs(["dev", "--entry", "--host"])).toThrow(
      /missing value/i
    );
  });

  it("rejects unknown options and extra positionals", () => {
    expect(() => parseArgs(["start", "--bogus"])).toThrow(/unknown option/i);
    expect(() => parseArgs(["start", "extra"])).toThrow(/unexpected argument/i);
  });
});

describe("resolvePort", () => {
  it("prefers the flag over PORT env over config over the 3000 default", () => {
    expect(resolvePort(8080, { PORT: "4000" })).toBe(8080);
    expect(resolvePort(undefined, { PORT: "4000" })).toBe(4000);
    expect(resolvePort(undefined, {}, 4100)).toBe(4100);
    expect(resolvePort(undefined, {})).toBe(3000);
  });

  it("ignores an unusable PORT env value", () => {
    expect(resolvePort(undefined, { PORT: "not-a-port" })).toBe(3000);
    expect(resolvePort(undefined, { PORT: "" })).toBe(3000);
  });
});

describe("resolveHost", () => {
  it("prefers the flag over HOST env over config over the default", () => {
    expect(resolveHost("flag-host", { HOST: "env-host" }, "code-host")).toBe(
      "flag-host"
    );
    expect(resolveHost(undefined, { HOST: "env-host" }, "code-host")).toBe(
      "env-host"
    );
    expect(resolveHost(undefined, {}, "code-host")).toBe("code-host");
    expect(resolveHost(undefined, {})).toBe("127.0.0.1");
  });

  it("ignores an empty HOST env value", () => {
    expect(resolveHost(undefined, { HOST: "   " }, "code-host")).toBe(
      "code-host"
    );
  });
});

describe("runStart", () => {
  it("errors actionably when there is no build", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mcp-use-bin-empty-"));
    tempDirs.push(cwd);
    await expect(runStart({ cwd })).rejects.toThrow(/mcp-use build/);
    await expect(runStart({ cwd })).rejects.toThrow(/no production build/i);
  });

  it("errors on a manifest without an entryPoint", async () => {
    const cwd = await makeProject({ manifest: `{ "buildId": "x" }` });
    await expect(runStart({ cwd })).rejects.toThrow(/invalid build manifest/i);
  });

  it("errors when the entry has no default export", async () => {
    const cwd = await makeProject({ entrySource: `export const x = 1;` });
    await expect(runStart({ cwd })).rejects.toThrow(/no default export/);
  });

  it("errors when the default export has no listen()", async () => {
    const cwd = await makeProject({
      entrySource: `export default { notAServer: true };`,
    });
    await expect(runStart({ cwd })).rejects.toThrow(/listen/);
  });

  it("starts the built entry and responds over HTTP", async () => {
    const cwd = await makeProject({ entrySource: HTTP_ENTRY });
    const started = await runStart({ cwd, port: 0 });
    try {
      expect(started.port).toBeGreaterThan(0);
      expect(started.url).toBe(`http://127.0.0.1:${started.port}/mcp`);
      const response = await fetch(started.url);
      expect(await response.text()).toBe("hello from built server");
    } finally {
      await started.close();
    }
  });

  it("mounts Inspector on the existing production listener only when requested", async () => {
    mountInspector.mockImplementation(
      () => async () => new Response("inspector")
    );
    const cwd = await makeProject({ entrySource: INSPECTOR_ENTRY });
    const manifestPath = join(cwd, ".mcp-use", "build", "manifest.json");
    const before = await readFile(manifestPath, "utf8");

    const started = await runStart({ cwd, port: 0, withInspector: true });
    try {
      expect(started.url).toBe(`http://localhost:${started.port}/api/mcp`);
      expect(mountInspector).toHaveBeenCalledWith({
        basePath: "/api/mcp",
        devMode: false,
        oauthProxyAllowLoopback: false,
      });
      await expect(readFile(manifestPath, "utf8")).resolves.toBe(before);
    } finally {
      await started.close();
    }
  });

  it("applies address precedence: flags over env over server config over defaults", async () => {
    const cwd = await makeProject({ entrySource: ADDRESS_ENTRY });

    vi.stubEnv("PORT", "4123");
    vi.stubEnv("HOST", "env-host");
    expect((await runStart({ cwd, port: 5001, host: "flag-host" })).url).toBe(
      "http://flag-host:5001/mcp"
    );
    expect((await runStart({ cwd })).url).toBe("http://env-host:4123/mcp");

    vi.stubEnv("PORT", undefined);
    vi.stubEnv("HOST", undefined);
    expect((await runStart({ cwd })).url).toBe(
      "http://configured-host:4321/mcp"
    );
  });

  it("sets NODE_ENV=production only when unset", async () => {
    const cwd = await makeProject({ entrySource: ECHO_ENTRY });

    vi.stubEnv("NODE_ENV", undefined);
    await runStart({ cwd, port: 5002 });
    expect(process.env.NODE_ENV).toBe("production");

    vi.stubEnv("NODE_ENV", "staging");
    await runStart({ cwd, port: 5003 });
    expect(process.env.NODE_ENV).toBe("staging");
  });
});

describe("main", () => {
  it("prints help and fails on an unknown command", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(main(["frobnicate"])).resolves.toBe(2);
    expect(errors.mock.calls.flat().join("\n")).toContain("Usage: mcp-use");
  });

  it("prints help and fails when no command is given", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(main([])).resolves.toBe(2);
    expect(errors.mock.calls.flat().join("\n")).toContain("Usage: mcp-use");
  });

  it("prints the package version for --version", async () => {
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(main(["--version"])).resolves.toBe(0);
    expect(logs.mock.calls.flat().join("")).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("prints help for --help", async () => {
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(main(["--help"])).resolves.toBe(0);
    expect(logs.mock.calls.flat().join("\n")).toContain("Usage: mcp-use");
  });

  it("prints client help for client --help", async () => {
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(main(["client", "--help"])).resolves.toBe(0);
    const output = logs.mock.calls.flat().join("\n");
    expect(output).toContain("mcp-use client connect");
    expect(output).not.toContain("mcp-use deploy");
  });

  it("dispatches build through its dedicated command module", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(main(["build", "--entry", "nope.ts"])).resolves.toBe(1);
    const output = errors.mock.calls.flat().join("\n");
    expect(output).toMatch(/Entry not found/);
  });
});
