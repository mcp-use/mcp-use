/** Exercise the real dev reconciliation loop without binding HTTP or HMR sockets. */
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServer: vi.fn(),
  createNodeServer: vi.fn(),
  importEntry: vi.fn(),
  publish: vi.fn(),
}));

vi.mock("vite", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vite")>()),
  createServer: mocks.createServer,
  createServerModuleRunner: () => ({
    import: mocks.importEntry,
    evaluatedModules: { clear: vi.fn() },
    close: vi.fn(),
  }),
}));
vi.mock("node:http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:http")>()),
  createServer: mocks.createNodeServer,
}));
vi.mock("@modelcontextprotocol/server", () => ({
  InMemoryServerEventBus: class {
    publish = mocks.publish;
  },
  localhostAllowedHostnames: vi.fn(),
  localhostAllowedOrigins: vi.fn(),
  validateHostHeader: vi.fn(),
  validateOriginHeader: vi.fn(),
}));
vi.mock("@mcp-use/tunnel", () => ({
  createTunnelManager: () => ({
    stop: vi.fn(),
    status: () => ({ url: null }),
  }),
}));
vi.mock("@tailwindcss/vite", () => ({ default: vi.fn() }));
vi.mock("@vitejs/plugin-react", () => ({ default: vi.fn() }));
vi.mock("../../src/cli/port.js", () => ({
  resolvePort: async () => ({ port: 3000, requested: 3000 }),
}));
vi.mock("../../src/cli/mcp-env-declaration.js", () => ({
  syncMcpEnvDeclaration: vi.fn(),
}));

import { runDev } from "../../src/cli/dev.js";

function server() {
  return {
    fetch: async () => new Response("ok"),
    __setEventBus: vi.fn(),
    __setRequestLogPrefix: vi.fn(),
    __mount: vi.fn(),
    __primeViews: vi.fn(),
    __primeSkills: vi.fn(),
    __skillsConfig: () => false,
  };
}

let cwd: string;
let viewPath: string;
let watcher: EventEmitter;
let controller: AbortController;
let done: Promise<void> | undefined;

function writeConfig(source: string): void {
  writeFileSync(
    viewPath,
    `export const viewConfig = ${source};\nexport default () => null;\n`
  );
}

async function changeConfig(source: string): Promise<void> {
  writeConfig(source);
  watcher.emit("change", viewPath);
  await vi.advanceTimersByTimeAsync(100);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubEnv("MCP_URL", "http://localhost:3000");
  vi.stubEnv("PORT", "3000");
  vi.stubEnv("MCP_USE_DEV_CLI", "1");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  cwd = mkdtempSync(join(tmpdir(), "mcp-dev-view-config-"));
  viewPath = join(cwd, "views", "example", "view.tsx");
  mkdirSync(join(cwd, "views", "example"), { recursive: true });
  writeFileSync(join(cwd, "index.ts"), "export default {};\n");
  writeFileSync(join(cwd, "package.json"), '{"type":"module"}');
  const bridgeDir = join(cwd, "node_modules", "mcp-use");
  mkdirSync(bridgeDir, { recursive: true });
  writeFileSync(
    join(bridgeDir, "package.json"),
    '{"name":"mcp-use","type":"module","exports":{"./node":"./node.js"}}'
  );
  writeFileSync(
    join(bridgeDir, "node.js"),
    "export const toNodeHandler = () => async () => {};\n"
  );
  writeConfig("{ autoResize: true }");
  watcher = Object.assign(new EventEmitter(), { add: vi.fn() });
  mocks.createServer.mockResolvedValue({
    watcher,
    environments: { ssr: { moduleGraph: {} } },
    close: vi.fn(),
  });
  mocks.createNodeServer.mockReturnValue(
    Object.assign(new EventEmitter(), {
      listen: (_port: number, _host: string, callback: () => void) =>
        callback(),
      close: (callback: () => void) => callback(),
      closeAllConnections: vi.fn(),
    })
  );
  mocks.importEntry.mockImplementation(async () => ({ default: server() }));
  controller = new AbortController();
});

afterEach(async () => {
  controller.abort();
  await done;
  done = undefined;
  rmSync(cwd, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function start(): Promise<void> {
  done = runDev({
    cwd,
    inspector: false,
    open: false,
    signal: controller.signal,
  });
  await vi.waitFor(() => {
    expect(console.log).toHaveBeenCalledWith("[mcp-use] dev server ready");
  });
}

describe("dev view config reconciliation", () => {
  it.each(["__primeViews", "__mount"] as const)(
    "retries an unchanged config after a candidate fails in %s",
    async (failurePoint) => {
      await start();
      const candidate = server();
      candidate[failurePoint].mockImplementation(() => {
        throw new Error("candidate failed");
      });
      mocks.importEntry.mockResolvedValueOnce({ default: candidate });

      await changeConfig("{ autoResize: false }");
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("keeping the previous server: candidate failed")
      );
      expect(mocks.publish).not.toHaveBeenCalled();

      await changeConfig("{ autoResize: false }");
      expect(mocks.importEntry).toHaveBeenCalledTimes(3);
      expect(mocks.publish).toHaveBeenCalledTimes(3);
      await changeConfig("{ autoResize: false }");
      expect(mocks.importEntry).toHaveBeenCalledTimes(3);
    }
  );

  it("retains the active config when a stale candidate is discarded", async () => {
    await start();
    const candidate = server();
    candidate.__mount.mockImplementation(() => {
      writeConfig("{ autoResize: false, displayModes: ['inline'] }");
      watcher.emit("change", viewPath);
    });
    mocks.importEntry
      .mockResolvedValueOnce({ default: candidate })
      .mockRejectedValue(new Error("newer entry failed"));

    await changeConfig("{ autoResize: false }");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("keeping the previous server: newer entry failed")
    );
    expect(mocks.publish).not.toHaveBeenCalled();
    const attempts = mocks.importEntry.mock.calls.length;
    mocks.importEntry.mockImplementation(async () => ({ default: server() }));

    await changeConfig("{ autoResize: false }");
    expect(mocks.importEntry).toHaveBeenCalledTimes(attempts + 1);
    expect(mocks.publish).toHaveBeenCalledTimes(3);
  });

  it("keeps component HMR for key reordering but reloads changed values", async () => {
    writeConfig("{ autoResize: true, displayModes: ['inline', 'fullscreen'] }");
    await start();

    await changeConfig(
      "{ displayModes: ['inline', 'fullscreen'], autoResize: true }"
    );
    expect(mocks.importEntry).toHaveBeenCalledTimes(1);
    expect(mocks.publish).not.toHaveBeenCalled();

    await changeConfig(
      "{ displayModes: ['inline', 'fullscreen'], autoResize: false }"
    );
    expect(mocks.importEntry).toHaveBeenCalledTimes(2);
    expect(mocks.publish).toHaveBeenCalledTimes(3);
  });
});
