import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const CLI_PATH = join(__dirname, "../dist/index.cjs");
const isWindows = process.platform === "win32";

type StartOptions = {
  childMode?: "7" | "0" | "wait" | "bare-wait" | "signal" | "spawn-error";
  childSignal?: NodeJS.Signals;
  tunnel?: boolean;
  signal?: NodeJS.Signals;
  signalDuringFailure?: boolean;
  signalGroup?: boolean;
  signalOnChildExit?: boolean;
  tunnelAlreadyExited?: boolean;
  ignoreShutdown?: boolean;
  stallRelease?: boolean;
};

// This preload runs in the CLI and every fixture child. No sockets or listeners
// are allowed. The tunnel command is replaced by a local Node fixture, so npx
// never installs or contacts anything. Only the port probe and tunnel DELETE are
// stubbed; start, child exits, signals, and shutdown use the actual built CLI.
const NETWORK_GUARD = `
import childProcess from "node:child_process";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { appendFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
const event = (value) => appendFileSync(process.env.CLI_START_EVENTS, value + "\\n");
const blocked = () => {
  event("unexpected-network");
  throw new Error("Network disabled in CLI start regression tests");
};
http.request = http.get = https.request = https.get = blocked;
net.connect = net.createConnection = net.Socket.prototype.connect = blocked;
net.Server.prototype.listen = blocked;
globalThis.fetch = async (input, options) => {
  const url = String(input);
  if (url === "http://localhost:0") {
    event("port-probe-blocked");
    throw new Error("Offline port probe");
  }
  if (url === "https://audit.invalid/api/tunnels/audit" && options?.method === "DELETE") {
    event("release-started");
    if (process.env.CLI_START_STALL_RELEASE === "1") {
      return new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          event("release-aborted");
          reject(new Error("Offline release timeout"));
        }, { once: true });
      });
    }
    return new Response(null, { status: 204 });
  }
  return blocked();
};
const originalSpawn = childProcess.spawn;
childProcess.spawn = (command, args, options) => {
  if (command === "npx" && args[0] === "--yes" && args[1] === "@mcp-use/tunnel") {
    // npx needs a Windows shell; the direct Node fixture does not. The CLI's
    // child handle must refer to the fixture, not to a cmd.exe wrapper whose
    // termination can leave the fixture alive and its cwd locked.
    const tunnel = originalSpawn(process.execPath, [process.env.CLI_START_TUNNEL_FILE], {
      ...options,
      shell: false,
    });
    event("tunnel-spawn-pid:" + tunnel.pid);
    return tunnel;
  }
  if (command === "node" && args.length === 1 && args[0] === "dist/index.js") {
    const executable = process.env.CLI_START_MODE === "spawn-error"
      ? join(process.env.CLI_START_PROJECT, "missing-node-executable")
      : process.execPath;
    const server = originalSpawn(executable, args, options);
    server.once("exit", (code, signal) => {
      event("server-exit-event:" + (signal ?? code));
      if (process.env.CLI_START_SIGNAL_ON_CHILD_EXIT === "1" && (signal === "SIGINT" || signal === "SIGTERM")) {
        // Queue a real parent signal in the same child-exit callback dispatch.
        // The CLI must let that signal run after its synchronous exit handler.
        event("parent-signal-queued:" + signal);
        process.kill(process.pid, signal);
      }
    });
    return server;
  }
  throw new Error("Unexpected subprocess in CLI start regression test: " + command);
};
process.on("exit", () => event("exited:" + process.pid));
syncBuiltinESMExports();
`;

const SERVER_FIXTURE = `
import { appendFileSync } from "node:fs";
const event = (value) => appendFileSync(process.env.CLI_START_EVENTS, value + "\\n");
event("server-pid:" + process.pid);
if (process.env.CLI_START_MODE === "wait" || process.env.CLI_START_MODE === "bare-wait") {
  if (process.env.CLI_START_MODE === "wait") {
    process.on("SIGTERM", () => {
      event("server-signal");
      if (process.env.CLI_START_IGNORE_SHUTDOWN === "1") return;
      setTimeout(() => {
        event("server-stopped");
        process.exit(7);
      }, 20);
    });
  }
  console.log("SERVER_READY");
  setInterval(() => {}, 1000);
} else if (process.env.CLI_START_MODE === "signal") {
  process.kill(process.pid, process.env.CLI_START_CHILD_SIGNAL || "SIGTERM");
} else {
  setTimeout(() => process.exit(Number(process.env.CLI_START_MODE)), 80);
}
`;

const TUNNEL_FIXTURE = `
import { appendFileSync } from "node:fs";
const event = (value) => appendFileSync(process.env.CLI_START_EVENTS, value + "\\n");
event("tunnel-pid:" + process.pid);
process.on("SIGINT", () => {
  event("tunnel-signal");
  if (process.env.CLI_START_IGNORE_SHUTDOWN === "1") return;
  setTimeout(() => {
    event("tunnel-stopped");
    process.exit(0);
  }, 100);
});
console.log("https://audit.local.invalid");
if (process.env.CLI_START_TUNNEL_ALREADY_EXITED === "1") {
  setTimeout(() => process.exit(9), 10);
} else {
  setInterval(() => {}, 1000);
}
`;

describe("mcp-use start child exit and shutdown", () => {
  let projectDir: string;
  let eventsPath: string;
  let guardPath: string;
  let tunnelPath: string;
  let cli: ChildProcess | undefined;
  let isolatedGroup = false;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "mcp-cli-start-"));
    eventsPath = join(projectDir, "events.log");
    guardPath = join(projectDir, "guard.mjs");
    tunnelPath = join(projectDir, "tunnel.mjs");
    mkdirSync(join(projectDir, "dist"));
    writeFileSync(eventsPath, "");
    writeFileSync(guardPath, NETWORK_GUARD);
    writeFileSync(tunnelPath, TUNNEL_FIXTURE);
    writeFileSync(join(projectDir, "dist/index.js"), SERVER_FIXTURE);
    writeFileSync(
      join(projectDir, "package.json"),
      JSON.stringify({ name: "offline-start-fixture", type: "module" })
    );
  });

  const events = () => readFileSync(eventsPath, "utf-8").trim().split("\n");

  const expectBeforeCliExit = (event: string) => {
    const entries = events();
    const eventIndex = entries.indexOf(event);
    const cliExitIndex = entries.indexOf(`exited:${cli!.pid}`);
    expect(
      eventIndex,
      `Missing fixture event: ${event}`
    ).toBeGreaterThanOrEqual(0);
    expect(cliExitIndex, "Missing CLI exit event").toBeGreaterThanOrEqual(0);
    expect(eventIndex, `CLI exited before ${event}`).toBeLessThan(cliExitIndex);
  };

  // If an assertion or timeout fails, terminate only the fixture children whose
  // PIDs were recorded in this temporary directory and have no recorded exit.
  const terminateFixtures = () => {
    if (isolatedGroup && cli?.pid) {
      try {
        // Detached Unix CLI groups contain only this test and its children.
        process.kill(-cli.pid, "SIGKILL");
      } catch {
        // The entire fixture group may already have exited.
      }
      return;
    }
    const entries = events();
    for (const entry of entries) {
      const match = /^(?:server|tunnel)-pid:(\d+)$/.exec(entry);
      if (!match || entries.includes(`exited:${match[1]}`)) continue;
      try {
        process.kill(Number(match[1]), "SIGKILL");
      } catch {
        // A fixture may already have exited due to a signal.
      }
    }
    if (cli && cli.exitCode === null && cli.signalCode === null) {
      cli.kill("SIGKILL");
    }
  };

  const waitForFixturesToExit = async () => {
    const fixturePids = events().flatMap((entry) => {
      const match = /^(?:server|tunnel)-pid:(\d+)$/.exec(entry);
      return match ? [Number(match[1])] : [];
    });
    if (cli?.pid) fixturePids.push(cli.pid);
    const deadline = Date.now() + 2000;
    while (true) {
      const running = fixturePids.filter((pid) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
          throw error;
        }
      });
      if (running.length === 0) return;
      if (Date.now() >= deadline) {
        throw new Error(
          `Fixture processes did not exit: ${running.join(", ")}`
        );
      }
      await delay(20);
    }
  };

  afterEach(async () => {
    terminateFixtures();
    await waitForFixturesToExit();
    // Windows can keep the child cwd locked briefly after process termination.
    // Async retries let pending process/stdio close callbacks run as well.
    await rm(projectDir, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
    cli = undefined;
    isolatedGroup = false;
  });

  async function runStart(options: StartOptions = {}) {
    const result = await new Promise<{ code: number | null; output: string }>(
      (resolve, reject) => {
        const args = [CLI_PATH, "start", "--path", projectDir, "--port", "0"];
        if (options.tunnel) args.push("--tunnel");
        isolatedGroup = Boolean(options.signalGroup && !isWindows);
        cli = spawn(process.execPath, args, {
          cwd: projectDir,
          detached: isolatedGroup,
          // Do not inherit credentials or local configuration from the test host.
          env: {
            PATH: process.env.PATH,
            SystemRoot: process.env.SystemRoot,
            TEMP: process.env.TEMP,
            TMP: process.env.TMP,
            TMPDIR: process.env.TMPDIR,
            CI: "true",
            NO_COLOR: "1",
            MCP_USE_ANONYMIZED_TELEMETRY: "false",
            MCP_USE_API: "https://audit.invalid",
            NODE_OPTIONS: `--import=${pathToFileURL(guardPath).href}`,
            CLI_START_EVENTS: eventsPath,
            CLI_START_TUNNEL_FILE: tunnelPath,
            CLI_START_PROJECT: projectDir,
            CLI_START_MODE: options.childMode ?? "7",
            CLI_START_CHILD_SIGNAL: options.childSignal ?? "SIGTERM",
            CLI_START_SIGNAL_ON_CHILD_EXIT: options.signalOnChildExit
              ? "1"
              : "0",
            CLI_START_IGNORE_SHUTDOWN: options.ignoreShutdown ? "1" : "0",
            CLI_START_TUNNEL_ALREADY_EXITED: options.tunnelAlreadyExited
              ? "1"
              : "0",
            CLI_START_STALL_RELEASE: options.stallRelease ? "1" : "0",
          },
        });
        let output = "";
        let signalSent = false;
        const onData = (data: Buffer) => {
          output += data.toString();
          const signalMarker = options.signalDuringFailure
            ? "Shutting down..."
            : "SERVER_READY";
          if (options.signal && !signalSent && output.includes(signalMarker)) {
            signalSent = true;
            if (isolatedGroup) {
              process.kill(-cli!.pid!, options.signal);
            } else {
              cli!.kill(options.signal);
            }
          }
        };
        cli.stdout?.on("data", onData);
        cli.stderr?.on("data", onData);
        const timeout = setTimeout(() => {
          terminateFixtures();
          reject(new Error(`CLI start timeout:\n${output}`));
        }, 10000);
        cli.once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        cli.once("close", (code) => {
          clearTimeout(timeout);
          resolve({ code, output });
        });
      }
    );
    if (options.tunnel) {
      const entries = events();
      const spawnedPid = entries.find((entry) =>
        entry.startsWith("tunnel-spawn-pid:")
      );
      const fixturePid = entries.find((entry) =>
        entry.startsWith("tunnel-pid:")
      );
      expect(spawnedPid, "Missing direct tunnel child handle").toBeDefined();
      expect(fixturePid, "Missing tunnel fixture PID").toBeDefined();
      expect(spawnedPid!.split(":")[1]).toBe(fixturePid!.split(":")[1]);
    }
    return result;
  }

  for (const tunnel of [false, true]) {
    for (const code of [7, 0] as const) {
      it(`preserves child exit ${code}${tunnel ? " with a tunnel" : ""}`, async () => {
        const result = await runStart({
          childMode: String(code) as "7" | "0",
          tunnel,
        });
        expect(result.code, result.output).toBe(code);
        expect(events()).toContain("port-probe-blocked");
        expect(events()).not.toContain("unexpected-network");
        if (tunnel) {
          expect(events()).toContain("release-started");
          if (!isWindows) expectBeforeCliExit("tunnel-stopped");
        }
      });
    }
  }

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    for (const tunnel of [false, true]) {
      it.skipIf(isWindows)(
        `intentional ${signal} exits cleanly${tunnel ? " after tunnel cleanup" : ""}`,
        async () => {
          const result = await runStart({ childMode: "wait", tunnel, signal });
          expect(result.code, result.output).toBe(0);
          expectBeforeCliExit("server-stopped");
          if (tunnel) expectBeforeCliExit("tunnel-stopped");
          expect(events()).not.toContain("unexpected-network");
        }
      );
    }
    for (const tunnel of [false, true]) {
      it.skipIf(isWindows)(
        `process-group ${signal} exits cleanly${tunnel ? " with a tunnel" : ""}`,
        async () => {
          const result = await runStart({
            childMode: "bare-wait",
            tunnel,
            signal,
            signalGroup: true,
          });
          expect(result.code, result.output).toBe(0);
          const childExit = events().find((event) =>
            /^server-exit-event:SIG(INT|TERM)$/.test(event)
          );
          expect(childExit, "Child must terminate from a signal").toBeDefined();
          expectBeforeCliExit(childExit!);
          expect(events()).not.toContain("unexpected-network");
        }
      );
    }
    it.skipIf(isWindows)(
      `parent ${signal} overrides the matching child signal received first`,
      async () => {
        const result = await runStart({
          childMode: "signal",
          childSignal: signal,
          tunnel: true,
          signal,
          signalDuringFailure: true,
        });
        expect(result.code, result.output).toBe(0);
        expectBeforeCliExit(`server-exit-event:${signal}`);
        expectBeforeCliExit("tunnel-stopped");
        expect(events()).not.toContain("unexpected-network");
      }
    );
    it.skipIf(isWindows)(
      `queued parent ${signal} wins a matching child signal without a tunnel`,
      async () => {
        const result = await runStart({
          childMode: "signal",
          childSignal: signal,
          signalOnChildExit: true,
        });
        expect(result.code, result.output).toBe(0);
        expectBeforeCliExit(`server-exit-event:${signal}`);
        expectBeforeCliExit(`parent-signal-queued:${signal}`);
        expect(events()).not.toContain("unexpected-network");
      }
    );
  }

  it.skipIf(isWindows)(
    "does not mask child SIGKILL when a later parent signal arrives",
    async () => {
      const result = await runStart({
        childMode: "signal",
        childSignal: "SIGKILL",
        tunnel: true,
        signal: "SIGTERM",
        signalDuringFailure: true,
      });
      expect(result.code, result.output).toBe(137);
      expectBeforeCliExit("tunnel-stopped");
      expect(events()).not.toContain("unexpected-network");
    }
  );

  for (const [signal, code] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const) {
    it.skipIf(isWindows)(
      `propagates unexpected child ${signal} termination as failure`,
      async () => {
        const result = await runStart({
          childMode: "signal",
          childSignal: signal,
        });
        expect(result.code, result.output).toBe(code);
        expect(events()).not.toContain("unexpected-network");
      }
    );
  }

  it("handles an established tunnel that already exited", async () => {
    const result = await runStart({ tunnel: true, tunnelAlreadyExited: true });
    expect(result.code, result.output).toBe(7);
    expect(events()).toContain("release-started");
    expect(events()).not.toContain("unexpected-network");
  });

  it.skipIf(isWindows)(
    "does not replace a failure with a later shutdown signal",
    async () => {
      const result = await runStart({
        tunnel: true,
        signal: "SIGTERM",
        signalDuringFailure: true,
      });
      expect(result.code, result.output).toBe(7);
      expect(
        events().filter((event) => event === "release-started")
      ).toHaveLength(1);
      expectBeforeCliExit("tunnel-stopped");
      expect(events()).not.toContain("unexpected-network");
    }
  );

  it.skipIf(isWindows)(
    "bounds cleanup when children ignore graceful shutdown",
    async () => {
      const result = await runStart({
        childMode: "wait",
        tunnel: true,
        signal: "SIGTERM",
        ignoreShutdown: true,
      });
      expect(result.code, result.output).toBe(0);
      expect(events()).toContain("server-signal");
      expect(events()).toContain("tunnel-signal");
      expect(events()).not.toContain("server-stopped");
      expect(events()).not.toContain("tunnel-stopped");
      expect(events()).not.toContain("unexpected-network");
    }
  );

  it("bounds a stalled tunnel release without masking the failure", async () => {
    const result = await runStart({ tunnel: true, stallRelease: true });
    expect(result.code, result.output).toBe(7);
    expectBeforeCliExit("release-aborted");
    expect(events()).not.toContain("unexpected-network");
  });

  it("cleans up a tunnel after a server spawn error", async () => {
    const result = await runStart({ childMode: "spawn-error", tunnel: true });
    expect(result.code, result.output).toBe(1);
    expect(result.output).toContain("Server failed:");
    expect(events()).toContain("release-started");
    if (!isWindows) expectBeforeCliExit("tunnel-stopped");
    expect(events()).not.toContain("unexpected-network");
  });
});
