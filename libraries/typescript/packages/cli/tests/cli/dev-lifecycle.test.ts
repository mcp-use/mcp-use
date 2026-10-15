/** Dev startup and cleanup regressions with mocked HTTP, Vite, and tunnel IO. */
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createHttp: vi.fn(),
  createVite: vi.fn(),
  createRunner: vi.fn(),
  stopTunnel: vi.fn(),
  startTunnel: vi.fn(),
}));

vi.mock("node:http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:http")>()),
  createServer: mocks.createHttp,
}));
vi.mock("vite", () => ({
  createServer: mocks.createVite,
  createServerModuleRunner: mocks.createRunner,
  normalizePath: (path: string) => path.replaceAll("\\", "/"),
}));
vi.mock("../../src/cli/port.js", () => ({
  resolvePort: async () => ({ port: 4321, requested: 4321 }),
}));
vi.mock("@mcp-use/tunnel", () => ({
  createTunnelManager: () => ({
    start: mocks.startTunnel,
    stop: mocks.stopTunnel,
    status: () => ({ url: null }),
  }),
}));
vi.mock("@modelcontextprotocol/server", () => ({
  InMemoryServerEventBus: class {
    publish() {}
  },
  localhostAllowedHostnames: () => ["localhost"],
  localhostAllowedOrigins: () => ["http://localhost:4321"],
  validateHostHeader: () => ({ ok: true }),
  validateOriginHeader: () => ({ ok: true }),
}));

import { runDev } from "../../src/cli/dev.js";

class MockHttpServer extends EventEmitter {
  bindError: Error | undefined;
  closeError: Error | undefined;
  connectionsError: Error | undefined;
  closeCallback: ((error?: Error) => void) | undefined;
  delayClose = false;

  listen = vi.fn((_port: number, _host: string, ready: () => void) => {
    queueMicrotask(() => {
      if (this.bindError !== undefined) this.emit("error", this.bindError);
      else ready();
    });
    return this;
  });

  close = vi.fn((complete: (error?: Error) => void) => {
    this.closeCallback = complete;
    if (!this.delayClose) queueMicrotask(() => this.completeClose());
    return this;
  });

  closeAllConnections = vi.fn(() => {
    if (this.connectionsError !== undefined) throw this.connectionsError;
  });

  completeClose(): void {
    this.closeCallback?.(this.closeError);
  }
}

let cwd: string;
let http: MockHttpServer;
let watcher: EventEmitter & { add: ReturnType<typeof vi.fn> };
let viteClose: ReturnType<typeof vi.fn>;
let runnerClose: ReturnType<typeof vi.fn>;
let runnerImport: ReturnType<typeof vi.fn>;
type SignalListener = (signal: NodeJS.Signals) => void;
let signals: Record<"SIGINT" | "SIGTERM", Set<SignalListener>>;

beforeEach(async () => {
  signals = {
    SIGINT: new Set(process.listeners("SIGINT")),
    SIGTERM: new Set(process.listeners("SIGTERM")),
  };
  vi.stubEnv("MCP_URL", undefined);
  vi.stubEnv("PORT", undefined);
  vi.stubEnv("MCP_USE_DEV_CLI", undefined);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(globalThis, "fetch").mockImplementation(() => {
    throw new Error("Network requests are forbidden in lifecycle fixtures.");
  });
  cwd = await mkdtemp(join(tmpdir(), "mcp-use-dev-lifecycle-"));
  await mkdir(join(cwd, "src"));
  await writeFile(join(cwd, "src", "index.ts"), "export default {};");
  await writeFile(join(cwd, "package.json"), '{"type":"module"}');
  const bridge = join(cwd, "node_modules", "mcp-use");
  await mkdir(bridge, { recursive: true });
  await writeFile(
    join(bridge, "package.json"),
    JSON.stringify({
      name: "mcp-use",
      type: "module",
      exports: { "./node": "./node.mjs" },
    })
  );
  await writeFile(
    join(bridge, "node.mjs"),
    "export function toNodeHandler() { return async () => {}; }"
  );

  http = new MockHttpServer();
  watcher = Object.assign(new EventEmitter(), { add: vi.fn() });
  viteClose = vi.fn().mockResolvedValue(undefined);
  runnerClose = vi.fn().mockResolvedValue(undefined);
  runnerImport = vi.fn().mockResolvedValue({
    default: {
      fetch: async () => new Response("unused"),
      __skillsConfig: () => false,
      __primeSkills() {},
      __primeViews() {},
      __setEventBus() {},
      __setRequestLogPrefix() {},
      __mount() {},
    },
  });
  mocks.createHttp.mockReset().mockReturnValue(http);
  mocks.createVite.mockReset().mockResolvedValue({
    watcher,
    close: viteClose,
    environments: { ssr: { moduleGraph: {} } },
  });
  mocks.createRunner.mockReset().mockReturnValue({
    import: runnerImport,
    close: runnerClose,
    evaluatedModules: new Map(),
  });
  mocks.stopTunnel.mockReset().mockResolvedValue(undefined);
  mocks.startTunnel.mockReset().mockResolvedValue({
    url: "https://fixture.invalid",
  });
});

afterEach(async () => {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    for (const listener of process.listeners(signal)) {
      if (!signals[signal].has(listener)) process.off(signal, listener);
    }
  }
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(cwd, { recursive: true, force: true });
});

function start(signal?: AbortSignal): Promise<void> {
  return runDev({
    cwd,
    port: 4321,
    inspector: false,
    open: false,
    ...(signal !== undefined && { signal }),
  });
}

function expectAllClosed(): void {
  expect(mocks.stopTunnel).toHaveBeenCalledOnce();
  expect(http.close).toHaveBeenCalledOnce();
  expect(http.closeAllConnections).toHaveBeenCalledOnce();
  expect(runnerClose).toHaveBeenCalledOnce();
  expect(viteClose).toHaveBeenCalledOnce();
  for (const event of ["change", "add", "unlink"]) {
    expect(watcher.listenerCount(event)).toBe(0);
  }
}

describe("dev resource ownership", () => {
  it("closes initialized resources after a late HTTP bind failure", async () => {
    http.bindError = Object.assign(new Error("port claimed during import"), {
      code: "EADDRINUSE",
    });
    await expect(start()).rejects.toBe(http.bindError);
    expectAllClosed();
  });

  it("closes resources if the project node adapter cannot resolve", async () => {
    // Keep a local package boundary so module resolution cannot fall back to
    // another installation once the workspace packages have been built.
    await writeFile(
      join(cwd, "node_modules", "mcp-use", "package.json"),
      JSON.stringify({ name: "mcp-use", type: "module", exports: {} })
    );
    await expect(start()).rejects.toThrow("Could not resolve mcp-use/node");
    expect(http.listen).not.toHaveBeenCalled();
    expectAllClosed();
  });

  it("preserves the bind error despite independent cleanup failures", async () => {
    http.bindError = new Error("bind failed");
    http.closeError = new Error("HTTP close failed");
    http.connectionsError = new Error("HTTP connections close failed");
    mocks.stopTunnel.mockRejectedValue(new Error("tunnel stop failed"));
    runnerClose.mockRejectedValue(new Error("runner close failed"));
    viteClose.mockRejectedValue(new Error("Vite close failed"));

    await expect(start()).rejects.toBe(http.bindError);
    expectAllClosed();
  });

  it("preserves an initial import failure when runner cleanup also fails", async () => {
    const importError = new Error("entry import failed");
    runnerImport.mockRejectedValue(importError);
    runnerClose.mockRejectedValue(new Error("runner close failed"));
    await expect(start()).rejects.toBe(importError);
    expect(http.listen).not.toHaveBeenCalled();
    expect(http.close).toHaveBeenCalledOnce();
    expect(runnerClose).toHaveBeenCalledOnce();
    expect(viteClose).toHaveBeenCalledOnce();
    expect(mocks.stopTunnel).not.toHaveBeenCalled();
  });

  it("cleans partial startup when constructing the module runner throws", async () => {
    const failure = new Error("module runner construction failed");
    mocks.createRunner.mockImplementation(() => {
      throw failure;
    });
    await expect(start()).rejects.toBe(failure);
    expect(http.close).toHaveBeenCalledOnce();
    expect(viteClose).toHaveBeenCalledOnce();
    expect(runnerClose).not.toHaveBeenCalled();
    expect(mocks.stopTunnel).not.toHaveBeenCalled();
  });

  it("tries every shutdown step and retains all independent failures", async () => {
    const failures = [
      new Error("tunnel stop failed"),
      new Error("HTTP connections close failed"),
      new Error("runner close failed"),
      new Error("Vite close failed"),
      new Error("HTTP close failed"),
    ];
    mocks.stopTunnel.mockRejectedValue(failures[0]);
    http.connectionsError = failures[1];
    runnerClose.mockRejectedValue(failures[2]);
    viteClose.mockRejectedValue(failures[3]);
    http.closeError = failures[4];
    const controller = new AbortController();
    const done = start(controller.signal);
    const result = done.catch((error: unknown) => error);
    await vi.waitFor(() => {
      expect(
        process
          .listeners("SIGTERM")
          .some((listener) => !signals.SIGTERM.has(listener))
      ).toBe(true);
    });
    controller.abort();
    const error = await result;

    expect(error).toBeInstanceOf(AggregateError);
    expect(new Set((error as AggregateError).errors)).toEqual(
      new Set(failures)
    );
    expectAllClosed();
    expect(new Set(process.listeners("SIGTERM"))).toEqual(signals.SIGTERM);
  });

  it("waits for HTTP close after Vite releases upgraded connections", async () => {
    http.delayClose = true;
    viteClose.mockImplementation(async () => {
      expect(http.close).toHaveBeenCalledOnce();
      http.completeClose();
    });
    const controller = new AbortController();
    const done = start(controller.signal);
    await vi.waitFor(() => {
      expect(http.listen).toHaveBeenCalledOnce();
      expect(process.listeners("SIGTERM").length).toBe(
        signals.SIGTERM.size + 1
      );
    });
    controller.abort();
    await done;
    expectAllClosed();
  });
});
