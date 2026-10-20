/**
 * SIGINT/SIGTERM in real Node processes: the package is bundled once and run
 * in a child that records one event and then idles like a listening server,
 * with an ingest whose `GET /v1/config` never answers.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { build } from "tsup";

import { startIngest, type MockIngest } from "./helpers/ingest.js";

/**
 * The child: an SDK-shaped server with one handler, instrumented, one request
 * recorded (the flush interval is long, so it stays queued), then idle.
 * `MODE` adds the shutdown code an application or framework would have.
 */
const CHILD = `
const { instrument, shutdown } = await import(process.env.ANALYTICS_BUNDLE);
const mode = process.env.MODE ?? "";
if (mode === "framework-exit") {
  // Skybridge's app.run(): registered when the server starts, before any
  // request; drops its handlers, closes the HTTP server and exits once it
  // closed (about 600 ms with a keep-alive client).
  const stop = () => {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    setTimeout(() => process.exit(0), 600);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
if (mode === "framework-exit-now") {
  // Skybridge again, with no connection left to drain: its HTTP server closes
  // at once and it exits in the same tick.
  process.on("SIGTERM", () => process.nextTick(() => process.exit(3)));
}
if (mode === "app-handles") {
  process.on("SIGTERM", () => console.log("app handled SIGTERM"));
}
if (mode === "await-shutdown") {
  process.once("SIGINT", async () => {
    await shutdown();
    console.log("shutdown resolved");
    process.exit(0);
  });
}
const server = {
  _requestHandlers: new Map([
    ["tools/call", async () => ({ content: [{ type: "text", text: "ok" }] })],
  ]),
};
instrument(server, {
  apiKey: "mfi_signal_test_000000000000000000000000",
  endpoint: process.env.INGEST_URL,
  flushIntervalMs: 60_000,
});
await server._requestHandlers.get("tools/call")(
  { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "echo" } },
  {}
);
console.log("ready " + process.listenerCount("SIGINT") + " " + process.listenerCount("SIGTERM"));
setInterval(() => undefined, 60_000);
`;

let dir: string;
let ingest: MockIngest;
const children: ChildProcess[] = [];

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "mcp-use-analytics-signals-"));
  await build({
    entry: { index: "src/index.ts" },
    format: ["esm"],
    outDir: dir,
    outExtension: () => ({ js: ".mjs" }),
    platform: "node",
    target: "es2022",
    config: false,
    dts: false,
    clean: false,
    splitting: false,
    sourcemap: false,
    silent: true,
  });
  await writeFile(join(dir, "server.mjs"), CHILD);
}, 60_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  ingest = await startIngest();
  ingest.holdConfig = true;
});

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  }
  await ingest.close();
});

interface Run {
  child: ChildProcess;
  output: () => string;
  /** Exit code and signal, and how long after `kill()` the process ended. */
  exited: Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
    afterMs: number;
  }>;
  kill: (signal: NodeJS.Signals) => void;
}

async function start(
  mode: string,
  env: Record<string, string> = {}
): Promise<Run> {
  const child = spawn(process.execPath, [join(dir, "server.mjs")], {
    env: {
      ...process.env,
      ANALYTICS_BUNDLE: join(dir, "index.mjs"),
      INGEST_URL: ingest.url,
      MODE: mode,
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let out = "";
  child.stdout!.on("data", (chunk: Buffer) => (out += chunk.toString()));
  child.stderr!.on("data", (chunk: Buffer) => (out += chunk.toString()));
  let killedAt = 0;
  const exited = once(child, "exit").then(([code, signal]) => ({
    code: code as number | null,
    signal: signal as NodeJS.Signals | null,
    afterMs: Date.now() - killedAt,
  }));
  await vi.waitFor(
    () => {
      if (child.exitCode !== null) throw new Error(`child exited: ${out}`);
      expect(out).toMatch(/ready \d+ \d+/);
    },
    { timeout: 10_000, interval: 10 }
  );
  return {
    child,
    output: () => out,
    exited,
    kill: (signal) => {
      killedAt = Date.now();
      child.kill(signal);
    },
  };
}

function recorded(): string[] {
  return ingest.events().map((e) => `${e.method} ${e.target ?? ""}`.trim());
}

describe("SIGINT and SIGTERM", () => {
  it.each(["SIGINT", "SIGTERM"] as const)(
    "flush queued events on %s when nothing else handles it, then the process still dies by the signal",
    async (signal) => {
      const run = await start("");
      expect(run.output()).toContain("ready 1 1");
      run.kill(signal);
      const exit = await run.exited;
      expect(exit).toMatchObject({ code: null, signal });
      // Sent without waiting for GET /v1/config, which never answers here.
      expect(exit.afterMs).toBeLessThan(1_500);
      expect(recorded()).toEqual(["tools/call echo"]);
      expect(ingest.requests.some((r) => r.path === "/v1/config")).toBe(true);
    }
  );

  it("delivers before a framework handler exits the process 600 ms later (Skybridge)", async () => {
    const run = await start("framework-exit");
    run.kill("SIGINT");
    const exit = await run.exited;
    // The framework's own exit: code 0, about 600 ms after the signal.
    expect(exit).toMatchObject({ code: 0, signal: null });
    expect(exit.afterMs).toBeGreaterThanOrEqual(550);
    expect(recorded()).toEqual(["tools/call echo"]);
  });

  it("holds a framework's immediate process.exit() until the events are sent, keeping its exit code", async () => {
    const run = await start("framework-exit-now");
    run.kill("SIGTERM");
    const exit = await run.exited;
    expect(exit).toMatchObject({ code: 3, signal: null });
    expect(exit.afterMs).toBeLessThan(1_500);
    expect(recorded()).toEqual(["tools/call echo"]);
  });

  it("never exits a process whose application handles the signal", async () => {
    const run = await start("app-handles");
    run.kill("SIGTERM");
    await vi.waitFor(() => expect(recorded()).toEqual(["tools/call echo"]), {
      timeout: 5_000,
      interval: 20,
    });
    // Longer than the 2 s flush bound: still running.
    await new Promise((resolve) => setTimeout(resolve, 2_300));
    expect(run.child.exitCode).toBeNull();
    expect(run.child.signalCode).toBeNull();
    expect(run.output()).toContain("app handled SIGTERM");
    run.kill("SIGKILL");
    expect(await run.exited).toMatchObject({ signal: "SIGKILL" });
  });

  it("sends each event once when the application awaits shutdown() in its handler", async () => {
    const run = await start("await-shutdown");
    run.kill("SIGINT");
    const exit = await run.exited;
    expect(exit).toMatchObject({ code: 0, signal: null });
    expect(exit.afterMs).toBeLessThan(1_500);
    expect(run.output()).toContain("shutdown resolved");
    expect(recorded()).toEqual(["tools/call echo"]);
  });

  it("installs no signal handler while analytics are disabled", async () => {
    const run = await start("", { MANUFACT_ANALYTICS_DISABLED: "1" });
    expect(run.output()).toContain("ready 0 0");
    run.kill("SIGINT");
    expect(await run.exited).toMatchObject({ code: null, signal: "SIGINT" });
    expect(ingest.requests).toHaveLength(0);
  });
});
