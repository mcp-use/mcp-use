/**
 * Tests for the `mcp-use` bin: argv parsing, port precedence, and the inline
 * `start` command run against real on-disk fixtures — a temp project with a
 * `.mcp-use/build/` workspace containing a manifest and a built entry, with
 * zero mocks of the filesystem or module loader.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const tunnelMocks = vi.hoisted(() => ({
  create: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("../src/cli/tunnel.js", () => ({
  createTunnelManager: tunnelMocks.create,
}));

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
let inspectorMiddleware;
const server = {
  basePath: "/api/mcp",
  app: {
    use(path, handler) {
      if (path !== "*") throw new Error("expected global Inspector middleware");
      inspectorMiddleware = handler;
    },
  },
  async listen(port = 3000, options) {
    if (typeof inspectorMiddleware !== "function") throw new Error("missing Inspector middleware");
    const inspector = new Request("http://localhost/api/mcp/inspector");
    const inspectorResponse = await inspectorMiddleware({ req: { raw: inspector } }, async () => {
      throw new Error("Inspector route did not match");
    });
    let continued = false;
    await inspectorMiddleware(
      { req: { raw: new Request("http://localhost/api/mcp") } },
      async () => { continued = true; }
    );
    if (!continued) throw new Error("Inspector middleware intercepted MCP");
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

beforeEach(() => {
  tunnelMocks.start.mockReset();
  tunnelMocks.stop.mockReset();
  tunnelMocks.create.mockReset();
  tunnelMocks.start.mockResolvedValue({
    url: "https://public-test.local.mcp-use.run",
    subdomain: "public-test",
  });
  tunnelMocks.stop.mockResolvedValue(undefined);
  tunnelMocks.create.mockReturnValue({
    start: tunnelMocks.start,
    stop: tunnelMocks.stop,
    status: () => ({ url: null }),
  });
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
    expect(parseArgs(["start", "--tunnel"]).tunnel).toBe(true);
    expect(parseArgs(["dev"]).tunnel).toBe(false);
    expect(parseArgs(["start"]).tunnel).toBe(false);
  });

  it("parses --no-open (auto-open defaults to on)", () => {
    expect(parseArgs(["dev", "--no-open"]).open).toBe(false);
    expect(parseArgs(["dev"]).open).toBe(true);
  });

  it("parses --no-inspector / --with-inspector as an optional preference", () => {
    expect(parseArgs(["dev"]).inspector).toBeUndefined();
    expect(parseArgs(["start"]).inspector).toBeUndefined();
    expect(parseArgs(["dev", "--no-inspector"]).inspector).toBe(false);
    expect(parseArgs(["start", "--with-inspector"]).inspector).toBe(true);
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

  it("forwards arguments after -- only for typecheck", () => {
    expect(
      parseArgs(["typecheck", "--", "--project", "tsconfig.check.json"])
        .passthrough
    ).toEqual(["--project", "tsconfig.check.json"]);
    expect(() => parseArgs(["build", "--", "--pretty", "false"])).toThrow(
      /only available for typecheck/i
    );
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

  it("starts a tunnel after binding and closes both resources", async () => {
    const cwd = await makeProject({ entrySource: HTTP_ENTRY });
    tunnelMocks.start.mockImplementationOnce(async (port: number) => {
      const response = await fetch(`http://127.0.0.1:${port}/mcp`);
      expect(await response.text()).toBe("hello from built server");
      return {
        url: "https://public-test.local.mcp-use.run",
        subdomain: "public-test",
      };
    });

    const started = await runStart({ cwd, port: 0, tunnel: true });

    expect(tunnelMocks.create).toHaveBeenCalledWith(
      join(cwd, ".mcp-use", "state", "tunnel.json")
    );
    expect(tunnelMocks.start).toHaveBeenCalledWith(started.port);
    expect(started.tunnelUrl).toBe("https://public-test.local.mcp-use.run/mcp");

    await started.close();
    expect(tunnelMocks.stop).toHaveBeenCalledOnce();
    await expect(fetch(started.url)).rejects.toThrow();
  });

  it("closes the bound server when tunnel startup fails", async () => {
    const cwd = await makeProject({ entrySource: HTTP_ENTRY });
    let boundPort: number | undefined;
    tunnelMocks.start.mockImplementationOnce(async (port: number) => {
      boundPort = port;
      throw new Error("tunnel unavailable");
    });

    await expect(runStart({ cwd, port: 0, tunnel: true })).rejects.toThrow(
      "tunnel unavailable"
    );

    expect(tunnelMocks.stop).toHaveBeenCalledOnce();
    expect(boundPort).toBeDefined();
    await expect(
      fetch(`http://127.0.0.1:${boundPort ?? 0}/mcp`)
    ).rejects.toThrow();
  });

  it("coexists with Inspector routing on the production listener", async () => {
    mountInspector.mockImplementation(
      () => async () => new Response("inspector")
    );
    const cwd = await makeProject({ entrySource: INSPECTOR_ENTRY });

    const started = await runStart({
      cwd,
      port: 4568,
      withInspector: true,
      tunnel: true,
    });
    try {
      expect(mountInspector).toHaveBeenCalledWith({
        basePath: "/api/mcp",
        devMode: false,
        oauthProxyAllowLoopback: false,
      });
      expect(tunnelMocks.start).toHaveBeenCalledWith(4568);
      expect(started.tunnelUrl).toBe(
        "https://public-test.local.mcp-use.run/api/mcp"
      );
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
    await expect(
      main(["--version"], { frameworkVersion: "9.8.7-test" })
    ).resolves.toBe(0);
    expect(logs.mock.calls.flat().join("")).toBe("9.8.7-test");
  });

  it("prints help for --help", async () => {
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(main(["--help"])).resolves.toBe(0);
    expect(logs.mock.calls.flat().join("\n")).toContain("Usage: mcp-use");
    expect(logs.mock.calls.flat().join("\n")).toContain(
      "public tunnel (dev/start only)"
    );
    expect(logs.mock.calls.flat().join("\n")).not.toContain(
      "Install maintained coding-agent skills"
    );
  });

  it("prints the public MCP URL and stops the tunnel on a signal", async () => {
    const cwd = await makeProject({ entrySource: ECHO_ENTRY });
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    const existingSigint = new Set(process.listeners("SIGINT"));
    const existingSigterm = new Set(process.listeners("SIGTERM"));

    await expect(
      main(["start", "--path", cwd, "--port", "4567", "--tunnel"])
    ).resolves.toBe(0);

    expect(logs.mock.calls.flat().join("\n")).toContain(
      "mcp-use public MCP URL: https://public-test.local.mcp-use.run/mcp"
    );

    const sigint = process
      .listeners("SIGINT")
      .find((listener) => !existingSigint.has(listener));
    const sigterm = process
      .listeners("SIGTERM")
      .find((listener) => !existingSigterm.has(listener));
    expect(sigint).toBeDefined();
    expect(sigterm).toBeDefined();

    try {
      sigint?.("SIGINT");
      sigterm?.("SIGTERM");
      await vi.waitFor(() => {
        expect(exit).toHaveBeenCalledWith(0);
      });
      expect(tunnelMocks.stop).toHaveBeenCalledOnce();
    } finally {
      if (sigint !== undefined) process.off("SIGINT", sigint);
      if (sigterm !== undefined) process.off("SIGTERM", sigterm);
    }
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
