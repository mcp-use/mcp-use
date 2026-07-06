/**
 * Tests for the `mcp-use` bin: argv parsing, port precedence, and the inline
 * `start` command run against real on-disk fixtures — a temp project with a
 * `.mcp-use/build/` workspace containing a manifest and a built entry, with
 * zero mocks of the filesystem or module loader.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { parseArgs, resolvePort } from "../src/bin/args.js";
import { isViteMissing, main } from "../src/bin/main.js";
import { runStart } from "../src/bin/start.js";

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

  it("parses --tunnel", () => {
    expect(parseArgs(["dev", "--tunnel"]).tunnel).toBe(true);
    expect(parseArgs(["dev"]).tunnel).toBe(false);
  });

  it("parses --no-open (auto-open defaults to on)", () => {
    expect(parseArgs(["dev", "--no-open"]).open).toBe(false);
    expect(parseArgs(["dev"]).open).toBe(true);
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
    expect(() => parseArgs(["start", "extra"])).toThrow(
      /unexpected argument/i
    );
  });
});

describe("resolvePort", () => {
  it("prefers the flag over PORT env over the 3000 default", () => {
    expect(resolvePort(8080, { PORT: "4000" })).toBe(8080);
    expect(resolvePort(undefined, { PORT: "4000" })).toBe(4000);
    expect(resolvePort(undefined, {})).toBe(3000);
  });

  it("ignores an unusable PORT env value", () => {
    expect(resolvePort(undefined, { PORT: "not-a-port" })).toBe(3000);
    expect(resolvePort(undefined, { PORT: "" })).toBe(3000);
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

  it("applies port precedence: flag over PORT env over 3000", async () => {
    const cwd = await makeProject({ entrySource: ECHO_ENTRY });

    vi.stubEnv("PORT", "4123");
    expect((await runStart({ cwd, port: 5001 })).port).toBe(5001);
    expect((await runStart({ cwd })).port).toBe(4123);

    vi.stubEnv("PORT", undefined);
    expect((await runStart({ cwd })).port).toBe(3000);
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
    await expect(main(["frobnicate"])).resolves.toBe(1);
    expect(errors.mock.calls.flat().join("\n")).toContain("Usage: mcp-use");
  });

  it("prints help and fails when no command is given", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(main([])).resolves.toBe(1);
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

  it("errors actionably when dev/build has no server entry (cli chunk loads, vite is present)", async () => {
    // vite is a devDependency of this package (needed to run the cli's
    // own tests below), so it is always resolvable here — this test proves
    // the cli chunk dispatch itself works (import succeeds, runDev/runBuild
    // run) by driving it to its next failure mode instead: no server entry in
    // this cwd's fixture. See `describe("isViteMissing")` for the missing-vite
    // classification this bin also has to handle, unit-tested directly since
    // reliably un-resolving vite from *this* workspace is impractical (vite
    // is required by tests/cli/*). Runs against the real process.cwd()
    // (this package) with a deliberately nonexistent --entry override.
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(main(["build", "--entry", "nope.ts"])).resolves.toBe(1);
    const output = errors.mock.calls.flat().join("\n");
    expect(output).toMatch(/Entry not found/);
  });
});

describe("isViteMissing", () => {
  /**
   * Node's exact shape for a missing bare import, confirmed against a real
   * `await import("./mod.js")` where `mod.js` does `import { x } from "vite"`
   * and vite is not installed:
   * `Error: Cannot find package 'vite' imported from <path>`,
   * `error.code === "ERR_MODULE_NOT_FOUND"`.
   */
  function moduleNotFoundError(specifier: string): NodeJS.ErrnoException {
    const error = new Error(
      `Cannot find package '${specifier}' imported from /project/cli/build.js`
    ) as NodeJS.ErrnoException;
    error.code = "ERR_MODULE_NOT_FOUND";
    return error;
  }

  it("classifies a missing vite import", () => {
    expect(isViteMissing(moduleNotFoundError("vite"))).toBe(true);
  });

  it("does not classify a missing unrelated package", () => {
    expect(isViteMissing(moduleNotFoundError("left-pad"))).toBe(false);
  });

  it("does not classify a module-not-found for a local file path", () => {
    const error = new Error(
      "Cannot find module '/project/.mcp-use/build/index.js' imported from /project"
    ) as NodeJS.ErrnoException;
    error.code = "ERR_MODULE_NOT_FOUND";
    expect(isViteMissing(error)).toBe(false);
  });

  it("does not classify errors with a different code", () => {
    const error = new Error("Cannot find package 'vite'") as NodeJS.ErrnoException;
    error.code = "ERR_INVALID_ARG_TYPE";
    expect(isViteMissing(error)).toBe(false);
  });

  it("does not classify non-Error values", () => {
    expect(isViteMissing("nope")).toBe(false);
    expect(isViteMissing(undefined)).toBe(false);
  });
});
